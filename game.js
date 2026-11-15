/* =====================================================================
   SPIN ARENA
   ===================================================================== */

/* ---------------- constants & fighter definitions ---------------- */
const R = 380;          // arena radius (world units)
const SIM_DT = 1/60;   // fixed simulation tick (seconds)
const SCAR_MAX = 12;      // impact scars kept per fighter
const SCAR_COOL = 2.5;    // seconds for a welt to cool from white-hot to a dark dent
const STALL_TIME = .4;    // motor stall after a massive hit
const LAST_STAND = .2;    // HP fraction that triggers the Last Stand burst and heartbeat
// hit-stop lengths in sim ticks (60 Hz): one place to tune the "weight" of impacts
const HITSTOP = {chip:1, medium:3, massive:6, ko:6};
const STALEMATE_T = 5;      // seconds with no damage to anyone before the stalemate penalty
const STALEMATE_DMG = 5;    // HP every spinner loses when it triggers
function hitStop(g,ticks){
  g.hitStop=Math.max(g.hitStop,ticks);
  if(ticks>=HITSTOP.medium) SFX.duck(ticks/60);          // muffle the spin hum for the freeze, then the clang lands at full volume
  if(ticks>=HITSTOP.massive) g.zoomP=Math.max(g.zoomP||0,CAM_PUNCH);   // tiny camera punch-in on the heaviest hits
}
// camera: slightly closer than "fit the whole arena", drifting a little toward whoever has more HP
const CAM_ZOOM = 1.12;      // base zoom over the fit-to-arena scale
const CAM_FOLLOW = .18;     // most the view centre may slide toward the healthier spinner (fraction of the way)
const CAM_PUNCH = .03;      // extra zoom on a massive hit, decays in about 0.2 s
// Beyblade launches: a hard hit sends the spinner that took it ricocheting off the walls
const LAUNCH_VN = 300;      // closing speed (px/s) that triggers a launch...
const LAUNCH_DMG = 10;      // ...or a hit dealing more than this much damage
const LAUNCH_MULT = 1.6;    // multiplier on the victim's separation speed
const LAUNCH_T = .7;        // seconds a launched spinner flies free (no speed cap, almost no drag, no AI steering, no bowl pull)
const LAUNCH_VMAX = 1100;   // speed cap right after a launch (px/s)
const WALL_HIT_DMG = 3;     // HP a full-speed wall slam during a launch deals (scales down with speed, min 1)

// Beyblade-style collisions (resolveCollision) and AI steering
const E_FIGHT = 2.0;        // impulse factor on the closing speed (2.0 = perfectly elastic)
const E_WALL = 1.9;         // same for the arena wall
const SEP_MIN = 170;        // minimum separating speed (px/s) after any closing contact, so slow hits still fling apart
const SEP_SOFT = 90;        // gentler kick for overlapping but non-closing pairs (the old "grinding" case)
const SPIN_KICK = .12;      // tangential kick = surface slip speed (spin*r) * this
const JT_MAX = 140;         // cap on the spin-kick (px/s of relative speed)
const STEER_T = .25;        // AI steering dampener after a hit (seconds, ~15 ticks)
const RIC_MIN = 430;        // separating speed above which a hit also plays the ricochet sound
const BANK_BOOST = .35;     // wall-bank: extra top speed (deliberately modest)
// Per-spinner constants (rage, cycles, ring, aura...) live in each spinners/<id>.js file.

/* ---------------- state ---------------- */
let state = 'menu';
let game = null;
const sel = [
  {fighter:'bigboy', ctrl:'human', c1:'#e8442b', c2:'#ffc93c', mirror:false},
  {fighter:'whirl',  ctrl:'cpu',   c1:'#7c4dff', c2:'#2ef2d0', mirror:false}
];
const keys = {};
const KEYMAP = [
  {u:'KeyW',d:'KeyS',l:'KeyA',r:'KeyD'},
  {u:'ArrowUp',d:'ArrowDown',l:'ArrowLeft',r:'ArrowRight'}
];

/* ---------------- canvas ---------------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
let W=0,H=0,DPR=1;
function resize(){
  DPR = Math.min(2, window.devicePixelRatio||1);
  W = innerWidth; H = innerHeight;
  cv.width = W*DPR; cv.height = H*DPR;
  cv.style.width = W+'px'; cv.style.height = H+'px';
}
addEventListener('resize', resize); resize();

/* =====================================================================
   DRAWING THE TOPS (the bodies themselves are painted by spinners/<id>.js; this is the shared wear overlay)
   ===================================================================== */
const CRACKS=[[.4,.9],[1.7,.7],[3.1,.95],[4.3,.6],[5.5,.8],[2.4,.55]];
function drawCracks(c,r,hp){
  if(hp>.66) return;
  const n=Math.min(CRACKS.length,Math.ceil((1-hp)/.66*CRACKS.length));
  c.strokeStyle='rgba(0,0,0,.7)'; c.lineWidth=Math.max(1.2,r*.035); c.lineCap='round';
  for(let i=0;i<n;i++){
    const[a,l]=CRACKS[i]; const x=Math.cos(a),y=Math.sin(a);
    c.beginPath(); c.moveTo(x*r*.15,y*r*.15);
    c.lineTo(x*r*l*.5+y*r*.08,y*r*l*.5-x*r*.08);
    c.lineTo(x*r*l,y*r*l); c.stroke();
  }
}
// impact welts: a hot gouge that cools from white to orange to dull red, then stays as a dark dent.
// Drawn inside the rotated body so the marks turn with it. Purely visual.
function drawScars(c,r,scars){
  if(!scars||!scars.length) return;
  c.save();
  c.beginPath(); c.arc(0,0,r*.98,0,TAU); c.clip();
  for(const s of scars){
    const len=r*s.s, wid=r*s.s*.42;
    c.save(); c.rotate(s.a); c.translate(r*.9,0);
    c.fillStyle=`rgba(0,0,0,${.5-.15*s.heat})`;
    c.beginPath(); c.ellipse(0,0,wid,len,0,0,TAU); c.fill();                 // the dent
    c.strokeStyle='rgba(255,255,255,.16)'; c.lineWidth=Math.max(1,r*.025);   // lit rim on the inner side
    c.beginPath(); c.ellipse(0,0,wid,len,0,Math.PI*.6,Math.PI*1.4); c.stroke();
    if(s.heat>0.01){
      const h=s.heat, a=Math.pow(h,.7);
      const col=`${255},${Math.round(70+170*h)},${Math.round(20+160*h*h)}`;
      const gr=c.createRadialGradient(0,0,0,0,0,len*1.7);
      gr.addColorStop(0,`rgba(${col},${.95*a})`); gr.addColorStop(1,`rgba(${col},0)`);
      c.globalCompositeOperation='lighter'; c.fillStyle=gr;
      c.beginPath(); c.arc(0,0,len*1.7,0,TAU); c.fill();
    }
    c.restore();
  }
  c.restore();
}
function drawTop(c,o){
  const{x,y,r,angle,c1,c2}=o; const hp=o.hp==null?1:o.hp, flash=o.flash||0;
  c.save();
  c.fillStyle='rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x+r*.12,y+r*.22,r*1.02,r*.95,0,0,TAU); c.fill();
  // below 25% HP the drawn body also jitters off-centre and tilts. Visual only: x, y and r are untouched.
  const bent=clamp((.25-hp)/.25,0,1), t=o.t||0;
  const wob=(1-hp)*(1-hp)*r*.07+bent*r*.035;
  c.translate(x+Math.sin(t*23)*wob,y+Math.cos(t*19)*wob);
  c.rotate(angle+Math.sin(t*31)*.03*bent);
  SPINNERS[o.id].draw(c,r,c1,c2,o);   // the body itself is painted by the spinner's own file
  drawScars(c,r,o.scars);
  drawCracks(c,r,hp);
  c.restore();
  if(flash>0){c.fillStyle=`rgba(255,255,255,${Math.min(1,flash)*.85})`; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill();}
}

/* =====================================================================
   FIGHTER
   ===================================================================== */
