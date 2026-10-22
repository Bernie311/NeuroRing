const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeState,createCursor,buildRows}=require('../web/task-band.js');
const state=()=>({ok:true,generatedAt:1000,connection:{connected:true},threads:[
  {id:'a',status:'active',checkedAt:995,updatedAt:900},
  {id:'b',status:'ended',statusLabel:'最近一轮已中断',updatedAt:980}],events:[]});
test('independent expiry of snapshot, connection, and thread never keeps RUN',()=>{
  for(const alter of [s=>s.generatedAt=980,s=>s.connection.connected=false,s=>s.threads[0].checkedAt=949]){
    const s=state();alter(s);assert.equal(normalizeState(s,1000).threads[0].status,'unknown');
  }
  assert.equal(normalizeState(state(),1000,true).threads[0].status,'unknown');
  assert.equal(normalizeState(state(),1000).threads[0].status,'active');
});
test('retains terminal/interruption meaning and does not invent verification or mutate source',()=>{
  const s=state(),before=structuredClone(s),n=normalizeState(s,1000);
  assert.deepEqual(s,before);assert.equal(n.threads[1].statusLabel,'最近一轮已中断');
  assert.equal(n.threads[1].verification,undefined);assert.equal(n.threads[1].progress,undefined);
});
test('historical first load, repeat polls and old/future arrivals never flash',()=>{
  const c=createCursor(),a={at:999,threadId:'a',kind:'tool',label:'调用工具 · read'};
  assert.deepEqual(c.ingest([a],1000),[]);assert.deepEqual(c.ingest([a],1001),[]);
  const b={...a,at:1001};assert.deepEqual(c.ingest([a,b],1002),[b]);
  assert.deepEqual(c.ingest([{...a,at:1},{...a,at:1500}],1002),[]);
  c.ingest([],1003);assert.deepEqual(c.ingest([a,b],1004),[]);
});
test('an empty first snapshot is still a baseline; newly observed event can light up',()=>{
  const c=createCursor();assert.deepEqual(c.ingest([],1000),[]);
  const e={threadId:'a',at:1001,kind:'tool',label:'read'};assert.deepEqual(c.ingest([e],1002),[e]);
});
test('active first, then recent records; filtered subset stays filtered',()=>{
  const s=state();s.events=[{threadId:'b',at:990,kind:'tool',label:'new'},{threadId:'b',at:985,kind:'tool',label:'old'}];
  const rows=buildRows(s,s.threads);assert.equal(rows[0].id,'a');assert.equal(rows[1].tool.label,'new');
  assert.deepEqual(buildRows(s,[s.threads[1]]).map(r=>r.id),['b']);assert.deepEqual(buildRows(s,[]),[]);
});
