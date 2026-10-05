/* Presentation 5: original-style rail travel, a central road, and a single
   panel/ghost pair. Every click ends in a complete, reproducible state. */
(() => {
  'use strict';
  const $=s=>document.querySelector(s),stage=$('#stage'),world=$('#world'),camera=$('#camera');
  const dot=$('#traveler'),line=$('#thread-live'),guide=$('#thread-guide');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const order=['title','direction','practice','apps','evidence','solution','sol-a','sol-b','sol-c','closing'];
  const slides=order.map(id=>$(`#${id}`)),stations={title:0,direction:1400,practice:2800,apps:5600,evidence:5600,solution:5600};
  for(const [id,y] of Object.entries(stations)){const el=$(`#${id}`);el.style.top=`${y}px`;world.append(el);}
  const features=slides.filter(s=>s.classList.contains('feature'));
  const panel=document.createElement('div');panel.id='panel';stage.append(panel);features.forEach(s=>panel.append(s));
  const ghost=document.createElement('div');ghost.id='ghost';stage.append(ghost);
  const cards=features.map((slide,i)=>{
    const x=i%2===0?1120:200,y=7500+i*700,el=document.createElement('article');el.className='road-card';el.dataset.feature=slide.id;
    el.style.cssText=`${slide.style.cssText};left:${x}px;top:${y}px`;
    el.innerHTML=`<b class="card-number">0${i+1}</b><b class="card-mark">${slide.dataset.mark}</b><h3>${slide.dataset.cardTitle}</h3><p>${slide.dataset.cardSub}</p>`;
    const poster=slide.querySelector('video')?.poster||slide.querySelector('[data-card-poster]')?.src;if(poster){const thumb=document.createElement('img');thumb.src=poster;thumb.alt='';el.append(thumb);}
    $('#feature-cards').append(el);return {el,id:slide.id,x:x+300,y:y+190};
  });
  // Trace the logo's curl, upper sweep, right turn and lower sweep, all the
  // way to the left tail. Coordinates belong to the actual 2029 × 470 asset.
  const logoPoints=[[1536,96],[1523,43],[1484,13],[1434,17],[1408,54],[1413,103],
    [1450,139],[1513,156],[1580,151],[1660,127],[1740,111],[1812,126],
    [1900,174],[1978,208],[2015,243],[2013,286],[1972,314],[1920,308],
    [1850,282],[1760,230],[1676,198],[1605,206],[1540,233],[1490,274],
    [1440,314],[1390,334],[1330,324],[1240,279],[1160,259],[1100,253],
    [1020,269],[955,306],[900,338],[840,344],[800,327],[740,289],[680,249],
    [640,231],[580,223],[530,237],[480,272],[450,283],[405,275],[358,247],
    [300,211],[240,192],[210,189],[175,201],[133,220],[91,240],[53,262],[10,297]];
  const logoScale=1200/2029,logoMark=[360+1536*logoScale,300+96*logoScale],tail=[360+10*logoScale,300+297*logoScale];
  function catmull(points){let d=`M${points[0].join(' ')}`;for(let i=0;i<points.length-1;i++){
    const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],e=points[Math.min(points.length-1,i+2)];
    d+=` C${b[0]+(c[0]-a[0])/6} ${b[1]+(c[1]-a[1])/6} ${c[0]-(e[0]-b[0])/6} ${c[1]-(e[1]-b[1])/6} ${c.join(' ')}`;
  }return d;}
  const logoPath=document.createElementNS('http://www.w3.org/2000/svg','path');logoPath.id='logo-route';
  logoPath.setAttribute('d',catmull(logoPoints.map(([x,y])=>[360+x*logoScale,300+y*logoScale])));logoPath.style.stroke='none';$('#thread').append(logoPath);
  // A long, confused route wraps past both screen edges. The fixed, eased
  // camera rail lets the line wander without making the screen chase every bend.
  const approach=catmull([tail,[330,540],[440,590],[700,615],[960,680],[985,970]]);
  const hard=[[900,1120],[1030,1280],[850,1400],[980,1500],[800,1600],[1010,1700],[850,1810],[950,1940]];
  const winding=[[950,1940],[600,1960],[-100,1980],[-170,2150],[110,2310],[600,2190],[800,2170],[1120,2170],[1610,2170],
    [2040,2100],[2110,1850],[1990,1520],[1830,1530],[1860,1920],[1830,2400],[1760,2690],[1970,2940],
    [2100,3120],[2070,3500],[2010,3780],[1680,3840],[970,3840],[280,3820],[-160,4000],[-130,4300],
    [90,4560],[-170,4750],[90,5020],[-130,5280],[430,5420],[1100,5420],[1700,5470],[2100,5700],
    [2020,6100],[1930,6490],[1430,6780],[940,6670],[1040,6400],[960,6140]];
  const chaos=approach+hard.map(p=>' L'+p.join(' ')).join('')+catmull(winding).replace(/^M[^C]+/,'');
  const calm=[[960,6140],[960,6550],[975,6900],[960,7320]];
  cards.forEach((card,i)=>{calm.push([960,card.y]);if(i<cards.length-1)calm.push([i%2===0?975:945,card.y+350]);});calm.push([960,13300]);
  const d=chaos+catmull(calm).replace(/^M[^C]+/,'');line.setAttribute('d',d);guide.setAttribute('d',d);
  const past=document.createElementNS('http://www.w3.org/2000/svg','path');past.id='problem-road';past.setAttribute('d',chaos);past.setAttribute('mask','url(#university-gap)');$('#thread').append(past);
  const gradient=$('#thread-color');gradient.replaceChildren();gradient.setAttribute('y1','5600');gradient.setAttribute('y2','13300');
  [[0,'#7457FF'],...cards.map(card=>[(card.y-5600)/7700,getComputedStyle(card.el).getPropertyValue('--accent').trim()]),[1,'#7457FF']].forEach(([offset,color])=>{
    const stop=document.createElementNS('http://www.w3.org/2000/svg','stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',color);gradient.append(stop);});
  const forks=[[[850,1400],[780,1510],[810,1690],[950,1940]],[[980,1500],[1060,1570],[1060,1760]],
    [[-170,2150],[-310,2280],[-260,2440],[110,2310]],[[1610,2170],[1760,2280],[1950,2360]],
    [[90,4560],[220,4710],[150,4920],[90,5020]],[[430,5420],[650,5580],[710,5500]]];
  forks.forEach((points,i)=>{const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M'+points.map(p=>p.join(' ')).join(' L'));p.setAttribute('class','problem-fork');$('#problem-forks').append(p);
    if(i%2){const[x,y]=points.at(-1),end=document.createElementNS('http://www.w3.org/2000/svg','path');end.setAttribute('d',`M${x-10} ${y-10} l20 20 M${x+10} ${y-10} l-20 20`);end.setAttribute('class','fork-end');$('#problem-forks').append(end);}});
  const history=document.createElement('div');history.id='journey-labels';history.innerHTML='<span style="top:2800px">قبل Waypoint</span><span style="top:6140px">اكتشاف Waypoint</span>';world.append(history);
  cards.forEach((card,i)=>{
    const branch=document.createElementNS('http://www.w3.org/2000/svg','path');
    branch.setAttribute('d',`M960 ${card.y} H${i%2===0?1120:800}`);branch.setAttribute('class','card-branch');
    branch.style.stroke=getComputedStyle(card.el).getPropertyValue('--accent');$('#thread').append(branch);
  });
  const roadLength=line.getTotalLength(),logoLength=logoPath.getTotalLength(),samples=[];
  for(let l=0;l<roadLength;l+=4){const p=line.getPointAtLength(l);samples.push({x:p.x,y:p.y,l});}
  const pointAt=l=>{const f=Math.max(0,Math.min(samples.length-1.001,l/4)),i=Math.floor(f),a=samples[i],b=samples[i+1]||a,t=f-i;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};};
  const nearest=([x,y])=>samples.reduce((a,b)=>Math.hypot(b.x-x,b.y-y)<Math.hypot(a.x-x,a.y-y)?b:a).l;
  const lengths={title:0,direction:nearest([1830,2400]),practice:nearest([1840,3800]),apps:nearest([960,6140]),evidence:nearest([960,6140]),solution:nearest([960,6140]),closing:roadLength};
  cards.forEach(card=>lengths[card.id]=nearest([960,card.y]));
  // The line exists from the first frame; it never pops in behind the point.
  line.style.strokeDasharray='none';line.style.strokeDashoffset='0';
  for(let i=0;i<9;i++)for(const side of [0,1]){const mark=document.createElement('i');mark.className=`depth-mark ${i%3===0?'square':''}`;
    mark.style.cssText=`left:${side?1820:15}px;top:${1100+i*1100}px;width:${80+i%3*25}px;height:${80+i%3*25}px;--accent:${['#FF5E57','#12B07A','#7457FF'][i%3]}`;$('#depth').append(mark);}
  const cam={x:960,y:540,s:1,rx:0,rz:0,sy:540};let currentLength=0,dotPosition={x:logoMark[0],y:logoMark[1]},phase='idle',settled=0;
  let lastRz=null;function renderCamera(){camera.style.transform=`translate(1045px,${cam.sy}px) scale(${cam.s}) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) translate(${-cam.x}px,${-cam.y}px)`;
    if(cam.rz!==lastRz){lastRz=cam.rz;cards.forEach(card=>card.el.style.transform=`translateZ(18px) rotateZ(${-cam.rz}deg)`);}}
  function setDot(x,y,scale=1){dotPosition={x,y};dot.style.transform=`translate(${x-23}px,${y-23}px) scale(${scale})`;dot.style.opacity=1;}
  function renderRoad(l){currentLength=l;const p=pointAt(l);setDot(p.x,p.y);}
  function pose(id){if(id==='closing')return {x:960,y:6890,s:.122,rx:0,rz:90,sy:640};const card=cards.find(c=>c.id===id);
    return card?{x:960,y:card.y,s:1.1,rx:-9,rz:0,sy:540}:{x:960,y:stations[id]+540,s:1,rx:0,rz:0,sy:540};}
  function classes(id){stage.classList.toggle('cover-state',id==='title');stage.classList.toggle('evidence-state',id==='evidence');stage.classList.toggle('overview-state',id==='closing');
    stage.classList.toggle('problem-state',['title','direction','practice','apps','evidence'].includes(id));stage.classList.toggle('feature-road-state',['solution','closing',...features.map(s=>s.id)].includes(id));
    const n=cards.findIndex(c=>c.id===id);cards.forEach((card,i)=>{card.el.classList.toggle('current',i===n);card.el.classList.toggle('done',id==='closing'||(n>=0&&i<n));});
    dot.style.background=['title','solution'].includes(id)?'#17142B':getComputedStyle($(`#${id}`)).getPropertyValue('--accent').trim()||'#7457FF';}
  const content=slide=>slide.querySelectorAll('.feature-copy,.demo,.usage');
  function clearArtifacts(){ghost.replaceChildren();gsap.set(ghost,{opacity:0});$('#merge-actors').replaceChildren();cards.forEach(card=>card.el.style.visibility='');
    gsap.set('.solution-result>img,.solution-result h2,.solution-result p,.solution-result small,#apps .apps-copy,#apps .app-token',{clearProps:'opacity,transform,clipPath'});}
  function markActive(i){slides.forEach((s,j)=>s.classList.toggle('active',j===i));}
  function set(i){clearArtifacts();markActive(i);gsap.set('#viewport',{opacity:1});const id=slides[i].id;classes(id);
    stage.classList.remove('feature-overview-state');
    stage.classList.toggle('feature-panel-state',features.includes(slides[i]));
    slides.forEach((s,j)=>gsap.set(s,{opacity:j===i?1:0,visibility:j===i?'visible':'hidden',clearProps:'transform,clipPath'}));features.forEach(s=>gsap.set(content(s),{opacity:1}));
    gsap.set(panel,{visibility:features.includes(slides[i])?'visible':'hidden',clipPath:'inset(0px 0px 0px 0px round 0px)'});
    Object.assign(cam,pose(id));renderCamera();renderRoad(lengths[id]);if(id==='title')setDot(...logoMark);
    if(id==='solution')setDot(100+1536*680/2029,5600+300+96*680/2029,.56);settled=i;phase='idle';}
  function rect(card){const r=card.el.getBoundingClientRect(),s=stage.getBoundingClientRect(),fit=s.width/2090;return {x:(r.left-s.left)/fit,y:(r.top-s.top)/fit,w:r.width/fit,h:r.height/fit};}
  const clip={top:0,right:0,bottom:0,left:0,radius:0},drawClip=()=>panel.style.clipPath=`inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px round ${clip.radius}px)`;
  function clipRect(r){return {top:Math.max(0,r.y),right:Math.max(0,2090-r.x-r.w),bottom:Math.max(0,1080-r.y-r.h),left:Math.max(0,r.x),radius:28};}
  function cloneCard(card){const el=card.el.cloneNode(true);el.classList.remove('current');el.style.left=el.style.top='0';el.style.transform='none';el.style.visibility='visible';ghost.replaceChildren(el);}
  function collapse(tl,slide,at){const card=cards.find(c=>c.id===slide.id);let r,sc;
    tl.add(()=>{phase='collapse';r=rect(card);sc=r.w/600;cloneCard(card);Object.assign(clip,{top:0,right:0,bottom:0,left:0,radius:0});drawClip();
      gsap.set(ghost,{x:r.x-600*sc*.06,y:r.y-380*sc*.06,scale:sc*1.12,opacity:0});card.el.style.visibility='hidden';},at);
    tl.to(content(slide),{opacity:0,duration:.13,ease:'power2.in'},at);
    tl.to(clip,{top:()=>clipRect(r).top,right:()=>clipRect(r).right,bottom:()=>clipRect(r).bottom,left:()=>clipRect(r).left,radius:28,duration:.28,ease:'power2.inOut',onUpdate:drawClip},at+.08);
    tl.to(ghost,{x:()=>r.x,y:()=>r.y,scale:()=>sc,opacity:1,duration:.25,ease:'power2.out'},at+.1);
    tl.add(()=>{gsap.set(panel,{visibility:'hidden'});stage.classList.remove('feature-panel-state');gsap.set(slide,{visibility:'hidden',opacity:0});ghost.replaceChildren();gsap.set(ghost,{opacity:0});card.el.style.visibility='';},at+.37);return .37;}
  function expand(tl,slide,at){const card=cards.find(c=>c.id===slide.id);let r,sc;
    tl.add(()=>{phase='expand';r=rect(card);sc=r.w/600;cloneCard(card);card.el.style.visibility='hidden';features.forEach(s=>gsap.set(s,{visibility:s===slide?'visible':'hidden',opacity:s===slide?1:0}));
      stage.classList.add('feature-panel-state');
      gsap.set(content(slide),{opacity:0});Object.assign(clip,clipRect(r));drawClip();gsap.set(panel,{visibility:'visible'});gsap.set(ghost,{x:r.x,y:r.y,scale:sc,opacity:1});},at);
    tl.to(clip,{top:0,right:0,bottom:0,left:0,radius:0,duration:.44,ease:'power2.inOut',onUpdate:drawClip},at+.001);
    // The ghost scales uniformly. The panel's HTML is never scaled or stretched.
    tl.to(ghost,{x:()=>r.x-600*sc*.1,y:()=>r.y-380*sc*.1,scale:()=>sc*1.2,opacity:0,duration:.38,ease:'power2.in'},at+.04);
    tl.to(content(slide),{opacity:1,duration:.24,stagger:.025,ease:'power2.out'},at+.36);
    tl.add(()=>{ghost.replaceChildren();card.el.style.visibility='';},at+.66);return .66;}
  function moveCamera(tl,dest,at,duration){const origin={...cam},state={t:0};let started=false;tl.to(state,{t:1,duration,ease:'sine.inOut',onStart:()=>{Object.assign(origin,cam);started=true;},onUpdate:()=>{
    if(!started)return;
    const t=state.t;for(const key of ['x','y','s','rx','rz','sy'])cam[key]=origin[key]+(dest[key]-origin[key])*t;renderCamera();}},at);}
  function travel(tl,id,at,duration){const origin={...cam},dest=pose(id),state={t:0};let start=currentLength,offY=0,started=false;tl.add(()=>phase='travel',at);
    tl.to(state,{t:1,duration,ease:'sine.inOut',onStart:()=>{Object.assign(origin,cam);start=currentLength;offY=cam.y-pointAt(start).y;started=true;},onUpdate:()=>{
      if(!started)return;
      const t=state.t,b=Math.sin(Math.PI*t),l=start+(lengths[id]-start)*t,p=pointAt(l),endY=pointAt(lengths[id]).y;cam.x=960;
      const chaotic=start<=lengths.solution||lengths[id]<=lengths.solution;
      cam.y=chaotic?origin.y+(dest.y-origin.y)*t:p.y+offY*(1-t)+(dest.y-endY)*t;cam.s=origin.s+(dest.s-origin.s)*t-.19*b;cam.rx=origin.rx+(dest.rx-origin.rx)*t-17*b;
      cam.rz=origin.rz+(dest.rz-origin.rz)*t;cam.sy=origin.sy+(dest.sy-origin.sy)*t;renderCamera();renderRoad(l);}},at);}
  function logoTravel(tl,reverse,at,duration){const state={t:reverse?1:0};let started=false;tl.add(()=>phase='logo',at);
    tl.to(state,{t:reverse?0:1,duration,ease:'sine.inOut',onStart:()=>started=true,onUpdate:()=>{if(!started)return;const p=logoPath.getPointAtLength(state.t*logoLength);setDot(p.x,p.y,1-.5*Math.sin(Math.PI*state.t));}},at);}
  function returnToRoad(tl,at){const start={...dotPosition},p=pointAt(currentLength),state={t:0};
    tl.to(state,{t:1,duration:.3,ease:'sine.inOut',onUpdate:()=>setDot(start.x+(p.x-start.x)*state.t,start.y+(p.y-start.y)*state.t,.56+.44*state.t)},at);return .3;}
  function toSolutionMark(tl,at){const state={t:0},start={};let started=false;
    const end={x:100+1536*680/2029,y:5600+300+96*680/2029};
    tl.to(state,{t:1,duration:.4,ease:'sine.inOut',onStart:()=>{Object.assign(start,dotPosition);started=true;},onUpdate:()=>{
      if(started)setDot(start.x+(end.x-start.x)*state.t,start.y+(end.y-start.y)*state.t,1-.44*state.t);
    }},at);}
  function merge(tl,fromStats){const solution=$('#solution'),result=$('.solution-result'),logo=result.querySelector('img'),host=$('#merge-actors'),originals=[...document.querySelectorAll('#apps .app-token')];
    gsap.set(solution,{visibility:'visible',opacity:1});gsap.set(logo,{clipPath:'circle(0px at 75.7% 19.1%)'});gsap.set(result.querySelectorAll('h2,p,small'),{opacity:0});phase='merge';
    originals.forEach((el,i)=>{const icon=el.querySelector('.app-icon'),r=icon.getBoundingClientRect(),s=stage.getBoundingClientRect(),fit=s.width/2090,actor=document.createElement('div');
      actor.className='app-token merge-token';actor.style.cssText=`left:0;top:0;width:86px;height:86px;padding:10px;--brand:${el.style.getPropertyValue('--brand')}`;if(el.hasAttribute('data-light'))actor.setAttribute('data-light','');if(el.hasAttribute('data-color'))actor.setAttribute('data-color','');actor.append(icon.cloneNode(true));host.append(actor);
      gsap.set(actor,{x:(r.left-s.left)/fit-10,y:(r.top-s.top)/fit-10,opacity:fromStats?0:1});if(fromStats)tl.to(actor,{opacity:1,duration:.2},.02);tl.to(actor,{x:1002,y:497,scale:.15,opacity:0,duration:.85,ease:'power2.inOut'},.12+i*.012);});
    tl.to(originals,{opacity:0,duration:.15},0);tl.to('#apps .apps-copy',{opacity:0,duration:.25},0);{const sc={v:1};tl.to(sc,{v:1.7,duration:.3,ease:'sine.out',onUpdate:()=>setDot(dotPosition.x,dotPosition.y,sc.v)},.6);}
    const mark={x:100+1536*680/2029,y:5600+300+96*680/2029},start={...dotPosition},state={t:0};
    tl.to(state,{t:1,duration:.55,ease:'power2.inOut',onUpdate:()=>setDot(start.x+(mark.x-start.x)*state.t,start.y+(mark.y-start.y)*state.t,1.7-1.14*state.t)},1.03);
    for(const [i,color] of ['#FF5E57','#12B07A','#7457FF'].entries()){const halo=document.createElement('i');halo.className='merge-halo';
      halo.style.cssText=`left:${mark.x-70}px;top:${mark.y-5600-70}px;border-color:${color}`;host.append(halo);gsap.set(halo,{scale:.1,opacity:0});
      tl.to(halo,{scale:2.5,opacity:.2,duration:.24},1.5+i*.06).to(halo,{scale:3,opacity:0,duration:.35},1.74+i*.06);}
    tl.to(logo,{clipPath:'circle(1000px at 75.7% 19.1%)',duration:.6,ease:'power2.out'},1.5);tl.to(result.querySelectorAll('h2,p,small'),{opacity:1,duration:.4,stagger:.06},1.7);
    tl.set('#apps',{visibility:'hidden',opacity:0},1.12);tl.add(()=>host.replaceChildren(),2.3);}
  function go(from,to,instant,onArrive){if(instant||reduced){set(to);onArrive();return gsap.timeline();}
    clearArtifacts();phase='transition';const old=slides[from],next=slides[to],id=next.id;markActive(to);classes(id);slides.forEach((s,i)=>{if(i!==from&&i!==to)gsap.set(s,{visibility:'hidden',opacity:0});});
    const tl=gsap.timeline({onComplete:()=>{set(to);onArrive();}});let at=0;if((old.id==='apps'||old.id==='evidence')&&id==='solution'){if(old.id==='evidence')tl.to(old,{opacity:0,duration:.25},0);merge(tl,old.id==='evidence');return tl;}
    if(old.classList.contains('feature'))at=collapse(tl,old,0);
    else if(old.id==='title'){logoTravel(tl,false,0,2.05);tl.to(old,{opacity:0,duration:.3},1.86);at=2.05;}
    else tl.to(old,{opacity:0,duration:.25},0);
    if(old.id==='solution')at+=returnToRoad(tl,at);
    if(id==='closing'){
      // Zooming the whole world out from 1.1× re-rasterises a huge layer every frame.
      // Fade out, jump to a mid zoom (already rotated), re-raster once there, then
      // zoom out to the same final pose: the layer is smaller and only ever shrinks.
      const vp=$('#viewport'),mid={...pose(id),s:.3};
      tl.to(vp,{opacity:0,duration:.22,ease:'power1.in'},at);
      tl.add(()=>{Object.assign(cam,mid);renderCamera();renderRoad(roadLength);camera.style.willChange='auto';requestAnimationFrame(()=>camera.style.willChange='transform');},at+.22);
      moveCamera(tl,pose(id),at+.28,.95);
      tl.to(vp,{opacity:1,duration:.35,ease:'power1.out'},at+.28);
      tl.to(next,{visibility:'visible',opacity:1,duration:.5},at+.75);return tl;}
    if(old.id==='solution'&&id===features[0].id){tl.add(()=>stage.classList.add('feature-overview-state'),at);moveCamera(tl,{x:960,y:(cards[0].y+cards.at(-1).y)/2,s:.2,rx:0,rz:0,sy:540},at,1.2);
      tl.add(()=>phase='overview',at+1.2);at+=2.4;tl.add(()=>{stage.classList.remove('feature-overview-state');phase='approach';},at);moveCamera(tl,pose(id),at,1.0);
      const state={l:currentLength};let started=false;tl.to(state,{l:lengths[id],duration:1.0,ease:'sine.inOut',onStart:()=>started=true,onUpdate:()=>{if(started)renderRoad(state.l);}},at);at+=1.0;
    }else if(['apps','evidence'].includes(old.id)&&['apps','evidence'].includes(id)){at+=.3;}else{travel(tl,id,at,1.1);at+=1.1;}
    if(next.classList.contains('feature'))expand(tl,next,at+.16);else{tl.to(next,{visibility:'visible',opacity:1,duration:.4},at-.15);if(id==='title')logoTravel(tl,true,at,.95);if(id==='solution')toSolutionMark(tl,at);}
    return tl;}
  window.WaypointScene={slides,set,go,get camera(){return {...cam}},get roadLength(){return currentLength},get phase(){return phase},get settled(){return settled},get dot(){return {...dotPosition}},logoMark,tail};
})();
