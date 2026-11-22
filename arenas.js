/* =====================================================================
   ARENAS
   Loaded after game.js (it uses R, E_WALL, CAT, SFX and the particle helpers at run time).
   Each arena registers itself with defineArena():

   defineArena({
     id, name, sub, desc,            // menu text
     pull,                           // bowl pull toward the centre (Classic .18)
     spawn,                          // spawn distance from the centre, in R (default .55)
     shapes:[...],                   // static obstacles the spinners bounce off (and debris, as static Matter bodies):
                                     //   {k:'circle',x,y,r}  {k:'seg',x1,y1,x2,y2,r} (a capsule)  {k:'arc',rc,a0,a1,w} (a thick ring arc, a0<a1)
                                     //   {k:'poly',pts:[[x,y],...]} (convex)
     props(g,pw){},                  // create movable props (Matter bodies in pw.props, category CAT.PROP; never in pw.bodies)
     collide(g,f,launched,fx){},     // extra fighter collisions (heavy props), after the static obstacles
     init(){return state},           // per-match arena state (g.as)
     env(g,as,f,dt,E){},             // per fighter, every step: set the multipliers in E (acc, drag, top, spin, pull, rot) and f.sink
     nav(g,as,f,v,o,d,dt){return v}, // AI only: adjust the steering vector for this arena's hazards (obstacle avoidance is shared)
     step(g,as,dt){},                // sim tick (timers, moving parts)
     vis(g,as,rdt){},                // real-time ambience (steam, sparks): visual only
     drawFloor(c,t,g),               // the floor and rim, under everything
     drawOver(c,t,g),                // raised structures: above the debris, below the spinners
     drawTop(c,g,t),                 // over the spinners
   });
   Every hazard acts on both spinners by the same rule, human or CPU, and none of them can end a match on its own.
   ===================================================================== */
const ARENAS={}, ARENA_LIST=[];
let selArena='classic';
function defineArena(a){
  a.shapes=a.shapes||[]; if(a.pull==null) a.pull=.18;
  for(const s of a.shapes) if(s.k==='poly'){   // orient every polygon the same way (positive signed area), so the inside test is one sign
    let ar=0; for(let i=0;i<s.pts.length;i++){const p=s.pts[i], q=s.pts[(i+1)%s.pts.length]; ar+=p[0]*q[1]-q[0]*p[1];}
    if(ar<0) s.pts.reverse();
  }
  ARENAS[a.id]=a; ARENA_LIST.push(a);
}

/* ---------------- geometry ---------------- */
// nearest point of an obstacle's surface to (x,y): q.d is the distance to the surface (negative inside), (q.nx,q.ny) points from the
// obstacle toward (x,y), (q.px,q.py) is the surface point
const NEAR={d:0,nx:0,ny:0,px:0,py:0};
function shapeNear(s,x,y,q){
  let cx,cy,w,fx=1,fy=0;
  if(s.k==='poly'){   // convex polygon: nearest edge point; inside, the distance is negative and the normal still points out
    const P=s.pts; let best=1e9, bx=0, by=0, inside=true;
    for(let i=0;i<P.length;i++){
      const a=P[i], b=P[(i+1)%P.length], ex=b[0]-a[0], ey=b[1]-a[1], l2=ex*ex+ey*ey||1;
      if(ex*(y-a[1])-ey*(x-a[0])<0) inside=false;
      const u=clamp(((x-a[0])*ex+(y-a[1])*ey)/l2,0,1), px=a[0]+ex*u, py=a[1]+ey*u, dd=(x-px)*(x-px)+(y-py)*(y-py);
      if(dd<best){best=dd; bx=px; by=py;}
    }
    const l=Math.sqrt(best)||1e-6;
    if(inside){q.nx=(bx-x)/l; q.ny=(by-y)/l; q.d=-l;} else {q.nx=(x-bx)/l; q.ny=(y-by)/l; q.d=l;}
    q.px=bx; q.py=by; return q;
  }
  if(s.k==='circle'){cx=s.x; cy=s.y; w=s.r;}
  else if(s.k==='seg'){
    const ex=s.x2-s.x1, ey=s.y2-s.y1, l2=ex*ex+ey*ey||1, u=clamp(((x-s.x1)*ex+(y-s.y1)*ey)/l2,0,1);
    cx=s.x1+ex*u; cy=s.y1+ey*u; w=s.r; fx=-ey; fy=ex;
  } else {   // arc
    const m=(s.a0+s.a1)/2, h=(s.a1-s.a0)/2, a=m+clamp(angDiff(Math.atan2(y,x),m),-h,h);
    fx=Math.cos(a); fy=Math.sin(a); cx=fx*s.rc; cy=fy*s.rc; w=s.w;
  }
  let dx=x-cx, dy=y-cy, l=Math.hypot(dx,dy);
  if(l<1e-6){const fl=Math.hypot(fx,fy)||1; dx=fx/fl; dy=fy/fl; l=1e-6;}
  q.nx=dx/l; q.ny=dy/l; q.d=l-w; q.px=cx+q.nx*w; q.py=cy+q.ny*w;
  return q;
}

/* ---------------- fighters vs obstacles ----------------
   The same rule as the rim: pushed out, the inward speed reflected with E_WALL (full restitution while launched), and the rim's
   effects (ring, sparks, and the small ricochet-slam damage for a launched spinner). A bolted-down obstacle is a hard surface like
   the rim, so onWall() fires too: without it Monster (whose stacks come from wall bounces) lost his banks wherever machinery stood
   in front of the rim (Salvage Yard win rate 43% -> 28%); with it he is back to his Classic level, and Crossroads is unchanged. */
function arenaCollide(g,f,launched,fx){
  const S=g.A.shapes; if(!S.length&&!g.A.collide) return;
  for(const s of S){
    shapeNear(s,f.x,f.y,NEAR); const pen=f.r-NEAR.d; if(pen<=0) continue;
    const nx=NEAR.nx, ny=NEAR.ny;
    f.x+=nx*pen; f.y+=ny*pen;
    f.obsT=0; f.obsNx=nx; f.obsNy=ny;
    const vn=-(f.vx*nx+f.vy*ny);
    if(vn>0){const e=launched?2:E_WALL; f.vx+=e*vn*nx; f.vy+=e*vn*ny;}
    if(!fx) continue;
    if(vn>0){
      f.onWall(vn);
      f.surfaceHit(g,-nx,-ny,NEAR.px,NEAR.py,vn,launched);
      if(vn>DENT_MIN){   // a hard hit leaves a hot spot on the structure and a scorch at its foot
        g.obsGlow.push({x:NEAR.px,y:NEAR.py,t0:g.time,s:clamp(vn/600,.35,1)}); if(g.obsGlow.length>30) g.obsGlow.shift();
        scorch(g,NEAR.px+nx*4,NEAR.py+ny*4,10+vn*.02,.18);
      }
    }
    const vt=-f.vx*ny+f.vy*nx;   // grinding along it
    if(Math.abs(vt)>70){
      f.scuffAdd(SIM_DT*Math.abs(vt)/320*.04);
      g.scrape=Math.max(g.scrape,clamp(Math.abs(vt)/320,0,1));
      if(Math.random()<SIM_DT*13) addSpark(g,NEAR.px,NEAR.py,-ny*Math.sign(vt)*rand(120,280)+nx*rand(20,80),nx*Math.sign(vt)*rand(120,280)+ny*rand(20,80),rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2));
    }
  }
  if(g.A.collide) g.A.collide(g,f,launched,fx);
  const dc=Math.hypot(f.x,f.y);   // an obstacle never shoves a spinner through the rim
  if(dc+f.r>R){f.x*=(R-f.r)/dc; f.y*=(R-f.r)/dc;}
}
// static Matter bodies for the obstacles, so loose debris bounces off them like the rim
function arenaBodies(g){
  const out=[];
  const opt=extra=>Object.assign({isStatic:true,restitution:.5,friction:.2,label:'wall',collisionFilter:{category:CAT.WALL,mask:CAT.DEBRIS|CAT.PROP}},extra);
  const add=b=>{b.gd={type:'wall'}; out.push(b);};
  for(const s of g.A.shapes){
    if(s.k==='circle') add(Bodies.circle(s.x,s.y,s.r,opt()));
    else if(s.k==='poly'){const m=polyCentroid(s.pts); add(Bodies.fromVertices(m.cx,m.cy,[s.pts.map(([x,y])=>({x,y}))],opt()));}
    else if(s.k==='seg'){
      const ex=s.x2-s.x1, ey=s.y2-s.y1, l=Math.hypot(ex,ey);
      add(Bodies.rectangle((s.x1+s.x2)/2,(s.y1+s.y2)/2,l,s.r*2,opt({angle:Math.atan2(ey,ex)})));
      add(Bodies.circle(s.x1,s.y1,s.r,opt())); add(Bodies.circle(s.x2,s.y2,s.r,opt()));
    } else {
      const n=Math.max(2,Math.ceil((s.a1-s.a0)/.1)), st=(s.a1-s.a0)/n, ch=2*s.rc*Math.sin(st/2)*1.12;
      for(let i=0;i<n;i++){const a=s.a0+(i+.5)*st; add(Bodies.rectangle(Math.cos(a)*s.rc,Math.sin(a)*s.rc,ch,s.w*2,opt({angle:a+Math.PI/2})));}
      for(const a of [s.a0,s.a1]) add(Bodies.circle(Math.cos(a)*s.rc,Math.sin(a)*s.rc,s.w,opt()));
    }
  }
  return out;
}
// every fighter step: reset the environment multipliers, then let the arena set them
function arenaEnv(g,f,dt){
  const E=f.env; E.acc=E.drag=E.top=E.spin=E.pull=1; E.rot=0;
  f.obsT+=dt;
  if(g.A.env) g.A.env(g,g.as,f,dt,E); else f.sink=0;
}

/* ---------------- AI navigation (a post-pass on each spinner's own steering) ----------------
   1. the arena's own hazard logic (gutters, hot plates)
   2. obstacle avoidance: when the steering heads into a nearby obstacle, the part pointing into it is swung along its surface,
      toward the side the steering already leans (kept for a moment, so it never dithers). Skipped when the rival sits between
      the spinner and the obstacle: shoving it into the structure is the point.
   3. unstick: pressed against an obstacle and barely moving for a while, it slides off along the surface for half a second. */