class Fighter{
  constructor(def,cfg,idx,x,y){
    this.def=def; this.id=def.id; this.idx=idx; this.name=def.name;
    this.x=x; this.y=y; this.vx=0; this.vy=0; this.r=def.r; this.m=def.m;
    this.maxHp=def.hp; this.hp=def.hp; this.hpLag=def.hp;
    this.c1=cfg.c1; this.c2=cfg.c2; this.ctrl=cfg.ctrl;
    this.angle=rand(0,TAU); this.spin=14;
    this.rage=0; this.flash=0; this.alive=true; this.hitCd=0; this.t=0;
    this.dotAcc=0; this.dotT=.7; this.dotSpark=0;   // damage-over-time readout (a rival's field burning this spinner)
    this.trailT=0;
    this.proxy=null; this.shrapCd=0;
    // wear feedback (visual / timing only, never touches hitboxes or damage maths)
    this.scars=[]; this.stallT=0; this.smokeT=0; this.arcT=rand(.1,.3); this.lastStand=false;
    const N=def.parts;
    this.parts=Array.from({length:N},(_,i)=>({a:i/N*TAU,alive:true}));
    // time dilation: ts is this fighter's own time scale (1 normally, slowed while a rival's Overdrive is running)
    this.ts=1;
    // collision / AI state
    this.steerT=0; this.sepCd=0;                       // post-hit steering dampener, pair separation cooldown
    this.bank=null; this.bankCd=rand(1.5,3); this.bankK=0;   // wall-bank slingshot (Big Boy, Scrap-King)
    this.shredCd=0;                                    // cooldown on a rival's ring shredding this spinner
    this.launchT=0; this.wallCd=0;                     // Beyblade launch: seconds of free flight left, cooldown on wall-slam damage
    this.weakT=0;                                      // seconds of reduced strike damage left (corrosive Drain Scrap)
    Object.assign(this,SPINNERS[def.id].methods);      // the spinner's own stats, AI and hooks (spinners/<id>.js)
    this.init();                                       // ...and its private state (clock, scrap ring, orbit, ...)
  }
  // ---- spinner hooks: these are the defaults. A spinner's methods (spinners/<id>.js) override the ones it needs. ----
  init(){}                                  // build the spinner's private state
  aiMove(o,dx,dy,d,dt,g){return [0,0];}     // steering for CPU control; every spinner should override this
  reach(){return 130;}                      // how far past its body rivals should keep clear
  charges(){return false;}                  // true for a spinner that builds speed and rams
  takenMul(){return 1;}                     // multiplier on damage taken (burns, shrapnel and the touch figure)
  hitCdTime(){return .35;}                  // seconds between touch hits it can deal
  steerDur(){return STEER_T;}               // AI steering dampener length after a hit
  warpFactor(){return 0;}                   // a time scale below 1 while this spinner dilates time for everyone else
  think(dt,g){}                             // each tick, before steering
  tickReal(dt,g){}                          // each tick in real time (never dilated)
  trail(dt,g){}                             // trail particles
  onHurt(g,isDot,cang){}                    // about to take damage (cang: direction toward the attacker, for touch hits)
  weakMul(){return this.weakT>0?.85:1;}     // multiplier on the touch damage it deals (Eater's acid saps strike damage for a while)
  onKill(g){}                               // just died
  onClash(closing,vn){}                     // touched the other spinner
  onWall(vn){}                              // met the arena wall at normal speed vn
  physStep(g,dtIn){}                        // each half-step of the Matter world
  field(g,dtIn){}                           // each sim half-step after collisions
  contact(g){}                              // after spinner-vs-spinner collisions
  check(g){}                                // dev-only invariant checks
  pileSource(){return null;}                // [x,y,r]: settled debris inside this circle wakes up
  drawUnder(c,g,t){}                        // arena effects drawn beneath the spinners (fields, auras)
  drawTrail(c){}                            // afterimages
  drawState(){return null;}                 // extra fields handed to drawTop
  hud(lab,bar){}                            // HUD meter label and fill
  // where to aim at rival o: its position plus its (real-time) velocity times a lookahead, kept inside the arena
  lead(o,k){
    const d=Math.hypot(o.x-this.x,o.y-this.y), la=clamp(d/Math.max(this.maxSpeed(),150),.08,k);
    let x=o.x+o.vx*o.ts*la, y=o.y+o.vy*o.ts*la; const c=Math.hypot(x,y), lim=R-o.r;
    if(c>lim){x*=lim/c; y*=lim/c;}
    return [x,y];
  }
  // worldAng is the direction of the hit; it is stored relative to the body so the mark turns with it
  addScar(worldAng,size,heat){
    let a=worldAng-this.angle; a=Math.atan2(Math.sin(a),Math.cos(a));
    this.scars.push({a,s:size,heat:heat==null?1:heat});
    if(this.scars.length>SCAR_MAX) this.scars.shift();
  }
  // motor stall: spin collapses to 15% then revs back up with an ease-out over STALL_TIME
  stallFactor(){
    if(this.stallT<=0) return 1;
    const u=1-this.stallT/STALL_TIME;
    return .15+.85*(1-Math.pow(1-u,3));
  }
  aliveFrac(){return this.parts.filter(p=>p.alive).length/this.parts.length;}
  lostCount(){return this.parts.filter(p=>!p.alive).length;}
  detachPart(g,cang,fx){
    const alive=this.parts.filter(p=>p.alive); if(!alive.length) return false;
    let pick;
    if(cang==null) pick=alive[(Math.random()*alive.length)|0];
    else{
      let best=1e9;
      for(const p of alive){
        const d=Math.abs(Math.atan2(Math.sin(p.a+this.angle-cang),Math.cos(p.a+this.angle-cang)));
        if(d<best){best=d;pick=p;}
      }
    }
    pick.alive=false;
    const pa=pick.a+this.angle, ca=Math.cos(pa), sa=Math.sin(pa);
    const px=this.x+ca*this.r*.92, py=this.y+sa*this.r*.92;
    const out=rand(200,440), tan=this.spin*this.r*.55*rand(.6,1);
    const kind=this.def.kind;
    const pts=SPINNERS[this.id].partPts(this.r);
    // becomes a real Matter body; it ignores its former owner for a moment so it can fly clear
    spawnPiece(g,pts,this.x,this.y,pa,
      this.vx*.5+ca*out-sa*tan, this.vy*.5+sa*out+ca*tan, rand(-16,16),
      {kind,idx:this.parts.indexOf(pick),r:this.r,c1:this.c1,c2:this.c2,owner:this.idx,shrap:true,noCapT:1.2},   // noCapT: Scrap-King's magnet leaves a fresh chip alone for a moment
      {density:kind==='blade'?.003:.004,ghost:.4,noOwner:true});
    if(fx){
      for(let i=0;i<18;i++){const a=rand(0,TAU),sp=rand(120,440); addSpark(g,px,py,Math.cos(a)*sp,Math.sin(a)*sp,rand(.2,.55),Math.random()<.5?'#fff3c4':this.c2,rand(1,2.6));}
      addRing(g,px,py,3,36,.25,this.c2,3);
      g.shake=Math.max(g.shake,5); hitStop(g,HITSTOP.chip); SFX.chip();
    }
    return true;
  }
  detachAll(g){while(this.detachPart(g,null,false));}
  ai(dt,g){
    const o=g.fighters.find(f=>f!==this&&f.alive); if(!o) return [0,0];
    let dx=o.x-this.x, dy=o.y-this.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    return this.aiMove(o,dx,dy,d,dt,g);   // each spinner steers itself (spinners/<id>.js); (dx,dy) is the unit vector to the rival, d the distance
  }
  // ride the arena rim toward angle pa (a wall-bank). Returns a steering vector, or null once the bank is over.
  bankStep(dt,pa){
    const b=this.bank; b.t-=dt;
    const dc=Math.hypot(this.x,this.y)||1, th=Math.atan2(this.y,this.x);
    if(b.t<=0||(Math.abs(angDiff(pa,th))<.5&&dc>R*.6)){this.bank=null; this.bankCd=rand(4,6); return null;}
    let wx,wy;
    if(dc>R*.78){ wx=-this.y/dc*b.dir+this.x/dc*.3; wy=this.x/dc*b.dir+this.y/dc*.3; }   // on the rim: ride it
    else{ const a=th+b.dir*.5; wx=Math.cos(a)*(R-this.r)-this.x; wy=Math.sin(a)*(R-this.r)-this.y; }   // shallow approach to the wall
    const l=Math.hypot(wx,wy)||1; return [wx/l,wy/l];
  }
  // scars cool, smoke below 50% HP (ramping in), electrical arcs below 25%
  wear(dt,g,hpF){
    for(const s of this.scars) s.heat=Math.max(0,s.heat-dt/SCAR_COOL);
    if(hpF<.5){
      const k=clamp((.5-hpF)/.5,0,1);
      this.smokeT-=dt;
      if(this.smokeT<=0){
        this.smokeT=.16-.11*k;
        const a=rand(0,TAU), d=rand(0,this.r*.25), life=rand(.9,1.5);
        g.parts.push({k:'smoke',x:this.x+Math.cos(a)*d,y:this.y+Math.sin(a)*d,vx:rand(-16,16),vy:-rand(18,42),
          life,max:life,size:this.r*rand(.14,.2),al:.22+.3*k});
      }
    }
    if(hpF<.25){
      this.arcT-=dt;
      if(this.arcT<=0){
        this.arcT=rand(.15,.5);
        const pts=[[rand(-.2,.2)*this.r,rand(-.2,.2)*this.r]], a=rand(0,TAU), n=rand(3,5)|0;
        const ex=Math.cos(a)*this.r*rand(.95,1.15), ey=Math.sin(a)*this.r*rand(.95,1.15);
        for(let i=1;i<n;i++){
          const u=i/n, j=this.r*.22*(1-u*.4);
          pts.push([ex*u+rand(-j,j),ey*u+rand(-j,j)]);
        }
        pts.push([ex,ey]);
        g.parts.push({k:'arc',f:this,pts,life:.09,max:.09,col:Math.random()<.5?'#ff3b3b':'#5ab0ff'});
        if(Math.random()<.7) addSpark(g,this.x+ex,this.y+ey,Math.cos(a)*rand(60,200)+rand(-60,60),Math.sin(a)*rand(60,200)+rand(-60,60),rand(.15,.35),Math.random()<.5?'#ff5a5a':'#8cc8ff',rand(1,2));
      }
    }
  }
  step(dt,g){
    this.t+=dt; this.hitCd=Math.max(0,this.hitCd-dt); this.flash=Math.max(0,this.flash-dt*5);
    this.shrapCd=Math.max(0,this.shrapCd-dt); this.sepCd=Math.max(0,this.sepCd-dt); this.shredCd=Math.max(0,this.shredCd-dt); this.weakT=Math.max(0,this.weakT-dt);
    const ai=this.ctrl!=='human';
    this.steerT=Math.max(0,this.steerT-dt);
    this.bankK+=((this.bank?1:0)-this.bankK)*Math.min(1,dt*5);
    this.think(dt,g);
    let ix=0,iy=0;
    if(this.ctrl==='human'){
      const k=KEYMAP[this.idx];
      ix=(keys[k.r]?1:0)-(keys[k.l]?1:0); iy=(keys[k.d]?1:0)-(keys[k.u]?1:0);
    } else [ix,iy]=this.ai(dt,g);
    const il=Math.hypot(ix,iy); if(il>1){ix/=il;iy/=il;}
    // post-hit dampener (AI only): almost no steering at the hit, easing back in over steerDur() (STEER_T unless the spinner says otherwise)
    const launched=this.launchT>0;
    if(launched){
      this.launchT-=dt; this.wallCd=Math.max(0,this.wallCd-dt);
      if(ai){ix=0;iy=0;}   // a launched AI spinner is a projectile: no steering until it lands
      if(Math.random()<.7) g.parts.push({k:'dot',x:this.x,y:this.y,vx:0,vy:0,life:.2,max:.2,col:this.c1,size:this.r*.4});   // motion streak
    }
    const damp=ai&&this.steerT>0&&!launched;
    if(damp){const sm=.12+.88*Math.pow(clamp(1-this.steerT/this.steerDur(),0,1),2); ix*=sm; iy*=sm;}
    const a=this.accel();
    this.vx+=ix*a*dt; this.vy+=iy*a*dt;
    // the arena is a shallow bowl: everything drifts to the middle
    if(!launched){this.vx-=this.x*.18*dt; this.vy-=this.y*.18*dt;}
    const drag=Math.exp(-this.dragK()*(launched?.15:1)*dt);
    this.vx*=drag; this.vy*=drag;
    const sp=Math.hypot(this.vx,this.vy), mx=this.maxSpeed();
    if(sp>mx&&!launched){const ns=mx+(sp-mx)*Math.exp(-(damp?1.2:3)*dt); this.vx*=ns/sp; this.vy*=ns/sp;}
    this.x+=this.vx*dt; this.y+=this.vy*dt;
    // wall
    const dc=Math.hypot(this.x,this.y);
    if(dc+this.r>R){
      const nx=this.x/dc, ny=this.y/dc;
      this.x=nx*(R-this.r); this.y=ny*(R-this.r);
      // grinding along the wall: drives the scrape sound and a stream of sparks
      const vt=-this.vx*ny+this.vy*nx;
      if(Math.abs(vt)>70){
        g.scrape=Math.max(g.scrape,clamp(Math.abs(vt)/320,0,1));
        if(Math.random()<dt*26) addSpark(g,nx*R,ny*R,-ny*Math.sign(vt)*rand(120,280)-nx*rand(20,80),nx*Math.sign(vt)*rand(120,280)-ny*rand(20,80),rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2));
      }
      const vn=this.vx*nx+this.vy*ny;
      if(vn>0){
        this.onWall(vn);
        const ew=launched?2:E_WALL;   // a launched spinner bounces off the wall with full restitution
        this.vx-=ew*vn*nx; this.vy-=ew*vn*ny;
        if(launched&&vn>250){         // ricochet slam: big sparks, a whang, a shake, and a little damage
          g.shake=Math.max(g.shake,clamp(vn*.012,4,12));
          SFX.ricochet(vn,100);
          addRing(g,nx*R,ny*R,4,40+vn*.04,.3,this.c1,3);
          if(this.wallCd<=0){
            this.wallCd=.2;
            const amt=1+(WALL_HIT_DMG-1)*clamp((vn-250)/850,0,1);
            addText(g,this.x,this.y-this.r-6,'-'+Math.round(amt),'#ffd166',16);
            damage(g,this,amt,true,Math.atan2(ny,nx),true);   // raw: shields don't soften a wall slam
          }
          for(let i=0;i<14;i++){
            const ta=Math.atan2(ny,nx)+Math.PI/2*(Math.random()<.5?1:-1)+rand(-1,1), s=rand(160,420);
            addSpark(g,nx*R,ny*R,Math.cos(ta)*s-nx*rand(60,160),Math.sin(ta)*s-ny*rand(60,160),rand(.2,.5),Math.random()<.5?'#ffb347':'#fff3c4',rand(1.2,2.8));
          }
        }
        if(vn>140){
          const px=nx*R, py=ny*R, cnt=clamp(vn/25,3,14)|0;
          for(let i=0;i<cnt;i++){
            const ta=Math.atan2(ny,nx)+Math.PI/2*(Math.random()<.5?1:-1)+rand(-.9,.9);
            const s=rand(120,320);
            addSpark(g,px,py,Math.cos(ta)*s-nx*rand(40,120),Math.sin(ta)*s-ny*rand(40,120),rand(.15,.4),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2.2));
          }
        }
      }
    }
    const hpF=this.hp/this.maxHp;
    this.stallT=Math.max(0,this.stallT-dt);
    this.spin=this.baseSpin()*(.35+.65*hpF)*this.stallFactor();
    this.angle+=this.spin*dt;
    this.wear(dt,g,hpF);
    this.trail(dt,g);   // trail particles (the spinner decides whether it leaves any)
  }
}

