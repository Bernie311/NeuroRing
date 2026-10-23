"""Read-only local project/thread metadata and bounded activity tails."""
import collections,datetime,json,os,pathlib,sqlite3,sys,time

LABELS={'task_started':'本轮开始','task_complete':'本轮结束','task_completed':'本轮结束',
        'turn_aborted':'本轮中断','turn_completed':'本轮结束'}
TERMINAL={'task_complete','task_completed','turn_completed','turn_aborted'}

class DataUnavailable(Exception):
    def __init__(self,code,message):
        super().__init__(message)
        self.code=code

def stamp(s):
    try:return datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
    except (ValueError,AttributeError):return 0

class Source:
    def __init__(self,observer,base=None):
        self.home=pathlib.Path(base or os.environ.get('NEURORING_CODEX_HOME') or os.environ.get('CODEX_HOME') or pathlib.Path.home()/'.codex').expanduser().resolve();self.observer=observer;self.cache={}
        catalog_path=(pathlib.Path(sys.executable).resolve().parent/'catalog.json' if getattr(sys,'frozen',False)
                      else pathlib.Path(__file__).with_name('catalog.json'))
        self.catalog=(json.loads(catalog_path.read_text(encoding='utf-8'))
                      if catalog_path.exists() else {'capturedAt':None,'projects':[]})
    def activity(self,path):
        try:
            p=pathlib.Path(path);stat=p.stat();key=(stat.st_size,stat.st_mtime_ns)
            if path in self.cache and self.cache[path][0]==key:return self.cache[path][1]
            with p.open('rb') as f:
                start=max(0,stat.st_size-256000);f.seek(start);raw=f.read()
            lines=raw.splitlines()[1:] if start else raw.splitlines()
            events=[];terminal=None;last=0
            for line in lines:
                try:e=json.loads(line)
                except (ValueError,UnicodeDecodeError):continue
                pl=e.get('payload') or {};kind=pl.get('type');at=stamp(e.get('timestamp'));last=max(last,at)
                if e.get('type')=='event_msg' and kind in LABELS:
                    terminal=kind;events.append({'at':at,'kind':kind,'label':LABELS[kind]})
                elif e.get('type')=='response_item' and kind in ('function_call','custom_tool_call'):
                    name=str(pl.get('name') or '工具')[:100]
                    events.append({'at':at,'kind':'tool','label':'调用工具 · '+name})
            value={'events':events[-12:],'terminal':terminal,'last':last}
            self.cache[path]=(key,value);return value
        except OSError:return {'events':[],'terminal':None,'last':0}
    def collect(self):
        if not (self.home/'state_5.sqlite').is_file():
            if any(self.home.glob('state_*.sqlite')):
                raise DataUnavailable('incompatible','当前 Codex 数据版本暂不兼容，请检查 NeuroRing 是否有新版本。')
            raise DataUnavailable('missing','尚未发现本机 Codex 数据。请先打开 Codex 桌面版，登录并创建一条聊天；本页会自动重试。')
        config=self.home/'.codex-global-state.json'
        if not config.is_file():
            raise DataUnavailable('missing','尚未发现 Codex 桌面配置。请先打开 Codex 桌面版并创建一条聊天；本页会自动重试。')
        now=time.time();g=json.loads(config.read_text(encoding='utf-8'))
        c=sqlite3.connect((self.home/'state_5.sqlite').as_uri()+'?mode=ro',uri=True,timeout=2)
        c.row_factory=sqlite3.Row
        try:
            rows=[dict(r) for r in c.execute('SELECT id,name,title,cwd,project_id,model,agent_nickname,agent_role,rollout_path,updated_at,updated_at_ms,created_at,source FROM threads WHERE archived=0 ORDER BY COALESCE(updated_at_ms,updated_at*1000) DESC')]
            dbprojects={r['id']:r['name'] for r in c.execute('SELECT id,name FROM projects')}
            edges=[dict(r) for r in c.execute('SELECT parent_thread_id,child_thread_id FROM thread_spawn_edges')]
        finally:c.close()
        migrated={}
        for mapping in g.get('app-server-project-id-by-legacy-project-id-by-host',{}).values():
            if isinstance(mapping,dict):migrated.update(mapping)
        reverse={v:k for k,v in migrated.items()};assign=g.get('thread-project-assignments',{})
        projects={p['projectId']:{'id':p['projectId'],'name':p['label'],'path':p.get('path'),'kind':p['projectKind']} for p in self.catalog['projects']}
        # Refresh known local project names and discover newly saved local projects.
        order=set(g.get('project-order',[]))
        for pid,p in g.get('local-projects',{}).items():
            if pid in projects or pid in order:
                projects[pid]={'id':pid,'name':p['name'],'path':(p.get('rootPaths') or [None])[0],'kind':'local'}
        out=[];events=[]
        self.observer.targets=[r['id'] for r in rows[:8]]
        for i,r in enumerate(rows):
            assignment=assign.get(r['id']) or {};pid=reverse.get(r['project_id'],r['project_id'])
            # The desktop migration explicitly marks whether assignments reached SQLite.
            migration=next(iter(g.get('app-server-projects-migration-by-host',{}).values()),{})
            if not migration.get('threadAssignmentsMigrated',False) and assignment.get('projectId'):pid=assignment['projectId']
            if not pid:pid='unassigned'
            if pid not in projects:
                old=g.get('local-projects',{}).get(pid,{})
                projects[pid]={'id':pid,'name':'独立聊天' if pid=='unassigned' else old.get('name') or dbprojects.get(r['project_id']) or '历史项目 · '+pid[:8],'kind':'local'}
            a=self.activity(r['rollout_path']) if i<120 else {'events':[],'terminal':None,'last':0}
            live=self.observer.get(r['id']);status='unknown';label='未同步实时状态';evidence='本地任务索引'
            checked=None
            if live and live.get('status') in ('active','idle','notLoaded','systemError'):
                status={'active':'active','idle':'idle','notLoaded':'unknown','systemError':'attention'}[live['status']]
                label={'active':'运行中','idle':'空闲','notLoaded':'未载入','systemError':'需关注'}[live['status']]
                if status=='active' and live.get('approval'):status='attention';label='等待批准'
                evidence='桌面实时状态';checked=live['checkedAt']
            elif a['terminal'] in TERMINAL:
                status='ended';label='最近一轮已中断' if a['terminal']=='turn_aborted' else '最近一轮已结束';evidence='本地事件记录'
            elif a['last'] and now-a['last']<30:status='recent';label='最近有活动';evidence='本地事件记录'
            name=str(r['name'] or r['title'] or (('子任务 · '+r['agent_nickname']) if r['agent_nickname'] else '未命名聊天')).split('\n')[0][:160]
            task={'id':r['id'],'name':name,'projectId':pid,'cwd':r['cwd'],'model':r['model'],
                  'updatedAt':(r['updated_at_ms']/1000 if r['updated_at_ms'] else r['updated_at']),
                  'status':status,'statusLabel':label,'evidence':evidence,'checkedAt':checked,
                  'agentNickname':r['agent_nickname'],'agentRole':r['agent_role']}
            out.append(task)
            for event in a['events']:events.append({**event,'threadId':r['id'],'threadName':name,'projectId':pid})
        ids={r['id'] for r in out};counts=collections.Counter(r['projectId'] for r in out)
        for p in projects.values():p['count']=counts[p['id']]
        return {'generatedAt':now,'ok':True,'projects':list(projects.values()),'threads':out,
                'edges':[{'source':e['parent_thread_id'],'target':e['child_thread_id']} for e in edges if e['parent_thread_id'] in ids and e['child_thread_id'] in ids],
                'events':sorted(events,key=lambda e:e['at'],reverse=True)[:160],
                'connection':{'connected':self.observer.connected,'synced':sum(t['checkedAt'] is not None for t in out),'error':self.observer.error},
                'coverage':{'localCodex':True,'cloudChatGPT':False,'tailThreads':min(120,len(rows)),'catalogCapturedAt':self.catalog['capturedAt']}}