function arenaNav(g,f,v,o,d,dt){
  const A=g.A;
  if(A.nav) v=A.nav(g,g.as,f,v,o,d,dt);
  const S=A.shapes; if(!S.length) return v;
  let vx=v[0], vy=v[1]; const vl=Math.hypot(vx,vy);
  const sp=Math.hypot(f.vx,f.vy);
  const nv=f.nav||(f.nav={s:null,side:1,t:0,stuck:0,un:0,ux:0,uy:0});
  nv.t-=dt;
  if(vl>1e-3){
    const rx=o.x-f.x, ry=o.y-f.y, gapO=d-f.r-o.r;
    for(const s of S){
      shapeNear(s,f.x,f.y,NEAR); const clear=NEAR.d-f.r; if(clear>170) continue;
      const nx=NEAR.nx, ny=NEAR.ny, into=-(vx*nx+vy*ny)/vl; if(into<=.05) continue;
      const look=36+Math.max(0,-(f.vx*nx+f.vy*ny))*.35;   // how soon it would actually arrive: closing speed, not raw speed
      if(clear>look) continue;
      if(gapO<clear+o.r*1.2&&(rx*vx+ry*vy)>.5*d*vl) continue;   // the rival is in front, closer than the obstacle: press on
      let side;
      if(nv.s===s&&nv.t>0) side=nv.side;
      else{
        let tv=-ny*vx+nx*vy; if(Math.abs(tv)<.15*vl) tv=-ny*rx+nx*ry;   // head-on: go round on the rival's side
        side=tv>=0?1:-1; nv.s=s; nv.side=side;
      }
      nv.t=.6;
      const w=clamp(1-clear/look,0,1)*into*vl, tx=-ny*side, ty=nx*side;
      vx+=(nx*1.05+tx)*w; vy+=(ny*1.05+ty)*w;
    }
  }
  if(f.obsT<.15&&sp<70&&f.launchT<=0) nv.stuck+=dt; else nv.stuck=Math.max(0,nv.stuck-dt*2);
  if(nv.stuck>.6&&nv.un<=0){
    nv.stuck=0; nv.un=.5;
    const tx=-f.obsNy, ty=f.obsNx, s=(tx*(o.x-f.x)+ty*(o.y-f.y))>=0?1:-1;
    nv.ux=tx*s+f.obsNx*.7; nv.uy=ty*s+f.obsNy*.7;
  }
  if(nv.un>0){nv.un-=dt; const l=Math.hypot(nv.ux,nv.uy)||1; return [nv.ux/l,nv.uy/l];}
  return [vx,vy];
}

// for AI planners: 0..1, how bad a spot on the rim (angle th) is to bank off (Gutterworks: the rim behind a gutter)
function arenaWallCost(th){const A=game&&game.A; return A&&A.wallCost?A.wallCost(th):0;}

/* ---------------- drawing helpers ---------------- */
// a static layer painted once into a canvas (world units, FLOOR_S pixels per unit, covering the rim)
function arenaCache(A,key,paint){
  if(A[key]) return A[key];
  const S=FLOOR_S, HW=R+40, cv=document.createElement('canvas'); cv.width=cv.height=Math.ceil(HW*2*S);
  const c=cv.getContext('2d'); c.setTransform(S,0,0,S,HW*S,HW*S); c.lineCap='round'; c.lineJoin='round';
  paint(c);
  return (A[key]={cv,HW});
}
function blit(c,L){c.drawImage(L.cv,-L.HW,-L.HW,L.HW*2,L.HW*2);}
const pol=(r,a)=>[Math.cos(a)*r,Math.sin(a)*r];
function bolt(c,x,y,r){
  c.fillStyle='rgba(0,0,0,.55)'; c.beginPath(); c.arc(x+r*.35,y+r*.45,r*1.1,0,TAU); c.fill();
  const gr=c.createRadialGradient(x-r*.35,y-r*.35,0,x,y,r); gr.addColorStop(0,'#c9ced6'); gr.addColorStop(1,'#4b5059');
  c.fillStyle=gr; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill();
  c.strokeStyle='rgba(0,0,0,.45)'; c.lineWidth=r*.35; c.beginPath(); c.moveTo(x-r*.55,y); c.lineTo(x+r*.55,y); c.stroke();
}
function sectorPath(c,r0,r1,a0,a1){c.beginPath(); c.arc(0,0,r1,a0,a1); c.arc(0,0,r0,a1,a0,true); c.closePath();}
// scratches: short bright and dark lines scattered inside radius rMax (seeded, so the arena always looks the same)
function scratches(c,seed,n,rMax,alpha){
  for(let i=0;i<n;i++){
    const a=hash01(seed,i)*TAU, r=Math.sqrt(hash01(seed,i+300))*rMax, x=Math.cos(a)*r, y=Math.sin(a)*r;
    const d=hash01(seed,i+600)*TAU, l=6+hash01(seed,i+900)*26;
    c.strokeStyle=i%3?`rgba(220,228,240,${alpha})`:`rgba(0,0,0,${alpha*1.6})`; c.lineWidth=.7;
    c.beginPath(); c.moveTo(x,y); c.quadraticCurveTo(x+Math.cos(d)*l*.5+Math.sin(d)*3,y+Math.sin(d)*l*.5-Math.cos(d)*3,x+Math.cos(d)*l,y+Math.sin(d)*l); c.stroke();
  }
}
function stainBlot(c,x,y,r,col,a){
  const gr=c.createRadialGradient(x,y,0,x,y,r); gr.addColorStop(0,rgba(col,a)); gr.addColorStop(.6,rgba(col,a*.4)); gr.addColorStop(1,rgba(col,0));
  c.fillStyle=gr; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill();
}
// the outer apron and the steel rim wall (a riveted ring with seams), shared by the industrial arenas
function paintApron(c,col){
  const gr=c.createRadialGradient(0,0,R,0,0,R+40); gr.addColorStop(0,col); gr.addColorStop(1,'#07080b');
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,R+40,0,TAU); c.fill();
}
function paintRim(c,edge){
  const gr=c.createRadialGradient(0,0,R,0,0,R+22);
  gr.addColorStop(0,'#666d78'); gr.addColorStop(.35,'#3b4049'); gr.addColorStop(1,'#16181d');
  c.strokeStyle=gr; c.lineWidth=22; c.beginPath(); c.arc(0,0,R+11,0,TAU); c.stroke();
  c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=2; c.beginPath(); c.arc(0,0,R+22,0,TAU); c.stroke();
  for(let i=0;i<24;i++){const a=i/24*TAU, p=pol(R+1,a), q=pol(R+21,a); c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=1.6; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();}
  for(let i=0;i<72;i++){if(i%3===0) continue; const p=pol(R+12,i/72*TAU); bolt(c,p[0],p[1],1.9);}
  c.strokeStyle=edge; c.lineWidth=2.5; c.beginPath(); c.arc(0,0,R,0,TAU); c.stroke();
}
// a warning lamp: a dark housing, and a glow when lit (k 0..1)
function lamp(c,x,y,col,k,size){
  size=size||4;
  c.fillStyle='#14161a'; c.beginPath(); c.arc(x,y,size+1.6,0,TAU); c.fill();
  c.fillStyle=k>.05?col:shade(col,-.6); c.globalAlpha=.35+.65*k; c.beginPath(); c.arc(x,y,size,0,TAU); c.fill(); c.globalAlpha=1;
  if(k>.05){
    c.save(); c.globalCompositeOperation='lighter';
    const gr=c.createRadialGradient(x,y,0,x,y,size*5); gr.addColorStop(0,rgba(col,.55*k)); gr.addColorStop(1,rgba(col,0));
    c.fillStyle=gr; c.beginPath(); c.arc(x,y,size*5,0,TAU); c.fill(); c.restore();
  }
}
// raised structures and their impact glows
function arenaDrawOver(c,g,t){
  const A=g.A; if(A.drawOver) A.drawOver(c,t,g);
  const G=g.obsGlow; while(G.length&&g.time-G[0].t0>DENT_COOL) G.shift();
  if(!G.length) return;
  c.save(); c.globalCompositeOperation='lighter';
  for(const q of G){
    const h=1-(g.time-q.t0)/DENT_COOL; if(h<=0) continue;
    const r=10+14*q.s, gr=c.createRadialGradient(q.x,q.y,0,q.x,q.y,r);
    gr.addColorStop(0,`rgba(255,235,190,${.8*h*h})`); gr.addColorStop(.35,`rgba(255,${(80+120*h)|0},40,${.5*h})`); gr.addColorStop(1,'rgba(255,60,20,0)');
    c.fillStyle=gr; c.beginPath(); c.arc(q.x,q.y,r,0,TAU); c.fill();
  }
  c.restore();
}
// the select-screen tile: the arena drawn small, with its raised structures
function arenaPreview(c,size,A,t){
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,size,size);
  c.fillStyle='#090a10'; c.fillRect(0,0,size,size);
  const k=size/((R+30)*2); c.setTransform(k,0,0,k,size/2,size/2);
  A.drawFloor(c,t,null); if(A.drawOver) A.drawOver(c,t,null);
}
function arenaPickHTML(){
  return ARENA_LIST.map(a=>{
    const on=a.id===selArena;
    return `
    <button data-act="arena" data-v="${a.id}" data-sfx="select" class="flex flex-col items-center rounded-2xl border ${on?'border-orange-300/80 bg-white/15 shadow-[0_0_24px_rgba(251,146,60,.25)]':'border-white/10 bg-white/5 hover:bg-white/10'} p-2 md:p-3 transition hover:scale-[1.03]">
      <canvas data-arena="${a.id}" width="224" height="224" class="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-black/30"></canvas>
      <div class="mt-1 md:mt-2 text-sm md:text-base font-extrabold text-center leading-tight">${a.name}</div>
    </button>`;
  }).join('');
}

/* =====================================================================
   CLASSIC BOWL: the original arena, unchanged
   ===================================================================== */
defineArena({
  id:'classic', name:'Classic', sub:'The original bowl',
  desc:'The original arena: a smooth bowl that draws everything toward the middle, ringed by a solid wall. Nothing but the fight.',
  pull:.18, classicWear:true,   // its floor panels buckle and its rim light strip shorts out (game.js wearFloor / rimWear)
  drawFloor(c,t){drawArenaFloor(c,t);}
});

/* =====================================================================
   GUTTERWORKS: four recessed channels around the rim, with raised bridges between them.
   In a gutter a spinner loses grip (less acceleration and top speed), its steering slews and its spin drops a little, while the
   trough's sloped floor nudges it back toward the deck. Climbing out over the inner lip bleeds inward speed like a step, so the easy way out is along the channel
   to the sloped ramp at either end. The lip weakens after a couple of seconds, so nothing is ever stuck. No damage of its own.
   ===================================================================== */