/* =====================================================================
   PARTICLES
   ===================================================================== */
// rt=true: the particle runs on real time and ignores Sandevistan slow-motion (Clockwork's own effects)
function addSpark(g,x,y,vx,vy,life,col,size,rt){g.parts.push({k:'spark',x,y,vx,vy,life,max:life,col,size,rt});}
function addText(g,x,y,txt,col,size,rt){g.parts.push({k:'text',x,y,vx:rand(-15,15),vy:-50,life:.9,max:.9,txt,col,size,rt});}
function addRing(g,x,y,r0,r1,life,col,lw,rt){g.parts.push({k:'ring',x,y,r0,r1,life,max:life,col,lw,rt});}

function impactSparks(g,x,y,nx,ny,impact,cols,heavy){
  const cnt=clamp(impact/2.6,18,130)|0;
  const tx=-ny, ty=nx;
  for(let i=0;i<cnt;i++){
    const side=Math.random()<.5?1:-1, spread=rand(-.7,.7);
    let dx=tx*side+nx*spread, dy=ty*side+ny*spread;
    const l=Math.hypot(dx,dy)||1; dx/=l; dy/=l;
    const s=rand(160,360+impact*1.1);
    const col=Math.random()<.45?'#fff3c4':(Math.random()<.5?'#ffb347':cols[(Math.random()*cols.length)|0]);
    addSpark(g,x,y,dx*s,dy*s,rand(.2,.6),col,rand(1,2.8));
  }
  for(let i=0;i<10;i++){ // slow glowing embers
    const a=rand(0,TAU), s=rand(40,150);
    g.parts.push({k:'dot',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.3,.7),max:.7,col:Math.random()<.5?'#ffb347':'#ff7a1a',size:rand(1.5,3)});
  }
  g.parts.push({k:'dot',x,y,vx:0,vy:0,life:.14,max:.14,col:'#ffffff',size:10+Math.min(14,impact*.03)});
  addRing(g,x,y,4,24+impact*.1,.28,'#ffffff',2.5);
  if(heavy) addRing(g,x,y,2,46+impact*.12,.4,cols[0],4);
}

/* =====================================================================
   PHYSICS WORLD (Matter.js): debris, shards, arena wall, fighter proxies
   ---------------------------------------------------------------------
   Hybrid model. Fighters keep their hand-tuned circle physics. Each one
   owns a very heavy Matter "proxy" circle that is teleported onto the
   fighter every substep, so debris gets pushed around by fighters but
   fighters are never pushed by debris.
   Matter velocities are px per 1/60 s (VU), our sim uses px per second.
   ===================================================================== */
const {Engine,Bodies,Body,Composite,Events,Vertices,Sleeping}=Matter;
const CAT={WALL:1,F0:2,F1:4,DEBRIS:8};
const FCAT=[CAT.F0,CAT.F1];
const DEBRIS_MASK=CAT.WALL|CAT.F0|CAT.F1|CAT.DEBRIS;
const VU=60;
const MAX_BODIES=150;       // live pieces before the oldest get baked into the floor
const BAKE_AGE=5;           // seconds a piece must lie still before it is baked
const MAXV=26;              // speed cap in Matter units (about 1560 px/s) to stop tunnelling
const FLOOR_HALF=R+30, FLOOR_S=1.5;
const SETTLED_MAX=600;      // resting pieces kept as wakeable records; only the oldest overflow is baked into the inert floor canvas
const WAKE_BUDGET=12;       // settled pieces that may wake back into Matter bodies per tick
/* Debris body states (gd.state; undefined counts as 'free'):
     free      ordinary loose debris
     captured  in a Scrap-King ring. Never sleeps, never settles, never splits, collides with walls only
     launched  fired by a polarity blast; behaves like free debris but can't be recaptured for a moment, and never hurts its shooter
   A resting piece is turned into a record in pw.settled (not a body) and wakes again when a fighter, Whirl's field or a magnet gets near. */
const SHRAPNEL_MIN=440;     // px/s relative speed before a flying piece hurts
const SPLIT_FIGHTER=450, SPLIT_OTHER=600;
const setVel=(b,vx,vy)=>Body.setVelocity(b,{x:vx/VU,y:vy/VU});
// NOTE: body.velocity / body.speed are per-substep values; Body.getVelocity() normalises to px per 1/60 s
const getVel=b=>Body.getVelocity(b);

function polyCentroid(p){
  let a=0,cx=0,cy=0;
  for(let i=0;i<p.length;i++){
    const[x0,y0]=p[i],[x1,y1]=p[(i+1)%p.length],c=x0*y1-x1*y0;
    a+=c; cx+=(x0+x1)*c; cy+=(y0+y1)*c;
  }
  a/=2; if(Math.abs(a)<1e-6) return null;
  return{cx:cx/(6*a),cy:cy/(6*a),area:Math.abs(a)};
}
// convex hull + re-centre on the centroid; (cx,cy) is where that centroid sat in the input frame
function makeShape(local){
  const hull=Vertices.hull(local.map(([x,y])=>({x,y})));
  if(hull.length<3) return null;
  const pts=hull.map(v=>[v.x,v.y]), m=polyCentroid(pts);
  if(!m||m.area<4) return null;
  return{pts:pts.map(([x,y])=>[x-m.cx,y-m.cy]),cx:m.cx,cy:m.cy};
}
function clipHalf(p,nx,ny){ // keep the part of polygon p where dot(point,n)>=0
  const out=[];
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length],da=a[0]*nx+a[1]*ny,db=b[0]*nx+b[1]*ny;
    if(da>=0) out.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db); out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }
  return out;
}

function createWorld(g){
  const engine=Engine.create({enableSleeping:true});
  engine.gravity.x=0; engine.gravity.y=0; engine.gravity.scale=0; // top-down view
  engine.positionIterations=6; engine.velocityIterations=4;
  // the round wall: a ring of thick static slabs, inner face at radius R
  const T=70, N=48, L=2*(R+T/2)*Math.tan(Math.PI/N)*1.08, walls=[];
  for(let i=0;i<N;i++){
    const a=i/N*TAU, rr=R+T/2;
    const w=Bodies.rectangle(Math.cos(a)*rr,Math.sin(a)*rr,L,T,{isStatic:true,angle:a+Math.PI/2,restitution:.6,friction:.2,
      collisionFilter:{category:CAT.WALL,mask:CAT.DEBRIS},label:'wall'});
    w.gd={type:'wall'}; walls.push(w);
  }
  Composite.add(engine.world,walls);
  const floor=document.createElement('canvas');
  floor.width=floor.height=Math.ceil(FLOOR_HALF*2*FLOOR_S);
  const pw={engine,bodies:[],settled:[],hits:[],floor,fctx:floor.getContext('2d'),tick:0,rs:1};
  Events.on(engine,'collisionStart',ev=>{
    for(const p of ev.pairs){
      const a=p.bodyA,b=p.bodyB; if(!a.gd||!b.gd||pw.hits.length>40) continue;
      const va=getVel(a), vb=getVel(b), rel=Math.hypot(va.x-vb.x,va.y-vb.y)*VU*pw.rs;   // rs: slow-motion scale, so dilated debris isn't treated as fast
      if(rel<110) continue;
      const s=p.collision&&p.collision.supports&&p.collision.supports[0];
      pw.hits.push({a,b,rel,x:s?s.x:(a.position.x+b.position.x)/2,y:s?s.y:(a.position.y+b.position.y)/2});
    }
  });
  return pw;
}
function makeProxy(g,f){
  const b=Bodies.circle(f.x,f.y,f.r,{frictionAir:0,friction:0,restitution:.3,label:'fighter',
    collisionFilter:{category:FCAT[f.idx],mask:CAT.DEBRIS}});
  Body.setMass(b,300); Body.setInertia(b,Infinity); b.sleepThreshold=Infinity;
  b.gd={type:'fighter',f}; Composite.add(g.pw.engine.world,b); f.proxy=b;
}
function dropProxy(g,f){ if(f.proxy){Composite.remove(g.pw.engine.world,f.proxy); f.proxy=null;} }

