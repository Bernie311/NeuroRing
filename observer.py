"""Metadata-only observer for Codex desktop's existing read-only follower channel."""
import threading,time,uuid
from transport import Pipe,Frames

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
                requests=state.get('requests') or []
                if isinstance(requests,dict):requests=list(requests.values())
                approval=any(isinstance(r,dict) and 'requestApproval' in str(r.get('method','')) for r in requests)
                self.views[sid]={'status':status,'approval':approval,'checkedAt':now,
                                 'revision':change.get('revision'),'owner':obj.get('sourceClientId')}
            elif change.get('type')=='patches':
                v=self.views.get(sid)
                if not v or v.get('owner')!=obj.get('sourceClientId') or v.get('revision')!=change.get('baseRevision'):
                    self.views.pop(sid,None);return
                v['revision']=change.get('revision')
                for patch in change.get('patches',[]):
                    path=patch.get('path',[]);value=patch.get('value')
                    if path==['threadRuntimeStatus']:v['status']=(value or {}).get('type') if isinstance(value,dict) else None
                    elif path==['threadRuntimeStatus','type']:v['status']=value
                    elif path and path[0]=='requests':v['approval']=False
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