const GW_IN=R-64;               // inner lip radius
const GW_HS=31*Math.PI/180;     // half the angular span of a gutter (they sit on the diagonals)
const GW_RAMP=12*Math.PI/180;   // the sloped exit at each end
const GW_DEEP=16;               // px past the lip before a spinner is fully down in the channel
const GW_LIP=800;               // px/s^2 of inward speed the lip takes from a spinner climbing straight out
const GW_LIP_T=[1.2,1.3];       // after this long in a gutter the lip starts to give, and is gone this much later
// in the channel at full depth: grip (acceleration), top speed, spin, extra drag, and how far the steering slews (radians)
const GW_FX={acc:.35,top:.18,spin:.12,drag:.25,rot:.45};
// the channel is a shallow trough whose floor slopes back up toward the deck: the bowl pull is this much stronger at full depth.
// Without it a spinner already losing grip in a gutter could be held there by a rival's pull (Whirl's field took Eater vs Whirl from 65% to 18%).
const GW_SLOPE=1.2;
function gwCentre(th){return Math.PI/4+Math.round((th-Math.PI/4)/(Math.PI/2))*Math.PI/2;}
// 0..1: how far into the channel's flat floor an angle is (0 on a bridge, ramping up along the sloped ends)
function gwSector(th){const ad=Math.abs(angDiff(th,gwCentre(th))); return ad<GW_HS?clamp((GW_HS-ad)/GW_RAMP,0,1):0;}
function gwClank(g,f,th,vr){
  const x=Math.cos(th)*GW_IN, y=Math.sin(th)*GW_IN;
  SFX.wall(Math.min(vr*.8,420),panAt(x),matOf(f));
  g.shake=Math.max(g.shake,clamp(vr*.01,1.5,5));
  for(let i=0;i<10;i++){const a=th+Math.PI/2*(Math.random()<.5?1:-1)+rand(-.6,.6), s=rand(90,260); addSpark(g,x,y,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2));}
  gouge(g,x,y,-Math.sin(th),Math.cos(th),rand(12,24),.3);
}
function gwPaintFloor(c){
  paintApron(c,'#191b20');
  // inner deck: diamond tread plate in big bolted sheets
  c.save(); c.beginPath(); c.arc(0,0,GW_IN,0,TAU); c.clip();
  let gr=c.createRadialGradient(-90,-130,20,0,0,GW_IN); gr.addColorStop(0,'#41464f'); gr.addColorStop(1,'#262a30');
  c.fillStyle=gr; c.fillRect(-GW_IN,-GW_IN,GW_IN*2,GW_IN*2);
  const tread=(dx,dy,col,lw)=>{
    c.strokeStyle=col; c.lineWidth=lw; c.beginPath();
    for(let y=-GW_IN,j=0;y<GW_IN;y+=13,j++) for(let x=-GW_IN+(j&1)*6.5,i=0;x<GW_IN;x+=13,i++){const o=(i+j)&1?1:-1; c.moveTo(x-3.4+dx,y-1.6*o+dy); c.lineTo(x+3.4+dx,y+1.6*o+dy);}
    c.stroke();
  };
  c.lineCap='round'; tread(.8,.9,'rgba(0,0,0,.35)',2.4); tread(0,0,'rgba(200,208,220,.13)',2);
  for(let k=-3;k<=3;k++){   // sheet seams
    const p=k*112+56;
    c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=2.2; c.beginPath(); c.moveTo(p,-GW_IN); c.lineTo(p,GW_IN); c.moveTo(-GW_IN,p); c.lineTo(GW_IN,p); c.stroke();
    c.strokeStyle='rgba(255,255,255,.07)'; c.lineWidth=1; c.beginPath(); c.moveTo(p+1.6,-GW_IN); c.lineTo(p+1.6,GW_IN); c.moveTo(-GW_IN,p+1.6); c.lineTo(GW_IN,p+1.6); c.stroke();
  }
  for(let i=-3;i<=3;i++) for(let j=-3;j<=3;j++) for(const [ox,oy] of [[-6,-6],[6,-6],[-6,6],[6,6]]){const x=i*112+56+ox, y=j*112+56+oy; if(Math.hypot(x,y)<GW_IN-8) bolt(c,x,y,1.8);}
  stainBlot(c,-120,70,46,'#0a0806',.45); stainBlot(c,140,-60,34,'#0a0806',.4); stainBlot(c,30,170,28,'#3a2410',.25); stainBlot(c,-60,-190,40,'#0a0806',.3);
  scratches(c,11,110,GW_IN,.12);
  // centre marking: a stencilled ring and the arena code
  c.setLineDash([14,10]); c.strokeStyle='rgba(230,180,40,.22)'; c.lineWidth=5; c.beginPath(); c.arc(0,0,74,0,TAU); c.stroke(); c.setLineDash([]);
  c.fillStyle='rgba(230,180,40,.16)'; c.font='900 30px ui-sans-serif,system-ui'; c.textAlign='center'; c.textBaseline='middle'; c.fillText('GW-04',0,2);
  // hazard band along every lip
  for(let i=0;i<4;i++){
    const ci=Math.PI/4+i*Math.PI/2, n=26;
    for(let s=0;s<n;s++){const a0=ci-GW_HS+s/n*GW_HS*2, a1=a0+GW_HS*2/n; sectorPath(c,GW_IN-12,GW_IN-2,a0,a1); c.fillStyle=s&1?'rgba(20,20,20,.75)':'rgba(222,170,30,.7)'; c.fill();}
  }
  c.restore();
  // the gutters
  for(let i=0;i<4;i++){
    const ci=Math.PI/4+i*Math.PI/2, a0=ci-GW_HS, a1=ci+GW_HS;
    c.save(); sectorPath(c,GW_IN,R,a0,a1); c.clip();
    gr=c.createRadialGradient(0,0,GW_IN,0,0,R); gr.addColorStop(0,'#050608'); gr.addColorStop(.3,'#0f1115'); gr.addColorStop(1,'#1b1e23');
    c.fillStyle=gr; c.fillRect(-R,-R,R*2,R*2);
    // drainage grating across the channel
    c.lineCap='butt';
    for(let a=a0+.012;a<a1;a+=.034){const p=pol(GW_IN+6,a), q=pol(R-2,a);
      c.strokeStyle='#272a31'; c.lineWidth=2.3; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();
      c.strokeStyle='rgba(170,178,190,.13)'; c.lineWidth=.7; c.beginPath(); c.moveTo(p[0]-.8,p[1]-.8); c.lineTo(q[0]-.8,q[1]-.8); c.stroke();}
    // longitudinal rails and cross ribs (the supporting structure under the grate)
    for(const rr of [GW_IN+21,GW_IN+43]){c.strokeStyle='#17191e'; c.lineWidth=5; c.beginPath(); c.arc(0,0,rr,a0,a1); c.stroke(); c.strokeStyle='rgba(190,198,210,.12)'; c.lineWidth=1; c.beginPath(); c.arc(0,0,rr-2,a0,a1); c.stroke();}
    for(let k=1;k<8;k++){const a=a0+k/8*(a1-a0), p=pol(GW_IN+2,a), q=pol(R,a);
      c.strokeStyle='#121418'; c.lineWidth=6; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();
      c.strokeStyle='rgba(190,198,210,.16)'; c.lineWidth=1; c.beginPath(); c.moveTo(p[0]+1.5,p[1]+1.5); c.lineTo(q[0]+1.5,q[1]+1.5); c.stroke();
      for(const rr of [GW_IN+21,GW_IN+43]){const b=pol(rr,a); bolt(c,b[0],b[1],1.7);}}
    for(let k=0;k<5;k++){const a=a0+hash01(i+7,k)*(a1-a0), rr=GW_IN+10+hash01(i+7,k+9)*44, p=pol(rr,a); stainBlot(c,p[0],p[1],8+hash01(i,k)*14,'#6a3412',.28);}   // rust
    // shadow cast by the lip
    gr=c.createRadialGradient(0,0,GW_IN,0,0,GW_IN+22); gr.addColorStop(0,'rgba(0,0,0,.75)'); gr.addColorStop(1,'rgba(0,0,0,0)');
    c.fillStyle=gr; c.fillRect(-R,-R,R*2,R*2);
    // the sloped exits: the floor rises back to deck level, with chevrons pointing out
    for(const sd of [-1,1]){
      const end=ci+sd*GW_HS, n=12;
      for(let s=0;s<n;s++){const u=s/n, a=end-sd*GW_RAMP*u, b=end-sd*GW_RAMP*(u+1/n); sectorPath(c,GW_IN,R,Math.min(a,b),Math.max(a,b)); c.fillStyle=`rgba(52,57,65,${.9*(1-u)})`; c.fill();}
      for(let s=0;s<3;s++){
        const am=end-sd*GW_RAMP*(.3+s*.24);
        for(const rr of [GW_IN+16,GW_IN+34,GW_IN+52]){
          const tip=pol(rr,am+sd*.035), l1=pol(rr-7,am), l2=pol(rr+7,am);
          c.strokeStyle=`rgba(232,180,36,${.75-s*.18})`; c.lineWidth=2.6; c.beginPath(); c.moveTo(l1[0],l1[1]); c.lineTo(tip[0],tip[1]); c.lineTo(l2[0],l2[1]); c.stroke();
        }
      }
      const p=pol(GW_IN,end), q=pol(R,end); c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=2; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();
    }
    c.restore();
    // the lip: a rolled steel edge
    c.lineCap='round';
    c.strokeStyle='#5d636d'; c.lineWidth=4.5; c.beginPath(); c.arc(0,0,GW_IN+1,a0+GW_RAMP*.6,a1-GW_RAMP*.6); c.stroke();
    c.strokeStyle='rgba(225,230,238,.6)'; c.lineWidth=1.2; c.beginPath(); c.arc(0,0,GW_IN-.8,a0+GW_RAMP*.6,a1-GW_RAMP*.6); c.stroke();
  }
  // bridges between the gutters: raised walkways out to the wall
  for(let i=0;i<4;i++){
    const cb=i*Math.PI/2, h=Math.PI/4-GW_HS;
    c.save(); sectorPath(c,GW_IN,R,cb-h,cb+h); c.clip();
    gr=c.createRadialGradient(0,0,GW_IN,0,0,R); gr.addColorStop(0,'#3a3f47'); gr.addColorStop(1,'#2a2e34'); c.fillStyle=gr; c.fillRect(-R,-R,R*2,R*2);
    for(let rr=GW_IN+8;rr<R-4;rr+=7){c.strokeStyle='rgba(0,0,0,.35)'; c.lineWidth=2; c.beginPath(); c.arc(0,0,rr,cb-h*.8,cb+h*.8); c.stroke(); c.strokeStyle='rgba(220,226,236,.08)'; c.lineWidth=1; c.beginPath(); c.arc(0,0,rr-1.4,cb-h*.8,cb+h*.8); c.stroke();}
    c.restore();
    for(const sd of [-1,1]){const a=cb+sd*h, p=pol(GW_IN,a), q=pol(R,a); c.strokeStyle='#8a909a'; c.lineWidth=2.4; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();
      for(const rr of [GW_IN+12,GW_IN+50]){const b=pol(rr,a-sd*.03); bolt(c,b[0],b[1],2);}}
  }
  scratches(c,23,60,R-6,.08);
  paintRim(c,'rgba(214,220,230,.7)');
}
defineArena({
  id:'gutterworks', name:'Gutterworks', sub:'Rim gutters',
  desc:'Recessed gutters line the rim. A spinner knocked into one loses grip and steering until it climbs out up a sloped end ramp, a sitting target in the meantime. The bridges between them are safe ground.',
  pull:.18,
  wallCost:th=>gwSector(th),
  env(g,as,f,dt,E){
    const dc=Math.hypot(f.x,f.y)||1, th=Math.atan2(f.y,f.x), ci=gwCentre(th), da=angDiff(th,ci);
    const rk=gwSector(th), kr=clamp((dc-GW_IN)/GW_DEEP,0,1), k=kr*rk;
    f.gutK=k; f.gutSide=da>=0?1:-1;
    f.gutT=k>.3?(f.gutT||0)+dt:Math.max(0,(f.gutT||0)-dt);
    const nx=f.x/dc, ny=f.y/dc, vr=f.vx*nx+f.vy*ny;
    if(g.time>0&&k>.5&&(f.gutPrev||0)<=.5&&vr>110) gwClank(g,f,th,vr);   // dropped in: a heavy clank off the lip
    f.gutPrev=k;
    f.sink+=(k-f.sink)*Math.min(1,dt*10);
    if(kr<=0) return;
    if(k>0){
      E.acc=1-GW_FX.acc*k; E.top=1-GW_FX.top*k; E.spin=1-GW_FX.spin*k; E.pull=1+GW_SLOPE*k; E.drag=1+GW_FX.drag*k;
      E.rot=Math.sin(f.t*5.3+f.idx*2.1)*GW_FX.rot*k;   // the channel floor is uneven: the steering slews back and forth (smooth, never random)
    }
    if(vr<0&&rk>0){   // climbing straight out over the lip bleeds inward speed; weaker toward the ramps, and it gives after a while
      const ls=rk*(1-clamp((f.gutT-GW_LIP_T[0])/GW_LIP_T[1],0,1)), dv=Math.min(-vr,GW_LIP*ls*dt);
      f.vx+=nx*dv; f.vy+=ny*dv;
    }
  },
  nav(g,as,f,v,o,d,dt){
    f.bankCd=Math.max(f.bankCd,.5);   // no rim-riding slingshots here: the rim is lined with gutters
    const dc=Math.hypot(f.x,f.y)||1, nx=f.x/dc, ny=f.y/dc, engaged=d-f.r-o.r<70;
    if(f.gutK>.25){
      if(engaged) return v;            // the rival is right there: fight from where it is
      // climb out: run along the channel toward the nearer ramp, angling inward
      const tx=-ny*f.gutSide, ty=nx*f.gutSide, w=clamp(f.gutK*1.2,0,1)*.85;
      return [v[0]*(1-w)+(tx*.8-nx*.45)*w, v[1]*(1-w)+(ty*.8-ny*.45)*w];
    }
    // keep off the lip. When the rival is down in a gutter that is an opening: let it close right up to the edge and hit from the deck,
    // but still not follow it in
    const edge=(o.gutK||0)>.25?GW_IN-4:GW_IN-40;
    const near=clamp((dc+f.r*.5-edge)/40,0,1)*gwSector(Math.atan2(f.y,f.x));
    if(near>0){const out=v[0]*nx+v[1]*ny; if(out>0) return [v[0]-nx*(out+.25)*near, v[1]-ny*(out+.25)*near];}   // scrap lying in a gutter isn't worth climbing down for either
    return v;
  },
  vis(g,as,rdt){   // steam seeping up through the gratings
    if(Math.random()>rdt*2.2) return;
    const i=(Math.random()*4)|0, a=Math.PI/4+i*Math.PI/2+rand(-GW_HS*.8,GW_HS*.8), p=pol(rand(GW_IN+12,R-10),a), life=rand(1.2,2);
    g.parts.push({k:'smoke',x:p[0],y:p[1],vx:rand(-8,8),vy:-rand(10,22),life,max:life,size:rand(7,12),al:.1,col:'#aab3c0',rt:true});
  },
  drawFloor(c,t,g){
    blit(c,arenaCache(this,'_floor',gwPaintFloor));
    // rim lamps: amber on the bridges (slow blink), red over a gutter while a spinner is down in it
    for(let i=0;i<4;i++){
      const pb=pol(R+11,i*Math.PI/2); lamp(c,pb[0],pb[1],'#ffb020',.55+.45*Math.sin(t*2.2+i*1.6),3.4);
      const ci=Math.PI/4+i*Math.PI/2; let hot=0;
      if(g) for(const f of g.fighters) if(f.alive&&(f.gutK||0)>.3&&Math.abs(angDiff(Math.atan2(f.y,f.x),ci))<GW_HS) hot=1;
      for(const sd of [-1,1]){const p=pol(R+11,ci+sd*GW_HS*.55); lamp(c,p[0],p[1],'#ff3b2b',hot?.5+.5*Math.sin(t*14):0,3.4);}
    }
  },
  // the lip's edge is drawn again over any spinner sunk into a gutter, so it reads as sitting below the deck
  drawTop(c,g,t){
    for(const f of g.fighters){
      if(!f.alive||f.sink<.2) continue;
      c.save(); c.beginPath(); c.arc(f.x,f.y,f.r+2,0,TAU); c.clip();
      const th=Math.atan2(f.y,f.x);
      c.fillStyle=`rgba(0,0,0,${.28*f.sink})`; c.beginPath(); c.arc(0,0,R,0,TAU); c.arc(0,0,GW_IN+2,0,TAU,true); c.fill('evenodd');   // the channel's shadow falls on it
      c.lineCap='butt'; c.strokeStyle='#5d636d'; c.lineWidth=4.5; c.beginPath(); c.arc(0,0,GW_IN+1,th-.5,th+.5); c.stroke();
      c.strokeStyle='rgba(225,230,238,.6)'; c.lineWidth=1.2; c.beginPath(); c.arc(0,0,GW_IN-.8,th-.5,th+.5); c.stroke();
      c.restore();
    }
  }
});

