/* Task information arc. Independent implementation; all content comes from /api/state. */
(function (root) {
  'use strict';
const nrColor = globalThis.NeuroTheme?.color || (value => value);
  const LIVE = new Set(['active', 'idle', 'attention']);
  const ink = {active:nrColor('#cbffe6'), idle:nrColor('#9bbfaf'), attention:nrColor('#edcb91'), recent:nrColor('#a4d7df'), ended:nrColor('#9baea5'), unknown:nrColor('#849c91')};
  const shortStatus = {active:'运行中', idle:'空闲', attention:'需关注', recent:'近期活动', ended:'本轮结束', unknown:'状态未知'};
  const fresh = (v, now, ttl) => Number.isFinite(v) && v > 0 && v <= now + 5 && now - v <= ttl;
  const stamp = value => value ? new Date(value * 1000).toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false}) : '—';

  function normalizeState(state, now = Date.now()/1000, offline = false) {
    if (!state) return null;
    const snapshotFresh = !offline && state.ok === true && fresh(state.generatedAt, now, 15);
    const connected = snapshotFresh && state.connection?.connected === true;
    return {...state, connection:{...state.connection, connected}, snapshotFresh,
      threads:(state.threads || []).map(t => {
        const stale = (LIVE.has(t.status) && (!connected || !fresh(t.checkedAt, now, 50))) || (t.status === 'recent' && !snapshotFresh);
        return stale ? {...t, status:'unknown', statusLabel:'状态已过期', checkedAt:null, evidence:'保留记录 · 实时状态不可确认'} : t;
      })};
  }
  function createCursor() {
    const seen = new Set(); let ready = false;
    return {ingest(events, now = Date.now()/1000) {
      const added=[];
      for (const e of events || []) {
        const key=JSON.stringify([e.threadId,e.at,e.kind,e.label]);
        if (!seen.has(key)) {seen.add(key); if (ready && fresh(e.at,now,30)) added.push(e);}
      }
      ready=true; while (seen.size>4096) seen.delete(seen.values().next().value);
      return added;
    }};
  }
  function buildRows(state, visible) {
    const latest = new Map(), tool = new Map();
    for (const e of state?.events || []) {
      if (!Number.isFinite(e.at)) continue;
      if (!latest.has(e.threadId) || latest.get(e.threadId).at < e.at) latest.set(e.threadId,e);
      if (e.kind==='tool' && (!tool.has(e.threadId) || tool.get(e.threadId).at < e.at)) tool.set(e.threadId,e);
    }
    const rank = s => s==='active'?0:s==='attention'?1:s==='recent'?2:3;
    return (visible || []).map(t=>({ ...t, event:latest.get(t.id)||null, tool:tool.get(t.id)||null,
      activityAt:Math.max(t.updatedAt||0, latest.get(t.id)?.at||0) }))
      .sort((a,b)=>rank(a.status)-rank(b.status)||b.activityAt-a.activityAt||a.id.localeCompare(b.id));
  }

  function create({wrap, compact, access, controls, select, hover, projectName}) {
    let rows=[], total=0, selection=null, hovered=null, page=0, capacity=6, enabled=true, filter='', title='最近任务';
    let clock=0, boxes=[], lastKey='', layoutKey='', mode='arc', health=true;
    const pulses = new Map();
    const prev=controls.querySelector('[data-band-prev]'), next=controls.querySelector('[data-band-next]');
    const counter=controls.querySelector('[data-band-page]');
    function pageRows() {return rows.slice(page*capacity,(page+1)*capacity);}
    function syncDOM() {
      page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/capacity)-1)));
      const slice=pageRows();
      const key=JSON.stringify([mode,enabled,health,title,page,capacity,selection,slice.map(r=>[r.id,r.name,r.status,r.statusLabel,r.activityAt,r.tool?.label])]);
      if (key===lastKey) return; lastKey=key;
      controls.hidden=!enabled; compact.hidden=!enabled||mode!=='compact'; access.hidden=!enabled||mode!=='arc';
      prev.disabled=page===0; next.disabled=(page+1)*capacity>=rows.length;
      counter.textContent=rows.length?`${page+1} / ${Math.ceil(rows.length/capacity)}`:'0 / 0';
      controls.setAttribute('aria-label',title+' · 任务信息环翻页');
      const focused=document.activeElement,focusHost=access.contains(focused)?access:compact.contains(focused)?compact:null,focusId=focused?.dataset?.threadId;
      compact.replaceChildren();access.replaceChildren();
      const heading=document.createElement('div');heading.className='band-compact-title';
      heading.textContent='任务信息环 / '+title+(health?'':' · 状态不可确认');compact.append(heading);
      for (const host of [compact,access]) {
        if (!slice.length) {const p=document.createElement('p');p.textContent='当前筛选没有任务';host.append(p);}
        for (const row of slice) {
          const button=document.createElement('button');button.type='button';button.dataset.threadId=row.id;
          button.setAttribute('aria-pressed',String(row.id===selection));button.className='band-task';
          const name=document.createElement('span'), state=document.createElement('span'), detail=document.createElement('small');
          name.className='band-task-name';name.textContent=row.agentNickname?row.agentNickname+' · '+row.name:row.name;
          state.className='band-task-status';state.textContent=row.statusLabel||shortStatus[row.status]||'未知';
          detail.textContent=(row.tool?.label||row.event?.label||'尚无近期工具记录')+' · '+stamp(row.activityAt);
          button.title=[row.name,projectName(row.projectId),row.agentRole||'',row.statusLabel,row.tool?.label||'',stamp(row.activityAt)].filter(Boolean).join(' / ');
          button.append(name,state,detail);
          button.onclick=()=>select(row.id);button.onfocus=()=>hover(row.id);button.onblur=()=>hover(null);
          host.append(button);
        }
      }
      if(focusHost&&focusId){const replacement=[...focusHost.querySelectorAll('button')].find(b=>b.dataset.threadId===focusId);replacement?.focus({preventScroll:true});}
      wrap.dataset.bandRows=String(slice.length);wrap.dataset.bandPage=String(page+1);
      wrap.dataset.bandFirst=slice[0]?.id||'';wrap.dataset.bandMode=mode;
    }
    prev.onclick=()=>{page--;syncDOM();};next.onclick=()=>{page++;syncDOM();};
    function update({state,visible,selected,filterKey,scope}) {
      if (filter!==filterKey) {page=0;filter=filterKey;hovered=null;}
      const ranked=buildRows(state,visible);total=ranked.length;rows=ranked.slice(0,80);
      // A deliberately selected older record stays reachable without filling the arc with history.
      const chosen=ranked.find(r=>r.id===selected);if(chosen&&!rows.some(r=>r.id===selected))rows[rows.length-1]=chosen;
      selection=selected;title=scope;health=state?.snapshotFresh!==false&&state?.connection?.connected===true;
      syncDOM();
    }
    function fit(ctx,text,maxWidth) {
      text=String(text??'');if (ctx.measureText(text).width<=maxWidth) return text;
      while(text.length && ctx.measureText(text+'…').width>maxWidth)text=text.slice(0,-1);
      return text+'…';
    }
    function draw(ctx,{width,height,clock:now,vivid,controlTop}) {
      clock=now;
      const newMode=width<820?'compact':'arc';
      const availableBottom=Math.min(height-65,controlTop-12);
      const newCapacity=newMode==='compact'?5:Math.max(2,Math.min(10,Math.floor((availableBottom-177)/36)+1));
      const nextLayout=[newMode,newCapacity].join(':');
      if(nextLayout!==layoutKey){layoutKey=nextLayout;mode=newMode;capacity=newCapacity;wrap.dataset.bandMode=mode;syncDOM();}
      boxes=[];if(!enabled||mode==='compact')return;
      const bandWidth=Math.min(490,width*.415), left=width-bandWidth-20, right=width-27;
      const firstY=105, lastY=Math.max(firstY,availableBottom-72), centerY=(firstY+lastY)/2;
      const count=capacity, pitch=count>1?(lastY-firstY)/(count-1):38, half=Math.max(80,(lastY-firstY)/2), radius=Math.max(1200,half*10);
      ctx.save();
      const shade=ctx.createLinearGradient(left-30,0,right,0);shade.addColorStop(0,nrColor('#02090800'));shade.addColorStop(.18,nrColor('#020908dd'));shade.addColorStop(1,nrColor('#020908ee'));
      ctx.fillStyle=shade;ctx.fillRect(left-30,18,bandWidth+45,availableBottom+20);
      ctx.textAlign='left';ctx.font='10px Consolas,"Microsoft YaHei"';ctx.fillStyle=nrColor('#95bca7');
      ctx.fillText('TASK ARC / 任务信息环',left+24,43);
      ctx.font='11px Consolas,"Microsoft YaHei"';ctx.fillStyle=nrColor('#d8e9dc');ctx.fillText(fit(ctx,title,bandWidth-135),left+24,65);
      ctx.strokeStyle=nrColor('#526d5c66');ctx.lineWidth=.6;ctx.beginPath();
      for(let i=0;i<=48;i++) {const y=firstY-24+(lastY-firstY+50)*i/48,dy=y-centerY,x=left+16+Math.sqrt(radius*radius-dy*dy)-radius; i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
      const slice=pageRows();
      slice.forEach((row,i)=>{
        const y=firstY+i*pitch,dy=y-centerY,angle=Math.asin(dy/radius),x=left+30+Math.sqrt(radius*radius-dy*dy)-radius;
        const w=right-x-14,active=row.id===selection,over=row.id===hovered;
        const born=pulses.get(row.id),pulse=health&&born!==undefined?Math.max(0,1-(clock-born)/5):0;
        if(born!==undefined&&clock-born>5)pulses.delete(row.id);
        boxes.push({id:row.id,x,y,w,h:34,angle,row});
        ctx.save();ctx.translate(x,y);ctx.rotate(angle);
        if(active||over||pulse){ctx.fillStyle=active?nrColor('#254334b5'):over?nrColor('#152c22b0'):nrColor(`rgba(100,160,130,${pulse*.15})`);ctx.fillRect(-9,-15,w+15,34);}
        ctx.strokeStyle=active?nrColor('#c6e2c780'):nrColor('#617c6738');ctx.lineWidth=.55;ctx.beginPath();ctx.moveTo(0,21);ctx.lineTo(w,21);ctx.stroke();
        ctx.fillStyle=active?nrColor('#e9f5da'):ink[row.status]||ink.unknown;ctx.fillRect(-9,-8,2,active?19:3);
        if(pulse){ctx.fillStyle=nrColor(`rgba(205,255,220,${pulse*(vivid?.9:.6)})`);ctx.fillRect(-9,-12,Math.max(2,w*pulse),1);}
        const status=row.status==='ended'&&row.statusLabel?.includes('中断')?'本轮中断':shortStatus[row.status]||'未知';
        ctx.font='11px Consolas,"Microsoft YaHei"';ctx.textAlign='right';ctx.fillText(status,w-1,-1);ctx.textAlign='left';
        ctx.font=(active?'bold ':'')+'12px Consolas,"Microsoft YaHei"';ctx.fillStyle=active?nrColor('#f0f4df'):ink[row.status]||ink.unknown;
        const name=row.agentNickname?row.agentNickname+' / '+row.name:row.name;
        ctx.fillText(fit(ctx,name,w-83),0,-1);
        ctx.font='10px Consolas,"Microsoft YaHei"';ctx.fillStyle=nrColor('#91ac9a');
        const toolText=row.tool?.label||row.event?.label||'尚无近期工具记录';
        ctx.fillText(fit(ctx,toolText,w-74),0,14);ctx.textAlign='right';ctx.fillStyle=nrColor('#b2bfac');ctx.fillText(stamp(row.activityAt),w,14);ctx.textAlign='left';
        ctx.restore();
      });
      if(!slice.length){ctx.font='12px "Microsoft YaHei"';ctx.fillStyle=nrColor('#9aaa98');ctx.fillText('当前筛选没有任务',left+30,firstY+15);}
      ctx.font='9px Consolas,"Microsoft YaHei"';ctx.fillStyle=health?nrColor('#879e8c'):nrColor('#d8bb86');
      const foot=health?`${total>80?'最近 80 / '+total:total} 条 · 活跃优先 / 点击查看`:'状态不可确认 · 保留已读取记录';
      ctx.fillText(foot,left+24,availableBottom+8);ctx.restore();
      wrap.dataset.bandPulseCount=String(pulses.size);
    }
    function hit(x,y) {
      if(!enabled)return null;
      for(const b of boxes){const dx=x-b.x,dy=y-b.y,c=Math.cos(b.angle),s=Math.sin(b.angle),xx=dx*c+dy*s,yy=-dx*s+dy*c;
        if(xx>=-10&&xx<=b.w+8&&yy>=-16&&yy<=21)return b.row;
      }return null;
    }
    return {update,draw,hit,
      setSelection(id){selection=id;const index=rows.findIndex(r=>r.id===id);if(index>=0)page=Math.floor(index/capacity);syncDOM();},
      setHover(id){hovered=id;},
      setEnabled(value){enabled=value;wrap.dataset.bandEnabled=String(enabled);syncDOM();},
      observe(events,now){for(const e of events)pulses.set(e.threadId,now);},
    };
  }
  const api={normalizeState,createCursor,buildRows,create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.NeuroTaskBand=api;
})(globalThis);
