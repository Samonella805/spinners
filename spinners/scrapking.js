/* =====================================================================
   SCRAP-KING: magnetic junkyard spinner. Pulls loose debris into an orbiting shield, then blasts it outward.
   All gd.state changes for captured / launched pieces happen in the block headed "SCRAP-KING" below.
   ===================================================================== */
// Scrap-King: magnetic salvage, orbiting scrap ring, polarity blast
const SK_MAG = 300;         // magnetic pull radius (px from its centre)
const SK_PULL = 3400;       // px/s^2 the magnet applies to loose debris at point-blank range
const SK_SNAP = 90;         // inside this distance (past the ring) a piece is steered straight onto its orbit
const SK_LOCK = .7;         // seconds the magnet stays off after a blast
const SK_RING = 24;         // orbit radius of the scrap ring beyond the chassis edge
const SK_GAIN = 22;         // orbit spring: px/s of correction per px of slot error
const SK_PR = 10;           // effective radius of a ring piece when it touches a rival
const SK_SHIELD = .45;      // damage Scrap-King shrugs off with a shield ring (reached at SK_SHIELD_N pieces)
const SK_SHIELD_N = 3;      // ring pieces needed for the full shield (scales linearly below that)
const SK_BURST_CD = .5;     // seconds between shield-break retaliations
const SK_BURST_KB = 220;    // px/s shove an attacker takes when a shield piece breaks on it
const SK_SHRED_CD = .45;    // seconds between shred hits on the same rival
const SK_SHOVE = 150;       // px/s shove a rival gets when it plows into the ring
const SK_WEAR = 5;          // wear points before a ring piece breaks into fragments
const SK_BLAST_V = [1050,1400];   // polarity blast launch speed (px/s)
const SK_BLAST_BIAS = .4;   // how far each piece's radial direction leans toward the rival (slight, so it can miss)
const SK_BLAST_CAP = 14;  // total HP one blast can take
const SK_RANGE = 300;       // the AI fires when the rival is within chassis edge + this
const SK_FALL_MAX = 12;     // rim shards Scrap-King may rip loose per match
const SK_FALL_CD = 2.5;     // seconds between rim rips
const SK_FALL_BELOW = 4;    // it rips rim shards whenever its ring holds fewer pieces than this
const SK_SHOCK = 130;       // reach of the blast's repulsive shockwave past both chassis edges
const SK_SHOCK_KB = 560;    // px/s shove a rival at point-blank range takes from it
const SK_MIN_RING = 3;     // it will not go on the attack with fewer pieces than this while scrap can still be had
const SK_PATIENCE = 7;      // seconds of hunting after which it fights with whatever (at least 1 piece) it holds
/* ---- Scrap-King: rusted steel core, hazard-striped magnetic plates, amber induction coil ---- */
const SK_JUNK_MAX = 12;    // most welded-on scrap pieces drawn on the hull (visual only)
const SK_N=8, SK_W=TAU/SK_N/2*.86;
function platePts(r){return polar([[-SK_W,.78],[-SK_W*.82,1],[SK_W*.82,1],[SK_W,.78]],r);}
function drawPlate(c,r,i,c1,c2){
  const p=platePts(r);
  c.save(); polyPath(c,p); c.fillStyle='#e8a90c'; c.fill(); c.clip();
  c.rotate(.75); c.fillStyle='#17120c';
  for(let k=-8;k<8;k++) c.fillRect(k*r*.2,-r*1.2,r*.1,r*2.4);   // hazard stripes
  c.restore();
  polyPath(c,p); c.fillStyle='rgba(90,40,12,.22)'; c.fill();   // rust wash
  c.lineWidth=r*.04; c.lineJoin='round'; c.strokeStyle='#0d0a07'; polyPath(c,p); c.stroke();
}
let rustPat=null;
function rustPattern(c){
  if(!rustPat){
    const cn=document.createElement('canvas'); cn.width=cn.height=64; const g=cn.getContext('2d');
    for(let i=0;i<170;i++){g.fillStyle=Math.random()<.5?'rgba(160,74,26,.38)':'rgba(18,9,4,.38)'; g.fillRect(rand(0,64),rand(0,64),rand(1,3.2),rand(1,3.2));}
    rustPat=c.createPattern(cn,'repeat');
  }
  return rustPat;
}
// k: {n (ring pieces), cap (ring capacity), pulse (0..1 blast flash), t}
function drawScrap(c,r,c1,c2,parts,k){
  const n=k.n==null?5:k.n, cap=k.cap||SK_N, f=n/cap, t=k.t||0;
  const glow=clamp(.4+.35*f+.5*(k.pulse||0)+.12*Math.sin(t*7),0,1.2);
  c.fillStyle='#2a2019'; c.beginPath(); c.arc(0,0,r*.86,0,TAU); c.fill();
  for(let i=0;i<SK_N;i++){
    c.save(); c.rotate(i/SK_N*TAU);
    if(!parts||parts[i].alive){const p=parts&&parts[i]; partPose(c,r,p); drawPlate(c,r,i,c1,c2); partWear(c,r,p,platePts(r));}
    else drawSocket(c,r,parts[i],{r0:.7,r1:.95,w:.22,kind:'coil'});   // empty socket where a stabilizer plate was torn off
    c.restore();
  }
  const g=c.createRadialGradient(-r*.2,-r*.2,r*.05,0,0,r*.74);   // rusted steel core
  g.addColorStop(0,shade(c1,.15)); g.addColorStop(1,shade(c1,-.62));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.74,0,TAU); c.fill();
  c.fillStyle=rustPattern(c); c.fill();
  c.lineWidth=r*.045; c.strokeStyle='#0d0a07'; c.stroke();
  c.fillStyle='#1b130e';
  for(let i=0;i<SK_N;i++){const a=(i+.5)/SK_N*TAU; c.beginPath(); c.arc(Math.cos(a)*r*.64,Math.sin(a)*r*.64,r*.035,0,TAU); c.fill();}   // bolts
  for(let j=0;j<3;j++){   // copper induction windings
    c.strokeStyle=j%2?'#7a3d1c':'#d98b4a'; c.lineWidth=r*.055;
    c.beginPath(); c.arc(0,0,r*(.5-j*.09),0,TAU); c.stroke();
  }
  if(k.junk) for(const j of k.junk){   // salvaged scrap welded onto the hull: the more he has gathered, the more cluttered he looks
    c.save(); c.rotate(j.a); c.translate(r*j.rho,0); c.rotate(j.rot);
    polyPath(c,j.pts); c.fillStyle=j.col; c.fill(); c.lineWidth=r*.025; c.lineJoin='round'; c.strokeStyle='#0d0a07'; c.stroke();
    c.fillStyle='#ffb21a'; c.beginPath(); c.arc(j.pts[0][0]*.5,j.pts[0][1]*.5,r*.02,0,TAU); c.fill();   // weld spot
    c.restore();
  }
  c.save(); c.shadowColor=c2; c.shadowBlur=8+24*glow;
  const g2=c.createRadialGradient(0,0,0,0,0,r*.21);
  g2.addColorStop(0,'#fff6d0'); g2.addColorStop(.5,c2); g2.addColorStop(1,shade(c2,-.55));
  c.fillStyle=g2; c.beginPath(); c.arc(0,0,r*.21,0,TAU); c.fill(); c.restore();
}
// faint field markings: the ring's orbit path and the edge of the magnet's reach
function drawField(c,k,t){
  const sk=k.sk, a=.08+.22*(sk.ring.length/Math.max(1,k.skCap()))+.5*sk.pulse;
  c.save(); c.translate(k.x,k.y); c.rotate(t*.8);
  c.strokeStyle=rgba(k.c2,a); c.lineWidth=2; c.setLineDash([6,10]);
  c.beginPath(); c.arc(0,0,k.r+SK_RING,0,TAU); c.stroke();
  c.rotate(-t*1.5); c.strokeStyle=rgba(k.c2,.05+.08*(sk.magT>0?0:1)); c.setLineDash([3,16]);
  c.beginPath(); c.arc(0,0,SK_MAG*(.97+.03*Math.sin(t*3)),0,TAU); c.stroke();
  c.restore();
}
/* =====================================================================
   SCRAP-KING: magnetic salvage, orbiting ring, polarity blast
   All gd.state changes for captured / launched pieces happen in this block.
   ===================================================================== */