/* =====================================================================
   CROSSROADS: a raised ring wall around the centre, broken by four wide doorways that face the four roads in from the rim,
   with a turbine pillar in the middle of the courtyard. Spinners ricochet off it like the rim, it gives cover and walls to drive
   a rival into, and the doorways (120 px clear, wider than any spinner) let a fight flow through. The bowl is almost flat here,
   so nothing drifts into the hub and parks against it.
   ===================================================================== */
const CR_RC=200, CR_W=16, CR_CORE=34;
const CR_GAP=Math.asin((75+CR_W)/CR_RC);   // half-angle of a doorway: 150 px clear between the wall ends
const CR_ARCS=[0,1,2,3].map(i=>({k:'arc',rc:CR_RC,w:CR_W,a0:i*Math.PI/2+CR_GAP,a1:(i+1)*Math.PI/2-CR_GAP}));
function crPaintFloor(c){
  paintApron(c,'#141a1a');
  let gr=c.createRadialGradient(0,0,0,0,0,R); gr.addColorStop(0,'#344040'); gr.addColorStop(.6,'#232c2c'); gr.addColorStop(1,'#151b1b');
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,R,0,TAU); c.fill();
  c.save(); c.beginPath(); c.arc(0,0,R,0,TAU); c.clip();
  for(let r=8,i=0;r<R;r+=3,i++){c.strokeStyle=`rgba(255,255,255,${.012+hash01(3,i)*.022})`; c.lineWidth=1; c.beginPath(); c.arc(0,0,r,0,TAU); c.stroke();}   // lathe rings
  // diagonal hatching in the four quadrants between the roads
  c.save(); sectorPath(c,CR_RC+26,R,0,TAU); c.clip();
  c.strokeStyle='rgba(0,0,0,.18)'; c.lineWidth=2;
  c.beginPath(); for(let k=-2*R;k<2*R;k+=15){c.moveTo(k,-R); c.lineTo(k+2*R,R);} c.stroke();
  c.restore();
  // the four roads from the rim to the doorways
  for(let i=0;i<4;i++){
    c.save(); c.rotate(i*Math.PI/2);
    c.fillStyle='rgba(14,18,18,.82)'; c.fillRect(CR_RC-6,-64,R,128);
    c.strokeStyle='rgba(235,240,240,.32)'; c.lineWidth=2.5; c.beginPath(); c.moveTo(CR_RC+16,-62); c.lineTo(R,-62); c.moveTo(CR_RC+16,62); c.lineTo(R,62); c.stroke();
    c.setLineDash([18,14]); c.strokeStyle='rgba(240,190,40,.5)'; c.lineWidth=3; c.beginPath(); c.moveTo(CR_RC+30,0); c.lineTo(R-8,0); c.stroke(); c.setLineDash([]);
    for(const y of [-32,32]){const x=R-62; c.strokeStyle='rgba(235,240,240,.2)'; c.lineWidth=4; c.beginPath(); c.moveTo(x+12,y-11); c.lineTo(x,y); c.lineTo(x+12,y+11); c.stroke();}   // arrows pointing in
    for(let x=CR_RC+40;x<R;x+=56) for(const y of [-56,56]) bolt(c,x,y,1.8);
    c.restore();
  }
  // plate seams and their bolts
  for(const rr of [262,330]){c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=2.2; c.beginPath(); c.arc(0,0,rr,0,TAU); c.stroke(); c.strokeStyle='rgba(255,255,255,.06)'; c.lineWidth=1; c.beginPath(); c.arc(0,0,rr+1.6,0,TAU); c.stroke();
    for(let i=0;i<48;i++){const a=(i+.5)/48*TAU; if(Math.abs(angDiff(a,Math.round(a/(Math.PI/2))*Math.PI/2))<.2) continue; const p=pol(rr+5,a); bolt(c,p[0],p[1],1.7);}}
  // the courtyard inside the ring: a lighter turned plate with radial spokes and a painted circle
  gr=c.createRadialGradient(0,0,CR_CORE,0,0,CR_RC); gr.addColorStop(0,'#3e4a4a'); gr.addColorStop(1,'#283232');
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,CR_RC-CR_W+2,0,TAU); c.fill();
  for(let i=0;i<24;i++){const a=i/24*TAU, p=pol(CR_CORE+14,a), q=pol(CR_RC-CR_W-4,a); c.strokeStyle='rgba(0,0,0,.2)'; c.lineWidth=1.5; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();}
  c.setLineDash([10,12]); c.strokeStyle='rgba(80,220,200,.18)'; c.lineWidth=4; c.beginPath(); c.arc(0,0,118,0,TAU); c.stroke(); c.setLineDash([]);
  for(let i=0;i<32;i++){const p=pol(CR_RC-CR_W-8,(i+.5)/32*TAU); bolt(c,p[0],p[1],1.6);}
  stainBlot(c,-250,-120,40,'#070909',.4); stainBlot(c,270,150,34,'#070909',.35); stainBlot(c,90,-290,30,'#2a1c0c',.25);
  scratches(c,37,130,R-8,.1);
  c.restore();
  paintRim(c,'rgba(140,240,220,.6)');
}
// the raised ring walls and the pillar housing: painted once, drawn over the debris
function crPaintWalls(c){
  c.lineCap='round';
  for(const s of CR_ARCS){
    c.save(); c.shadowColor='rgba(0,0,0,.7)'; c.shadowBlur=16; c.shadowOffsetX=6; c.shadowOffsetY=9;
    c.strokeStyle='#2a2f36'; c.lineWidth=CR_W*2; c.beginPath(); c.arc(0,0,CR_RC,s.a0,s.a1); c.stroke(); c.restore();
    const gr=c.createRadialGradient(0,0,CR_RC-CR_W,0,0,CR_RC+CR_W);
    gr.addColorStop(0,'#8d97a4'); gr.addColorStop(.18,'#5f6874'); gr.addColorStop(.55,'#4a525d'); gr.addColorStop(.85,'#353b44'); gr.addColorStop(1,'#1e2228');
    c.strokeStyle=gr; c.lineWidth=CR_W*2; c.beginPath(); c.arc(0,0,CR_RC,s.a0,s.a1); c.stroke();
    c.strokeStyle='rgba(0,0,0,.22)'; c.lineWidth=CR_W*2-11; c.lineCap='butt'; c.beginPath(); c.arc(0,0,CR_RC,s.a0+.05,s.a1-.05); c.stroke(); c.lineCap='round';   // inset top plate
    for(let a=s.a0+.09;a<s.a1-.06;a+=.09){
      const p=pol(CR_RC-CR_W+2,a), q=pol(CR_RC+CR_W-2,a); c.strokeStyle='rgba(0,0,0,.5)'; c.lineWidth=1.4; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();
      for(const rr of [CR_RC-8,CR_RC+8]){const b=pol(rr,a+.045); bolt(c,b[0],b[1],1.9);}
    }
    c.strokeStyle='rgba(230,236,245,.45)'; c.lineWidth=1.2; c.beginPath(); c.arc(0,0,CR_RC-CR_W+1,s.a0+.03,s.a1-.03); c.stroke();   // lit inner edge
    for(const a of [s.a0,s.a1]){   // end caps: hazard-striped bumpers that mark the doorways
      const [x,y]=pol(CR_RC,a);
      c.save(); c.beginPath(); c.arc(x,y,CR_W-1,0,TAU); c.clip(); c.translate(x,y); c.rotate(a+.7);
      c.fillStyle='#1a1a1a'; c.fillRect(-CR_W,-CR_W,CR_W*2,CR_W*2); c.fillStyle='#e0ad22';
      for(let k=-3;k<=3;k++) c.fillRect(k*8-2,-CR_W,4,CR_W*2);
      c.restore();
      c.strokeStyle='#15181c'; c.lineWidth=2.4; c.beginPath(); c.arc(x,y,CR_W-1,0,TAU); c.stroke();
      c.strokeStyle='rgba(255,255,255,.25)'; c.lineWidth=1; c.beginPath(); c.arc(x,y,CR_W-3,Math.PI*1.1,Math.PI*1.7); c.stroke();
    }
  }
  // turbine pillar housing (the vanes inside are drawn live)
  c.save(); c.shadowColor='rgba(0,0,0,.7)'; c.shadowBlur=14; c.shadowOffsetX=5; c.shadowOffsetY=8;
  c.fillStyle='#2a2f36'; c.beginPath(); c.arc(0,0,CR_CORE,0,TAU); c.fill(); c.restore();
  const gr=c.createRadialGradient(-10,-12,4,0,0,CR_CORE); gr.addColorStop(0,'#8a94a1'); gr.addColorStop(.7,'#4b535e'); gr.addColorStop(1,'#272c33');
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,CR_CORE,0,TAU); c.fill();
  for(let i=0;i<10;i++){const p=pol(CR_CORE-4.5,(i+.5)/10*TAU); bolt(c,p[0],p[1],1.8);}
  c.fillStyle='#0b0d10'; c.beginPath(); c.arc(0,0,CR_CORE-9,0,TAU); c.fill();
}
defineArena({
  id:'crossroads', name:'Crossroads', sub:'Central hub',
  desc:'A raised ring wall surrounds the centre, broken by four wide doorways. Bounce off it, use it for cover, or drive a rival into it. The floor is nearly flat, so nothing drifts into the hub on its own.',
  pull:.07, spawn:.75,
  shapes:[{k:'circle',x:0,y:0,r:CR_CORE},...CR_ARCS],
  drawFloor(c){blit(c,arenaCache(this,'_floor',crPaintFloor));},
  drawOver(c,t,g){
    blit(c,arenaCache(this,'_walls',crPaintWalls));
    // the turbine turning inside the pillar, with a pulsing core light
    c.save(); c.rotate(t*2.4);
    for(let i=0;i<7;i++){c.rotate(TAU/7); c.fillStyle='#8f99a6'; c.beginPath(); c.moveTo(6,-2); c.quadraticCurveTo(16,-9,CR_CORE-10,-4); c.lineTo(CR_CORE-10,3); c.quadraticCurveTo(15,1,6,3); c.closePath(); c.fill();}
    c.restore();
    const pu=.5+.5*Math.sin(t*3);
    c.fillStyle='#3c434d'; c.beginPath(); c.arc(0,0,7,0,TAU); c.fill();
    lamp(c,0,0,'#47f0d0',.4+.6*pu,3);
    // doorway lights on the wall ends
    for(const s of CR_ARCS) for(const [a,sd] of [[s.a0,1],[s.a1,-1]]){const p=pol(CR_RC,a+sd*.11); lamp(c,p[0],p[1],'#3dff9a',.5+.5*Math.sin(t*2+a*3),2.6);}
  }
});