// o: {density, ghost:seconds of reduced collision, noOwner:ignore the owning fighter while ghost,
//     sh:an existing shape to reuse (waking a settled piece: (ox,oy) is then the body position itself)}
function spawnPiece(g,local,ox,oy,rot,vx,vy,vr,gd,o){
  const sh=o.sh||makeShape(local); if(!sh) return null;
  const ca=Math.cos(rot), sa=Math.sin(rot), pw=g.pw;
  const x=o.sh?ox:ox+ca*sh.cx-sa*sh.cy, y=o.sh?oy:oy+sa*sh.cx+ca*sh.cy;
  const b=Body.create({position:{x,y},vertices:sh.pts.map(([px,py])=>({x:px,y:py})),density:o.density,
    restitution:.5,friction:.15,frictionStatic:.6,frictionAir:.025,sleepThreshold:45,label:'debris',
    collisionFilter:{category:CAT.DEBRIS,mask:o.noOwner&&o.ghost?DEBRIS_MASK&~FCAT[gd.owner]:DEBRIS_MASK,group:gd.group||0}});
  Body.setAngle(b,rot); setVel(b,vx,vy); Body.setAngularVelocity(b,vr/VU);
  gd.type='debris'; gd.shape=sh; gd.born=g.time; gd.ghostT=o.ghost||0; gd.hitCd=0; gd.dens=o.density;
  b.gd=gd; Composite.add(pw.engine.world,b); pw.bodies.push(b);
  while(pw.bodies.length>MAX_BODIES){   // over budget: the oldest non-captured piece lies down as a settled record
    const old=pw.bodies.find(q=>q.gd.state!=='captured'); if(!old) break;
    settlePiece(g,old);
  }
  return b;
}
function removeBody(g,b){
  const pw=g.pw, i=pw.bodies.indexOf(b); if(i>=0) pw.bodies.splice(i,1);
  Composite.remove(pw.engine.world,b);
}
function drawPiece(c,b){
  const d=b.gd, sh=d.shape;
  c.save(); c.translate(b.position.x,b.position.y); c.rotate(b.angle);
  const P=PIECE[d.kind];   // a chipped part is drawn by its spinner (PIECE is filled by defineSpinner); anything else is a plain shard
  if(P){
    c.save(); c.translate(-sh.cx,-sh.cy); P.draw(c,d); c.restore();
  } else {
    polyPath(c,sh.pts); c.fillStyle=d.col; c.fill();
    c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=1.3; c.lineJoin='round'; c.stroke();
  }
  if(d.corrupt){   // Eater's Drain Scrap: a pulsing toxic green / violet outline (sh.pts is centred on the body in both cases)
    const u=.5+.5*Math.sin(performance.now()/130+b.position.x*.05), col=u>.5?'#7dff3a':'#b04dff';
    polyPath(c,sh.pts); c.lineJoin='round';
    c.strokeStyle=rgba(col,.3+.3*u); c.lineWidth=6; c.stroke();
    c.strokeStyle=col; c.lineWidth=1.8; c.stroke();
  }
  c.restore();
}
// stamp a settled record (or body) onto the inert floor canvas. Only the oldest overflow of the settled pile ends up here.
function bakePiece(g,b){
  const c=g.pw.fctx, o=FLOOR_HALF*FLOOR_S;
  c.save(); c.setTransform(FLOOR_S,0,0,FLOOR_S,o,o); drawPiece(c,b); c.restore();
}
// a resting piece stops being a body and becomes a record that stays on the floor and can wake again
function settlePiece(g,b){
  const pw=g.pw, d=b.gd;
  d.state='free'; d.shrap=false; d.shotBy=undefined; d.blast=null; d.hitCd=0; d.noCapT=0;
  pw.settled.push({position:{x:b.position.x,y:b.position.y},angle:b.angle,gd:d});
  removeBody(g,b);
  while(pw.settled.length>SETTLED_MAX) bakePiece(g,pw.settled.shift());
}
function maintainPile(g){
  const bodies=g.pw.bodies;
  for(let i=bodies.length-1;i>=0;i--){
    const b=bodies[i], d=b.gd; if(d.state==='captured') continue;   // an orbiting piece may look slow: never settle it
    if(g.time-d.born>BAKE_AGE&&(b.isSleeping||Body.getSpeed(b)*VU<10)) settlePiece(g,b);
  }
}
// settled pieces wake into real bodies when a moving fighter, Whirl's field or a Scrap-King magnet comes near
function wakeSettled(g){
  const pw=g.pw, S=pw.settled; if(!S.length) return;
  const src=[];
  for(const f of g.fighters){
    if(!f.alive) continue;
    if(Math.hypot(f.vx,f.vy)*f.ts>25) src.push([f.x,f.y,f.r+16]);
    const ps=f.pileSource(); if(ps) src.push(ps);   // a spinner's field or magnet also wakes resting scrap
  }
  if(!src.length) return;
  let budget=WAKE_BUDGET;
  for(let i=S.length-1;i>=0&&budget>0;i--){
    const p=S[i];
    for(const [sx,sy,sr] of src){
      const dx=p.position.x-sx, dy=p.position.y-sy;
      if(dx*dx+dy*dy<sr*sr){
        S.splice(i,1); budget--;
        spawnPiece(g,null,p.position.x,p.position.y,p.angle,0,0,0,p.gd,{density:p.gd.dens||.004,sh:p.gd.shape});
        break;
      }
    }
  }
}

// a flying tooth or blade that gets hit hard breaks into two smaller fragments
function splitPiece(g,b){
  const d=b.gd, sh=d.shape, ang=rand(0,Math.PI), nx=Math.cos(ang), ny=Math.sin(ang);
  const bv=getVel(b), ca=Math.cos(b.angle), sa=Math.sin(b.angle), vx=bv.x*VU, vy=bv.y*VU;
  const col=PIECE[d.kind]?PIECE[d.kind].col(d):d.col, px=b.position.x, py=b.position.y, w=Body.getAngularVelocity(b)*VU;
  const group=-(100+((Math.random()*1e6)|0));
  let made=0;
  for(const s of [1,-1]){
    const half=clipHalf(sh.pts,nx*s,ny*s); if(half.length<3) continue;
    const wx=(ca*nx-sa*ny)*s, wy=(sa*nx+ca*ny)*s;
    if(spawnPiece(g,half,px,py,b.angle,vx+wx*90,vy+wy*90,w+rand(-8,8),
      {kind:'shard',col,owner:d.owner,shrap:true,group,corrupt:d.corrupt,corruptBy:d.corruptBy,charges:d.charges},{density:.004,ghost:.3})) made++;   // corruption survives a split
  }
  if(!made) return;
  removeBody(g,b);
  for(let i=0;i<8;i++) addSpark(g,px,py,rand(-260,260),rand(-260,260),rand(.15,.35),'#fff3c4',rand(1,2.2));
  addRing(g,px,py,2,22,.2,'#ffffff',2);
}

// massive high-velocity shrapnel: 1-2 HP plus a tiny shove
function shrapnel(g,deb,f,rel){
  const d=deb.gd, bl=d.blast;
  if(!d.shrap||!f.alive||rel<SHRAPNEL_MIN||d.hitCd>0) return;
  if(d.shotBy===f.idx) return;                          // a polarity blast never hurts its own spinner
  if(!bl&&f.shrapCd>0) return;                          // a blast volley skips the shared cooldown but has its own HP cap
  if(d.owner===f.idx&&g.time-d.born<.8) return;
  let amt=1+clamp((rel-SHRAPNEL_MIN)/400,0,1);
  if(bl){ if(bl.left<=0) return; amt=Math.min(amt,bl.left); bl.left-=amt; }
  d.hitCd=.6; if(!bl) f.shrapCd=.15;
  const dx=f.x-deb.position.x, dy=f.y-deb.position.y, l=Math.hypot(dx,dy)||1;
  const kb=clamp(rel*.1,25,70)/Math.sqrt(f.m);
  f.vx+=dx/l*kb; f.vy+=dy/l*kb;
  addText(g,f.x,f.y-f.r-6,'-'+Math.round(amt),'#ffd9a0',16);
  addRing(g,deb.position.x,deb.position.y,2,20,.2,'#ffd9a0',2);
  f.addScar(Math.atan2(-dy,-dx),.16,1);   // small welt where the shrapnel struck
  damage(g,f,amt,true,null);
}
function processHits(g){
  const pw=g.pw, H=pw.hits; if(!H.length) return;
  let n=0;
  for(const h of H){
    if(++n>14) break;
    const deb=h.a.gd.type==='debris'?h.a:(h.b.gd.type==='debris'?h.b:null); if(!deb) continue;
    if(!pw.bodies.includes(deb)) continue;
    const other=deb===h.a?h.b:h.a, d=deb.gd;
    if(d.state==='captured') continue;   // ring pieces are driven by the orbit, not by hits
    if(h.rel>130&&n<=6) for(let k=0;k<3;k++) addSpark(g,h.x,h.y,rand(-210,210),rand(-210,210),rand(.15,.35),'#ffd9a0',rand(1,2));
    SFX.debris(h.rel);
    let splitAt=SPLIT_OTHER;
    if(other.gd.type==='fighter'){splitAt=SPLIT_FIGHTER; shrapnel(g,deb,other.gd.f,h.rel);}
    if(h.rel>splitAt&&PIECE[d.kind]&&d.state!=='captured'&&g.time-d.born>.25&&pw.bodies.includes(deb)) splitPiece(g,deb);
  }
  H.length=0;
}

// one half-substep of the Matter world; dt is already scaled by slow-mo
function physStep(g,dtIn){
  const pw=g.pw, eng=pw.engine, dt=dtIn*g.dil;   // dt: world time, slowed while Clockwork is in Overdrive
  pw.rs=g.dil*g.timeScale;
  // debris reacts to a fighter's effective speed, so a dilated fighter shoves it slowly
  for(const f of g.fighters) if(f.proxy){Body.setPosition(f.proxy,{x:f.x,y:f.y}); setVel(f.proxy,f.vx*f.ts,f.vy*f.ts);}
  for(const f of g.fighters) if(f.alive) f.physStep(g,dtIn);   // per-spinner world hooks: Whirl's debris pull, Scrap-King's ring and magnet
  eng.timing.timeScale=g.timeScale*g.dil;
  Engine.update(eng,1000/120);
  for(const b of pw.bodies){
    const v=getVel(b), s=Math.hypot(v.x,v.y), d=b.gd;
    if(s>MAXV) Body.setVelocity(b,{x:v.x*MAXV/s,y:v.y*MAXV/s});
    if(d.hitCd>0) d.hitCd-=dt;
    if(d.noCapT>0){d.noCapT-=dt; if(d.noCapT<=0&&d.state==='launched') d.state='free';}
    if(d.ghostT>0){d.ghostT-=dt; if(d.ghostT<=0){b.collisionFilter.mask=DEBRIS_MASK; b.collisionFilter.group=0; d.group=0;}}
  }
  processHits(g);
}