function skLoose(g){   // loose scrap on the floor: free live pieces plus settled records
  let n=g.pw.settled.length;
  for(const b of g.pw.bodies){const s=b.gd.state; if(!s||s==='free') n++;}
  return n;
}
function skCapture(g,k,b){
  const d=b.gd;
  d.state='captured'; d.ghostT=0; d.shrap=false; d.blast=null; d.shotBy=undefined; d.wear=0; d.group=0;
  b.sleepThreshold=Infinity; if(b.isSleeping) Sleeping.set(b,false);   // a sleeping body would ignore the orbit drive
  b.collisionFilter.group=0; b.collisionFilter.mask=CAT.WALL;          // ring pieces only touch the wall; contact with rivals is handled in ringContact()
  k.sk.ring.push(b); k.sk.pulse=Math.max(k.sk.pulse,.35);
  // visual clutter: a scaled copy of the salvaged piece's outline gets welded onto the hull, in its own colour (draw-only, never read by the ability)
  const sp=d.shape&&d.shape.pts;
  if(sp&&sp.length>=3){
    const m=sp.reduce((mx,p)=>Math.max(mx,Math.hypot(p[0],p[1])),1), s=Math.min(1,k.r*.17/m);
    k.sk.junk.push({a:rand(0,TAU),rho:rand(.46,.64),rot:rand(0,TAU),pts:sp.map(p=>[p[0]*s,p[1]*s]),col:(PIECE[d.kind]?PIECE[d.kind].col(d):d.col)||'#8a6a4a'});
    if(k.sk.junk.length>SK_JUNK_MAX) k.sk.junk.shift();
  }
  SFX.salvage();
  for(let i=0;i<4;i++) addSpark(g,b.position.x,b.position.y,rand(-160,160),rand(-160,160),rand(.12,.3),Math.random()<.5?'#ffb21a':'#fff3c4',rand(1,2));
}
// back to normal debris. shot=true marks it as part of a polarity blast (hurts the rival, never its shooter).
function skRelease(g,k,b,shot,vx,vy,blast){
  const d=b.gd;
  b.sleepThreshold=45;
  d.state=shot?'launched':'free'; d.noCapT=shot?.9:.7;
  b.collisionFilter.mask=DEBRIS_MASK&~FCAT[k.idx]; d.ghostT=.35;   // clears its former owner first; the ghost timer restores the normal mask
  if(shot){d.shotBy=k.idx; d.shrap=true; d.blast=blast; d.hitCd=0;}
  if(vx!=null) setVel(b,vx,vy);
}
function skReleaseAll(g,k){
  for(const b of k.sk.ring.slice()){
    const a=Math.atan2(b.position.y-k.y,b.position.x-k.x);
    skRelease(g,k,b,false,Math.cos(a)*150+k.vx*.5,Math.sin(a)*150+k.vy*.5);
  }
  k.sk.ring=[];
}
// rip 1-2 jagged rust shards off the arena rim so Scrap-King always has something to pull
function skRip(g,k){
  const th=Math.atan2(k.y,k.x), cnt=Math.random()<.5?1:2;
  for(let i=0;i<cnt;i++){
    const a=th+rand(-.45,.45), px=Math.cos(a)*(R-10), py=Math.sin(a)*(R-10), rad=rand(9,15), pts=[];
    for(let j=0;j<5;j++){const aa=j/5*TAU+rand(-.3,.3), rr=rad*rand(.55,1.1); pts.push([Math.cos(aa)*rr,Math.sin(aa)*rr]);}
    const dx=k.x-px, dy=k.y-py, l=Math.hypot(dx,dy)||1, sp=rand(200,320);
    spawnPiece(g,pts,px,py,rand(0,TAU),dx/l*sp,dy/l*sp,rand(-14,14),{kind:'shard',col:i?'#9a5226':'#7a3f1c',owner:-1,shrap:false},{density:.004,ghost:0});
    for(let s=0;s<8;s++) addSpark(g,px,py,-Math.cos(a)*rand(40,220)+rand(-120,120),-Math.sin(a)*rand(40,220)+rand(-120,120),rand(.15,.4),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2.2));
  }
  k.sk.fallN++; k.sk.fallT=SK_FALL_CD;
  addText(g,k.x,k.y-k.r-22,'SCRAP!','#ffb21a',16);
  SFX.salvage();
}
// short-range repulsive shockwave on blast release: shoves close rivals and loose debris away. No damage (the blast cap stays the only limit).
function skShock(g,k){
  for(const o of g.fighters){
    if(o===k||!o.alive) continue;
    const dx=o.x-k.x, dy=o.y-k.y, d=Math.hypot(dx,dy)||1, touch=k.r+o.r;
    if(d>touch+SK_SHOCK) continue;
    const f=clamp(1-(d-touch)/SK_SHOCK,.25,1), kb=SK_SHOCK_KB*f/Math.sqrt(o.m)/o.ts;
    o.vx+=dx/d*kb; o.vy+=dy/d*kb; o.steerT=Math.max(o.steerT,o.steerDur());
    for(let i=0;i<10;i++) addSpark(g,o.x-dx/d*o.r,o.y-dy/d*o.r,dx/d*rand(120,420)+rand(-120,120),dy/d*rand(120,420)+rand(-120,120),rand(.15,.35),'#ffd166',rand(1,2.4));
  }
  for(const b of g.pw.bodies){
    const st=b.gd.state; if(st==='captured'||st==='launched') continue;
    const dx=b.position.x-k.x, dy=b.position.y-k.y, d=Math.hypot(dx,dy)||1, reach=k.r+SK_SHOCK+60;
    if(d>reach) continue;
    const f=1-d/reach, v=getVel(b), sp=620*f/VU;
    if(b.isSleeping) Sleeping.set(b,false);
    Body.setVelocity(b,{x:v.x+dx/d*sp,y:v.y+dy/d*sp});
  }
  addRing(g,k.x,k.y,k.r,k.r+SK_SHOCK+20,.3,'#ffd166',4);
}
// polarity reversal: every orbiting piece is flung outward, leaning slightly toward the rival so it can miss but doesn't always
function polarityBlast(g,k){
  const sk=k.sk, ring=sk.ring.slice(), n=ring.length; if(!n) return;
  const rv=g.fighters.find(f=>f!==k&&f.alive), bl={left:SK_BLAST_CAP};
  let bx=0,by=0; if(rv){const dx=rv.x-k.x, dy=rv.y-k.y, l=Math.hypot(dx,dy)||1; bx=dx/l; by=dy/l;}
  for(const b of ring){
    let rx=b.position.x-k.x, ry=b.position.y-k.y; const rl=Math.hypot(rx,ry)||1; rx/=rl; ry/=rl;
    let dx=rx+bx*SK_BLAST_BIAS, dy=ry+by*SK_BLAST_BIAS; const dl=Math.hypot(dx,dy)||1; dx/=dl; dy/=dl;
    const j=rand(-.12,.12), cj=Math.cos(j), sj=Math.sin(j), sp=rand(SK_BLAST_V[0],SK_BLAST_V[1]);
    skRelease(g,k,b,true,(dx*cj-dy*sj)*sp+k.vx*.3,(dx*sj+dy*cj)*sp+k.vy*.3,bl);
    Body.setAngularVelocity(b,rand(-.5,.5));
    addSpark(g,b.position.x,b.position.y,rx*rand(120,380),ry*rand(120,380),rand(.15,.35),Math.random()<.5?'#ffb21a':'#fff3c4',rand(1.2,2.4));
  }
  skShock(g,k);
  sk.ring=[]; sk.pulse=1; sk.blastT=rand(4,6); sk.magT=SK_LOCK; sk.slam=false;   // magnet stays off briefly so it can't suck the volley straight back
  addRing(g,k.x,k.y,k.r*.8,k.r*3.6,.4,k.c2,5); addRing(g,k.x,k.y,k.r*.5,k.r*2.2,.3,'#ffffff',3);
  addText(g,k.x,k.y-k.r-24,'POLARITY!','#ffd166',20);
  g.shake=Math.max(g.shake,8); hitStop(g,HITSTOP.chip);
  SFX.polarity(n);
}
// per half-substep: keep the orbit alive, run the magnet, rip rim scrap if the floor is bare, and decide when to blast
function skPhys(g,k,dtIn){
  const sk=k.sk, pw=g.pw, q=k.ts/g.dil, dt=dtIn*k.ts;
  sk.ring=sk.ring.filter(b=>b.gd.state==='captured'&&pw.bodies.includes(b));   // drop pieces that were baked, split or removed
  const cap=k.skCap();
  while(sk.ring.length>cap) skRelease(g,k,sk.ring.pop(),false);                 // a lost plate shrinks the swarm
  sk.magT=Math.max(0,sk.magT-dt); sk.burstCd=Math.max(0,sk.burstCd-dt); sk.blastT-=dt; sk.pulse=Math.max(0,sk.pulse-dt*3);
  sk.ang+=dt*(2.6+.5*sk.ring.length);
  // orbit: drive velocity (never position) toward each slot, so the pieces keep colliding and can't tunnel
  const n=sk.ring.length, rr=k.r+SK_RING;
  for(let i=0;i<n;i++){
    const b=sk.ring[i], a=sk.ang+i*TAU/n;
    let tx=k.x+Math.cos(a)*rr, ty=k.y+Math.sin(a)*rr; const c=Math.hypot(tx,ty); if(c>R-10){tx*=(R-10)/c; ty*=(R-10)/c;}
    if(b.isSleeping) Sleeping.set(b,false);
    setVel(b,k.vx*q+(tx-b.position.x)*SK_GAIN,k.vy*q+(ty-b.position.y)*SK_GAIN);
    Body.setAngularVelocity(b,3/VU);
  }
  // magnet: loose pieces are pulled in and captured while there is room
  let pulling=false;
  if(sk.magT<=0&&n<cap){
    for(const b of pw.bodies){
      const d=b.gd; if((d.state&&d.state!=='free')||d.noCapT>0) continue;
      const dx=k.x-b.position.x, dy=k.y-b.position.y, dist=Math.hypot(dx,dy);
      if(dist>SK_MAG) continue;
      if(dist<rr+22&&sk.ring.length<cap){skCapture(g,k,b); continue;}
      pulling=true;
      if(b.isSleeping) Sleeping.set(b,false);
      if(dist<rr+SK_SNAP){   // close in: steer straight at the orbit so the piece snaps on instead of overshooting
        const sp=Math.max(320,(dist-rr)*7), l=Math.max(dist,1);
        setVel(b,k.vx*q+dx/l*sp,k.vy*q+dy/l*sp); continue;
      }
      const kf=1-dist/SK_MAG, s=SK_PULL*Math.max(.12,kf*(.3+.7*kf))*dt/VU/Math.max(dist,1);   // the floor keeps far scrap moving
      const v=getVel(b); Body.setVelocity(b,{x:v.x+dx*s,y:v.y+dy*s});
    }
  }
  sk.pulling=pulling;
  if(sk.ring.length||pulling) g.magnet=Math.max(g.magnet,(sk.ring.length?.3:0)+(pulling?.5:0));
  // floor salvage: whenever the ring holds fewer than SK_FALL_BELOW pieces, rip rim shards loose (limited per match, spaced by SK_FALL_CD)
  sk.fallT-=dt;
  if(sk.fallT<=0){
    sk.fallT=.5;
    if(sk.ring.length<Math.min(SK_FALL_BELOW,cap)&&sk.magT<=0&&sk.fallN<SK_FALL_MAX) skRip(g,k);
  }
  // field arcs reaching for nearby scrap (visual only, at most about two alive at once)
  sk.arcT-=dt;
  if(sk.arcT<=0){
    sk.arcT=rand(.18,.45);
    const m=pw.bodies.length, st=m?(Math.random()*m)|0:0;
    for(let i=0;i<m;i++){
      const b=pw.bodies[(st+i)%m], s=b.gd.state; if(s&&s!=='free') continue;
      const dx=b.position.x-k.x, dy=b.position.y-k.y, dd=Math.hypot(dx,dy);
      if(dd>SK_MAG*.9||dd<k.r) continue;
      const pts=[[0,0]], seg=4, nx=-dy/dd, ny=dx/dd;
      for(let j=1;j<seg;j++){const u=j/seg, jit=rand(-1,1)*dd*.07; pts.push([dx*u+nx*jit,dy*u+ny*jit]);}
      pts.push([dx,dy]);
      g.parts.push({k:'arc',f:k,pts,life:.09,max:.09,col:Math.random()<.6?'#ffb21a':'#ffe08a'});
      break;
    }
  }
  // polarity blast: when armed and the ring faces the rival, on a timer, or right after a heavy wall slam
  if(sk.ring.length>=3||(sk.slam&&sk.ring.length>=2)){
    const rv=g.fighters.find(f=>f!==k&&f.alive);
    let go=false;
    if(sk.slam&&sk.blastT<3) go=true;
    else if(sk.blastT<=0&&rv){
      const bear=Math.atan2(rv.y-k.y,rv.x-k.x), dist=Math.hypot(rv.x-k.x,rv.y-k.y);
      let face=0; for(let i=0;i<sk.ring.length;i++) if(Math.abs(angDiff(sk.ang+i*TAU/sk.ring.length,bear))<.8) face++;
      go=(dist<k.r+rv.r+SK_RANGE&&face>=2)||sk.blastT<-3;   // never hold fire forever
    }
    if(go) polarityBlast(g,k);
  }
  sk.slam=false;
}
// a rival that plows into the ring is shoved back and shredded for 1-2 HP; ring pieces wear down and eventually break apart
function ringBreak(g,b){ if(g.pw.bodies.includes(b)) splitPiece(g,b); }
// a rival that plows into the ring is shoved back and shredded for 1-2 HP (per Scrap-King that owns the ring)
function ringContact(g,k){
  if(!k.alive||!k.sk.ring.length) return;
  for(const o of g.fighters){
    if(o===k||!o.alive||o.shredCd>0) continue;
    for(const b of k.sk.ring){
      const dx=o.x-b.position.x, dy=o.y-b.position.y, lim=o.r+SK_PR;
      if(dx*dx+dy*dy>lim*lim) continue;
      o.shredCd=SK_SHRED_CD;
      let ux=o.x-k.x, uy=o.y-k.y; const ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
      o.vx+=ux*SK_SHOVE/Math.sqrt(o.m)/o.ts; o.vy+=uy*SK_SHOVE/Math.sqrt(o.m)/o.ts;
      k.vx-=ux*SK_SHOVE*.25/Math.sqrt(k.m)/k.ts; k.vy-=uy*SK_SHOVE*.25/Math.sqrt(k.m)/k.ts;
      const amt=1.5+Math.random();
      addText(g,o.x,o.y-o.r-6,'-'+Math.round(amt),'#ffb21a',15);
      damage(g,o,amt,true,Math.atan2(-uy,-ux));
      for(let i=0;i<12;i++){const a=Math.atan2(uy,ux)+rand(-1.2,1.2), s=rand(120,380); addSpark(g,b.position.x,b.position.y,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.4),Math.random()<.5?'#ffb21a':'#fff3c4',rand(1,2.4));}
      SFX.debris(520);
      b.gd.wear=(b.gd.wear||0)+1; if(b.gd.wear>=SK_WEAR) ringBreak(g,b);
      break;
    }
  }
}
// a hit that lands on Scrap-King wears the ring piece nearest the impact (cang points from Scrap-King toward the attacker).
// When that piece breaks, the attacker is chipped, shoved and showered with sparks. The damage cut itself is in takenMul.
function ringAbsorb(g,f,cang){
  const r=f.sk.ring; if(!r.length) return;
  let b=r[(Math.random()*r.length)|0];
  if(cang!=null){
    let best=9;
    for(const p of r){const d=Math.abs(angDiff(Math.atan2(p.position.y-f.y,p.position.x-f.x),cang)); if(d<best){best=d;b=p;}}
  }
  b.gd.wear=(b.gd.wear||0)+2;
  for(let i=0;i<6;i++) addSpark(g,b.position.x,b.position.y,rand(-220,220),rand(-220,220),rand(.15,.35),'#ffb21a',rand(1,2.2));
  if(b.gd.wear<SK_WEAR) return;
  const at=g.fighters.find(o=>o!==f&&o.alive);
  if(at&&f.sk.burstCd<=0){
    f.sk.burstCd=SK_BURST_CD;
    let ux=at.x-f.x, uy=at.y-f.y; const ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
    at.vx+=ux*SK_BURST_KB/Math.sqrt(at.m)/at.ts; at.vy+=uy*SK_BURST_KB/Math.sqrt(at.m)/at.ts;
    const amt=1.5+Math.random();
    addText(g,at.x,at.y-at.r-6,'-'+Math.round(amt),'#ffb21a',15);
    for(let i=0;i<14;i++){const a=Math.atan2(uy,ux)+rand(-1,1), sp=rand(140,400); addSpark(g,b.position.x,b.position.y,Math.cos(a)*sp,Math.sin(a)*sp,rand(.15,.4),Math.random()<.5?'#ffb21a':'#fff3c4',rand(1,2.4));}
    damage(g,at,amt,true,Math.atan2(-uy,-ux));   // DoT-flagged, so it can never trigger another ring absorb
  }
  ringBreak(g,b);
}
// dev check: a captured piece must be awake, in the world and in state 'captured'. Warns once per violation kind.
const skWarned={};
function skCheck(g){
  for(const k of g.fighters){
    if(!k.sk) continue;
    for(const b of k.sk.ring){
      const why=b.isSleeping?'asleep':(!g.pw.bodies.includes(b)?'missing from world':(b.gd.state!=='captured'?'wrong state':null));
      if(why&&!skWarned[why]){skWarned[why]=true; console.warn('[Scrap-King] ring invariant violated: captured piece is '+why);}
    }
  }
}