/* =====================================================================
   FOUNDRY: six heated floor plates in three pairs. Each pair sits point-symmetric across the centre, so both halves of the arena
   always share the same danger. They fire on a fixed, staggered schedule (never random): amber warning lamps for 1.5 s, hot for
   3.5 s, then 2 s cooling. A spinner over a live plate builds heat (about a second to reach full), and sheds it about twice as
   slowly once off. Heat costs grip, a little top speed and spin, and makes the steering waver: no damage of its own.
   ===================================================================== */
const FD_R=245, FD_W=150, FD_H=96;   // plate centre radius; plate size along the rim and across it
const FD_PLATES=[0,1,2,3,4,5].map(k=>{const a=(30+60*k)*Math.PI/180, r=a+Math.PI/2; return {x:Math.cos(a)*FD_R,y:Math.sin(a)*FD_R,a:r,ca:Math.cos(r),sa:Math.sin(r),pair:k%3};});
const FD_START=2, FD_CYCLE=12, FD_STAGGER=4, FD_WARN=1.5, FD_HOT=3.5, FD_COOL=2;   // seconds
const FD_RISE=1.4, FD_FALL=.45;           // heat gained per second on a live plate (times its intensity), lost per second off it
const FD_FX={acc:.2,spin:.12,top:.08,rot:.2};   // at full heat
// the phase of pair p at fight time T: s 'idle'|'warn'|'hot'|'cool', u 0..1 through it, hot = heat intensity 0..1
function fdPhase(T,p,out){
  out=out||{}; out.s='idle'; out.u=0; out.hot=0;
  let u=T-FD_START-p*FD_STAGGER; if(u<0) return out;
  u%=FD_CYCLE;
  if(u<FD_WARN){out.s='warn'; out.u=u/FD_WARN;}
  else if(u<FD_WARN+FD_HOT){out.s='hot'; out.u=(u-FD_WARN)/FD_HOT; out.hot=1;}
  else if(u<FD_WARN+FD_HOT+FD_COOL){out.s='cool'; out.u=(u-FD_WARN-FD_HOT)/FD_COOL; out.hot=.6*(1-out.u);}
  return out;
}
function fdLocal(P,x,y){const dx=x-P.x, dy=y-P.y; return [dx*P.ca+dy*P.sa,-dx*P.sa+dy*P.ca];}
// signed distance from a point to a plate (negative inside) and the outward normal in world space
function fdNear(P,x,y,q){
  const [lx,ly]=fdLocal(P,x,y), ex=Math.abs(lx)-FD_W/2, ey=Math.abs(ly)-FD_H/2, sx=lx<0?-1:1, sy=ly<0?-1:1;
  let nlx,nly;
  if(ex<0&&ey<0){q.d=Math.max(ex,ey); if(ex>ey){nlx=sx; nly=0;} else {nlx=0; nly=sy;}}
  else{const ox=Math.max(ex,0), oy=Math.max(ey,0), l=Math.hypot(ox,oy)||1; q.d=l; nlx=ox/l*sx; nly=oy/l*sy;}
  q.nx=nlx*P.ca-nly*P.sa; q.ny=nlx*P.sa+nly*P.ca; return q;
}
// the heating element's serpentine channel, in plate-local coordinates
function fdCoil(c){
  const x0=-FD_W/2+16, x1=FD_W/2-16, n=4, h=(FD_H-24)/(n-1);
  c.beginPath(); c.moveTo(x0,-FD_H/2+12);
  for(let i=0;i<n;i++){const y=-FD_H/2+12+i*h, xb=i%2?x0:x1; c.lineTo(xb,y); if(i<n-1) c.arc(xb,y+h/2,h/2,-Math.PI/2,Math.PI/2,i%2===1);}
}
// a point a distance s round the outline of a w x h rectangle centred on the origin
function rectWalk(w,h,s){s%=(w+h)*2; if(s<w) return [-w/2+s,-h/2]; s-=w; if(s<h) return [w/2,-h/2+s]; s-=h; if(s<w) return [w/2-s,h/2]; s-=w; return [-w/2,h/2-s];}
function fdPaintFloor(c){
  paintApron(c,'#1c1310');
  let gr=c.createRadialGradient(0,0,0,0,0,R); gr.addColorStop(0,'#2d2622'); gr.addColorStop(.7,'#201b18'); gr.addColorStop(1,'#151210');
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,R,0,TAU); c.fill();
  c.save(); c.beginPath(); c.arc(0,0,R,0,TAU); c.clip();
  // heavy cast plates in a grid, each slightly different in tone, with bolted corners
  for(let i=-4;i<4;i++) for(let j=-4;j<4;j++){
    const x=i*96, y=j*96, k=hash01(i*7+j,3);
    c.fillStyle=`rgba(${k<.5?0:60},${k<.5?0:40},${k<.5?0:20},${.06+k*.08})`; c.fillRect(x+2,y+2,92,92);
    c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=2.4; c.strokeRect(x,y,96,96);
    c.strokeStyle='rgba(255,220,190,.05)'; c.lineWidth=1; c.strokeRect(x+2,y+2,92,92);
    for(const [ox,oy] of [[8,8],[88,8],[8,88],[88,88]]) if(Math.hypot(x+ox,y+oy)<R-10) bolt(c,x+ox,y+oy,2);
  }
  for(let i=0;i<9;i++){const a=hash01(5,i)*TAU, r=60+hash01(6,i)*260, p=pol(r,a); stainBlot(c,p[0],p[1],24+hash01(7,i)*40,'#050302',.5);}   // soot
  for(let i=0;i<26;i++){const a=hash01(8,i)*TAU, r=40+hash01(9,i)*300, p=pol(r,a); stainBlot(c,p[0],p[1],3+hash01(10,i)*7,'#7a3a12',.35);}   // dried slag splashes
  c.fillStyle='rgba(210,180,140,.06)'; for(let i=0;i<400;i++){const a=hash01(11,i)*TAU, r=Math.sqrt(hash01(12,i))*R; c.fillRect(Math.cos(a)*r,Math.sin(a)*r,1.4,1.4);}   // foundry sand
  scratches(c,51,90,R-8,.07);
  // the cold pour grate in the middle
  c.fillStyle='#120f0d'; c.beginPath(); c.arc(0,0,64,0,TAU); c.fill();
  for(let i=0;i<20;i++){c.save(); c.rotate(i/20*TAU); c.fillStyle='#2c2522'; c.fillRect(16,-3,44,6); c.restore();}
  c.strokeStyle='#3d3430'; c.lineWidth=5; c.beginPath(); c.arc(0,0,64,0,TAU); c.stroke(); c.beginPath(); c.arc(0,0,14,0,TAU); c.stroke();
  for(let i=0;i<8;i++){const p=pol(58,i/8*TAU+.2); bolt(c,p[0],p[1],2);}
  c.restore();
  // the heated plates: tempered steel slabs, a hazard border and the element channel, cold here (the glow is drawn live)
  for(const P of FD_PLATES){
    c.save(); c.translate(P.x,P.y); c.rotate(P.a);
    c.fillStyle='rgba(0,0,0,.55)'; c.fillRect(-FD_W/2-9,-FD_H/2-9,FD_W+18,FD_H+18);
    const W2=FD_W+12, H2=FD_H+12, per=(W2+H2)*2, n=24; c.lineWidth=5; c.lineCap='butt';
    for(let k=0;k<n;k++){const s0=k/n*per, s1=(k+1)/n*per; c.strokeStyle=k%2?'#151515':'rgba(214,150,30,.75)'; c.beginPath(); for(let s=s0;s<=s1;s+=3){const p=rectWalk(W2,H2,Math.min(s,s1)); s===s0?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);} const e=rectWalk(W2,H2,s1); c.lineTo(e[0],e[1]); c.stroke();}
    gr=c.createLinearGradient(0,-FD_H/2,0,FD_H/2); gr.addColorStop(0,'#4a4440'); gr.addColorStop(.5,'#38322f'); gr.addColorStop(1,'#2a2523'); c.fillStyle=gr; c.fillRect(-FD_W/2,-FD_H/2,FD_W,FD_H);
    gr=c.createRadialGradient(0,0,FD_H*.3,0,0,FD_W*.62);   // heat discoloration: straw, purple and blue toward the edges
    gr.addColorStop(0,'rgba(0,0,0,0)'); gr.addColorStop(.55,'rgba(190,150,70,.16)'); gr.addColorStop(.75,'rgba(120,60,140,.18)'); gr.addColorStop(1,'rgba(50,90,170,.22)');
    c.fillStyle=gr; c.fillRect(-FD_W/2,-FD_H/2,FD_W,FD_H);
    c.lineCap='round'; fdCoil(c); c.strokeStyle='#120d0b'; c.lineWidth=7; c.stroke(); c.strokeStyle='rgba(255,200,160,.08)'; c.lineWidth=1; c.stroke();
    c.strokeStyle='rgba(255,235,215,.25)'; c.lineWidth=1.2; c.strokeRect(-FD_W/2+1,-FD_H/2+1,FD_W-2,FD_H-2);
    for(const [x,y] of [[-FD_W/2+6,-FD_H/2+6],[FD_W/2-6,-FD_H/2+6],[-FD_W/2+6,FD_H/2-6],[FD_W/2-6,FD_H/2-6]]) bolt(c,x,y,2.2);
    c.restore();
  }
  paintRim(c,'rgba(255,170,110,.55)');
}
const FD_PH=[{},{},{}];
defineArena({
  id:'foundry', name:'Foundry', sub:'Heated floor plates',
  desc:'Six heated plates fire in pairs on a fixed cycle. Amber lamps warn before a pair heats up. Crossing a live plate builds heat that saps grip and spin until it cools off. Both halves of the arena always heat together.',
  pull:.18,
  init(){return {t:0,ph:[0,1,2].map(p=>fdPhase(0,p))};},
  step(g,as,dt){
    as.t+=dt;
    for(let p=0;p<3;p++){
      const was=as.ph[p].s; fdPhase(as.t,p,as.ph[p]);
      if(as.ph[p].s!==was&&as.ph[p].s==='hot') SFX.acid('infect');   // the elements kick in with a hiss
    }
    as.tickT=(as.tickT||0)-dt;   // a relay clicks faster and faster while a pair is about to fire
    const w=as.ph.find(q=>q.s==='warn'); if(w&&as.tickT<=0){as.tk=1-(as.tk||0); SFX.tick(1.15+w.u*.2,as.tk); as.tickT=.32-.2*w.u;}
  },
  env(g,as,f,dt,E){
    let on=0;
    for(const P of FD_PLATES){const ph=as.ph[P.pair]; if(ph.hot<=0) continue; if(fdNear(P,f.x,f.y,NEAR).d<f.r*.35) on=Math.max(on,ph.hot);}
    f.heat=on>0?Math.min(1,(f.heat||0)+on*FD_RISE*dt):Math.max(0,(f.heat||0)-FD_FALL*dt);
    f.sink=0;
    if(on>0) g.sizzle=Math.max(g.sizzle,.35+.4*on);
    const h=f.heat; if(h<=0) return;
    E.acc=1-FD_FX.acc*h; E.spin=1-FD_FX.spin*h; E.top=1-FD_FX.top*h;
    E.rot=Math.sin(f.t*7.1+f.idx*1.7)*FD_FX.rot*h;   // a hot bearing: the steering wavers (smooth, never random)
  },
  // keep off live and about-to-fire plates, and get off one; but never break off an engagement to do it
  nav(g,as,f,v,o,d,dt){
    if(d-f.r-o.r<60) return v;
    let vx=v[0], vy=v[1];
    for(const P of FD_PLATES){
      const ph=as.ph[P.pair], risk=ph.s==='hot'?1:ph.s==='warn'?.3+.7*ph.u:ph.s==='cool'?.6*(1-ph.u):0; if(risk<=0) continue;
      fdNear(P,f.x,f.y,NEAR); const clear=NEAR.d-f.r*.35; if(clear>55) continue;
      const nx=NEAR.nx, ny=NEAR.ny, w=risk*clamp(1-clear/55,0,1.5), into=-(vx*nx+vy*ny);
      if(into>0){vx+=nx*into*w; vy+=ny*into*w;}
      if(clear<0){vx+=nx*w; vy+=ny*w;}
    }
    return [vx,vy];
  },
  vis(g,as,rdt){
    for(const P of FD_PLATES){
      const ph=as.ph[P.pair];
      if(ph.s==='hot'&&Math.random()<rdt*9){   // embers lifting off a live plate
        const lx=rand(-FD_W/2,FD_W/2), ly=rand(-FD_H/2,FD_H/2), x=P.x+lx*P.ca-ly*P.sa, y=P.y+lx*P.sa+ly*P.ca;
        g.parts.push({k:'dot',x,y,vx:rand(-14,14),vy:-rand(30,70),life:rand(.5,1),max:1,col:Math.random()<.5?'#ffb347':'#ff6a1a',size:rand(1.2,2.4),rt:true});
      }
      if((ph.s==='cool'||(ph.s==='hot'&&ph.u>.8))&&Math.random()<rdt*3){   // steam as it cools
        const x=P.x+rand(-30,30), y=P.y+rand(-30,30), life=rand(1,1.6);
        g.parts.push({k:'smoke',x,y,vx:rand(-8,8),vy:-rand(14,28),life,max:life,size:rand(8,13),al:.12,col:'#c8c2bc',rt:true});
      }
    }
    for(const f of g.fighters) if(f.alive&&f.heat>.3&&Math.random()<rdt*8*f.heat){   // a heat-soaked spinner smokes
      const life=rand(.5,.9); g.parts.push({k:'smoke',x:f.x+rand(-.4,.4)*f.r,y:f.y+rand(-.4,.4)*f.r,vx:rand(-10,10),vy:-rand(20,40),life,max:life,size:f.r*.2,al:.18*f.heat,col:'#6b5a50',rt:true});
    }
    if(Math.random()<rdt*1.5){   // sparks spitting from the slag trough round the rim
      const p=pol(R+31,rand(0,TAU));
      for(let i=0;i<5;i++) addSpark(g,p[0],p[1],rand(-80,80),rand(-120,-30),rand(.2,.5),Math.random()<.5?'#ffb347':'#ffe08a',rand(1,2),true);
    }
  },
  drawFloor(c,t,g){
    blit(c,arenaCache(this,'_floor',fdPaintFloor));
    // the slag trough outside the rim: a slow molten flicker
    c.save(); c.globalCompositeOperation='lighter';
    for(let i=0;i<24;i++){const a0=i/24*TAU, k=.5+.5*Math.sin(t*1.7+i*2.3)*Math.sin(t*.9+i); c.strokeStyle=`rgba(255,${(90+60*k)|0},20,${.22+.25*k})`; c.lineWidth=7; c.beginPath(); c.arc(0,0,R+31,a0,a0+TAU/24+.01); c.stroke();}
    c.restore();
    const T=t%(FD_CYCLE*1.5);
    for(const P of FD_PLATES){
      const ph=g?g.as.ph[P.pair]:fdPhase(T,P.pair,FD_PH[P.pair]);
      c.save(); c.translate(P.x,P.y); c.rotate(P.a);
      if(ph.s!=='idle'){
        c.globalCompositeOperation='lighter';
        let k, coil;
        if(ph.s==='warn'){k=.12*ph.u; coil=.25*ph.u*(.6+.4*Math.sin(t*12));}
        else if(ph.s==='hot'){k=.55+.08*Math.sin(t*9+P.x); coil=1;}
        else {k=.45*(1-ph.u); coil=.6*(1-ph.u);}
        const gr=c.createRadialGradient(0,0,6,0,0,FD_W*.62);
        gr.addColorStop(0,`rgba(255,${ph.s==='hot'?190:110},60,${k})`); gr.addColorStop(.6,`rgba(255,90,20,${k*.75})`); gr.addColorStop(1,`rgba(160,30,10,${k*.4})`);
        c.fillStyle=gr; c.fillRect(-FD_W/2,-FD_H/2,FD_W,FD_H);
        if(coil>0){c.lineCap='round'; fdCoil(c); c.strokeStyle=`rgba(255,${(150+90*coil)|0},80,${coil})`; c.lineWidth=4; c.stroke(); c.strokeStyle=`rgba(255,250,210,${coil*.6})`; c.lineWidth=1.4; c.stroke();}
        if(ph.s==='hot'){   // heat shimmer: faint wavering lines rising over the plate
          c.strokeStyle='rgba(255,220,160,.12)'; c.lineWidth=1.2;
          for(let i=0;i<4;i++){const y=FD_H/2-((t*30+i*FD_H/4)%FD_H); c.beginPath(); for(let x=-FD_W/2;x<=FD_W/2;x+=8) c.lineTo(x,y+Math.sin(x*.15+t*6+i)*2.5); c.stroke();}
        }
        c.globalCompositeOperation='source-over';
      }
      // warning lamps on the short ends: blink amber (faster as it nears), solid red while live, dark otherwise
      const lk=ph.s==='warn'?(Math.sin(t*(8+14*ph.u))>0?1:.15):ph.s==='hot'?1:ph.s==='cool'?.35*(1-ph.u):0;
      for(const sx of [-1,1]) lamp(c,sx*(FD_W/2+6),0,ph.s==='warn'?'#ffb020':'#ff3b1f',lk,3.6);
      c.restore();
    }
  },
  // a heat-soaked spinner glows
  drawTop(c,g,t){
    c.save(); c.globalCompositeOperation='lighter';
    for(const f of g.fighters){
      if(!f.alive||!(f.heat>.04)) continue;
      const h=f.heat, gr=c.createRadialGradient(f.x,f.y,f.r*.6,f.x,f.y,f.r*1.5);
      gr.addColorStop(0,`rgba(255,120,30,${.3*h})`); gr.addColorStop(1,'rgba(255,60,10,0)');
      c.fillStyle=gr; c.beginPath(); c.arc(f.x,f.y,f.r*1.5,0,TAU); c.fill();
      c.strokeStyle=`rgba(255,${(140+80*h)|0},70,${.55*h})`; c.lineWidth=2.5; c.beginPath(); c.arc(f.x,f.y,f.r+1,0,TAU); c.stroke();
    }
    c.restore();
  }
});