// dt is world time (dilated during Overdrive), rt is real time for particles flagged rt
function updateParts(wdt,g,rt){
  const P=g.parts;
  for(let i=P.length-1;i>=0;i--){
    const p=P[i], dt=p.rt?rt:wdt; p.life-=dt;
    if(p.life<=0){P.splice(i,1);continue;}
    if(p.k==='spark'){const d=Math.exp(-3*dt);p.vx*=d;p.vy*=d;p.x+=p.vx*dt;p.y+=p.vy*dt;}
    else if(p.k==='dot'){const d=Math.exp(-1.2*dt);p.vx*=d;p.vy*=d;p.x+=p.vx*dt;p.y+=p.vy*dt;}
    else if(p.k==='text'){p.x+=p.vx*dt;p.y+=p.vy*dt;}
    else if(p.k==='smoke'){const d=Math.exp(-1.5*dt);p.vx*=d;p.vy*=d;p.x+=p.vx*dt;p.y+=p.vy*dt;}
  }
  if(P.length>1800) P.splice(0,300);
}
function drawParts(c,g){
  c.save(); c.lineCap='round'; c.lineJoin='round';
  // dark smoke first, with normal blending, so sparks and arcs glow over it
  for(const p of g.parts){
    if(p.k!=='smoke') continue;
    const a=clamp(p.life/p.max,0,1), grow=1+(1-a)*1.8;
    c.globalAlpha=p.al*a; c.fillStyle=p.col||'#15151c';
    c.beginPath(); c.arc(p.x,p.y,p.size*grow,0,TAU); c.fill();
  }
  for(const p of g.parts){
    const a=clamp(p.life/p.max,0,1);
    if(p.k==='arc'){
      const f=p.f; c.globalCompositeOperation='lighter'; c.globalAlpha=a;
      c.beginPath(); p.pts.forEach((q,i)=>i?c.lineTo(f.x+q[0],f.y+q[1]):c.moveTo(f.x+q[0],f.y+q[1]));
      c.strokeStyle=p.col; c.lineWidth=Math.max(3,f.r*.1); c.globalAlpha=a*.55; c.stroke();   // glow
      c.strokeStyle='#ffffff'; c.lineWidth=Math.max(1.2,f.r*.035); c.globalAlpha=a; c.stroke();  // hot core
    } else if(p.k==='spark'){
      c.globalCompositeOperation='lighter'; c.globalAlpha=a; c.strokeStyle=p.col; c.lineWidth=p.size;
      c.beginPath(); c.moveTo(p.x,p.y); c.lineTo(p.x-p.vx*.045,p.y-p.vy*.045); c.stroke();
    } else if(p.k==='dot'){
      c.globalCompositeOperation='lighter'; c.globalAlpha=a*.9; c.fillStyle=p.col;
      c.beginPath(); c.arc(p.x,p.y,p.size*(.5+a*.5),0,TAU); c.fill();
    } else if(p.k==='ring'){
      const t=1-a, r=p.r0+(p.r1-p.r0)*(1-Math.pow(1-t,2));
      c.globalCompositeOperation='lighter'; c.globalAlpha=a; c.strokeStyle=p.col; c.lineWidth=p.lw*a+.5;
      c.beginPath(); c.arc(p.x,p.y,r,0,TAU); c.stroke();
    }
  }
  c.globalCompositeOperation='source-over';
  for(const p of g.parts){
    if(p.k!=='text') continue;
    const a=clamp(p.life/p.max*1.6,0,1);
    c.globalAlpha=a; c.font=`800 ${p.size}px ui-sans-serif,system-ui`; c.textAlign='center';
    c.lineWidth=3; c.strokeStyle='rgba(0,0,0,.7)'; c.strokeText(p.txt,p.x,p.y);
    c.fillStyle=p.col; c.fillText(p.txt,p.x,p.y);
  }
  c.restore();
}

/* =====================================================================
   SHATTER
   ===================================================================== */
function shatter(g,f){
  const N=18;
  for(let i=0;i<N;i++){
    const a0=i/N*TAU, a1=(i+1)/N*TAU, am=(a0+a1)/2+rand(-.05,.05);
    const inner=f.r*rand(0,.4);
    let pts=[
      [Math.cos(a0)*inner,Math.sin(a0)*inner],
      [Math.cos(a0)*f.r*rand(.85,1),Math.sin(a0)*f.r*rand(.85,1)],
      [Math.cos(am)*f.r*rand(.9,1.05),Math.sin(am)*f.r*rand(.9,1.05)],
      [Math.cos(a1)*f.r*rand(.85,1),Math.sin(a1)*f.r*rand(.85,1)],
      [Math.cos(a1)*inner,Math.sin(a1)*inner]
    ];
    let cx=0,cy=0; pts.forEach(p=>{cx+=p[0];cy+=p[1];}); cx/=pts.length; cy/=pts.length;
    const ang=Math.atan2(cy,cx), sp=rand(160,490);
    // real Matter bodies: they never collide with each other for the first moments (shared negative group), then pile up
    spawnPiece(g,pts,f.x,f.y,0,Math.cos(ang)*sp+f.vx*.6,Math.sin(ang)*sp+f.vy*.6,rand(-12,12),
      {kind:'shard',col:i%3===0?f.c2:(i%3===1?f.c1:shade(f.c1,-.45)),owner:f.idx,shrap:false,group:-77},
      {density:.003,ghost:.35});
  }
  for(let i=0;i<14;i++){ // small chips
    const s=rand(4,9), a=rand(0,TAU), sp=rand(250,680);
    spawnPiece(g,[[-s,-s*.6],[s,-s*.3],[0,s]],f.x,f.y,rand(0,TAU),Math.cos(a)*sp+f.vx*.4,Math.sin(a)*sp+f.vy*.4,rand(-20,20),
      {kind:'shard',col:Math.random()<.5?f.c2:'#cfd3e6',owner:f.idx,shrap:false,group:-77},
      {density:.003,ghost:.35});
  }
  for(let i=0;i<90;i++){
    const a=rand(0,TAU), s=rand(120,700);
    addSpark(g,f.x,f.y,Math.cos(a)*s,Math.sin(a)*s,rand(.3,.9),[f.c1,f.c2,'#fff3c4','#ffb347'][(Math.random()*4)|0],rand(1,3));
  }
  addRing(g,f.x,f.y,10,230,.55,f.c2,6);
  addRing(g,f.x,f.y,5,140,.4,'#ffffff',4);
}

/* =====================================================================
   DAMAGE / KO
   ===================================================================== */
// raw=true skips the spinner's damage reduction (used by the stalemate penalty)
function damage(g,f,amt,isDot,cang,raw){
  if(!f.alive) return;
  if(isDot&&!raw) amt*=f.takenMul();   // burns and shrapnel
  f.onHurt(g,isDot,cang);              // e.g. a Scrap-King ring piece wears when a touch hit lands
  if(amt>0) g.idleT=0;                 // anything that hurts a spinner restarts the stalemate clock
  f.hp=Math.max(0,f.hp-amt);
  f.flash=Math.max(f.flash,isDot?.18:1);
  // heavy touch hits leave a glowing welt at the exact impact angle (same 7% threshold as the chip logic)
  if(!isDot&&cang!=null){const big=amt/f.maxHp; if(big>.07) f.addScar(cang,clamp(.2+big*.9,.2,.42),1);}
  chipParts(g,f,amt,isDot,cang);
  if(f.hp<=0) kill(g,f);
  else if(!f.lastStand&&f.hp/f.maxHp<LAST_STAND) lastStand(g,f);
}
// restore HP (never above max). Returns the HP actually gained. Climbing back above the Last Stand zone (with some margin) ends the heartbeat.
function heal(g,f,amt){
  if(!f.alive||amt<=0) return 0;
  const got=Math.min(amt,f.maxHp-f.hp); if(got<=0) return 0;
  f.hp+=got;
  if(f.lastStand&&f.hp/f.maxHp>=LAST_STAND+.1) f.lastStand=false;
  addText(g,f.x,f.y-f.r-8,'+'+(+got.toFixed(1)),'#8cff5a',clamp(13+got*1.6,13,24));
  return got;
}
// Stalemate rule: if nobody has been hurt for STALEMATE_T seconds, every spinner takes STALEMATE_DMG (shields ignored),
// so a spinner that runs away or hides behind a shield cannot stall the match forever. It repeats every STALEMATE_T seconds.
function stalemate(g){
  addText(g,0,-R*.32,'STALEMATE','#ff9a5a',30);
  addRing(g,0,0,20,R*.9,.6,'#ff9a5a',5);
  SFX.stalemate();
  g.shake=Math.max(g.shake,6);
  for(const f of g.fighters) if(f.alive){
    addText(g,f.x,f.y-f.r-6,'-'+STALEMATE_DMG,'#ff9a5a',22);
    damage(g,f,STALEMATE_DMG,true,null,true);
  }
  g.idleT=0;
}
// one-off dramatic burst the first time a fighter drops under 20% HP; audio.js picks up the heartbeat from game state
function lastStand(g,f){
  f.lastStand=true;
  for(let i=0;i<40;i++){
    const a=rand(0,TAU), s=rand(180,520);
    addSpark(g,f.x+Math.cos(a)*f.r*.8,f.y+Math.sin(a)*f.r*.8,Math.cos(a)*s,Math.sin(a)*s,rand(.25,.6),['#ff3b3b','#5ab0ff','#fff3c4'][(Math.random()*3)|0],rand(1.2,2.8));
  }
  addRing(g,f.x,f.y,f.r*.6,f.r*3,.5,'#ff3b3b',4);
  addText(g,f.x,f.y-f.r-24,'LAST STAND','#ff6b6b',20);
  g.shake=Math.max(g.shake,9);
}
function chipParts(g,f,amt,isDot,cang){
  const N=f.parts.length; if(!N||f.hp<=0) return;
  const target=Math.floor((1-f.hp/f.maxHp)*N*.9);
  let want=Math.max(0,target-f.lostCount());
  if(!isDot){const big=amt/f.maxHp; if(big>.07) want+=1; if(big>.16) want+=1;}
  while(want-->0) if(!f.detachPart(g,isDot?null:cang,true)) break;
}
function kill(g,f){
  f.alive=false;
  dropProxy(g,f);              // so the explosion isn't boxed in by the dead fighter's own circle
  f.onKill(g);                 // spinner-specific cleanup (a dead Scrap-King must release its ring)
  f.detachAll(g);
  shatter(g,f);
  SFX.shatter(f.r);
  g.shake=Math.max(g.shake,24); g.slowT=1.3; hitStop(g,HITSTOP.ko);
  const alive=g.fighters.filter(x=>x.alive);
  if(alive.length===0){g.over=true; g.winner=null;}
  else if(!g.over){g.over=true; g.winner=alive[0]; g.endT=0;}
  else if(g.over && g.winner && !g.winner.alive){g.winner=null;}
}

