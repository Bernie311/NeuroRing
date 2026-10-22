"""Metadata-only observer for Codex desktop's existing read-only follower channel."""
import threading,time,uuid
from transport import Pipe,Frames


def _approval_flag(request):
    if not isinstance(request,dict):raise ValueError('Invalid request metadata')
    method=request.get('method','')
    if not isinstance(method,str):raise ValueError('Invalid request method')
    return 'requestApproval' in method


def _request_flags(requests):
    """Keep only one approval bit per request, never request parameters/body."""
    if requests is None:return []
    if isinstance(requests,list):return [_approval_flag(request) for request in requests]
    if isinstance(requests,dict):return {key:_approval_flag(request) for key,request in requests.items()}
    raise ValueError('Invalid requests collection')


def _patch_request_flags(flags,patch):
    """Apply supported Immer request patches to the metadata-only projection."""
    op=patch.get('op');path=patch['path'];value=patch.get('value')
    if op not in ('add','replace','remove'):raise ValueError('Unsupported request patch')
    if op!='remove' and 'value' not in patch:raise ValueError('Missing request patch value')
    if len(path)==1:return [] if op=='remove' else _request_flags(value)
    key=path[1]
    if isinstance(flags,list):
        if type(key) is not int or key<0:raise ValueError('Invalid request index')
        exists=key<len(flags)
    else:
        if not isinstance(key,str):raise ValueError('Invalid request key')
        exists=key in flags
    if len(path)>2:
        if not exists or len(path)!=3 or path[2]!='method':
            raise ValueError('Unsupported nested request patch')
        if op!='remove' and not isinstance(value,str):raise ValueError('Invalid request method')
        flags[key]=False if op=='remove' else 'requestApproval' in value
    elif op=='add':
        flag=_approval_flag(value)
        if isinstance(flags,list):
            if key>len(flags):raise ValueError('Invalid request index')
            flags.insert(key,flag)
        else:flags[key]=flag
    else:
        if not exists:raise ValueError('Missing request')
        if op=='remove':del flags[key]
        else:flags[key]=_approval_flag(value)
    return flags


def _has_approval(flags):
    return any(flags.values() if isinstance(flags,dict) else flags)


class Observer:
    def __init__(self):
        self.targets=[]; self.views={}; self.connected=False; self.error=None
        self.stop=threading.Event(); self.lock=threading.Lock()
    def follow(self,p,cid,sid,value=True):
        p.send({'type':'broadcast','sourceClientId':cid,'version':1,
                'method':'thread-stream-following-changed',
                'params':{'conversationId':sid,'hostId':'local','following':value}})
    def get(self,sid):
        with self.lock: v=dict(self.views.get(sid,{}))
        if not self.connected or time.time()-v.get('checkedAt',0)>50:return None
        v.pop('_requests',None)
        return v
    def consume(self,obj,cid):
        if obj.get('type')!='broadcast' or obj.get('sourceClientId')==cid:return
        p=obj.get('params') or {};sid=p.get('conversationId')
        if obj.get('method')!='thread-stream-state-changed' or p.get('hostId')!='local' or sid not in self.targets:return
        if obj.get('version')!=11:
            self.error='状态协议版本变化';return
        change=p.get('change') or {};now=time.time()
        with self.lock:
            if change.get('type')=='snapshot':
                state=change.get('conversationState') or {}
                status=(state.get('threadRuntimeStatus') or {}).get('type')
                # Only status metadata survives this method; no message text is stored.
                try:requests=_request_flags(state.get('requests'))
                except ValueError:self.views.pop(sid,None);return
                self.views[sid]={'status':status,'approval':_has_approval(requests),'_requests':requests,'checkedAt':now,
                                 'revision':change.get('revision'),'owner':obj.get('sourceClientId')}
            elif change.get('type')=='patches':
                v=self.views.get(sid)
                if not v or v.get('owner')!=obj.get('sourceClientId') or v.get('revision')!=change.get('baseRevision'):
                    self.views.pop(sid,None);return
                v['revision']=change.get('revision')
                for patch in change.get('patches',[]):
                    path=patch.get('path',[]);value=patch.get('value')
                    if not isinstance(path,list) or not path:
                        self.views.pop(sid,None);return
                    if path==['threadRuntimeStatus']:v['status']=(value or {}).get('type') if isinstance(value,dict) else None
                    elif path==['threadRuntimeStatus','type']:v['status']=value
                    elif path and path[0]=='requests':
                        try:v['_requests']=_patch_request_flags(v['_requests'],patch)
                        except ValueError:
                            # Require a fresh snapshot when the projection cannot
                            # follow a request change; never guess "no approval".
                            self.views.pop(sid,None);return
                        v['approval']=_has_approval(v['_requests'])
                # Runtime status is authoritative; turn/tool updates cannot override it.
                v['checkedAt']=now
    def run(self):
        while not self.stop.is_set():
            p=None;cid=None;subscribed=set()
            try:
                p=Pipe();p.send({'type':'request','requestId':str(uuid.uuid4()),'sourceClientId':'initializing-client',
                    'version':0,'method':'initialize','params':{'clientType':'codex-project-screen-observer'}})
                frames=Frames();start=time.monotonic();last=0
                while not self.stop.is_set():
                    data=p.read()
                    if data:
                        for obj in frames.feed(data):
                            if obj.get('type')=='client-discovery-request':
                                p.send({'type':'client-discovery-response','requestId':obj['requestId'],'response':{'canHandle':False}})
                            elif obj.get('type')=='response' and obj.get('method')=='initialize':
                                if obj.get('resultType')!='success':raise ValueError('初始化未成功')
                                cid=obj['result']['clientId'];self.connected=True;self.error=None
                            elif obj.get('method')=='ipc-connection-reset':raise OSError('连接重置')
                            else:self.consume(obj,cid)
                    if not cid and time.monotonic()-start>5:raise TimeoutError('连接超时')
                    if cid and time.monotonic()-last>35:
                        wanted=set(self.targets)
                        for sid in subscribed-wanted:self.follow(p,cid,sid,False)
                        for sid in wanted:
                            if sid not in subscribed or not self.get(sid) or time.time()-self.get(sid)['checkedAt']>30:self.follow(p,cid,sid)
                        subscribed=wanted;last=time.monotonic()
                    self.stop.wait(.001 if data else .1)
            except Exception as exc:self.error=type(exc).__name__
            finally:
                self.connected=False
                with self.lock:self.views.clear()
                if p:
                    try:
                        for sid in subscribed:self.follow(p,cid,sid,False)
                    except Exception:pass
                    p.close()
            self.stop.wait(3)