/* =====================================================================
   SALVAGE YARD: a scrapyard floor with heavy machinery bolted down (engine blocks, tyre stacks, fallen I-beams) and two crane
   gantries you can drive under (only their legs are solid). Two heavy oil drums shift a little with every hit, and small scrap
   plates get shoved aside. The layout is point-symmetric, so neither starting side has an edge.
   Props live in pw.props (category CAT.PROP), never in pw.bodies: Eater can't eat them, Scrap-King can't capture them, Whirl's
   field and shrapnel ignore them, and they are never baked into the floor.
   ===================================================================== */
const SY_DRUM_R=21, SY_DRUM_M=7;   // drum radius; its mass in fighter units (Big Boy is 5)
function rectPts(cx,cy,w,h,a){const c=Math.cos(a), s=Math.sin(a); return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[cx+x*c-y*s,cy+x*s+y*c]);}
const SY_ENG=[{x:0,y:-100,a:.12},{x:0,y:100,a:.12}], SY_ENG_W=100, SY_ENG_H=60;
const SY_TYRE=[{x:230,y:90,r:32},{x:-230,y:-90,r:32}];
const SY_BEAM=[{x1:60,y1:265,x2:140,y2:215,r:11},{x1:-60,y1:-265,x2:-140,y2:-215,r:11}];
const SY_GANTRY=[[[-226.5,127.5],[-127.5,226.5]],[[226.5,-127.5],[127.5,-226.5]]], SY_LEG=13;
const SY_DRUMS=[[130,-150],[-130,150]];
const SY_DRUM_COL=['#9a3324','#2f5d8a'];
const SY_SCRAP=[[150,40],[-40,215],[262,-40],[90,-268]].flatMap(([x,y])=>[[x,y],[-x,-y]]);
function syPaintFloor(c){
  paintApron(c,'#1d1a15');
  let gr=c.createRadialGradient(-60,-80,10,0,0,R); gr.addColorStop(0,'#4a4236'); gr.addColorStop(.7,'#352f27'); gr.addColorStop(1,'#26221c');
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,R,0,TAU); c.fill();
  c.save(); c.beginPath(); c.arc(0,0,R,0,TAU); c.clip();
  for(let i=-4;i<4;i++) for(let j=-4;j<4;j++){   // poured concrete slabs, each a slightly different shade, some cracked
    const x=i*104+((j&1)?52:0), y=j*104, k=hash01(i+11,j+5);
    c.fillStyle=`rgba(${k<.5?20:90},${k<.5?16:80},${k<.5?10:60},${.07+k*.07})`; c.fillRect(x+2,y+2,100,100);
    c.strokeStyle='rgba(0,0,0,.45)'; c.lineWidth=2; c.strokeRect(x,y,104,104);
    if(k>.6){c.strokeStyle='rgba(0,0,0,.5)'; c.lineWidth=1.2; c.beginPath(); let px=x+hash01(i,j)*104, py=y; c.moveTo(px,py); for(let s=0;s<5;s++){px+=(hash01(i+s,j)-.5)*30; py+=20; c.lineTo(px,py);} c.stroke();}
  }
  for(let i=0;i<3;i++){   // tyre tracks: a forklift's double tread curving across the yard
    const a0=hash01(21,i)*TAU, r0=120+hash01(22,i)*140;
    for(const off of [-11,11]){c.strokeStyle='rgba(15,12,9,.28)'; c.lineWidth=7; c.setLineDash([5,3]); c.beginPath(); c.arc(Math.cos(a0)*60,Math.sin(a0)*60,r0+off,a0,a0+1.6); c.stroke(); c.setLineDash([]);}
  }
  for(let i=0;i<10;i++){const a=hash01(23,i)*TAU, r=hash01(24,i)*330, p=pol(r,a); stainBlot(c,p[0],p[1],18+hash01(25,i)*38,i%3?'#060504':'#5a2c10',i%3?.45:.3);}   // oil and rust
  c.fillStyle='rgba(230,210,170,.07)'; for(let i=0;i<500;i++){const a=hash01(26,i)*TAU, r=Math.sqrt(hash01(27,i))*R; c.fillRect(Math.cos(a)*r,Math.sin(a)*r,1.6,1.6);}   // grit
  c.strokeStyle='rgba(210,170,40,.18)'; c.lineWidth=6; for(const s of [-1,1]){c.beginPath(); c.moveTo(-300,s*20); c.lineTo(-180,s*20); c.moveTo(180,s*20); c.lineTo(300,s*20); c.stroke();}   // faded bay lines
  for(let i=0;i<40;i++){const a=hash01(28,i)*TAU, r=40+hash01(29,i)*300, p=pol(r,a); c.save(); c.translate(p[0],p[1]); c.rotate(hash01(30,i)*TAU);   // loose nuts and bolts, trodden into the floor
    c.fillStyle=i%2?'#6b6358':'#3e3a34'; if(i%3){c.beginPath(); for(let k=0;k<6;k++){const q=pol(2.6,k/6*TAU); c.lineTo(q[0],q[1]);} c.fill();} else c.fillRect(-4,-1,8,2); c.restore();}
  scratches(c,61,100,R-8,.08);
  c.restore();
  // a patchwork rim: salvaged plates of different colours, corrugated and riveted
  const cols=['#6b3b22','#4a5a46','#3b4c66','#5d5a55','#7a5a2a','#544036'];
  c.lineCap='butt';
  for(let i=0;i<20;i++){
    const a0=i/20*TAU-.004, a1=(i+1)/20*TAU+.004;
    c.strokeStyle=cols[(hash01(31,i)*cols.length)|0]; c.lineWidth=22; c.beginPath(); c.arc(0,0,R+11,a0,a1); c.stroke();
    for(let k=1;k<10;k++){const a=a0+(a1-a0)*k/10, p=pol(R+1,a), q=pol(R+21,a); c.strokeStyle='rgba(0,0,0,.28)'; c.lineWidth=1.6; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();}
    const p=pol(R+1,a0), q=pol(R+21,a0); c.strokeStyle='rgba(0,0,0,.7)'; c.lineWidth=2; c.beginPath(); c.moveTo(p[0],p[1]); c.lineTo(q[0],q[1]); c.stroke();
    for(const rr of [R+5,R+17]){const b=pol(rr,a0+.025); bolt(c,b[0],b[1],1.7);}
    const sp=pol(R+11,a0+(a1-a0)*hash01(32,i)); stainBlot(c,sp[0],sp[1],10,'#8a4a1a',.35);
  }
  c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=2; c.beginPath(); c.arc(0,0,R+22,0,TAU); c.stroke();
  c.strokeStyle='rgba(230,215,190,.55)'; c.lineWidth=2.5; c.beginPath(); c.arc(0,0,R,0,TAU); c.stroke();
}
// the bolted-down machinery, painted once (drawn above debris, below the spinners)
function syPaintMachines(c){
  const shadow=fn=>{c.save(); c.shadowColor='rgba(0,0,0,.7)'; c.shadowBlur=14; c.shadowOffsetX=6; c.shadowOffsetY=9; fn(); c.restore();};
  for(const E of SY_ENG){   // engine blocks: a cast-iron block with four bores and a rusted head
    c.save(); c.translate(E.x,E.y); c.rotate(E.a);
    const w=SY_ENG_W, h=SY_ENG_H;
    shadow(()=>{c.fillStyle='#2a2826'; c.fillRect(-w/2,-h/2,w,h);});
    const gr=c.createLinearGradient(0,-h/2,0,h/2); gr.addColorStop(0,'#6a6660'); gr.addColorStop(.5,'#4b4844'); gr.addColorStop(1,'#33302d');
    c.fillStyle=gr; c.fillRect(-w/2,-h/2,w,h);
    c.fillStyle='#3a2a20'; c.fillRect(-w/2+4,-h/2+4,w-8,9);   // head gasket edge
    for(let i=0;i<4;i++){const x=-w/2+16+i*(w-32)/3; c.fillStyle='#141210'; c.beginPath(); c.arc(x,6,10,0,TAU); c.fill(); c.strokeStyle='#7d776f'; c.lineWidth=2; c.stroke(); c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=1; c.beginPath(); c.arc(x,6,6,0,TAU); c.stroke();}
    for(let i=0;i<6;i++) bolt(c,-w/2+8+i*(w-16)/5,-h/2+8,1.8);
    stainBlot(c,w*.25,h*.2,18,'#7a3a12',.45); stainBlot(c,-w*.3,-h*.1,12,'#050403',.5);
    c.strokeStyle='rgba(255,255,255,.18)'; c.lineWidth=1; c.strokeRect(-w/2+.5,-h/2+.5,w-1,h-1);
    c.restore();
  }
  for(const T of SY_TYRE){   // tyre stacks: two tyres, the top one slightly offset, a wheel rim left in the middle
    shadow(()=>{c.fillStyle='#111'; c.beginPath(); c.arc(T.x,T.y,T.r,0,TAU); c.fill();});
    for(const [ox,oy] of [[0,0],[-3,-4]]){
      const x=T.x+ox, y=T.y+oy;
      c.fillStyle='#1a1a1a'; c.beginPath(); c.arc(x,y,T.r-(ox?1:0),0,TAU); c.fill();
      c.strokeStyle='#2c2c2c'; c.lineWidth=3; for(let k=0;k<24;k++){const a=k/24*TAU, p=pol(T.r-5,a), q=pol(T.r-1,a+.06); c.beginPath(); c.moveTo(x+p[0],y+p[1]); c.lineTo(x+q[0],y+q[1]); c.stroke();}
      c.fillStyle='#0a0a0a'; c.beginPath(); c.arc(x,y,T.r*.52,0,TAU); c.fill();
      c.strokeStyle='rgba(255,255,255,.1)'; c.lineWidth=1.2; c.beginPath(); c.arc(x,y,T.r*.75,Math.PI*1.1,Math.PI*1.8); c.stroke();
    }
    c.fillStyle='#5a5047'; c.beginPath(); c.arc(T.x-3,T.y-4,T.r*.36,0,TAU); c.fill(); c.fillStyle='#120f0c'; c.beginPath(); c.arc(T.x-3,T.y-4,T.r*.14,0,TAU); c.fill();
  }
  for(const B of SY_BEAM){   // fallen I-beams: faded yellow paint over rust, flange edges and lightening holes
    const ex=B.x2-B.x1, ey=B.y2-B.y1, l=Math.hypot(ex,ey);
    c.save(); c.translate(B.x1,B.y1); c.rotate(Math.atan2(ey,ex));
    shadow(()=>{c.fillStyle='#2b2418'; c.fillRect(-B.r,-B.r,l+B.r*2,B.r*2);});
    c.fillStyle='#a3812e'; c.fillRect(-B.r,-B.r,l+B.r*2,B.r*2);
    c.fillStyle='#7f6220'; c.fillRect(-B.r,-2,l+B.r*2,4);
    c.strokeStyle='rgba(0,0,0,.5)'; c.lineWidth=1.4; c.strokeRect(-B.r,-B.r,l+B.r*2,B.r*2);
    for(let x=12;x<l-4;x+=22){c.fillStyle='#1d1710'; c.beginPath(); c.ellipse(x,0,5,2.2,0,0,TAU); c.fill();}
    for(let k=0;k<5;k++) stainBlot(c,hash01(41,k+B.x1)*l,(hash01(42,k)-.5)*B.r,6+hash01(43,k)*8,'#6a3410',.5);
    c.restore();
  }
  for(const G of SY_GANTRY) for(const [x,y] of G){   // gantry legs: hazard-striped posts on bolted base plates
    shadow(()=>{c.fillStyle='#222'; c.fillRect(x-17,y-17,34,34);});
    c.fillStyle='#4a4640'; c.fillRect(x-17,y-17,34,34); for(const [bx,by] of [[-13,-13],[13,-13],[-13,13],[13,13]]) bolt(c,x+bx,y+by,1.8);
    c.save(); c.beginPath(); c.arc(x,y,SY_LEG,0,TAU); c.clip(); c.translate(x,y); c.rotate(.8); c.fillStyle='#1a1a1a'; c.fillRect(-SY_LEG,-SY_LEG,SY_LEG*2,SY_LEG*2);
    c.fillStyle='#e0ad22'; for(let k=-2;k<=2;k++) c.fillRect(k*8-2,-SY_LEG,4.5,SY_LEG*2); c.restore();
    c.strokeStyle='#14120f'; c.lineWidth=2; c.beginPath(); c.arc(x,y,SY_LEG,0,TAU); c.stroke();
  }
}
function syDrawDrum(c,b){
  const x=b.position.x, y=b.position.y, r=SY_DRUM_R, d=b.gd;
  c.fillStyle='rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(x+4,y+6,r,r*.95,0,0,TAU); c.fill();
  c.save(); c.translate(x,y); c.rotate(b.angle);
  const gr=c.createRadialGradient(-r*.3,-r*.35,2,0,0,r); gr.addColorStop(0,shade(d.col,.25)); gr.addColorStop(1,shade(d.col,-.45));
  c.fillStyle=gr; c.beginPath(); c.arc(0,0,r,0,TAU); c.fill();
  c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=2; c.beginPath(); c.arc(0,0,r-1,0,TAU); c.stroke();
  c.strokeStyle='rgba(255,255,255,.18)'; c.lineWidth=1.4; c.beginPath(); c.arc(0,0,r*.72,0,TAU); c.stroke();   // the lid's rolled ring
  c.fillStyle='#1a1714'; c.beginPath(); c.arc(r*.42,0,3.2,0,TAU); c.fill(); c.beginPath(); c.arc(-r*.4,r*.12,2,0,TAU); c.fill();   // bungs
  c.fillStyle='rgba(240,200,40,.75)'; c.beginPath(); c.moveTo(-5,-r*.45); c.lineTo(5,-r*.45); c.lineTo(0,-r*.45-8); c.closePath(); c.fill();   // a faded hazard label
  for(let k=0;k<(d.dents||0);k++){const p=pol(r*.8,hash01(d.seed,k)*TAU); c.fillStyle='rgba(0,0,0,.35)'; c.beginPath(); c.arc(p[0],p[1],3.5,0,TAU); c.fill();}   // dents from hits
  stainBlot(c,-r*.2,r*.3,9,'#6a3410',.45);
  c.restore();
}
function syDrawScrap(c,b){
  const d=b.gd; c.save(); c.translate(b.position.x,b.position.y); c.rotate(b.angle);
  c.save(); c.translate(2,3); polyPath(c,d.shape); c.fillStyle='rgba(0,0,0,.4)'; c.fill(); c.restore();
  polyPath(c,d.shape); c.fillStyle=d.col; c.fill(); c.strokeStyle='rgba(0,0,0,.6)'; c.lineWidth=1.2; c.stroke();
  c.strokeStyle='rgba(255,240,220,.22)'; c.lineWidth=.8; c.beginPath(); c.moveTo(d.shape[0][0]*.6,d.shape[0][1]*.6); c.lineTo(d.shape[2][0]*.6,d.shape[2][1]*.6); c.stroke();
  c.restore();
}
defineArena({
  id:'salvage', name:'Salvage Yard', sub:'Machinery and scrap',
  desc:'A scrapyard with engine blocks, tyre stacks and fallen beams bolted down. You can drive under the crane gantries. Heavy oil drums shift when hit, and loose scrap gets shoved aside. It is only clutter: none of it can be eaten or captured.',
  pull:.12,
  shapes:[
    ...SY_ENG.map(E=>({k:'poly',pts:rectPts(E.x,E.y,SY_ENG_W,SY_ENG_H,E.a)})),
    ...SY_TYRE.map(T=>({k:'circle',x:T.x,y:T.y,r:T.r})),
    ...SY_BEAM.map(B=>({k:'seg',...B})),
    ...SY_GANTRY.flat().map(([x,y])=>({k:'circle',x,y,r:SY_LEG})),
  ],
  props(g,pw){
    SY_DRUMS.forEach(([x,y],i)=>{
      const b=Bodies.circle(x,y,SY_DRUM_R,{frictionAir:.06,friction:.3,restitution:.35,label:'prop',collisionFilter:{category:CAT.PROP,mask:CAT.WALL|CAT.DEBRIS|CAT.PROP}});
      Body.setMass(b,40); b.gd={type:'prop',kind:'drum',rad:SY_DRUM_R,col:SY_DRUM_COL[i],seed:i+3,dents:0};
      Composite.add(pw.engine.world,b); pw.props.push(b);
    });
    SY_SCRAP.forEach(([x,y],i)=>{
      const k=i>>1, n=4+((hash01(70,k)*3)|0), s=10+hash01(71,k)*8, local=[];
      for(let j=0;j<n;j++){const a=j/n*TAU+hash01(72+j,k)*.6, rr=s*(.6+hash01(80+j,k)*.5); local.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
      const sh=makeShape(local); if(!sh) return;
      const b=Body.create({position:{x,y},vertices:sh.pts.map(([px,py])=>({x:px,y:py})),density:.003,frictionAir:.09,friction:.3,restitution:.3,label:'prop',
        collisionFilter:{category:CAT.PROP,mask:CAT.WALL|CAT.DEBRIS|CAT.PROP|CAT.F0|CAT.F1}});
      Body.setAngle(b,hash01(73,k)*TAU+(i&1)*Math.PI);
      b.gd={type:'prop',kind:'scrap',rad:s,shape:sh.pts,col:['#6d6158','#7a4a2c','#4f5a5e','#8a7a50'][k%4]};
      Composite.add(pw.engine.world,b); pw.props.push(b);
    });
  },
  // fighters vs the heavy drums: both move, by mass. A drum outweighs every spinner, so it only shifts a little per hit.
  collide(g,f,launched,fx){
    for(const b of g.pw.props){
      if(b.gd.kind!=='drum') continue;
      const dx=f.x-b.position.x, dy=f.y-b.position.y, d=Math.hypot(dx,dy), min=f.r+SY_DRUM_R; if(d>=min||d<1e-6) continue;
      const nx=dx/d, ny=dy/d, ov=min-d, sh=SY_DRUM_M/(f.m+SY_DRUM_M);
      f.x+=nx*ov*sh; f.y+=ny*ov*sh; Body.setPosition(b,{x:b.position.x-nx*ov*(1-sh),y:b.position.y-ny*ov*(1-sh)});
      f.obsT=0; f.obsNx=nx; f.obsNy=ny;
      const bv=getVel(b), bvx=bv.x*VU, bvy=bv.y*VU, vn=(f.vx-bvx)*nx+(f.vy-bvy)*ny;
      if(vn>=0) continue;
      const j=-(1+.7)*vn/(1/f.m+1/SY_DRUM_M);
      f.vx+=j/f.m*nx; f.vy+=j/f.m*ny;
      if(b.isSleeping) Sleeping.set(b,false);
      setVel(b,bvx-j/SY_DRUM_M*nx,bvy-j/SY_DRUM_M*ny);
      Body.setAngularVelocity(b,b.angularVelocity+((-f.vx*ny+f.vy*nx)/VU)*.004);
      if(fx&&-vn>140){
        const px=b.position.x+nx*SY_DRUM_R, py=b.position.y+ny*SY_DRUM_R;
        SFX.wall(-vn*.75,panAt(px),matOf(f)); if(g.stats&&-vn>150) g.stats[f.idx].ric++;
        for(let i=0;i<8;i++){const a=Math.atan2(ny,nx)+rand(-1.2,1.2), s=rand(80,240); addSpark(g,px,py,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2));}
        if(-vn>260&&b.gd.dents<6) b.gd.dents++;
      }
    }
  },
  step(g,as,dt){   // keep the props from tunnelling through anything
    for(const b of g.pw.props){const v=getVel(b), s=Math.hypot(v.x,v.y), m=MAXV*.6; if(s>m) Body.setVelocity(b,{x:v.x*m/s,y:v.y*m/s});}
  },
  drawFloor(c){blit(c,arenaCache(this,'_floor',syPaintFloor));},
  drawOver(c,t,g){
    blit(c,arenaCache(this,'_mach',syPaintMachines));
    if(g){for(const b of g.pw.props) if(b.gd.kind==='scrap') syDrawScrap(c,b); for(const b of g.pw.props) if(b.gd.kind==='drum') syDrawDrum(c,b);}
    else SY_DRUMS.forEach(([x,y],i)=>syDrawDrum(c,{position:{x,y},angle:i,gd:{col:SY_DRUM_COL[i],seed:i,dents:0}}));
  },
  // the gantries' overhead beams pass over the spinners: twin girders with lattice bracing and a trolley hook
  drawTop(c,g,t){
    for(const [[x1,y1],[x2,y2]] of SY_GANTRY){
      const l=Math.hypot(x2-x1,y2-y1);
      c.save(); c.translate(x1,y1); c.rotate(Math.atan2(y2-y1,x2-x1));
      c.fillStyle='rgba(0,0,0,.22)'; c.fillRect(2,1,l+16,30);   // its shadow falls on whatever is underneath
      for(const y of [-11,11]){c.fillStyle='#c79a26'; c.fillRect(-10,y-4,l+20,8); c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=1.2; c.strokeRect(-10,y-4,l+20,8);}
      c.strokeStyle='#8f6e1a'; c.lineWidth=2.2; c.beginPath(); for(let x=0;x<l;x+=16){c.moveTo(x,-8); c.lineTo(x+8,8); c.lineTo(x+16,-8);} c.stroke();
      const hx=l/2+Math.sin(t*.7)*l*.25, sw=Math.sin(t*1.9)*3;
      c.fillStyle='#3d3a36'; c.fillRect(hx-9,-15,18,30); bolt(c,hx-5,-10,1.6); bolt(c,hx+5,10,1.6);
      c.strokeStyle='#9a9a9a'; c.lineWidth=2.4; c.beginPath(); c.arc(hx+sw,4,4,-.3,Math.PI+.6); c.stroke();
      c.restore();
    }
  }
});