/* =====================================================================
   PHYSICS STEP
   ===================================================================== */
const DIL_VCAP=520;   // raw speed cap for a dilated fighter, so a hit taken in slow-motion can't launch it when time resumes
function resolveCollision(g){
  const[a,b]=g.fighters; if(!a.alive||!b.alive) return;
  let dx=b.x-a.x, dy=b.y-a.y; const d=Math.hypot(dx,dy), min=a.r+b.r;
  if(d>=min||d===0) return;
  const nx=dx/d, ny=dy/d, ov=min-d, im1=1/a.m, im2=1/b.m, sum=im1+im2;
  a.x-=nx*ov*im1/sum; a.y-=ny*ov*im1/sum; b.x+=nx*ov*im2/sum; b.y+=ny*ov*im2/sum;
  // impulses are solved in effective (real-time) velocities, then converted back to each fighter's own time frame
  const ta=a.ts, tb=b.ts;
  const vn=(a.vx*ta-b.vx*tb)*nx+(a.vy*ta-b.vy*tb)*ny;
  const closing=vn>0;
  if(!closing && (a.sepCd>0||b.sepCd>0)) return;   // overlapping but already parting: don't re-kick every tick
  // normal impulse, then top it up so the pair always separates at SEP_MIN (SEP_SOFT if they were only grinding)
  let j=closing?E_FIGHT*vn/sum:0;
  const vsep=j*sum-vn, need=closing?SEP_MIN:SEP_SOFT;
  if(vsep<need) j+=(need-vsep)/sum;
  // spin-kick: the rims slip past each other, so each spinner is deflected sideways, scaled by its spin rate
  const tx=-ny, ty=nx;
  const vs=a.spin*a.r+b.spin*b.r;
  const jt=clamp(vs*SPIN_KICK*rand(.9,1.1)*(closing?clamp(vn/250,.35,1):.3),-JT_MAX,JT_MAX)/sum;
  a.vx+=(-j*nx-jt*tx)*im1/ta; a.vy+=(-j*ny-jt*ty)*im1/ta;
  b.vx+=( j*nx+jt*tx)*im2/tb; b.vy+=( j*ny+jt*ty)*im2/tb;
  for(const f of [a,b]){
    f.steerT=f.steerDur();   // AI loses steering briefly so the ricochet carries
    if(!closing) f.sepCd=.12;
    f.onClash(closing,vn);
  }
  for(const f of [a,b]) if(f.ts<1){const s=Math.hypot(f.vx,f.vy); if(s>DIL_VCAP){f.vx*=DIL_VCAP/s; f.vy*=DIL_VCAP/s;}}
  if(!closing||vn<45) return;
  const vout=-((a.vx*ta-b.vx*tb)*nx+(a.vy*ta-b.vy*tb)*ny);   // real separating speed after the bounce
  const cx=a.x+nx*a.r, cy=a.y+ny*a.r;
  const dA=a.hitCd<=0?a.contactDamage(vn)*a.weakMul()*b.takenMul():0;   // damage a deals to b
  const dB=b.hitCd<=0?b.contactDamage(vn)*b.weakMul()*a.takenMul():0;   // damage b deals to a
  let big=0;
  if(dA>0){a.hitCd=a.hitCdTime(); addText(g,b.x,b.y-b.r-6,'-'+Math.round(dA),'#ffd166',clamp(14+dA*.6,15,34)); damage(g,b,dA,false,Math.atan2(-ny,-nx)); big=Math.max(big,dA); a.rage=0; if(dA>14) b.stallT=STALL_TIME;}
  if(dB>0){b.hitCd=b.hitCdTime(); addText(g,a.x,a.y-a.r-6,'-'+Math.round(dB),'#ffd166',clamp(14+dB*.6,15,34)); damage(g,a,dB,false,Math.atan2(ny,nx)); big=Math.max(big,dB); b.rage=0; if(dB>14) a.stallT=STALL_TIME;}
  impactSparks(g,cx,cy,nx,ny,vn,[a.c1,b.c1,a.c2,b.c2],big>0);
  const stop=big>14?HITSTOP.massive:(big>7||vn>220?HITSTOP.medium:0);
  const delay=stop/60;   // the clang waits for the freeze to end, so it lands at full volume right as time resumes
  SFX.clang(vn,a.m,b.m,big,delay);
  if(vout>RIC_MIN&&vn>260) SFX.ricochet(vout,Math.abs(jt*sum),delay);   // extra-hard ricochet gets its own whang on top
  g.shake=Math.max(g.shake,clamp(vn*.016,1,5.5),clamp(big*.3,0,12));
  if(stop) hitStop(g,stop);
  // Beyblade launch: a hard enough hit sends whoever took more damage ricocheting off the walls
  if(vn>LAUNCH_VN||big>LAUNCH_DMG){
    const victim=dA>dB?b:(dB>dA?a:(a.m<=b.m?a:b)), at=victim===a?b:a;
    if(victim.ts>=1){
      const dir=victim===b?1:-1, share=(1/victim.m)/sum;
      const extra=vout*(LAUNCH_MULT-1)*share+clamp(at.spin*at.r*.03,0,120);
      victim.vx+=nx*dir*extra; victim.vy+=ny*dir*extra;
      const s=Math.hypot(victim.vx,victim.vy); if(s>LAUNCH_VMAX){victim.vx*=LAUNCH_VMAX/s; victim.vy*=LAUNCH_VMAX/s;}
      victim.launchT=LAUNCH_T; victim.wallCd=0;
      addRing(g,victim.x,victim.y,victim.r,victim.r+34,.3,'#ffffff',3);
    }
  }
}
function stepSim(dtIn,g){
  const dt=dtIn;
  for(const f of g.fighters) if(f.alive) f.step(dt*f.ts,g);
  resolveCollision(g);
  for(const f of g.fighters) if(f.alive) f.contact(g);   // e.g. a Scrap-King ring shredding a rival
  physStep(g,dt);
  for(const f of g.fighters) if(f.alive) f.field(g,dtIn);   // per-spinner fields (Whirl's gravity field)
}

/* =====================================================================
   RENDERING THE ARENA
   ===================================================================== */
function drawArenaFloor(c,t){
  const g=c.createRadialGradient(0,0,0,0,0,R);
  g.addColorStop(0,'#232647'); g.addColorStop(.65,'#161830'); g.addColorStop(1,'#0c0d1a');
  c.fillStyle=g; c.beginPath(); c.arc(0,0,R,0,TAU); c.fill();
  c.strokeStyle='rgba(255,255,255,.05)'; c.lineWidth=2;
  for(let i=1;i<=4;i++){c.beginPath(); c.arc(0,0,R*i/5,0,TAU); c.stroke();}
  for(let i=0;i<16;i++){const a=i/16*TAU; c.beginPath(); c.moveTo(Math.cos(a)*R*.12,Math.sin(a)*R*.12); c.lineTo(Math.cos(a)*R,Math.sin(a)*R); c.stroke();}
  // rim
  c.save();
  c.shadowColor='#6d7bff'; c.shadowBlur=30; c.lineWidth=18; c.strokeStyle='#2b2e50';
  c.beginPath(); c.arc(0,0,R+9,0,TAU); c.stroke(); c.restore();
  c.lineWidth=2.5; c.strokeStyle='rgba(139,149,255,.75)'; c.beginPath(); c.arc(0,0,R,0,TAU); c.stroke();
  c.save(); c.lineWidth=5; c.strokeStyle='rgba(255,207,90,.22)'; c.setLineDash([22,16]); c.lineDashOffset=-t*10;
  c.beginPath(); c.arc(0,0,R+9,0,TAU); c.stroke(); c.restore();
}

