'use strict';
const nrColor = globalThis.NeuroTheme?.color || (value => value);
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=(v,full=false)=>v?new Date(v*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',...(full?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';
const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const TAU=Math.PI*2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
const colors={active:nrColor('#b5ffdc'),idle:nrColor('#83b39d'),recent:nrColor('#83c4d5'),attention:nrColor('#ecc080'),ended:nrColor('#608b77'),unknown:nrColor('#486b5c')};
let rawData=null,transportOffline=false,data=null,visible=[],selected=null,lastSuccess=0,fetching=false,signature='',lastEvents='',instrumentKey='';
let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,speed=1,panorama=false,hover=null,vivid=true,sparse=true;
const camera={yaw:0,pitch:0,zoom:1,targetZoom:1},canvas=$('#graph'),ctx=canvas.getContext('2d',{alpha:false});
let width=0,height=0,dpr=1,clock=0,lastFrame=0,frameDurations=[],lastPerformance=0;
let nodes=[],hubs=[],links=[],rays=[],projected=[],ringTexture=null,ringKey='',bounds={cx:0,cy:0,r:1};
let ringBands=[],ringTaskStates=new Map(),ringLitRows=0;
let signals=new Map(),scopeEvents=new Map();
let eventPulses=[],eventPulseTotal=0;
const eventCursor=NeuroTaskBand.createCursor();
const glowTile=document.createElement('canvas');glowTile.width=glowTile.height=96;
{const g=glowTile.getContext('2d'),light=g.createRadialGradient(48,48,0,48,48,48);light.addColorStop(0,nrColor('#fffce8cc'));light.addColorStop(.08,nrColor('#e1f2cf88'));light.addColorStop(.28,nrColor('#b6cf9c26'));light.addColorStop(1,nrColor('#8dab7600'));g.fillStyle=light;g.fillRect(0,0,96,96);}
function glow(x,y,r,alpha=1){ctx.globalAlpha=alpha;ctx.drawImage(glowTile,x-r,y-r,r*2,r*2);ctx.globalAlpha=1;}
function observeEvents(next){
 for(const event of next.events)scopeEvents.set(JSON.stringify([event.at,event.threadId,event.kind,event.label]),event);
 for(const [key,event]of scopeEvents)if(Date.now()/1000-event.at>120)scopeEvents.delete(key);
 const added=eventCursor.ingest(next.events);
 if(next.snapshotFresh&&next.connection.connected){for(const e of added){eventPulses.push({id:e.threadId,born:clock});eventPulseTotal++;}taskBand.observe(added,clock);}
 eventPulses=eventPulses.slice(-24);
}
const projectName=id=>data?.projects.find(p=>p.id===id)?.name||'未归类';
const taskBand=NeuroTaskBand.create({wrap:$('#graph-wrap'),compact:$('#band-compact'),access:$('#band-access'),controls:$('#band-controls'),select,hover:id=>{hover=id;taskBand.setHover(id);},projectName});
let bandEnabled=true;
function updateTaskBand(){if(!data)return;const pid=$('#project').value;
 taskBand.update({state:data,visible,selected,filterKey:[pid,$('#period').value,$('#search').value].join('|'),scope:pid==='all'?'所有项目 · 最近任务':projectName(pid)});
}
function groupInfo(t){return t.projectId==='unassigned'?{id:'model:'+String(t.model||'unknown'),name:t.model||'模型未记录',subtitle:'独立聊天 · 按模型分区',model:t.model}:{id:'project:'+t.projectId,name:projectName(t.projectId),subtitle:'真实项目归属',projectId:t.projectId};}
function filtered(){if(!data)return[];const q=$('#search').value.trim().toLowerCase().replace(/\s+/g,''),pid=$('#project').value,days=Number($('#period').value),cut=days?Date.now()/1000-days*86400:0;
 return data.threads.filter(t=>(t.updatedAt>=cut||t.status==='active'||t.status==='attention')&&(pid==='all'||t.projectId===pid)&&(!q||(q.startsWith('模型:')?String(t.model||'未记录').toLowerCase()===q.slice(3):[t.name,t.model,projectName(t.projectId)].join('').toLowerCase().replace(/\s+/g,'').includes(q))));}
function select(id){selected=id;updateTaskBand();taskBand.setSelection(id);renderDetail();if(!$('#tasks-panel').hidden)renderRows();}
function renderDetail(){const t=data?.threads.find(t=>t.id===selected);$('#detail').dataset.threadId=t?.id||'';if(!t){$('#detail').innerHTML='<h2>选择一个任务</h2><p>点击图中的节点，或打开任务列表查看详情。</p>';return;}
 $('#detail').innerHTML=`<h2>${esc(t.name)}</h2><span class="badge ${esc(t.status)}">● ${esc(t.statusLabel)}</span><dl><dt>项目</dt><dd>${esc(projectName(t.projectId))}</dd><dt>智能体</dt><dd>${esc(t.agentNickname||'未提供昵称')}</dd><dt>角色</dt><dd>${esc(t.agentRole||'未标注角色')}</dd><dt>模型</dt><dd>${esc(t.model||'记录未提供')}</dd><dt>状态依据</dt><dd>${esc(t.evidence)}</dd><dt>状态确认</dt><dd>${t.checkedAt?time(t.checkedAt,true):'暂无实时确认'}</dd><dt>最近更新</dt><dd>${time(t.updatedAt,true)}</dd></dl><div class="path" title="${esc(t.cwd)}">${esc(t.cwd)}</div>`;
}
function renderRows(){const rows=visible.slice(0,180);$('#list-count').textContent=visible.length>180?`共 ${visible.length} 条 · 列表显示最近 180 条，可搜索更多`:`${visible.length} 条真实记录`;
 $('#rows').innerHTML=rows.length?rows.map(t=>`<tr class="${t.id===selected?'selected':''}"><td><button data-id="${esc(t.id)}">${esc(t.name)}</button></td><td>${esc(projectName(t.projectId))}</td><td><span class="badge ${esc(t.status)}">${esc(t.statusLabel)}</span></td><td>${esc(t.model||'—')}</td><td>${time(t.updatedAt,true)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">没有符合当前筛选条件的聊天任务。</td></tr>';
 $('#rows').querySelectorAll('button').forEach(b=>b.onclick=()=>{select(b.dataset.id);toggleTasks(false);});
}
function renderInstruments(){const key=JSON.stringify([Math.floor((Date.now()/1000+28800)/86400),visible.map(t=>[t.id,t.name,t.status,t.projectId,t.model,Math.floor((t.updatedAt+28800)/86400)]),data.projects.map(p=>[p.id,p.name,p.count])]);if(key===instrumentKey)return;instrumentKey=key;
 const counts=new Map(),models=new Map(),statuses=new Map();for(const t of visible){counts.set(t.projectId,(counts.get(t.projectId)||0)+1);models.set(t.model||'未记录',(models.get(t.model||'未记录')||0)+1);statuses.set(t.status,(statuses.get(t.status)||0)+1);}
 $('#project-list').innerHTML=data.projects.filter(p=>p.count).sort((a,b)=>(counts.get(b.id)||0)-(counts.get(a.id)||0)).map(p=>`<button class="project-row" data-project="${esc(p.id)}"><span>${esc(p.name)}</span><b>${counts.get(p.id)||0} / ${p.count}</b></button>`).join('');
 $('#project-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('#project').value=b.dataset.project;render();});
 $('#model-list').innerHTML=[...models].sort((a,b)=>b[1]-a[1]).map(([m,n])=>`<div class="model-row"><span>${esc(m)}</span><b>${n}</b><progress class="bar" max="${Math.max(1,visible.length)}" value="${n}" aria-label="${esc(m)} 的聊天数量"></progress></div>`).join('');
 const dayKey=ms=>new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),today=Date.now(),days=Array.from({length:7},(_,i)=>({key:dayKey(today-(6-i)*864e5),count:0}));
 for(const t of visible){const day=days.find(d=>d.key===dayKey(t.updatedAt*1000));if(day)day.count++;}const max=Math.max(1,...days.map(d=>d.count));
 $('#history-chart').innerHTML=days.map(d=>`<div class="day" title="${d.key}：${d.count} 条任务最后更新"><b>${d.count}</b><svg class="history-bar" viewBox="0 0 20 80" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="${80-d.count/max*80}" width="20" height="${Math.max(.5,d.count/max*80)}" fill="${nrColor('#669e83')}"/></svg><small>${d.key.slice(5).replace('-','/')}</small></div>`).join('');
 $('#status-matrix').innerHTML='<div class="status-grid">'+visible.slice(0,144).map(t=>`<i class="${esc(t.status)}" title="${esc(t.name+' · '+t.statusLabel)}"></i>`).join('')+'</div>';
 const labels={active:'运行',idle:'空闲',recent:'近期活动',attention:'需关注',ended:'本轮结束',unknown:'未同步'};
 $('#status-counts').innerHTML=[...statuses].map(([s,n])=>`<span>${labels[s]||s} ${n}</span>`).join('')+(visible.length>144?'<span>矩阵展示最近 144 条</span>':'');
}
function render(){if(!data)return;const chosen=$('#project').value,opts=data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${p.count}</option>`).join('');
 if($('#project').dataset.opts!==opts){$('#project').innerHTML='<option value="all">所有项目</option>'+opts;$('#project').dataset.opts=opts;$('#project').value=[...$('#project').options].some(o=>o.value===chosen)?chosen:'all';}
 visible=filtered();$('#project-count').textContent=data.projects.filter(p=>p.count&&p.id!=='unassigned').length;$('#thread-count').textContent=visible.length;$('#active-count').textContent=data.threads.filter(t=>t.status==='active').length;$('#recent-count').textContent=data.threads.filter(t=>t.updatedAt>Date.now()/1000-86400).length;
 $('#connection').textContent=data.connection.connected?`本机在线 · ${data.connection.synced} 条实时状态`:'实时未连接 · 本地记录';$('#updated').textContent='数据读取 '+time(data.generatedAt);$('#health').textContent=`已读取 ${data.threads.length} 条真实记录 · 实时状态订阅最近 8 条 · 本机只读`;
 const allowed=new Set(visible.map(t=>t.id)),events=data.events.filter(e=>allowed.has(e.threadId)).slice(0,35),eventKey=events.map(e=>e.at+e.threadId+e.label).join('|');
 if(eventKey!==lastEvents){const oldFirst=$('#activity').firstElementChild?.dataset.key;$('#activity').innerHTML=events.length?events.map((e,i)=>`<div class="event${i===0&&oldFirst&&oldFirst!==String(e.at)?' new':''}" data-key="${e.at}"><time>${time(e.at)}</time><div><strong>${esc(e.label)}</strong><p title="${esc(e.threadName)}">${esc(e.threadName)}</p></div></div>`).join(''):'<p class="empty">当前筛选暂无近期事件。</p>';lastEvents=eventKey;}
 window.NeuroInstruments?.update({data,visible});
 if(!visible.some(t=>t.id===selected))selected=visible.find(t=>t.status==='active')?.id||visible[0]?.id||null;renderDetail();if(!$('#tasks-panel').hidden)renderRows();renderInstruments();
 const sig=visible.map(t=>t.id+':'+t.status+':'+t.projectId+':'+t.model+':'+t.name).join('|')+data.edges.map(e=>e.source+e.target).join('|');if(sig!==signature||!signature){signature=sig;layout();}
 updateTaskBand();$('#empty-graph').hidden=visible.length>0;
 $('#empty-graph').textContent=data.threads.length?'当前筛选没有任务。请切换项目、时间或清空搜索。':'还没有聊天记录。请在 Codex 中创建一条聊天，本页会自动更新。';
 $('#view-summary').textContent=`${visible.length} 条真实聊天 · ${data.edges.filter(e=>allowed.has(e.source)&&allowed.has(e.target)).length} 条委派关系`;
}
function markStale(){transportOffline=true;if(rawData){data=NeuroTaskBand.normalizeState(rawData,Date.now()/1000,true);render();}$('#connection').textContent='本机服务暂不可用';$('#active-count').textContent='—';}
function showDataUnavailable(next){
 markStale();$('#connection').textContent=next.code==='loading'?'正在读取本机数据':'等待本机数据';
 $('#banner').textContent=next.error||'本机数据暂不可读，本页会自动重试。';$('#banner').hidden=false;
 $('#health').textContent='本机服务已启动 · 等待可用数据 · 每 3 秒自动重试';
 if(!rawData){$('#empty-graph').hidden=false;$('#empty-graph').textContent=next.error;$('#graph-scope').textContent='等待真实记录';$('#view-summary').textContent='启动成功，等待连接你的 Codex';$('#updated').textContent='正在自动重试';}
}
async function refresh(){if(fetching)return;fetching=true;try{
 const r=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('读取失败');
 const next=await r.json();if(!next.ok){showDataUnavailable(next);return;}
 rawData=next;transportOffline=false;data=NeuroTaskBand.normalizeState(next);observeEvents(data);lastSuccess=Date.now();
 $('#banner').hidden=!!data.connection.connected;
 if(!data.connection.connected)$('#banner').textContent=next.connection?.error==='状态协议版本变化'?'Codex 实时状态版本暂不兼容；当前展示本地记录，实时状态待确认。':'已读取本地记录。请保持 Codex 桌面版打开以获取实时状态；未同步的任务状态待确认。';
 render();
 }catch(e){$('#banner').textContent=rawData?'连接中断，保留最近记录；实时状态暂不可确认。':'本机服务暂不可用。请重新双击 NeuroRing 启动；本页会自动重试。';$('#banner').hidden=false;markStale();}finally{fetching=false;}}

// Geometry describes actual memberships and delegations. Fibre copies are optical strokes,
// never extra tasks. Repeating propagation is presentation; RUN comes only from live data.
function layout(){
 projected=[];hover=null;$('#hover-card').hidden=true;
 const sample=visible.slice(0,1800),groups=new Map();
 for(const t of sample){const info=groupInfo(t);if(!groups.has(info.id))groups.set(info.id,{...info,tasks:[]});groups.get(info.id).tasks.push(t);}
 const ranked=[...groups.values()].sort((a,b)=>b.tasks.length-a.tasks.length||a.id.localeCompare(b.id)),slots=new Array(ranked.length);
 ranked.forEach((g,i)=>{let slot=Math.round((i*.38196601125%1)*ranked.length)%ranked.length;while(slots[slot])slot=(slot+1)%ranked.length;slots[slot]=g;});
 hubs=slots;const totalWeight=hubs.reduce((sum,g)=>sum+Math.sqrt(g.tasks.length)+1.2,0);let cursor=-Math.PI/2;
 for(const [i,g]of hubs.entries()){
  const span=(Math.sqrt(g.tasks.length)+1.2)/Math.max(1,totalWeight)*TAU;g.span=span;
  g.index=i;g.seed=hash(g.id);g.angle=cursor+span*.5;cursor+=span;g.hub=true;g.status='idle';
  const radius=.46+(g.seed%100)/100*.17;g.x=Math.cos(g.angle)*radius;g.y=Math.sin(g.angle)*radius;g.z=0;
  const count=Math.min(5,Math.max(1,Math.ceil(Math.sqrt(g.tasks.length)/4)));
  g.tracts=Array.from({length:count},(_,j)=>{
   const seed=hash(g.id+':tract:'+j),side=((j+.5)/count-.5),bend=(.26+span*.48)*(g.seed%2?1:-1),angle=g.angle-bend+side*span*.54,rootRadius=.13+(seed%73)/730;
   const guide={x:Math.cos(angle)*rootRadius,y:Math.sin(angle)*rootRadius,z:0};
   const a1=g.angle-bend*.60+side*span*.40,a2=g.angle-bend*.12+side*span*.13;
   return {g,index:j,seed,members:[],guide,
    c1:{x:Math.cos(a1)*(.29+(seed%37)/740),y:Math.sin(a1)*(.29+(seed%37)/740),z:.015},
    c2:{x:Math.cos(a2)*radius*.84,y:Math.sin(a2)*radius*.84,z:.015},
    angle:g.angle+(j-(count-1)/2)*span/(count+.5),spread:Math.min(span/(count+.5)*.38,.018+Math.sqrt(g.tasks.length/count)*.0018),outputSpread:Math.min(.18,span/(count+.5)*.78),
    period:4.2+(seed%181)/100,offset:(seed%997)/997};
  });
 }
 const groupMap=new Map(hubs.map(g=>[g.id,g]));
 nodes=sample.map(t=>{const seed=hash(t.id),a=(seed%65536)/65536*TAU,r=Math.sqrt(((seed>>>16)%10000)/10000)*.70+.012,g=groupMap.get(groupInfo(t).id),tract=g.tracts[seed%g.tracts.length];
  const n={...t,seed,hub:false,g,tract,x:Math.cos(a)*r,y:Math.sin(a)*r,z:(((seed>>>6)%1000)/1000-.5)*.12};tract.members.push(n);return n;
 });
 for(const g of hubs)for(const tr of g.tracts){tr.members.sort((a,b)=>a.seed-b.seed);tr.members.forEach((n,i)=>{
  n.laneIndex=i;n.lane=(i+.5)/tr.members.length-.5;n.portAngle=tr.angle+n.lane*tr.spread;
  // Stable, disc-wide positions make the long connections readable. No synthetic tasks.
  const a=(hash(n.id+':angle')%65536)/65536*TAU;
  const r=.055+Math.sqrt((hash(n.id+':radius')%10000)/10000)*.66;
  n.x=Math.cos(a)*r;n.y=Math.sin(a)*r;n.z=(((n.seed>>>6)%1000)/1000-.5)*.025;
 });}
 links=nodes.map(n=>({source:n,target:n.g,type:n.projectId==='unassigned'?'model':'project',seed:n.seed,tract:n.tract}));
 const byId=new Map(nodes.map(n=>[n.id,n]));
 for(const edge of data.edges){const s=byId.get(edge.source),t=byId.get(edge.target);if(!s||!t)continue;const seed=hash(s.id+t.id),bend=(seed%2?1:-1)*.18;
  links.push({source:s,target:t,type:'delegation',seed,c1:{x:s.x*.65+t.x*.35+bend,y:s.y*.65+t.y*.35-bend,z:.04},c2:{x:s.x*.30+t.x*.70+bend,y:s.y*.30+t.y*.70-bend,z:.04}});
 }
 // Three optical filaments per real task make a fine, continuous stream, without changing counts.
 rays=nodes.flatMap(n=>Array.from({length:3},(_,f)=>({n,tract:n.tract,seed:hash(n.id+':f:'+f),angle:n.tract.angle+n.lane*n.tract.outputSpread+(f-1)*.0011,fibre:f})));
 $('#graph-scope').textContent=`${sample.length} 个真实节点${visible.length>sample.length?' / '+visible.length:''} · ${hubs.length} 个分区`;
 const count=type=>links.filter(l=>l.type===type).length;
 $('#relationships').textContent=`${count('project')} 项目归属 · ${count('model')} 未归属按模型分区 · ${count('delegation')} 真实委派`;
 ringTaskStates=new Map(sample.map(t=>[t.id,t.status]));
 const key=hubs.map(g=>g.id+':'+g.tasks.map(t=>t.id+t.name).join('')).join('|');if(key!==ringKey){ringKey=key;buildRing();}
 canvas.dataset.nodeCount=String(nodes.length);canvas.dataset.relationshipCount=String(links.length);canvas.dataset.version='9.1';canvas.dataset.light=vivid?'vivid':'soft';
 if(!nodes.length){for(const key of ['signalPackets','brightFilaments','baseSegments','baseBranches','baseTrunks','baseDelegations','carrierFibres','emittingPackets'])canvas.dataset[key]='0';canvas.dataset.networkAnchor='';canvas.dataset.emissionQuadrants='';canvas.dataset.sparseApplied='false';}
}
function buildRing(){
 ringBands=[];
 const c=document.createElement('canvas');c.width=c.height=2560;const p=c.getContext('2d');p.translate(1280,1280);const r=1137.7778;
 p.beginPath();p.arc(0,0,r*1.027,0,TAU);p.arc(0,0,r*.762,0,TAU,true);p.fillStyle=nrColor('#030707');p.fill();
 for(const [rr,alpha,weight]of [[.754,.68,1],[.762,.95,1.5],[.778,.32,1],[.985,.28,1],[1.014,.55,1],[1.027,.88,1.4],[1.038,.35,1]]){p.beginPath();p.arc(0,0,r*rr,0,TAU);p.strokeStyle=nrColor(`rgba(191,216,201,${alpha})`);p.lineWidth=weight;p.stroke();}
 for(let i=0;i<900;i++){const a=i/900*TAU,rr=r*1.035;p.beginPath();p.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);const end=rr+(i%30===0?13:i%5===0?6:2.4);p.lineTo(Math.cos(a)*end,Math.sin(a)*end);p.strokeStyle=i%30===0?nrColor('#c4d9cb'):nrColor('#526b5f');p.lineWidth=.7;p.stroke();}
 for(let j=0;j<3;j++)for(let i=0;i<750;i++){p.save();p.rotate(i/750*TAU);p.fillStyle=i%13===0?nrColor('#d4e0d3'):nrColor('#61776a');p.fillRect(r*(.765+j*.0035),0,2,1+(i%4));p.restore();}
 for(const g of hubs){
  const span=g.span,bands=Math.max(1,Math.min(7,Math.floor(span/.15))),bandAngle=span/bands,rows=Math.max(5,Math.min(15,Math.floor(bandAngle*r*.78/8)-4));
  p.save();p.rotate(g.angle-span*.48);p.beginPath();p.moveTo(r*.788,0);p.lineTo(r*1.004,0);p.strokeStyle=nrColor('#435b4d');p.lineWidth=.6;p.stroke();p.restore();
  for(let band=0;band<bands;band++){
   const angle=g.angle+(band-(bands-1)/2)*bandAngle,start=-rows*3.8;
   const title=band===0?String(g.index+1).padStart(2,'0')+' / '+g.name.slice(0,19):g.name.slice(0,12)+' / '+String(band+1).padStart(2,'0');
   const seed=hash(g.id+':ring:'+band),period=6.7+(seed%131)/100;
   const segment={angle,rows,seed,period,offset:(seed%997)/997*period,title,x:r*.794,y:start-13,cells:[]};ringBands.push(segment);
   p.save();p.rotate(angle);p.fillStyle=nrColor('#62796f');p.font='bold 9px Consolas,"Microsoft YaHei"';
   p.fillText(title,r*.794,start-13);
   for(let column=0;column<2;column++){
    const offset=(band*2+column)*rows,tasks=g.tasks.slice(offset,offset+rows),x=r*(column?.902:.794);
    tasks.forEach((t,j)=>{const text=t.id.slice(0,4)+' '+t.name.slice(0,10),y=start+j*7.6;p.fillStyle=nrColor('#4c6460');p.font='7px Consolas,"Microsoft YaHei"';p.fillText(text,x,y);segment.cells.push({id:t.id,text,x,y,row:j});});
    // Little ID matrices retain real record identity while breaking the long text columns.
    if(tasks.length>3)for(let j=0;j<Math.min(tasks.length,10);j++){const seed=hash(tasks[j].id);for(let bit=0;bit<12;bit++)if((seed>>>bit)&1){p.fillStyle=bit%4===0?nrColor('#dce4d3'):nrColor('#768e79');p.fillRect(x+j*6.2,start+rows*7.6+3+bit%3*2.1,1.2,1.2);}}
   }
   p.restore();
  }
 }
 ringTexture=c;
 canvas.dataset.ringActivation='row-group-v5';canvas.dataset.ringLabelCount=String(ringBands.reduce((n,b)=>n+b.cells.length,0));
}
// Presentation only: these pulses never change task state, counts, or event history.
// The same ring clock controls rotation, pause and playback speed.
function ringPulse(age,hold=.20,fade=.42){
 if(age<0)return 0;const attack=.045;
 if(age<attack)return age/attack;if(age<attack+hold)return 1;
 const tail=(age-attack-hold)/fade;return tail>=1?0:(1-tail)*(1-tail);
}
function drawRingActivation(){
 ringLitRows=0;if(clock<=0)return;
 const intensity=(vivid?.95:.64)*Math.min(1,clock/.25);
 ctx.save();const scale=bounds.r*2.25/2560;ctx.scale(scale,scale);
 ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.textAlign='left';
 for(const band of ringBands){
  const phase=(clock+band.offset)%band.period;
  const block=ringPulse(phase-.32,.24,.46);
  const rowLevels=Array.from({length:band.rows},(_,row)=>{
   const scan=ringPulse(phase-1.48-row*.072,.12+(row%3)*.035,.28);
   const cluster=(row+band.seed)%band.rows<3?ringPulse(phase-4.12,.22,.44):0;
   return Math.max(block,scan,cluster)*intensity;
  });
  const title=block*intensity;
  if(title<.003&&!rowLevels.some(n=>n>.003))continue;
  ctx.save();ctx.rotate(band.angle);
  if(title>.003){ctx.globalAlpha=title;ctx.fillStyle=nrColor('#c2d5cb');ctx.font='bold 9px Consolas,"Microsoft YaHei"';ctx.fillText(band.title,band.x,band.y);}
  ctx.font='7px Consolas,"Microsoft YaHei"';
  for(const cell of band.cells){const alpha=rowLevels[cell.row];if(alpha<.003)continue;
   ctx.globalAlpha=alpha;ctx.fillStyle=ringTaskStates.get(cell.id)==='attention'?nrColor('#dbc18f'):nrColor('#b5dddd');
   ctx.fillText(cell.text,cell.x,cell.y);ringLitRows++;
  }
  ctx.restore();
 }
 ctx.restore();
}
function resize(){const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;dpr=Math.min(devicePixelRatio||1,1.75);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
new ResizeObserver(resize).observe(canvas);
function geometry(){const narrow=width<750,targetR=panorama?Math.min(width*.43,height*.42):Math.min(width*(narrow?.78:.55),height*(narrow?.77:.99));return{cx:width*(panorama?.48:narrow?.23:.27),cy:height*.50,r:targetR*camera.zoom};}
// The neural field is anchored. Only explicit dragging changes its viewing angle.
function project(v){const yaw=camera.yaw,pitch=camera.pitch,x=v.x,y=v.y,z=v.z||0;
 const xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw),yy=y*Math.cos(pitch)-zz*Math.sin(pitch),depth=y*Math.sin(pitch)+zz*Math.cos(pitch),scale=3.5/(3.5-depth);
 return{x:bounds.cx+xx*bounds.r*scale,y:bounds.cy+yy*bounds.r*scale,z:depth,scale};
}
function cubic(s,a,b,t,f){const u=1-f;return{x:u*u*u*s.x+3*u*u*f*a.x+3*u*f*f*b.x+f*f*f*t.x,y:u*u*u*s.y+3*u*u*f*a.y+3*u*f*f*b.y+f*f*f*t.y};}
function strokeCurve(s,a,b,t,offset=0){ctx.moveTo(s.x,s.y);ctx.bezierCurveTo(a.x+offset,a.y-offset,b.x-offset,b.y+offset,t.x,t.y);}
function partialCurve(e,from,to,offset=0){const f0=clamp(from,0,1),f1=clamp(to,0,1);if(f1-f0<.00001)return;
 const a={x:e.a.x+offset,y:e.a.y-offset},b={x:e.b.x-offset,y:e.b.y+offset},p=cubic(e.s,a,b,e.t,f0),q=cubic(e.s,a,b,e.t,f1),dt=f1-f0,u=1-f0,v=1-f1;
 const dx0=u*u*(a.x-e.s.x)+2*u*f0*(b.x-a.x)+f0*f0*(e.t.x-b.x),dy0=u*u*(a.y-e.s.y)+2*u*f0*(b.y-a.y)+f0*f0*(e.t.y-b.y);
 const dx1=v*v*(a.x-e.s.x)+2*v*f1*(b.x-a.x)+f1*f1*(e.t.x-b.x),dy1=v*v*(a.y-e.s.y)+2*v*f1*(b.y-a.y)+f1*f1*(e.t.y-b.y);
 ctx.moveTo(p.x,p.y);ctx.bezierCurveTo(p.x+dt*dx0,p.y+dt*dy0,q.x-dt*dx1,q.y-dt*dy1,q.x,q.y);
}
// Density follows the projected circle, including zoom and the compact side panel.
// Static strokes and moving bundles have separate budgets; the logical graph stays complete.
function neuralDetail(radius){const scale=clamp(radius/800,.25,1.35);return{
 line:clamp(Math.sqrt(scale),.72,1.1),baseAlpha:(vivid?.40:.25),
 band:clamp(radius*.066,15,54),lanes:clamp(Math.round(radius/29),7,26),tail:clamp(radius*.285,66,252),
 branches:clamp(Math.round(radius/26),10,34),baseLanes:clamp(Math.round(radius/100),3,8),delegationBase:clamp(Math.round(radius*.09),24,85),
 delegationStride:Math.max(1,Math.ceil(links.filter(l=>l.type==='delegation').length/Math.max(34,radius*.12)))};}