defineSpinner({
  def:{
    id:'scrapking', mat:'junk', name:'Scrap-King', r:40, m:4, hp:165, parts:8, kind:'plate', prev:1.8,
    sub:'Heavy &middot; magnetic scrap shield',
    desc:'A hoarder with a magnet. He drags loose scrap into a spinning junk shield, then flings the whole pile at you. One spinner&rsquo;s trash is his crown.',
    stats:{Speed:40, Power:78, Health:80}
  },
  sig:{main:['#b4592a','#ffb21a'], rival:['#6f8398','#35d6e8']},
  draw(c,r,c1,c2,o){ drawScrap(c,r,c1,c2,o.parts,{n:o.sk&&o.sk.n,cap:o.sk&&o.sk.cap,pulse:o.sk&&o.sk.pulse,junk:o.sk&&o.sk.junk,t:o.t||0}); },
  // the magnet: a horseshoe wound with copper that turns slowly; the coil flickers when the machine is heavily damaged
  internals(c,r,o){
    const t=o.t||0, ga=o.ga||0, fl=o.tier>=3&&Math.sin(t*35+t*t)>.4?.3:1;
    c.save(); c.rotate(ga*.4); c.globalAlpha=fl; c.lineCap='butt'; c.lineWidth=r*.14;
    c.strokeStyle='#b23a3a'; c.beginPath(); c.arc(0,0,r*.4,.25,Math.PI-.25); c.stroke();
    c.strokeStyle='#3a5fb2'; c.beginPath(); c.arc(0,0,r*.4,Math.PI+.25,TAU-.25); c.stroke();
    c.strokeStyle='#d98b4a'; c.lineWidth=Math.max(1,r*.025);                          // copper windings across both limbs
    c.beginPath(); for(let i=0;i<14;i++){const a=.3+i*.2; if(a>Math.PI-.3) break; for(const s of [0,Math.PI]){c.moveTo(Math.cos(a+s)*r*.32,Math.sin(a+s)*r*.32); c.lineTo(Math.cos(a+s+.05)*r*.48,Math.sin(a+s+.05)*r*.48);}} c.stroke();
    c.fillStyle='#c0c6d2'; for(const a of [.25,Math.PI-.25,Math.PI+.25,TAU-.25]){c.beginPath(); c.arc(Math.cos(a)*r*.4,Math.sin(a)*r*.4,r*.08,0,TAU); c.fill();}   // pole tips
    c.restore();
  },
  partPts:r=>platePts(r),
  piece:{draw:(c,d)=>drawPlate(c,d.r,d.idx||0,d.c1,d.c2), col:()=>'#c98a1c'},
  preview:{spin:9},
  bg:{pos:t=>{const m=t*.33; return [Math.cos(m+1)*R*.5,Math.sin(m*1.2+4)*R*.45];}, spin:9},
  methods:class{
    init(){
      this.sk={ring:[],ang:rand(0,TAU),blastT:rand(3.5,5),magT:0,fallT:.8,fallN:0,arcT:.3,planT:0,tgt:null,slam:false,pulse:0,pulling:false,huntT:0,burstCd:0,junk:[],malT:rand(.3,.8)};
    }
    // visual only: with the machine failing, electricity jumps between the ring pieces (the ring's orbit itself is physical and untouched)
    malfunction(g,dt,tier){
      const sk=this.sk; sk.malT-=dt; if(sk.malT>0) return;
      sk.malT=rand(.25,.7)/(tier-2);
      const rg=sk.ring; if(!rg.length) return;
      const i=(Math.random()*rg.length)|0, A=rg[i].position;
      let bx=rand(-.2,.2)*this.r, by=rand(-.2,.2)*this.r;   // a lone piece arcs back to the hull
      if(rg.length>1){const B=rg[(i+1+((Math.random()*(rg.length-1))|0))%rg.length].position; bx=B.x-this.x; by=B.y-this.y;}
      const ax=A.x-this.x, ay=A.y-this.y, pts=[[ax,ay]], n=4;
      for(let q=1;q<n;q++){const u=q/n, j=this.r*.16; pts.push([ax+(bx-ax)*u+rand(-j,j),ay+(by-ay)*u+rand(-j,j)]);}
      pts.push([bx,by]);
      g.parts.push({k:'arc',f:this,pts,life:.09,max:.09,col:Math.random()<.5?'#ffb21a':'#5ab0ff'});
      addSpark(g,A.x,A.y,rand(-140,140),rand(-140,140),rand(.12,.28),'#ffd27a',rand(1,1.8));
    }
    // finale: the magnet fails with a pop and the welded clutter flies off the hull as cosmetic fragments (pw.cosm, never real scrap)
    onBurst(g){
      SFX.pop(panAt(this.x));
      addRing(g,this.x,this.y,this.r*.4,this.r*1.8,.3,this.c2,4);
      for(const j of this.sk.junk){
        const a=this.angle+j.a, s=rand(160,420);
        spawnCosm(g,j.pts,this.x+Math.cos(a)*this.r*j.rho,this.y+Math.sin(a)*this.r*j.rho,a+j.rot,Math.cos(a)*s+this.vx*.4,Math.sin(a)*s+this.vy*.4,rand(-22,22),j.col,.7);
      }
      this.sk.junk=[];
      for(let i=0;i<14;i++){const a=rand(0,TAU), s=rand(100,380); addSpark(g,this.x,this.y,Math.cos(a)*s,Math.sin(a)*s,rand(.2,.5),Math.random()<.5?'#ffb21a':'#5ab0ff',rand(1,2.2));}
    }
    maxSpeed(){return 215*(1+BANK_BOOST*this.bankK);}
    accel(){return 720*(1+.25*this.bankK);}
    dragK(){return .8*(1-.3*this.bankK);}
    baseSpin(){return 12;}
    contactDamage(impact){return impact*0.048*(.6+.4*this.aliveFrac());}   // lost plates weaken the hit
    reach(){return SK_RING+150;}                                              // the ring adds reach
    skCap(){return this.parts.length-this.lostCount();}                       // each lost magnetic plate shrinks the swarm by one
    // the orbiting ring soaks up to SK_SHIELD of any hit once it holds SK_SHIELD_N pieces (scaled below that)
    takenMul(){return 1-SK_SHIELD*clamp(this.sk.ring.length/SK_SHIELD_N,0,1);}
    onHurt(g,isDot,cang){if(!isDot) ringAbsorb(g,this,cang);}                         // a touch hit wears a ring piece
    onKill(g){skReleaseAll(g,this);}                                          // no piece may stay "captured" by a dead Scrap-King
    onWall(vn){if(vn>300&&this.sk.ring.length>=2) this.sk.slam=true;}         // heavy wall slam: reverse polarity right now
    physStep(g,dtIn){skPhys(g,this,dtIn);}                                    // ring orbit, magnet, rim fallback, blast
    contact(g){ringContact(g,this);}
    check(g){skCheck(g);}
    pileSource(){return this.sk.magT<=0&&this.sk.ring.length<this.skCap()?[this.x,this.y,SK_MAG]:null;}   // settled scrap in reach of the magnet wakes up
    drawUnder(c,g,t){drawField(c,this,t);}
    drawState(){return {sk:{n:this.sk.ring.length,cap:this.skCap(),pulse:this.sk.pulse,junk:this.sk.junk}};}
    hud(lab,bar){
      const n=this.sk.ring.length, cap=this.skCap();
      const hunting=n<Math.min(SK_MIN_RING,cap)&&this.sk.huntT>0;
      lab.textContent='SCRAP '+n+'/'+cap+(n>=3?'  BLAST '+Math.max(0,this.sk.blastT).toFixed(1)+'s':(this.sk.pulling?'  PULLING':(hunting?'  SCAVENGING':'')));
      bar.style.width=(cap?n/cap*100:0)+'%';
    }
  // pick the densest-looking loose scrap (live free pieces and settled records) to reload from. Samples, so it stays cheap.
  scrapTarget(g){
    const pw=g.pw, cand=[], rv=g.fighters.find(f=>f!==this&&f.alive);
    const take=(list,isBody)=>{
      const m=list.length; if(!m) return;
      for(let i=0;i<22&&cand.length<44;i++){
        const b=list[(Math.random()*m)|0], s=b.gd.state;
        if(isBody&&((s&&s!=='free')||b.gd.noCapT>0)) continue;
        cand.push(b.position);
      }
    };
    take(pw.bodies,true); take(pw.settled,false);
    let best=null, bs=-1;
    for(const p of cand){
      let nb=0; for(const q of cand) if(Math.hypot(p.x-q.x,p.y-q.y)<120) nb++;
      let sc=(1+nb)/(1+Math.hypot(p.x-this.x,p.y-this.y)/280);
      if(rv){const rd=rv.danger(), near=clamp(1-Math.hypot(p.x-rv.x,p.y-rv.y)/280,0,1); sc/=1+rd*near*2.5;}   // don't reload right beside a dangerous rival
      if(sc>bs){bs=sc; best=p;}
    }
    return best?[best.x,best.y]:null;
  }
    // Opportunistic scavenger. It will not go on the attack empty-handed: with fewer than SK_MIN_RING pieces it reloads first
    // (densest floor scrap, banking along the rim to reach it, or waiting at the rim for the rim-rip fallback to tear shards loose).
    // With a little scrap it lead-aims at the rival so the ring faces it and the blast lands at close-to-mid range.
    // If no scrap can be had at all, or the hunt drags on past SK_PATIENCE, it fights with whatever it holds.
    aiMove(o,dx,dy,d,dt,g){
      const sk=this.sk, n=sk.ring.length, cap=this.skCap();
      this.bankCd-=dt; sk.planT-=dt;
      const th=Math.atan2(this.y,this.x);
      const canGet=skLoose(g)>0||sk.fallN<SK_FALL_MAX;   // loose scrap on the floor, or rim shards left to rip
      let need=n<Math.min(SK_MIN_RING,cap)&&canGet;
      sk.huntT=need?sk.huntT+dt:0;
      if(need&&n>=1&&sk.huntT>SK_PATIENCE) need=false;   // hunted long enough: go with what it has
      if(need){
        if(sk.planT<=0){sk.planT=.5; sk.tgt=this.scrapTarget(g);}
        if(sk.tgt){
          const [tx,ty]=sk.tgt, td=Math.hypot(tx-this.x,ty-this.y), tc=Math.hypot(tx,ty), pa=Math.atan2(ty,tx);
          if(!this.bank&&this.bankCd<=0&&td>260&&tc>R*.6) this.bank={t:rand(.7,1.1),dir:angDiff(pa,th)>=0?1:-1};
          if(this.bank){const v=this.bankStep(dt,pa); if(v) return v;}
          const wv=Math.sin(this.t*1.9)*.2, [ux,uy]=this.steerTo(tx,ty,.5);
          return [ux-uy*wv,uy+ux*wv];
        }
        // nothing to pull yet: wait on the rim side it is already on, where the rim fallback will tear shards loose toward it
        const wr=R*.62, wx=Math.cos(th)*wr-this.x, wy=Math.sin(th)*wr-this.y, wl=Math.hypot(wx,wy)||1;
        if(wl>45) return [wx/wl,wy/wl];
        return [-Math.sin(th)*.3,Math.cos(th)*.3];
      }
      // has scrap (or none exists): lead-aim at the rival and slam; a wall-bank slam also triggers the blast
      if(!this.bank&&this.bankCd<=0&&n>=1&&d>(this.r+o.r+SK_RANGE)*1.3){
        this.bank={t:rand(.7,1.1),dir:angDiff(Math.atan2(o.y,o.x),th)>=0?1:-1};
      }
      if(this.bank){const v=this.bankStep(dt,Math.atan2(o.y,o.x)); if(v) return v;}
      const [lx,ly]=this.lead(o,.35), [tx,ty]=this.steerTo(lx,ly,.4);
      const wv=Math.sin(this.t*1.3)*.2;
      return [tx-ty*wv,ty+tx*wv];
    }
    // victory (visual only, the match is already decided): the magnet drags the wreckage in, and his own capture rings it as it arrives
    victory(g,dt,u){
      wreckTug(g,this,420,1500,8);
      this.vicT=(this.vicT||0)-dt;
      if(this.vicT<=0){this.vicT=.6; addRing(g,this.x,this.y,this.r*2.8,this.r,.5,'#ffb21a',3); this.sk.pulse=Math.max(this.sk.pulse,.5);}
    }
    danger(){const cap=this.skCap(); return cap?clamp(this.sk.ring.length/cap,0,1)*.8:0;}   // a loaded ring shields and blasts
  }
});