// the camera centre eases toward the healthier spinner (a small fraction of the way, scaled by the HP gap)
function updateCam(g,rdt){
  let tx=0,ty=0;
  const [a,b]=g.fighters;
  if(a.alive&&b.alive){
    const gap=a.hp/a.maxHp-b.hp/b.maxHp, lead=gap>0?a:b, k=CAM_FOLLOW*clamp(Math.abs(gap)*2,0,1);
    tx=lead.x*k; ty=lead.y*k;
  }
  const e=1-Math.exp(-rdt/.7);   // ~0.7 s ease
  g.camX+=(tx-g.camX)*e; g.camY+=(ty-g.camY)*e;
  g.zoomP*=Math.exp(-rdt*14);
}
function renderGame(){
  const g=game; const t=g.time;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#07070d'; ctx.fillRect(0,0,W,H);
  const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.7);
  bg.addColorStop(0,'#14152a'); bg.addColorStop(1,'#050509');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  const top=110, availH=H-top-10;
  const s0=Math.min(W/(2*R+70),availH/(2*R+70)), s=s0*(CAM_ZOOM+g.zoomP);
  // keep every living spinner fully on screen and the view centre inside the arena
  let camX=g.camX, camY=g.camY;
  const hw=W/(2*s)-12, hh=availH/(2*s)-12;
  let loX=-1e9,hiX=1e9,loY=-1e9,hiY=1e9;
  for(const f of g.fighters) if(f.alive){
    loX=Math.max(loX,f.x+f.r-hw); hiX=Math.min(hiX,f.x-f.r+hw);
    loY=Math.max(loY,f.y+f.r-hh); hiY=Math.min(hiY,f.y-f.r+hh);
  }
  camX=loX>hiX?(loX+hiX)/2:clamp(camX,loX,hiX); camY=loY>hiY?(loY+hiY)/2:clamp(camY,loY,hiY);
  const cl=Math.hypot(camX,camY), cm=R*.25; if(cl>cm){camX*=cm/cl; camY*=cm/cl;}
  const sk=g.shake+(g.hitStop>0?3:0);   // a small tremor while the world is frozen on impact
  const cx=W/2-camX*s+rand(-1,1)*sk, cy=top+availH/2-camY*s+rand(-1,1)*sk;
  ctx.save(); ctx.translate(cx,cy); ctx.scale(s,s);
  drawArenaFloor(ctx,t);
  ctx.drawImage(g.pw.floor,-FLOOR_HALF,-FLOOR_HALF,FLOOR_HALF*2,FLOOR_HALF*2);   // oldest overflow of the pile, baked
  for(const b of g.pw.settled) drawPiece(ctx,b);                                   // resting pieces that can still wake up
  for(const b of g.pw.bodies) drawPiece(ctx,b);
  for(const f of g.fighters) if(f.alive) f.drawUnder(ctx,g,t);   // fields, auras and beams belong to their spinner
  // drawState() adds the spinner's own fields (clock hands, scrap ring) to what drawTop needs
  const fo=f=>Object.assign({id:f.id,x:f.x,y:f.y,r:f.r,angle:f.angle,c1:f.c1,c2:f.c2,hp:f.hp/f.maxHp,rage:f.rage,flash:f.flash,t:f.t,parts:f.parts,scars:f.scars},f.drawState());
  const boosted=f=>f.warpFactor()>0;   // the spinner currently dilating time
  for(const f of g.fighters) if(f.alive&&!(g.dilK>.01&&boosted(f))) drawTop(ctx,fo(f));
  if(g.dilK>.01){
    // Sandevistan screen treatment: the arena cools and darkens, then the boosted fighter and its afterimages are drawn over it
    const k=g.dilK, og=ctx.createRadialGradient(0,0,R*.3,0,0,R*1.05);
    og.addColorStop(0,`rgba(10,34,56,${.2*k})`); og.addColorStop(1,`rgba(0,8,22,${.55*k})`);
    ctx.fillStyle=og; ctx.beginPath(); ctx.arc(0,0,R+22,0,TAU); ctx.fill();
    for(const f of g.fighters) if(f.alive&&boosted(f)){f.drawTrail(ctx); drawTop(ctx,fo(f));}
  } else {
    for(const f of g.fighters) if(f.alive) f.drawTrail(ctx);   // afterimages of an Overdrive that just ended fade out on their own
  }
  drawParts(ctx,g);
  ctx.restore();
  // countdown
  ctx.textAlign='center'; ctx.textBaseline='middle';
  if(g.countdown>0){
    const n=Math.ceil(g.countdown), frac=g.countdown%1;
    ctx.font='900 120px ui-sans-serif,system-ui'; ctx.fillStyle=`rgba(255,255,255,${.35+.65*frac})`;
    ctx.save(); ctx.translate(W/2,H/2); ctx.scale(.8+frac*.4,.8+frac*.4); ctx.fillText(n>3?3:n,0,0); ctx.restore();
  } else if(g.fightT>0){
    ctx.font='900 110px ui-sans-serif,system-ui'; ctx.fillStyle=`rgba(255,160,60,${clamp(g.fightT/.9,0,1)})`;
    ctx.fillText('FIGHT!',W/2,H/2);
  }
  if(!g.over&&g.countdown<=0&&g.idleT>STALEMATE_T-2){   // warn before the stalemate penalty lands
    ctx.font='800 18px ui-sans-serif,system-ui'; ctx.fillStyle='rgba(255,154,90,.95)';
    ctx.fillText('NO DAMAGE  -  STALEMATE IN '+Math.max(1,Math.ceil(STALEMATE_T-g.idleT)),W/2,top-10);
  }
  ctx.textBaseline='alphabetic';
}

/* =====================================================================
   HUD
   ===================================================================== */
function hudHTML(i,f){
  const right=i===1;
  const side=right?'right-0':'left-0';
  const hint=f.ctrl==='cpu'?'CPU':(i===0?'WASD':'ARROWS');
  return `
    <div class="flex items-baseline justify-between ${right?'flex-row-reverse':''}">
      <span class="font-extrabold tracking-wide text-lg" style="color:${f.c1}">${f.name}</span>
      <span class="text-[11px] text-slate-400 tracking-widest">${hint}</span>
    </div>
    <div class="relative h-4 rounded bg-black/50 border border-white/10 overflow-hidden mt-1">
      <div id="lag${i}" class="absolute inset-y-0 ${side} bg-white/60"></div>
      <div id="hp${i}" class="absolute inset-y-0 ${side}" style="background:linear-gradient(${right?270:90}deg,${f.c1},${f.c2})"></div>
    </div>
    <div class="flex justify-between text-[11px] mt-1 text-slate-300 ${right?'flex-row-reverse':''}">
      <span id="hpt${i}"></span><span id="ml${i}" class="tracking-widest"></span>
    </div>
    <div class="h-1.5 rounded bg-black/50 mt-0.5 overflow-hidden relative">
      <div id="mt${i}" class="absolute inset-y-0 ${side}" style="background:${SPINNERS[f.id].meterBg||'linear-gradient(90deg,'+f.c1+','+f.c2+')'}"></div>
    </div>
    <div id="pp${i}" class="flex gap-1 mt-1.5 ${right?'justify-end':''}"></div>`;
}
function updateHud(g){
  g.fighters.forEach((f,i)=>{
    const hp=$('#hp'+i); if(!hp) return;
    $('#hud'+i).classList.toggle('last-stand',f.alive&&f.lastStand);
    $('#hp'+i).style.width=(f.hp/f.maxHp*100)+'%';
    $('#lag'+i).style.width=(f.hpLag/f.maxHp*100)+'%';
    $('#hpt'+i).textContent=Math.ceil(f.hp)+' / '+f.maxHp;
    if(f._pk!==f.lostCount()){f._pk=f.lostCount(); $('#pp'+i).innerHTML=f.parts.map(p=>`<span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${p.alive?f.c2:'rgba(255,255,255,.12)'}"></span>`).join('');}
    f.hud($('#ml'+i),$('#mt'+i));   // the spinner fills in its own meter label and bar
  });
}

/* =====================================================================
   GAME LIFECYCLE
   ===================================================================== */
function show(id){
  ['menu','select','game','pause','end'].forEach(s=>$('#'+s).classList.toggle('hidden',s!==id&&!(id==='game'&&false)));
}
function setScreen(name){
  state=name;
  $('#menu').classList.toggle('hidden',name!=='menu');
  $('#select').classList.toggle('hidden',name!=='select');
  $('#game').classList.toggle('hidden',name!=='game');
  $('#pause').classList.add('hidden');
  $('#end').classList.add('hidden');
  if(name==='select'){activeSlot=0; renderCards();}
}
function startGame(){
  applyDefaults();
  const f0=new Fighter(DEFS[sel[0].fighter],sel[0],0,-R*.55,0);
  const f1=new Fighter(DEFS[sel[1].fighter],sel[1],1,R*.55,0);
  game={fighters:[f0,f1],parts:[],shake:0,hitStop:0,slowT:0,timeScale:1,dil:1,dilK:0,acc:0,scrape:0,sizzle:0,magnet:0,
        countdown:3.0,fightT:0,idleT:0,over:false,winner:null,endT:0,endShown:false,paused:false,time:0,camX:0,camY:0,zoomP:0};
  game.pw=createWorld(game);
  makeProxy(game,f0); makeProxy(game,f1);
  $('#hud0').innerHTML=hudHTML(0,f0); $('#hud1').innerHTML=hudHTML(1,f1);
  setScreen('game');
}
function showEnd(){
  const g=game; g.endShown=true;
  const el=$('#endTitle');
  if(g.winner){el.textContent=g.winner.name+' WINS'; el.style.color=g.winner.c1; el.style.textShadow=`0 0 40px ${g.winner.c1}`;}
  else {el.textContent='DOUBLE K.O.'; el.style.color='#e2e8f0'; el.style.textShadow='none';}
  $('#end').classList.remove('hidden');
}
function setPause(p){
  if(state!=='game'||!game||game.over&&game.endShown) return;
  game.paused=p; $('#pause').classList.toggle('hidden',!p);
}

// Time dilation (Clockwork's Overdrive): while exactly one spinner is dilating time (warpFactor()>0), every other spinner,
// Matter debris and world particle runs at that factor. Two spinners dilating at once cancel out. A KO or a decided match ends it at once.
function updateDilation(g){
  const od=g.over?[]:g.fighters.filter(f=>f.alive&&f.warpFactor()>0);
  const solo=od.length===1, slow=solo?od[0].warpFactor():1;
  g.dil=slow;
  for(const f of g.fighters) f.ts=solo&&f!==od[0]?slow:1;
}
// one fixed 60 Hz simulation tick. A hit-stop tick does nothing at all (sim, Matter and particles freeze).
function simTick(g){
  if(g.hitStop>0){g.hitStop--; return false;}
  if(g.slowT>0) g.slowT=Math.max(0,g.slowT-SIM_DT);
  g.timeScale=g.slowT>0?.25+.75*(1-g.slowT/1.3):1;
  const dt=SIM_DT*g.timeScale;
  updateDilation(g);
  if(g.countdown>0){
    g.countdown-=SIM_DT; if(g.countdown<=0){g.fightT=.9;}
    for(const f of g.fighters){f.t+=dt; f.angle+=f.spin*dt;}
  } else {
    g.fightT=Math.max(0,g.fightT-SIM_DT);
    for(const f of g.fighters) if(f.alive) f.tickReal(dt,g);   // real-time spinner logic (Clockwork's clock): never dilated
    updateDilation(g);   // a clock step may have just started or ended Overdrive
    stepSim(dt/2,g); stepSim(dt/2,g);
    if(!g.over){g.idleT+=SIM_DT; if(g.idleT>=STALEMATE_T) stalemate(g);}   // nobody hurt for a while: the stalemate penalty
  }
  updateParts(dt*g.dil,g,dt);
  wakeSettled(g);
  if(++g.pw.tick%15===0){maintainPile(g); for(const f of g.fighters) f.check(g);}
  if(g.over){g.endT+=SIM_DT; if(!g.endShown&&g.endT>2.4) showEnd();}
  return true;
}
function updateGame(rdt){
  const g=game; if(g.paused){SFX.silence(); return;}
  g.time+=rdt;
  g.shake*=Math.exp(-9*rdt);
  g.acc=Math.min(g.acc+rdt,SIM_DT*5);
  let ran=false;
  while(g.acc>=SIM_DT){
    g.acc-=SIM_DT;
    if(!ran){g.scrape=0; g.sizzle=0; g.magnet=0;}   // loop-sound levels are gathered fresh on every frame that simulates
    ran=true;
    simTick(g);
  }
  if(ran){
    SFX.scrape(g.scrape); SFX.sizzle(g.sizzle); SFX.magnet(g.magnet);
    // one quiet spin voice per spinner: its own timbre, pitch following spin speed (HP wear, stalls and time dilation included), panned by position
    // wear 0..1 (starts after ~20% HP lost): the hum wobbles in and out like a dying motor
    for(const f of g.fighters) SFX.spin(f.idx,f.id,f.spin/f.baseSpin()*Math.max(.2,f.ts),clamp(f.x/R,-1,1),f.alive,clamp((1-f.hp/f.maxHp-.2)/.8,0,1));
  }
  updateCam(g,rdt);
  // heartbeat urgency 0..1: rises as a fighter in Last Stand drops from 20% HP toward 0. Silent once the match is decided.
  let hb=0;
  if(!g.over) for(const f of g.fighters) if(f.alive&&f.lastStand) hb=Math.max(hb,clamp(1-f.hp/(f.maxHp*LAST_STAND),0,1)*.85+.15);
  SFX.heartbeat(hb);
  SFX.timeWarp(g.dil<1);                                       // muffle the mix while time is dilated
  g.dilK+=((g.dil<1?1:0)-g.dilK)*Math.min(1,rdt*8);            // eased 0..1 for the screen treatment
  for(const f of g.fighters) f.hpLag+=(f.hp-f.hpLag)*Math.min(1,rdt*2.5);
  updateHud(g);
}