function laneVisible(index,total,count){count=Math.min(total,count);const slot=Math.floor((index+.5)*count/total);return index===Math.floor((slot+.5)*total/count);}
function shifted(p,n,amount){return{x:p.x+n.x*amount,y:p.y+n.y*amount};}
// Arc-length lookup keeps a signal's tail in pixels instead of a fraction of a long curve.
function curveMetric(e){const lengths=[0];let previous=e.s,total=0;
 for(let i=1;i<=18;i++){const p=cubic(e.s,e.a,e.b,e.t,i/18);total+=Math.hypot(p.x-previous.x,p.y-previous.y);lengths.push(total);previous=p;}
 return{lengths,total};
}
function curveParameter(metric,distance){const d=clamp(distance,0,metric.total);if(d<=0)return 0;if(d>=metric.total)return 1;
 let lo=0,hi=metric.lengths.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(metric.lengths[mid]<d)lo=mid;else hi=mid;}
 return(lo+(d-metric.lengths[lo])/Math.max(.00001,metric.lengths[hi]-metric.lengths[lo]))/(metric.lengths.length-1);
}
function neuralDelay(n){return .025+(n.lane+.5)*.24+(n.seed%29)/580;}
function curveTangent(e,f){const u=1-f,dx=u*u*(e.a.x-e.s.x)+2*u*f*(e.b.x-e.a.x)+f*f*(e.t.x-e.b.x),dy=u*u*(e.a.y-e.s.y)+2*u*f*(e.b.y-e.a.y)+f*f*(e.t.y-e.b.y),length=Math.hypot(dx,dy)||1;return{x:dx/length,y:dy/length};}
function pathMetric(curves){let total=0;const pieces=curves.map(e=>{const metric=e.metric||(e.metric=curveMetric(e)),start=total;total+=metric.total;return{e,metric,start,end:total};});return{pieces,total};}
function pathWindow(path,from,to){const spans=[];for(const p of path.pieces){if(to<=p.start||from>=p.end||p.metric.total<.001)continue;spans.push({e:p.e,from:curveParameter(p.metric,from-p.start),to:curveParameter(p.metric,to-p.start)});}return spans;}
function pathPoint(path,distance){const d=clamp(distance,0,path.total),p=path.pieces.find(p=>d<=p.end)||path.pieces.at(-1);return cubic(p.e.s,p.e.a,p.e.b,p.e.t,curveParameter(p.metric,d-p.start));}
function tracePath(path,from,to){for(const part of pathWindow(path,from,to))partialCurve(part.e,part.from,part.to);}
const fract=v=>v-Math.floor(v);
function wheelAngle(at=clock){return at*.038+.92+camera.yaw*.05;}
function ringPoint(angle,rr=1,at=clock){const a=angle+wheelAngle(at);return{x:bounds.cx+Math.cos(a)*bounds.r*rr,y:bounds.cy+Math.sin(a)*bounds.r*rr*.98};}
function bell(v,center,width){return Math.exp(-Math.pow((v-center)/width,2));}
function tractPhase(tr){return fract(clock/tr.period+tr.offset+Math.sin(clock*.21+tr.offset*TAU)*.075)*6.7;}
function groupSignal(g){const flows=g.tracts.map(tr=>({tr,q:tractPhase(tr)}));return{flows,charge:Math.min(1,flows.reduce((a,f)=>a+bell(f.q,2,.16),0))};}
function drawBackdrop(){ctx.fillStyle=nrColor('#020303');ctx.fillRect(0,0,width,height);const wash=ctx.createRadialGradient(bounds.cx,bounds.cy,0,bounds.cx,bounds.cy,bounds.r*1.2);wash.addColorStop(0,nrColor('#080a0a'));wash.addColorStop(.7,nrColor('#040606'));wash.addColorStop(1,nrColor('#020303'));ctx.fillStyle=wash;ctx.fillRect(0,0,width,height);
 ctx.strokeStyle=nrColor('#b9c2ba06');ctx.lineWidth=.5;ctx.beginPath();for(let x=0;x<width;x+=110){ctx.moveTo(x,0);ctx.lineTo(x,height);}for(let y=0;y<height;y+=110){ctx.moveTo(0,y);ctx.lineTo(width,y);}ctx.stroke();
}
// Align the inner arrival, ring transfer and outer launch while preserving the optical renderer.
function crossingTransit(){return .165;}
function arrivalBase(n){return n.tract.period*(.72-n.tract.offset)+neuralDelay(n);}
function outletPhase(ray){
 const tr=ray.tract;
 const base=arrivalBase(ray.n)+crossingTransit();
 const start=base+Math.floor((clock-base)/tr.period+1e-10)*tr.period;
 // Preserve the original phase velocity, including its small continuous modulation.
 // Cancel the old independent launch offset, so the same packet begins at the outlet.
 const travel=Math.max(0,6.7*((clock-start)/tr.period+.075*(Math.sin(clock*.21+tr.offset*TAU)-Math.sin(start*.21+tr.offset*TAU))));
 return 3.12+(ray.seed%97)/180+travel;
}
function transferPhase(tr,original){
 if(!tr.members.length)return original;
 const n=tr.members[Math.floor(tr.members.length/2)],base=arrivalBase(n);
 const arrival=base+Math.round((clock-base)/tr.period)*tr.period;
 return 2.98+(clock-arrival)*(.20/crossingTransit());
}
function drawRayField(){
 const {r}=bounds,segments=Array.from({length:9},()=>[]);let emitting=0;const directions=new Set();
 for(const ray of rays){
  const tr=ray.tract,q=outletPhase(ray),theta=tr.angle+wheelAngle()+.045+(ray.seed%17-8)*.00028;
  const s=ringPoint(ray.angle,1.043),length=r*(.62+(tr.seed%113)/210+(ray.seed%157)/265),dx=Math.cos(theta)*length,dy=Math.sin(theta)*length*.98;
  const ex=s.x+dx,ey=s.y+dy;if((s.x<-10&&ex<-10)||(s.x>width+10&&ex>width+10)||(s.y<-10&&ey<-10)||(s.y>height+10&&ey>height+10))continue;
  directions.add(Math.floor(((theta%TAU+TAU)%TAU)/(Math.PI/2)));
  const line=(bucket,from,to)=>{from=clamp(from,0,1);to=clamp(to,0,1);if(to>from)segments[bucket].push([s.x+dx*from,s.y+dy*from,s.x+dx*to,s.y+dy*to]);};
  line(ray.seed%2,.002,.68);line(2,.68,1);
  // Quiet fibre traffic remains between surges, so the outlet never becomes an empty fan.
  const micro=fract(clock*(.30+(ray.seed%13)*.008)+(ray.seed%991)/991);line(3,micro-.075,micro);if(ray.fibre===1)line(8,micro-.014,micro);
  const head=(q-3.12-(ray.seed%97)/180)/(.90+(ray.seed%79)/200),tail=.18+(ray.seed%71)/270;
  if(head>=0&&head<1.4){emitting++;for(let k=0;k<4;k++)line(4+k,head-tail+tail*k/4,head-tail+tail*(k+1)/4);}
 }
 ctx.save();ctx.globalCompositeOperation='lighter';
 const palette=vivid?[nrColor('#cfdbcc36'),nrColor('#b9cfbf24'),nrColor('#9cb9a813'),nrColor('#d8e7d575'),nrColor('#a5c6b535'),nrColor('#c6d6be72'),nrColor('#e4e8c6bf'),nrColor('#fff9dff2'),nrColor('#fcf7dfb3')]:[nrColor('#cfdbcc21'),nrColor('#b9cfbf15'),nrColor('#9cb9a809'),nrColor('#d8e7d540'),nrColor('#a5c6b51b'),nrColor('#c6d6be3d'),nrColor('#e4e8c670'),nrColor('#fff9dfb0'),nrColor('#fcf7df65')];
 for(let k=0;k<segments.length;k++){ctx.strokeStyle=palette[k];ctx.lineWidth=k>=7?.86:k>3?.58:.34;ctx.beginPath();for(const v of segments[k]){ctx.moveTo(v[0],v[1]);ctx.lineTo(v[2],v[3]);}ctx.stroke();}
 ctx.restore();canvas.dataset.emittingPackets=String(emitting);canvas.dataset.carrierFibres=String(rays.length);canvas.dataset.emissionQuadrants=[...directions].sort().join(',');
}
function drawRing(){
 if(!ringTexture)return;const {cx,cy,r}=bounds;
 ctx.save();ctx.translate(cx,cy);ctx.scale(1,.98);ctx.rotate(wheelAngle());ctx.drawImage(ringTexture,-r*1.125,-r*1.125,r*2.25,r*2.25);drawRingActivation();ctx.restore();
 ctx.save();ctx.globalCompositeOperation='lighter';
 // Three independent edge rhythms; the fixed network is not coupled to these rotations.
 for(let layer=0;layer<3;layer++){const rr=r*[.751,1.031,1.052][layer],a=clock*[.13,-.085,.067][layer]+layer*2.12;
  ctx.save();ctx.translate(cx,cy);ctx.scale(1,.98);for(let i=0;i<20;i++){ctx.beginPath();ctx.arc(0,0,rr,a+i*.010,a+i*.010+.006);ctx.strokeStyle=nrColor(`rgba(215,231,210,${(.03+i/20*.48)*(vivid?1:.55)})`);ctx.lineWidth=layer===0?1:.65;ctx.stroke();}ctx.restore();
 }
 for(const g of hubs)for(const f of signals.get(g.id).flows){
  const tr=f.tr,q=transferPhase(tr,f.q),receive=bell(q,2.98,.18),emit=bell(q,3.18,.22),route=bell(q,3.10,.16);
  if(receive+emit<.015)continue;
  for(const [rr,power]of [[.752,receive],[1.040,emit]]){const p=ringPoint(tr.angle,rr),spread=rr<1?tr.spread:tr.outputSpread;glow(p.x,p.y,vivid?22:13,power*.44);ctx.save();ctx.translate(cx,cy);ctx.scale(1,.98);ctx.beginPath();ctx.arc(0,0,r*rr,tr.angle+wheelAngle()-spread*.52,tr.angle+wheelAngle()+spread*.52);ctx.strokeStyle=nrColor(`rgba(253,250,226,${power*.85})`);ctx.lineWidth=1.35;ctx.stroke();ctx.restore();}
  // A narrow scanning trace bridges the rotating annulus without covering its real labels.
  if(route>.02){ctx.strokeStyle=nrColor(`rgba(225,235,212,${route*.35})`);ctx.lineWidth=.55;ctx.beginPath();for(const shift of [-.003,0,.003]){const a=ringPoint(tr.angle+shift,.778),b=ringPoint(tr.angle+shift,1.025);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();}
 }
 ctx.restore();
 const band=nodes.slice(0,64);ctx.save();ctx.translate(cx,cy);ctx.scale(1,.98);ctx.rotate(wheelAngle());for(let i=0;i<band.length;i++){ctx.save();ctx.rotate(i/Math.max(1,band.length)*TAU);ctx.translate(r*1.075,0);ctx.rotate(Math.PI/2);ctx.fillStyle=nrColor('#91a38f');ctx.font='6px Consolas';ctx.textAlign='center';ctx.fillText(band[i].id.slice(0,8)+' / '+String(band[i].model||'LOCAL').toUpperCase(),0,0);ctx.restore();}ctx.restore();
}
// A single clock drives geometry, packets and instruments. Small, deterministic drift
// changes the weave continuously without regenerating nodes or jumping between layouts.
function fieldPosition(n){
 if(n.hub)return project(n);
 const phase=n.seed*.0001,drift=.0045;
 return project({x:n.x+Math.sin(clock*.11+phase)*drift,y:n.y+Math.cos(clock*.09+phase*1.7)*drift,z:n.z});
}
function longFibre(n,s,h,detail){
 const tr=n.tract,normal={x:-Math.sin(tr.angle),y:Math.cos(tr.angle)},lane=n.lane*detail.band;
 const junction=shifted(h,normal,lane*.40),guide=project(tr.guide);
 const tangent=curveTangent({s:guide,a:project(tr.c1),b:project(tr.c2),t:h},1);
 const sway=Math.sin(clock*.14+tr.offset*TAU)*bounds.r*.009;
 const branch={s,a:{x:mix(s.x,junction.x,.34)+normal.x*(lane*.55+sway),y:mix(s.y,junction.y,.34)+normal.y*(lane*.55+sway)},b:shifted(junction,tangent,-bounds.r*(.12+(n.seed%41)/1000)),t:junction};
 const port=ringPoint(n.portAngle,.752),radial={x:Math.cos(n.portAngle+wheelAngle()),y:Math.sin(n.portAngle+wheelAngle())*.98};
 const outlet={s:junction,a:shifted(junction,tangent,bounds.r*.13),b:shifted(port,radial,-bounds.r*(.17+(tr.seed%23)/500)),t:port};
 return{branch,outlet};
}
function drawGraph(stale){
 projected=[];const cache=new Map();for(const n of [...hubs,...nodes]){const p=fieldPosition(n);cache.set(n.id,p);projected.push({...p,n});}
 const detail=neuralDetail(bounds.r),simple=sparse&&nodes.length>80,carriers=[[],[],[],[]],bursts=[],members=new Map(),focus=[],excited=new Map(),velocity=bounds.r*.48;
 const delegationTotal=links.filter(l=>l.type==='delegation').length;let delegationIndex=0;
 eventPulses=eventPulses.filter(e=>clock-e.born<6.5);const eventIds=new Set(eventPulses.map(e=>e.id));
 const add=(path,distance,tail,strength,seed)=>{if(distance<0||distance>path.total+tail||path.total<2)return;
  const fade=clamp(Math.min(distance/Math.max(4,tail*.22),(path.total+tail-distance)/Math.max(6,tail*.65)),0,1);
  if(fade>.025)bursts.push({path,distance,tail,strength,fade,seed});
 };
 // Clip only the neural field; labels and the outer annulus remain separately legible.
 ctx.save();ctx.beginPath();ctx.ellipse(bounds.cx,bounds.cy,bounds.r*.754,bounds.r*.754*.98,0,0,TAU);ctx.clip();
 for(const l of links){
  const s=cache.get(l.source.id),t=cache.get(l.target.id),interested=l.source.id===selected||l.target.id===selected||l.source.id===hover||l.target.id===hover;
  if(l.target.hub){
   const n=l.source,important=n.id===selected||n.id===hover||(!stale&&n.status==='active')||eventIds.has(n.id);
   const fine=laneVisible(n.laneIndex,l.tract.members.length,detail.lanes)||important;
   const baseBranch=!simple||important||laneVisible(n.laneIndex,l.tract.members.length,detail.branches);
   const baseOutlet=laneVisible(n.laneIndex,l.tract.members.length,detail.baseLanes)||important;
   if(!fine&&!baseBranch&&!baseOutlet)continue;
   const {branch,outlet}=longFibre(n,s,t,detail);
   if(baseBranch)carriers[0].push(branch);if(baseOutlet)carriers[1].push(outlet);
   if(interested)focus.push(branch,outlet);
   if(fine){
    const path=pathMetric([branch,outlet]);members.set(n.id,[{path,weight:1}]);
    const period=l.tract.period,age=fract(clock/period+l.tract.offset-neuralDelay(n)/period)*period;
    // Align the arrival front across a fan; lengths remain measured along the complete curve.
    const distance=path.total+(age-period*.72)*velocity,tail=detail.tail*(.78+(n.seed%29)/65);
    // Keep every in-flight packet across the periodic boundary; do not restart midway.
    const train=(position,length,strength)=>{const spacing=period*velocity;
     for(let cycle=Math.ceil(-position/spacing);cycle<=Math.floor((path.total+length-position)/spacing);cycle++)add(path,position+cycle*spacing,length,strength,n.seed);
    };
    train(distance,tail,1);
    const quiet=fract(age/period+.43)*period;
    train(path.total+(quiet-period*.72)*velocity,tail*.42,.23);
    excited.set(n.id,bell(distance,0,detail.tail*.20));
   }
  }else{
   const e={s,t,a:project(l.c1),b:project(l.c2)},important=interested||eventIds.has(l.source.id)||eventIds.has(l.target.id)||(!stale&&(l.source.status==='active'||l.target.status==='active'));
   if(!simple||important||laneVisible(delegationIndex,delegationTotal,detail.delegationBase))carriers[3].push(e);delegationIndex++;if(interested)focus.push(e);
   if(l.seed%detail.delegationStride===0||interested){const path=pathMetric([e]),period=3.4+(l.seed%157)/50,age=fract(clock/period+(l.seed%991)/991)*period;add(path,age*velocity,detail.tail*.44,interested?.75:.34,l.seed);}
  }
 }
 const baseAlpha=detail.baseAlpha*(simple?1:.72);
 for(let k=0;k<4;k++){
  ctx.lineWidth=(k===0?.51:k===3?.46:.50)*detail.line;ctx.strokeStyle=nrColor(`rgba(206,211,198,${baseAlpha*[.78,.48,.2,.63][k]})`);
  ctx.beginPath();for(const e of carriers[k])strokeCurve(e.s,e.a,e.b,e.t);ctx.stroke();
 }
 ctx.strokeStyle=nrColor('#f1ead980');ctx.lineWidth=.75*detail.line;ctx.beginPath();for(const e of focus)strokeCurve(e.s,e.a,e.b,e.t);ctx.stroke();
 // Soft tails with a short bright tip. Normal compositing keeps the individual fibres visible.
 ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=vivid?nrColor('#e4e2cb0c'):nrColor('#e4e2cb06');ctx.lineWidth=2.4*detail.line;ctx.beginPath();for(const b of bursts)if(b.strength>.8)tracePath(b.path,b.distance-b.tail*.65,b.distance);ctx.stroke();ctx.restore();
 const packets=Array.from({length:2},()=>Array.from({length:12},()=>[])),levels=[.04,.10,.22,.40,.68,.96];
 for(const b of bursts)for(let k=0;k<6;k++){const alpha=levels[k]*b.strength*b.fade*(vivid?1:.63);if(alpha<.025)continue;
  const from=b.distance-b.tail+b.tail*k/6,to=b.distance-b.tail+b.tail*(k+1)/6;packets[k===5?1:0][Math.min(11,Math.floor(alpha*12))].push(...pathWindow(b.path,from,to));
 }
 for(let head=0;head<2;head++)for(let level=0;level<12;level++){const batch=packets[head][level];if(!batch.length)continue;ctx.strokeStyle=nrColor(`rgba(${head?'255,249,228':'216,220,202'},${.035+level*.081})`);ctx.lineWidth=(head?1.03:.68)*detail.line;ctx.beginPath();for(const p of batch)partialCurve(p.e,p.from,p.to);ctx.stroke();}
 for(const b of bursts){if(b.distance>b.path.total||b.seed%31||b.strength<.8)continue;const p=pathPoint(b.path,b.distance);glow(p.x,p.y,5*detail.line,.15*b.fade);}
 if(!stale)for(const pulse of eventPulses){const routes=members.get(pulse.id),distance=(clock-pulse.born)*velocity;if(!routes)continue;
  for(const route of routes){if(distance>route.path.total+detail.tail)continue;ctx.strokeStyle=nrColor('rgba(225,244,230,.9)');ctx.lineWidth=1.08*detail.line;ctx.beginPath();tracePath(route.path,distance-detail.tail,distance);ctx.stroke();if(distance<=route.path.total){const p=pathPoint(route.path,distance);glow(p.x,p.y,9,.32);}}
 }
 ctx.restore();
 canvas.dataset.pathMode='continuous-distance';canvas.dataset.density=sparse?'reference':'all';canvas.dataset.sparseApplied=String(simple);canvas.dataset.baseBranches=String(carriers[0].length);canvas.dataset.baseTrunks=String(carriers[1].length);canvas.dataset.baseDelegations=String(carriers[3].length);canvas.dataset.signalPackets=String(bursts.length);canvas.dataset.brightFilaments=String(bursts.filter(b=>b.strength>.8).length);canvas.dataset.bundleLanes=String(detail.lanes);canvas.dataset.bundleWidth=detail.band.toFixed(1);canvas.dataset.tailPixels=detail.tail.toFixed(1);canvas.dataset.baseSegments=String(carriers.reduce((sum,layer)=>sum+layer.length,0));canvas.dataset.baseOpacity=baseAlpha.toFixed(3);canvas.dataset.eventPulses=String(eventPulses.length);canvas.dataset.eventPulseTotal=String(eventPulseTotal);
 if(!stale)for(const event of eventPulses){const p=cache.get(event.id);if(!p)continue;const age=(clock-event.born)/6.5;ctx.strokeStyle=nrColor(`rgba(214,232,218,${(1-age)*.40})`);ctx.lineWidth=.6;ctx.beginPath();ctx.arc(p.x,p.y,5+age*23,0,TAU);ctx.stroke();}
 const labelBoxes=[];
 for(const p of projected.slice().sort((a,b)=>a.z-b.z)){
  const n=p.n,st=signals.get(n.hub?n.id:n.g.id),isActive=n.status==='active'&&!stale,isSelected=n.id===selected||n.id===hover;
   const excitation=n.hub?st.charge:(excited.get(n.id)||0),radius=n.hub?1.9:isActive?3:isSelected?2.6:.56;
  if(n.hub||isActive||isSelected){ctx.save();ctx.globalCompositeOperation='lighter';glow(p.x,p.y,n.hub?15+excitation*13:isActive?19:10,n.hub?.25+excitation*.3:.65);ctx.restore();}
  ctx.fillStyle=excitation>.3?nrColor('#fff7df'):n.hub?nrColor('#e2e6d4'):isActive?nrColor('#edffe8'):colors[stale&&!n.hub?'unknown':n.status]||colors.unknown;ctx.globalAlpha=n.hub||isActive||isSelected?1:.38+excitation*.45;ctx.beginPath();ctx.arc(p.x,p.y,(radius+excitation*.5)*p.scale,0,TAU);ctx.fill();ctx.globalAlpha=1;
  if(n.hub||(excitation>.24&&(!simple||isActive||isSelected||n.seed%11===0))){ctx.strokeStyle=nrColor(`rgba(225,231,211,${n.hub?.42+excitation*.4:excitation*.55})`);ctx.lineWidth=.65;ctx.beginPath();ctx.arc(p.x,p.y,n.hub?5.2+excitation*1.7:2.5+excitation,0,TAU);ctx.stroke();}
  if(isActive){const pulse=clock*.5%1;ctx.strokeStyle=nrColor(`rgba(198,255,214,${(1-pulse)*.65})`);ctx.lineWidth=.8;ctx.beginPath();ctx.arc(p.x,p.y,7+pulse*18,0,TAU);ctx.stroke();}
  if((n.hub||isSelected||isActive)&&p.x>-5&&p.x<width+5&&p.y>0&&p.y<height){
   ctx.font='9px Consolas,"Microsoft YaHei"';ctx.textAlign='left';const label=n.hub?n.name+' · '+n.tasks.length:(isActive?'RUN / ':'')+n.name.slice(0,23),tw=ctx.measureText(label).width;
   const x=clamp(p.x+7,7,Math.max(7,width-tw-15));let y=null;
   for(const offset of [-17,-33,0,-49,16,32]){const top=clamp(p.y+offset,4,height-19);if(!labelBoxes.some(b=>x<b.x+b.w+3&&x+tw+8>b.x-3&&top<b.y+17&&top+14>b.y-3)){y=top;break;}}
   if(y===null&&(isSelected||isActive))y=clamp(p.y-17,4,height-19);
   if(y!==null){labelBoxes.push({x,y,w:tw+8});if(Math.abs(y-(p.y-17))>4||x<p.x){ctx.strokeStyle=nrColor('#8caa7e55');ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(clamp(p.x,x,x+tw+8),y+13);ctx.stroke();}ctx.fillStyle=nrColor('#020807cf');ctx.fillRect(x,y,tw+8,14);ctx.fillStyle=n.hub?nrColor('#d3dfcd'):nrColor('#e2ffe9');ctx.fillText(label,x+4,y+10);}
  }
 }
 const anchor=projected.find(p=>p.n.hub);canvas.dataset.networkAnchor=anchor?`${anchor.x.toFixed(2)},${anchor.y.toFixed(2)}`:'';
}

let lastScopeDraw=-1000,scopePainted=false,lastScopeFilter='';
function drawEventScope(now,stale){
 if(now-lastScopeDraw<100||document.hidden)return;lastScopeDraw=now;
 const scope=$('#event-scope');if(!scope)return;const w=scope.clientWidth,h=scope.clientHeight,ratio=Math.min(devicePixelRatio||1,1.5),resize=scope.width!==Math.round(w*ratio)||scope.height!==Math.round(h*ratio),filter=[$('#project').value,$('#period').value,$('#search').value].join('|');
 if(!w||!h)return;
 if(paused&&scopePainted&&!resize&&filter===lastScopeFilter){$('#scope-caption').textContent=`画面暂停 · 已观测 ${scope.dataset.observedEvents||0} 条`;return;}
 lastScopeFilter=filter;
 if(resize){scope.width=Math.round(w*ratio);scope.height=Math.round(h*ratio);}
 const p=scope.getContext('2d'),end=Date.now()/1000,allowed=new Set(visible.map(t=>t.id));
 const events=[...scopeEvents.values()].filter(e=>e.at>=end-90&&e.at<=end&&allowed.has(e.threadId)),channels=[events.filter(e=>e.kind==='tool'),events.filter(e=>e.kind!=='tool')];
 p.setTransform(ratio,0,0,ratio,0,0);p.clearRect(0,0,w,h);p.font='8px Consolas';
 for(let row=0;row<2;row++){
  const base=28+row*(h*.46),ink=row?nrColor('#d1c9a8'):nrColor('#b4d6be');p.fillStyle=nrColor('#72917e');p.fillText(row?'CHAT':'TOOL',12,base-13);p.fillStyle=ink;p.textAlign='right';p.fillText(String(channels[row].length),w-14,base-13);p.textAlign='left';
  const left=49,right=w-15,range=right-left,bins=new Array(61).fill(0);for(const event of channels[row]){const i=Math.floor((event.at-(end-90))/1.5);if(i>=0&&i<bins.length)bins[i]++;}
  p.strokeStyle=nrColor('#314a3b');p.lineWidth=.5;p.beginPath();p.moveTo(left,base);p.lineTo(right,base);p.stroke();
  const max=Math.max(2,...bins);p.strokeStyle=ink;p.globalAlpha=stale?.35:.9;p.lineWidth=.8;p.beginPath();
  bins.forEach((n,i)=>{const x=left+i/60*range,y=base-Math.min(18,n/max*18);if(i===0)p.moveTo(x,y);else p.lineTo(x,y);});p.stroke();
  for(const event of channels[row]){const x=left+(event.at-end+90)/90*range;p.fillStyle=ink;p.fillRect(x,base+4,1,2);}p.globalAlpha=1;
 }
 scope.dataset.observedEvents=String(events.length);$('#scope-caption').textContent=paused?`画面暂停 · 已观测 ${events.length} 条`:stale?'连接中断 · 保留已读取事件':`近 90 秒已观测 ${events.length} 条 · 随当前筛选`;
 scopePainted=true;
}

function drawFrame(){ctx.strokeStyle=nrColor('#84d5ab60');ctx.lineWidth=.65;ctx.beginPath();for(const [x,y,sx,sy]of [[8,8,1,1],[width-8,8,-1,1],[8,height-8,1,-1],[width-8,height-8,-1,-1]]){ctx.moveTo(x,y+sy*20);ctx.lineTo(x,y);ctx.lineTo(x+sx*20,y);}ctx.stroke();}
function draw(now){const delta=lastFrame?Math.min((now-lastFrame)/1000,.05):0;lastFrame=now;if(!paused&&!document.hidden)clock+=delta*speed;camera.zoom=mix(camera.zoom,camera.targetZoom,1-Math.exp(-delta*10));bounds=geometry();const started=performance.now();ctx.setTransform(dpr,0,0,dpr,0,0);const stale=Date.now()-lastSuccess>10000;signals=new Map(hubs.map(g=>[g.id,groupSignal(g)]));drawBackdrop();if(nodes.length){drawRayField(stale);drawRing();drawGraph(stale);}taskBand.draw(ctx,{width,height,clock,vivid,controlTop:document.querySelector('.graph-controls').offsetTop});drawFrame();drawEventScope(now,stale);window.NeuroInstruments?.draw({clock,paused,stale,speed,now});
 frameDurations.push(performance.now()-started);if(frameDurations.length>60)frameDurations.shift();if(now-lastPerformance>2000){canvas.dataset.renderMs=(frameDurations.reduce((a,b)=>a+b,0)/Math.max(1,frameDurations.length)).toFixed(2);canvas.dataset.motionTime=clock.toFixed(3);canvas.dataset.wheelAngle=(wheelAngle()*180/Math.PI%360).toFixed(2);lastPerformance=now;}requestAnimationFrame(draw);}
let down=null,dragged=false;
function hit(e){const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const bandRow=taskBand.hit(x,y);if(bandRow)return bandRow;let best=null,dist=12;for(const p of projected){const d=Math.hypot(p.x-x,p.y-y);if(d<dist){dist=d;best=p.n;}}return best;}
canvas.onpointerdown=e=>{if(down)return;down={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:camera.yaw,pitch:camera.pitch};dragged=false;canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(down&&down.id===e.pointerId){const dx=e.clientX-down.x,dy=e.clientY-down.y;dragged=dragged||Math.hypot(dx,dy)>4;camera.yaw=clamp(down.yaw+dx*.003,-.65,.65);camera.pitch=clamp(down.pitch+dy*.003,-.45,.45);canvas.style.cursor='grabbing';}else if(!down){const n=hit(e);hover=n?.id||null;taskBand.setHover(hover);canvas.style.cursor=n?'pointer':'grab';$('#hover-card').hidden=!n;if(n)$('#hover-card').innerHTML=n.hub?`<b>${esc(n.name)}</b><br><small>${esc(n.subtitle)} · ${n.tasks.length} 条真实聊天</small>`:`<b>${esc(n.name)}</b><br><small>${esc(projectName(n.projectId))} / ${esc(n.statusLabel)}</small>`;}};
canvas.onpointerup=e=>{if(down?.id!==e.pointerId)return;if(!dragged){const n=hit(e);if(n?.hub){if(n.projectId){$('#project').value=n.projectId;$('#search').value='';}else{$('#project').value='unassigned';$('#search').value='模型:'+(n.model||'未记录');}render();}else if(n)select(n.id);}down=null;canvas.style.cursor='grab';};
canvas.onpointercancel=()=>{down=null;};canvas.onpointerleave=()=>{if(!down){hover=null;taskBand.setHover(null);$('#hover-card').hidden=true;}};
canvas.addEventListener('wheel',e=>{e.preventDefault();camera.targetZoom=clamp(camera.targetZoom*Math.exp(-e.deltaY*.001),.5,2.6);},{passive:false});
function updateMotion(){canvas.dataset.paused=String(paused);$('#motion').textContent=paused?'▶ 开启巡航':'Ⅱ 暂停巡航';$('#motion').setAttribute('aria-pressed',String(paused));$('#motion-state').textContent=paused?'画面已暂停':'长线流场 · 连续传播';}
$('#band-toggle').onclick=()=>{bandEnabled=!bandEnabled;taskBand.setEnabled(bandEnabled);$('#band-toggle').textContent=bandEnabled?'任务环：开':'任务环：关';$('#band-toggle').setAttribute('aria-pressed',String(bandEnabled));};
$('#motion').onclick=()=>{paused=!paused;updateMotion();};$('#speed').onchange=()=>{speed=Number($('#speed').value);};
$('#light').onclick=()=>{vivid=!vivid;canvas.dataset.light=vivid?'vivid':'soft';$('#light').textContent=vivid?'光效：增强':'光效：柔和';$('#light').setAttribute('aria-pressed',String(vivid));};
$('#density').onclick=()=>{sparse=!sparse;canvas.dataset.density=sparse?'sparse':'all';$('#density').textContent=sparse?'线网：参考':'线网：全部';$('#density').setAttribute('aria-pressed',String(sparse));};
$('#view').onclick=()=>{panorama=!panorama;camera.targetZoom=1;$('#view').textContent=panorama?'巨环近景':'完整圆环';$('#view').setAttribute('aria-pressed',String(panorama));canvas.dataset.view=panorama?'panorama':'close';};
$('#zoom-in').onclick=()=>camera.targetZoom=clamp(camera.targetZoom*1.18,.5,2.6);$('#zoom-out').onclick=()=>camera.targetZoom=clamp(camera.targetZoom/1.18,.5,2.6);
$('#reset').onclick=()=>{camera.yaw=0;camera.pitch=0;camera.targetZoom=1;};
function toggleTasks(open){$('#tasks-panel').hidden=!open;$('#tasks-toggle').setAttribute('aria-expanded',String(open));if(open)renderRows();}
$('#tasks-toggle').onclick=()=>toggleTasks($('#tasks-panel').hidden);$('#tasks-close').onclick=()=>toggleTasks(false);document.addEventListener('keydown',e=>{if(e.key==='Escape')toggleTasks(false);});
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('#banner').textContent='当前浏览器不支持此全屏方式，可在 Chrome 打开此地址并按 F11。';$('#banner').hidden=false;}};
document.addEventListener('fullscreenchange',()=>$('#fullscreen').textContent=document.fullscreenElement?'退出全屏 ↙':'全屏 ↗');
$('#project').onchange=render;$('#period').onchange=render;$('#search').oninput=render;$('#refresh').onclick=refresh;
setInterval(()=>{$('#clock').textContent=time(Date.now()/1000,true);if(rawData){if(lastSuccess&&Date.now()-lastSuccess>10000&&!transportOffline)markStale();else if(!transportOffline){const checked=NeuroTaskBand.normalizeState(rawData);if(checked.connection.connected!==data.connection.connected||checked.threads.some((t,i)=>t.status!==data.threads[i]?.status)){data=checked;render();}}}},1000);
updateMotion();resize();requestAnimationFrame(draw);refresh();setInterval(refresh,3000);
