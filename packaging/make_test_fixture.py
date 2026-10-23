"""Synthetic Codex-shaped metadata for isolated package acceptance only."""
import json
from pathlib import Path
import sqlite3
import sys
import time

target=Path(sys.argv[1])
target.mkdir(parents=True,exist_ok=True)
(target/'.codex-global-state.json').write_text('{}',encoding='utf-8')
db=sqlite3.connect(target/'state_5.sqlite')
db.executescript('''
CREATE TABLE threads(id TEXT,name TEXT,title TEXT,cwd TEXT,project_id TEXT,model TEXT,
 agent_nickname TEXT,agent_role TEXT,rollout_path TEXT,updated_at REAL,updated_at_ms REAL,
 created_at REAL,source TEXT,archived INTEGER);
CREATE TABLE projects(id TEXT,name TEXT);
CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT);
''')
db.execute('INSERT INTO projects VALUES (?,?)',('synthetic-project','Synthetic demo project'))
for index in range(3):
    db.execute('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
       (f'synthetic-task-{index}',f'Synthetic demo task {index}',None,'C:/SyntheticDemo',
        'synthetic-project','test-model',None,None,'C:/SyntheticDemo/missing.jsonl',
        time.time(),None,time.time(),'test',0))
db.execute('INSERT INTO thread_spawn_edges VALUES (?,?)',('synthetic-task-0','synthetic-task-1'))
db.commit();db.close()