/* =====================================================================
   BACKDROP FOR MENU / SELECT
   ===================================================================== */
let bgT=0;
function renderBg(dt){
  bgT+=dt;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.75);
  bg.addColorStop(0,'#1a1b36'); bg.addColorStop(1,'#050509');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  const s=Math.min(W,H)/(2*R+60)*1.25;
  ctx.save(); ctx.translate(W/2,H/2); ctx.scale(s,s); ctx.globalAlpha=.55; drawArenaFloor(ctx,bgT);
  ctx.globalAlpha=.8;
  for(const s of Object.values(SPINNERS)){   // every registered spinner drifts around the backdrop (its bg entry says where and how fast)
    const [x,y]=s.bg.pos(bgT), p=s.sig.main;
    drawTop(ctx,Object.assign({id:s.def.id,x,y,r:s.def.r,angle:bgT*s.bg.spin,c1:p[0],c2:p[1],hp:1,t:bgT},s.bg.extra?s.bg.extra(bgT):null));
  }
  ctx.restore();
  ctx.fillStyle='rgba(5,5,10,.45)'; ctx.fillRect(0,0,W,H);
}

/* =====================================================================
   SELECT SCREEN UI
   ===================================================================== */
function applyDefaults(){
  for(let i=0;i<2;i++){
    const mirror=i===1&&sel[0].fighter===sel[1].fighter;
    const p=SIG[sel[i].fighter][mirror?'rival':'main'];
    sel[i].mirror=mirror; sel[i].c1=p[0]; sel[i].c2=p[1];
  }
}
function statBars(d,i){
  const col=i===0?'bg-orange-400':'bg-sky-400';
  return Object.entries(d.stats).map(([k,v])=>`
    <div><div class="flex justify-between text-[11px] text-slate-400"><span>${k}</span></div>
    <div class="h-1.5 rounded bg-white/10"><div class="h-full rounded ${col}" style="width:${v}%"></div></div></div>`).join('');
}
let activeSlot=0;   // which player the next roster pick goes to
function cardHTML(i){
  const s=sel[i], d=DEFS[s.fighter];
  const accent=i?'text-sky-300':'text-orange-300';
  const ring=activeSlot===i?(i?'border-sky-400/80 shadow-[0_0_24px_rgba(56,189,248,.25)]':'border-orange-400/80 shadow-[0_0_24px_rgba(251,146,60,.25)]'):'border-white/10';
  return `
  <div data-act="slot" data-i="${i}" class="rounded-2xl border ${ring} bg-white/5 backdrop-blur p-4 cursor-pointer transition">
    <div class="flex items-center justify-between mb-3">
      <span class="text-xs tracking-[0.3em] font-bold ${accent}">PLAYER ${i+1} &middot; ${d.name.toUpperCase()}${activeSlot===i?' &middot; PICKING':''}</span>
      <div class="flex rounded-lg overflow-hidden border border-white/10 text-xs font-bold">
        <button data-act="ctrl" data-i="${i}" data-v="human" class="px-3 py-1.5 ${s.ctrl==='human'?'bg-white text-black':'text-slate-300 hover:bg-white/10'}">HUMAN</button>
        <button data-act="ctrl" data-i="${i}" data-v="cpu" class="px-3 py-1.5 ${s.ctrl==='cpu'?'bg-white text-black':'text-slate-300 hover:bg-white/10'}">CPU</button>
      </div>
    </div>
    <div class="flex gap-4 items-center">
      <canvas data-prev="${i}" width="200" height="200" class="w-36 h-36 shrink-0 rounded-xl bg-black/30"></canvas>
      <div class="flex-1 space-y-2">${statBars(d,i)}<div class="text-[11px] text-slate-400">HP ${d.hp}</div></div>
    </div>
    <p class="text-sm text-slate-300/80 mt-3 min-h-[7.5rem]">${d.desc}</p>
    <div class="mt-3 flex items-center gap-2 text-xs text-slate-400">
      <span class="w-5 h-5 rounded-full border border-white/30" style="background:${s.c1}"></span>
      <span class="w-5 h-5 rounded-full border border-white/30" style="background:${s.c2}"></span>
      <span>${s.mirror?'Rival colours (mirror match)':'Signature colours'}</span>
    </div>
  </div>`;
}
// roster: one tile per spinner in DEFS. Adding a spinner to DEFS adds a tile, no menu changes needed.
function rosterHTML(){
  return Object.values(DEFS).map(d=>{
    const picks=[0,1].filter(i=>sel[i].fighter===d.id);
    const badges=picks.map(i=>`<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${i?'bg-sky-400 text-black':'bg-orange-400 text-black'}">P${i+1}</span>`).join('');
    const ring=picks.length?(picks.includes(activeSlot)?'border-white/70 bg-white/15':'border-white/40 bg-white/10'):'border-white/10 bg-white/5 hover:bg-white/10';
    return `
    <button data-act="pick" data-v="${d.id}" data-sfx="select" class="relative flex flex-col items-center rounded-2xl border ${ring} p-3 transition hover:scale-[1.03]">
      <span class="absolute top-2 right-2 flex gap-1">${badges}</span>
      <canvas data-roster="${d.id}" width="120" height="120" class="w-24 h-24 rounded-xl bg-black/30"></canvas>
      <div class="mt-2 font-extrabold">${d.name}</div>
      <div class="text-[11px] text-slate-400 text-center">${d.sub}</div>
    </button>`;
  }).join('');
}
function renderCards(){
  applyDefaults();
  $('#cards').innerHTML=cardHTML(0)+cardHTML(1);
  $('#roster').innerHTML=rosterHTML();
}
$('#select').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]'); if(!b) return;
  const act=b.dataset.act;
  if(act==='pick'){sel[activeSlot].fighter=b.dataset.v; activeSlot=1-activeSlot; renderCards();}   // fill the highlighted player, then move on to the other
  else if(act==='slot'){activeSlot=+b.dataset.i; renderCards();}
  else if(act==='ctrl'){sel[+b.dataset.i].ctrl=b.dataset.v; renderCards();}
});
// one preview painter for the big slot previews (200px) and the roster tiles (120px)
function drawPreview(c,size,d,c1,c2,t){
  const h=size/2, k=size/200;
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,size,size);
  const g=c.createRadialGradient(h,h,0,h,h,h);
  g.addColorStop(0,'#232647'); g.addColorStop(1,'#0c0d1a'); c.fillStyle=g; c.fillRect(0,0,size,size);
  const pv=SPINNERS[d.id].preview;   // each spinner's file says how it spins and what it draws around itself in the preview
  if(pv.under) pv.under(c,h,k,c2,t);
  drawTop(c,Object.assign({id:d.id,x:h,y:h,r:d.r*d.prev*k,angle:t*pv.spin,c1,c2,hp:1,t},pv.extra?pv.extra(t):null));
}
function renderPreviews(t){
  document.querySelectorAll('canvas[data-prev]').forEach(cn=>{
    const s=sel[+cn.dataset.prev];
    drawPreview(cn.getContext('2d'),200,DEFS[s.fighter],s.c1,s.c2,t);
  });
  document.querySelectorAll('canvas[data-roster]').forEach(cn=>{
    const d=DEFS[cn.dataset.roster], p=SIG[d.id].main;
    drawPreview(cn.getContext('2d'),120,d,p[0],p[1],t);
  });
}

/* =====================================================================
   INPUT & BUTTONS
   ===================================================================== */
addEventListener('pointerdown',()=>SFX.unlock());
// every button (and clickable card) gets a click sound; data-sfx picks the variant. Bubbling, so the mute button's own
// handler has already run: muting is silent and unmuting confirms with a click.
document.addEventListener('click',e=>{
  const b=e.target.closest('button,[data-act]');
  if(b) SFX.click(b.dataset.sfx);
});
function syncMute(){ $('#btnMute').textContent=SFX.isMuted()?'SND OFF':'SND ON'; }
addEventListener('keydown',e=>{
  keys[e.code]=true; SFX.unlock();
  if(e.code==='KeyM'){SFX.toggleMute(); syncMute();}
  if(state==='game'&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  if((e.code==='KeyP'||e.code==='Escape')&&state==='game'&&game&&!(game.over&&game.endShown)) setPause(!game.paused);
});
addEventListener('keyup',e=>{keys[e.code]=false;});
addEventListener('blur',()=>{for(const k in keys) keys[k]=false; if(state==='game'&&game&&!game.over) setPause(true);});

$('#btnPlay').onclick=()=>setScreen('select');
$('#btnHow').onclick=()=>$('#how').classList.toggle('hidden');
$('#btnBack').onclick=()=>setScreen('menu');
$('#btnFight').onclick=startGame;
$('#btnPause').onclick=()=>setPause(true);
$('#btnMute').onclick=()=>{SFX.unlock(); SFX.toggleMute(); syncMute();};
syncMute();
$('#pResume').onclick=()=>setPause(false);
$('#pRestart').onclick=startGame;
$('#pSelect').onclick=()=>setScreen('select');
$('#pMenu').onclick=()=>setScreen('menu');
$('#eAgain').onclick=startGame;
$('#eSelect').onclick=()=>setScreen('select');
$('#eMenu').onclick=()=>setScreen('menu');

/* =====================================================================
   MAIN LOOP
   ===================================================================== */
let last=performance.now();
function frame(now){
  const rdt=Math.min(.05,(now-last)/1000); last=now;
  if(state==='game'&&game){updateGame(rdt); renderGame();}
  else {renderBg(rdt); if(state==='select') renderPreviews(now/1000); SFX.silence();}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
