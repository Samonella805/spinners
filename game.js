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
const NEAR_ZOOM = .06;      // extra zoom while one spinner is critical and the pair is close (eased in and out)
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
// Destruction polish (all cosmetic, none of it touches hitboxes or damage)
const HOT_T = 3.5;          // seconds a freshly broken plate takes to cool from red-hot to grey
const DENT_COOL = 4;        // seconds a rim dent glows after a hard wall hit
const DENT_MIN = 260;       // wall impact speed (px/s) that dents the rim
const DEATH_T = .7;         // KO death spin: sim seconds the loser grinds and tips before bursting
const VIG_MAX = .13;        // Last Stand vignette: peak alpha (kept deliberately light)
// Fragmentation (stage 5/6). Cosmetic fragments live in pw.cosm, a list that Eater, Scrap-King and Whirl never look at.
// detached plates hop: a fake height (drawn as scale and a shadow, never touching the physics) with a clatter on every landing
const HOP_G = 900;          // fake gravity (height px/s^2)
const HOP_BOUNCE = .42;     // fraction of the vertical speed kept per landing
const HOP_MIN = 70;         // landings slower than this end the hopping
const WOB_T = .55;          // seconds a big plate wobbles like a dropped coin before lying still
const WOB_MAX = 2;          // plates wobbling at once
const matOf = f => (DEFS[f.id]&&DEFS[f.id].mat)||'iron';
const panAt = x => clamp(x/R,-1,1);   // stereo position from arena x
const COSM_MAX = 36;       // live cosmetic fragments at once (the oldest is baked into the floor)
const COSM_LIFE = 2.2;      // seconds a cosmetic fragment stays a live body before it is baked into the floor
const FLICK_MIN = 150;      // px/s: a spinning rim moving this fast relative to a piece flicks it sideways
const SHED_GAP = [.09,.15]; // death spin: seconds between loose plates flying off
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
/* ---- hull wear: marks that build up where the spinner was actually hit (replaces the old fixed crack list) ----
   Cracks, scratches and heat tint are painted once, when the hit lands, onto a small per-fighter canvas in the body's own frame, so
   drawing 100 marks costs the same per frame as one. Craters, the rim scuff band and the soot are cheap enough to draw live,
   which lets craters be lit from a fixed point in the world as the body turns. Visual only. */
const WEAR_SCALE=2, CRATER_MAX=10;
function wearTex(f){
  if(f.wx) return f.wx;
  const S=Math.ceil(f.r*2*WEAR_SCALE), cn=document.createElement('canvas'); cn.width=cn.height=S;
  const c=cn.getContext('2d'); c.scale(WEAR_SCALE,WEAR_SCALE); c.translate(f.r,f.r);
  c.beginPath(); c.arc(0,0,f.r*.97,0,TAU); c.clip();   // marks stay inside the hull
  return f.wx={cn,c,ends:[],tint:new Array(12).fill(0),craters:[],scuff:0,cuts:[],holes:[],lay:null};
}
/* ---- structural damage: real cut-outs ----
   Heavy hits bite jagged notches out of the hull edge (w.cuts) and a battered spinner gets holes punched through the armour (w.holes).
   A fighter with any cut or hole is drawn in two steps: the chassis (a counter-rotating flywheel and frame) goes down first, then the
   body is painted into a small offscreen layer, the cuts are removed from that layer with destination-out, and the layer is blitted on top,
   so the chassis shows through the gaps. Fighters without cuts (and the menu previews) are drawn directly, as before. Visual only. */
const LAY_K=1.5;
function layerOf(w,r){
  if(!w.lay){const S=Math.ceil(r*2.7*LAY_K), cn=document.createElement('canvas'); cn.width=cn.height=S; w.lay={cn,c:cn.getContext('2d'),S};}
  return w.lay;
}
function drawChassis(c,r,hp,t,c2,o){
  c.save(); c.beginPath(); c.arc(0,0,r*.95,0,TAU); c.clip();
  const g=c.createRadialGradient(0,0,r*.1,0,0,r*.95);
  g.addColorStop(0,'#2b2d37'); g.addColorStop(.55,'#16161c'); g.addColorStop(1,'#08070a'); c.fillStyle=g; c.fillRect(-r,-r,r*2,r*2);
  c.lineCap='round';
  c.strokeStyle='#343845'; c.lineWidth=r*.08;                                    // fixed frame struts
  c.beginPath(); for(let i=0;i<8;i++){const a=i/8*TAU+.2; c.moveTo(Math.cos(a)*r*.6,Math.sin(a)*r*.6); c.lineTo(Math.cos(a)*r*.95,Math.sin(a)*r*.95);} c.stroke();
  c.strokeStyle='rgba(255,255,255,.12)'; c.lineWidth=r*.025; c.beginPath(); c.arc(0,0,r*.6,0,TAU); c.stroke();
  const I=o&&SPINNERS[o.id]&&SPINNERS[o.id].internals;
  if(I){c.save(); I(c,r,o); c.restore();}                                        // the spinner's own machinery (spinners/<id>.js), turning with the spin and stopping when jammed
  else{
    c.save(); c.rotate(-(o&&o.ga!=null?o.ga*.5:t*7));                            // a flywheel turning against the hull
    c.strokeStyle='#555b6b'; c.lineWidth=r*.06; c.beginPath(); c.arc(0,0,r*.45,0,TAU); c.stroke();
    c.lineWidth=r*.05; c.beginPath(); for(let i=0;i<6;i++){const a=i/6*TAU; c.moveTo(Math.cos(a)*r*.14,Math.sin(a)*r*.14); c.lineTo(Math.cos(a)*r*.45,Math.sin(a)*r*.45);} c.stroke();
    c.fillStyle='#8a90a0'; for(let i=0;i<6;i++){const a=i/6*TAU+.5; c.beginPath(); c.arc(Math.cos(a)*r*.45,Math.sin(a)*r*.45,r*.028,0,TAU); c.fill();}
    c.restore();
  }
  c.fillStyle='#6b7080'; c.beginPath(); c.arc(0,0,r*.13,0,TAU); c.fill();
  c.globalCompositeOperation='lighter';                                          // the dying core glows through
  const e=c.createRadialGradient(0,0,0,0,0,r*.95), a=.12+.4*(1-hp);
  e.addColorStop(0,rgba(c2||'#ff8a3a',a)); e.addColorStop(1,'rgba(255,90,20,0)'); c.fillStyle=e; c.fillRect(-r,-r,r*2,r*2);
  c.restore();
}
// remove one jagged bite from the (already drawn) body layer, leaving a dark torn edge and a rim that glows for ~3 s after the hit
function cutOne(c,r,k,t){
  const cx=Math.cos(k.a)*r*k.rho, cy=Math.sin(k.a)*r*k.rho, n=9, pts=[];
  for(let i=0;i<n;i++){const a=i/n*TAU, rr=k.s*(.6+.55*hash01(k.seed,i)); pts.push([cx+Math.cos(a)*rr,cy+Math.sin(a)*rr]);}
  const heat=clamp(1-(t-k.t0)/3,0,1);
  c.globalCompositeOperation='source-atop'; c.lineJoin='round';
  polyPath(c,pts); c.lineWidth=Math.max(2,r*.1); c.strokeStyle='#0b0809'; c.stroke();
  if(heat>0){c.lineWidth=Math.max(1.5,r*.06); c.strokeStyle=`rgba(255,${Math.round(120+90*heat)},50,${.9*heat})`; c.stroke();}
  c.globalCompositeOperation='destination-out'; c.fillStyle='#000'; polyPath(c,pts); c.fill();
  c.globalCompositeOperation='source-over';
}
function drawHull(c,r,w,hp,angle){
  c.save(); c.beginPath(); c.arc(0,0,r*.98,0,TAU); c.clip();
  const dk=1-hp;
  if(dk>.15){   // soot: the paint wears away as the spinner is battered
    const a=.34*Math.pow(clamp((dk-.15)/.85,0,1),1.2), g=c.createRadialGradient(0,0,r*.3,0,0,r);
    g.addColorStop(0,'rgba(10,8,6,0)'); g.addColorStop(1,`rgba(10,8,6,${a})`); c.fillStyle=g; c.fillRect(-r,-r,r*2,r*2);
  }
  c.drawImage(w.cn,-r,-r,r*2,r*2);
  if(w.scuff>.02){c.strokeStyle=`rgba(225,230,240,${Math.min(.5,w.scuff*.6)})`; c.lineWidth=r*.07; c.beginPath(); c.arc(0,0,r*.9,0,TAU); c.stroke();}   // rim scuff band
  const lb=-2.35-angle;   // direction toward a fixed light (upper left) in the body's frame
  for(const k of w.craters){
    c.save(); c.translate(Math.cos(k.a)*r*k.rho,Math.sin(k.a)*r*k.rho);
    c.fillStyle='rgba(0,0,0,.42)'; c.beginPath(); c.arc(0,0,k.s,0,TAU); c.fill();
    c.lineWidth=Math.max(1,k.s*.3); c.lineCap='round';
    c.strokeStyle='rgba(0,0,0,.5)'; c.beginPath(); c.arc(0,0,k.s,lb-1,lb+1); c.stroke();                                   // the wall facing the light is shadowed
    c.strokeStyle='rgba(255,255,255,.34)'; c.beginPath(); c.arc(0,0,k.s,lb+Math.PI-1,lb+Math.PI+1); c.stroke();           // the far wall catches it
    c.lineWidth=Math.max(.8,k.s*.18); c.strokeStyle='rgba(255,255,255,.2)'; c.beginPath(); c.arc(0,0,k.s*1.3,lb-.9,lb+.9); c.stroke();   // raised lip
    c.restore();
  }
  c.restore();
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
  const tip=o.tip||0;   // KO death spin: the body wobbles hard and tips onto one edge (squashed along a tilt axis)
  const wb=wob+tip*r*.1;
  // jx/jy: the body is knocked off-centre by hits and springs back (Fighter.mechStep); sa: the drawn angle lags while the motor sputters. Both draw-only.
  c.translate(x+Math.sin(t*23)*wb*.6+(o.jx||0),y+Math.cos(t*19)*wb*.6+(o.jy||0));
  if(tip>0){c.rotate(t*3.1); c.scale(1-.2*tip,1); c.rotate(-t*3.1);}
  c.rotate(angle+(o.sa||0)+Math.sin(t*31)*(.03*bent+.1*tip));
  const w=o.wx;
  if(w&&(w.cuts.length||w.holes.length)){
    // structural damage: chassis underneath, body painted into a layer with the cut-outs removed, layer blitted on top
    drawChassis(c,r,hp,t,c2,o);
    const L=layerOf(w,r), lc=L.c;
    lc.setTransform(1,0,0,1,0,0); lc.clearRect(0,0,L.S,L.S);
    lc.save(); lc.setTransform(LAY_K,0,0,LAY_K,L.S/2,L.S/2);
    SPINNERS[o.id].draw(lc,r,c1,c2,o);
    drawHull(lc,r,w,hp,angle); drawScars(lc,r,o.scars);
    for(const k of w.holes) cutOne(lc,r,k,t);
    for(const k of w.cuts) cutOne(lc,r,k,t);
    lc.restore();
    c.drawImage(L.cn,-L.S/2/LAY_K,-L.S/2/LAY_K,L.S/LAY_K,L.S/LAY_K);
  }else{
    SPINNERS[o.id].draw(c,r,c1,c2,o);   // the body itself is painted by the spinner's own file
    if(w) drawHull(c,r,w,hp,angle);
    drawScars(c,r,o.scars);
  }
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
    // dmg: visual plate wear 0..1 (cracks, bend, rattle); cr/sc: crack lines and bare-metal scratches; hs/ph/seed: per-plate variety; t/tt: clock, seconds since torn off
    this.parts=Array.from({length:N},(_,i)=>({a:i/N*TAU,alive:true,dmg:0,cy:def.partY||0,hs:Math.random()<.5?1:-1,ph:rand(0,TAU),seed:rand(1,90),t:0,tt:0,cr:null,sc:null,bolt:false,sa:0,sv:0}));
    // mechanical state (all draw-only: nothing here is ever read by physics, damage or AI). jx/jy/jvx/jvy: the body's spring offset after a hit;
    // ga: machinery angle (advances with spin, frozen while jammed); sa: drawn-angle lag while the motor sputters (sputT = a stall in progress);
    // cond 0..1 and tier 0..4: how wrecked the machine is (see mechStep)
    this.jx=0; this.jy=0; this.jvx=0; this.jvy=0; this.ga=0; this.sa=0; this.lag=0; this.cond=0; this.tier=0;
    this.sputT=0; this.sputNext=rand(1.5,3); this.jamT=0; this.jamNext=rand(2,4); this.sparkT=rand(1,3); this.joltT=rand(.4,1);
    this.wx=null;   // hull wear canvas, created by the first mark
    // time dilation: ts is this fighter's own time scale (1 normally, slowed while a rival's Overdrive is running)
    this.ts=1;
    // collision / AI state
    this.steerT=0; this.sepCd=0;                       // post-hit steering dampener, pair separation cooldown
    this.bank=null; this.bankCd=rand(1.5,3); this.bankK=0;   // wall-bank slingshot (Big Boy, Scrap-King)
    this.shredCd=0;                                    // cooldown on a rival's ring shredding this spinner
    this.launchT=0; this.wallCd=0;                     // Beyblade launch: seconds of free flight left, cooldown on wall-slam damage
    this.weakT=0;                                      // seconds of reduced strike damage left (corrosive Drain Scrap)
    this.grindCd=0;                                    // rate limit on grinding sparks when the rim flicks debris
    this.dentCd=0; this.dying=false; this.dyU=0;      // rim-dent cooldown; true while the KO death spin plays, and how far through it (0..1, draw-only)
    // arena environment (arenas.js): multipliers the arena sets every tick (all 1 on the Classic floor), and obstacle contact state
    this.env={acc:1,drag:1,top:1,spin:1,pull:1,rot:0}; this.sink=0; this.obsT=9; this.obsNx=0; this.obsNy=0;
    Object.assign(this,SPINNERS[def.id].methods);      // the spinner's own stats, AI and hooks (spinners/<id>.js)
    this.init();                                       // ...and its private state (clock, scrap ring, orbit, ...)
  }
  // ---- spinner hooks: these are the defaults. A spinner's methods (spinners/<id>.js) override the ones it needs. ----
  init(){}                                  // build the spinner's private state
  aiMove(o,dx,dy,d,dt,g){return [0,0];}     // steering for CPU control; every spinner should override this
  reach(){return 130;}                      // how far past its body rivals should keep clear
  charges(){return false;}                  // true for a spinner that builds speed and rams
  flicks(){return true;}                    // false: its rim doesn't fling loose debris sideways (visual debris physics only)
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
  malfunction(g,dt,tier){}                  // visual only, every sim tick while heavily damaged (tier 3-4): the spinner's own way of breaking down
  deathStep(g,dt,u){}                       // visual only, every tick of the death spin; u 0..1 is how far through it is (also in this.dyU)
  onBurst(g){}                              // visual only, the instant the dead body bursts (after its plates blow off, before the core shatters)
  onClash(closing,vn){}                     // touched the other spinner
  onWall(vn){}                              // met the arena wall at normal speed vn
  wallImmune(){return false;}               // true: a launched wall slam never costs this spinner HP (Monster)
  onHitDealt(g,dmg){}                       // this spinner just landed a touch hit that dealt dmg (Monster resets its stacks here)
  spinPitch(){return 1;}                    // multiplier on the spin sound's pitch, on top of spin speed
  // visual only, every tick after the match is decided in this spinner's favour and its rival has burst. u: seconds since the flourish began.
  // The default is a pulse of rings and sparks in the spinner's colours; spinners override it (Clockwork, Scrap-King, Eater...).
  victory(g,dt,u){
    this.vicT=(this.vicT||0)-dt;
    if(this.vicT>0) return;
    this.vicT=.7;
    addRing(g,this.x,this.y,this.r,this.r*3.4,.6,this.c1,4);
    for(let i=0;i<14;i++){const a=rand(0,TAU),s=rand(90,260); addSpark(g,this.x+Math.cos(a)*this.r,this.y+Math.sin(a)*this.r,Math.cos(a)*s,Math.sin(a)*s,rand(.25,.5),Math.random()<.5?this.c1:this.c2,rand(1,2.2));}
  }
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
  // The lookahead is a real intercept time: the smallest t where |rival position + rival velocity*t| equals what this spinner can cover in t
  // (its current speed or speed cap, whichever is higher). k caps it, so the aim never reaches far into the future.
  lead(o,k){
    const px=o.x-this.x, py=o.y-this.y, vx=o.vx*o.ts, vy=o.vy*o.ts;
    const s=Math.max(this.maxSpeed(),Math.hypot(this.vx,this.vy),150);
    const a=vx*vx+vy*vy-s*s, b=2*(px*vx+py*vy), c0=px*px+py*py;
    let t=Math.sqrt(c0)/s;                                   // fallback: the rival is at least as fast as us, so just aim ahead by the straight-line time
    if(a<-1e-3){const disc=b*b-4*a*c0; if(disc>=0) t=(-b-Math.sqrt(disc))/(2*a);}
    const la=clamp(t,.08,k);
    let x=o.x+vx*la, y=o.y+vy*la; const c=Math.hypot(x,y), lim=R-o.r;
    if(c>lim){x*=lim/c; y*=lim/c;}
    return [x,y];
  }
  // steering toward (x,y) that also cancels sideways drift, so approaches go straight instead of curving or overshooting.
  // k is how hard the drift is cancelled (0 = plain aim). Close to the point it just aims, so it never fights a final lunge.
  steerTo(x,y,k){
    let ux=x-this.x, uy=y-this.y; const l=Math.hypot(ux,uy)||1; ux/=l; uy/=l;
    if(l<this.r*2) return [ux,uy];
    const al=this.vx*ux+this.vy*uy, sx=this.vx-al*ux, sy=this.vy-al*uy, f=(k==null?.5:k)/Math.max(this.maxSpeed(),100);
    return [ux-sx*f,uy-sy*f];
  }
  // 0..1: how dangerous this spinner is to be near right now (Big Boy's rage, Monster's stacks, Clockwork's Overdrive...). Other AIs read it.
  danger(){return 0;}
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
  // big: the blow as a fraction of max HP (0 for burns and the death spin). calm: no shrapnel damage (plates shed during the death spin).
  // Returns the plate's world position {x,y}, or false when no plate was left.
  detachPart(g,cang,fx,big,calm){
    big=big||0;
    const alive=this.parts.filter(p=>p.alive); if(!alive.length) return false;
    // which plate goes is cosmetic (only how many are left matters): the one nearest the blow, favouring a plate that is already cracked and loose
    let pick, best=1e9; const step=TAU/this.parts.length;
    for(const p of alive){
      const s=cang==null?-p.dmg-Math.random()*.05:Math.abs(angDiff(p.a+this.angle,cang))/step-p.dmg*.8;
      if(s<best){best=s;pick=p;}
    }
    pick.alive=false; if(g.stats) g.stats[this.idx].lost++;
    const pa=pick.a+this.angle, ca=Math.cos(pa), sa=Math.sin(pa);
    const px=this.x+ca*this.r*.92, py=this.y+sa*this.r*.92;
    const hit=clamp(big*4,0,1);                       // how hard the blow was, 0..1
    const out=rand(200,440)*(1+hit*.5), tan=this.spin*this.r*.55*rand(.6,1);
    let lx=0, ly=0;                                   // a blow flings the plate sideways, in the direction of the push
    if(cang!=null&&hit>0){
      const bx=-Math.cos(cang), by=-Math.sin(cang), dot=bx*ca+by*sa;
      lx=bx-dot*ca; ly=by-dot*sa;
      const kick=clamp(110+big*900,0,480)*rand(.8,1.2);
      lx*=kick; ly*=kick;
    }
    const kind=this.def.kind;
    const pts=SPINNERS[this.id].partPts(this.r);
    const gd={kind,idx:this.parts.indexOf(pick),r:this.r,c1:this.c1,c2:this.c2,owner:this.idx,shrap:!calm,noCapT:1.2,   // noCapT: Scrap-King's magnet leaves a fresh chip alone for a moment
      dmg:pick.dmg,cr:pick.cr,sc:pick.sc,bolt:pick.bolt,cy:pick.cy,hs:pick.hs};   // it falls off still cracked, scratched and missing a bolt
    // becomes a real Matter body; it ignores its former owner for a moment so it can fly clear
    const body=spawnPiece(g,pts,this.x,this.y,pa,
      this.vx*.5+ca*out-sa*tan+lx, this.vy*.5+sa*out+ca*tan+ly, rand(-16,16)*(1+hit*2),
      gd,{density:kind==='blade'?.003:.004,ghost:.4,noOwner:true,heat:1});
    if(body&&big>.07) this.fragments(g,body,pick,pts,big,lx,ly);
    if(fx){
      for(let i=0;i<18;i++){const a=rand(0,TAU),sp=rand(120,440); addSpark(g,px,py,Math.cos(a)*sp,Math.sin(a)*sp,rand(.2,.55),Math.random()<.5?'#fff3c4':this.c2,rand(1,2.6));}
      addRing(g,px,py,3,36,.25,this.c2,3);
      g.shake=Math.max(g.shake,5); hitStop(g,HITSTOP.chip); SFX.chip();
    }
    return {x:px,y:py};
  }
  // extra, purely cosmetic debris thrown off with a plate (never edible, capturable or dangerous). Medium blow: bolt chips.
  // Heavy blow: slivers cut from the plate along its crack, each on its own path.
  fragments(g,body,plate,pts,big,lx,ly){
    const bv=getVel(body), vx=bv.x*VU, vy=bv.y*VU, x=body.position.x, y=body.position.y;
    const nb=1+((Math.random()*2)|0);
    for(let i=0;i<nb;i++){   // bolt and rivet chips
      const s=rand(1.8,3.2), a=rand(0,TAU), sp=rand(160,420);
      spawnCosm(g,[[-s,-s*.7],[s,-s*.4],[s*.3,s]],x,y,rand(0,TAU),vx*.5+Math.cos(a)*sp,vy*.5+Math.sin(a)*sp,rand(-30,30),'#9aa1ad',1);
    }
    if(big<=.16) return;
    const sh=body.gd.shape, n=crackNormal(body.gd), ca=Math.cos(body.angle), sa=Math.sin(body.angle);
    const col=PIECE[this.def.kind]?PIECE[this.def.kind].col(body.gd):this.c1;
    for(const s of [1,-1]){
      const half=clipHalf(sh.pts,n[0]*s,n[1]*s); if(half.length<3) continue;
      if(s<0&&Math.random()<.4) continue;   // sometimes only one sliver comes away
      const wx=(ca*n[0]-sa*n[1])*s, wy=(sa*n[0]+ca*n[1])*s, sp=rand(140,360);
      spawnCosm(g,half.map(q=>[q[0]*.6,q[1]*.6]),x,y,body.angle,vx*.6+wx*sp+lx*.4,vy*.6+wy*sp+ly*.4,rand(-26,26),col,1);
    }
  }
  detachAll(g){while(this.detachPart(g,null,false));}
  // ---- visual wear (never touches hitboxes, mass or damage) ----
  // a touch hit wears the plates nearest the blow; burns and the stalemate loosen whichever plate is already worst
  hurtPlates(g,amt,cang,isDot){
    const N=this.parts.length; if(!N||!(amt>0)) return;
    const k=amt/this.maxHp;
    if(isDot||cang==null){
      let w=null; for(const p of this.parts) if(p.alive&&(!w||p.dmg>w.dmg)) w=p;
      if(w) this.plateDmg(g,w,k*2.5);
      return;
    }
    const step=TAU/N, base=clamp(k*5,.06,.7);
    for(const p of this.parts){
      if(!p.alive) continue;
      const d=Math.abs(angDiff(p.a+this.angle,cang))/step;
      if(d<1.6){
        this.plateDmg(g,p,base*Math.max(0,1-d*.6));
        p.sv+=p.hs*clamp(base*8,.3,4.5)*(1-d*.4);   // the armour rings like a struck bell: the plate swings on its hinge
      }
    }
  }
  plateDmg(g,p,add){
    if(add<=0) return;
    const o=p.dmg; p.dmg=Math.min(.97,o+add);
    const want=p.dmg>=.7?3:p.dmg>=.45?2:p.dmg>=.2?1:0;
    while((p.cr?p.cr.length:0)<want){
      (p.cr||(p.cr=[])).push(makeCrack(p.cy));
      (p.sc||(p.sc=[])).push([rand(.76,.95),p.cy+rand(-.14,.14),rand(-.6,.6)+(Math.random()<.5?0:Math.PI),rand(.07,.16)]);
    }
    if(o<.45&&p.dmg>=.45&&!p.bolt){   // a bolt shears off with a small shower of sparks
      p.bolt=true;
      const pa=p.a+this.angle, bx=this.x+Math.cos(pa)*this.r*.8, by=this.y+Math.sin(pa)*this.r*.8;
      for(let i=0;i<5;i++){const a=rand(0,TAU),s=rand(60,220); addSpark(g,bx,by,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.35),'#fff3c4',rand(1,1.8));}
    }
  }
  // make sure some plate is visibly loose before the next one goes (min: the wear it should have reached)
  loosen(g,min){
    let w=null; for(const p of this.parts) if(p.alive&&(!w||p.dmg>w.dmg)) w=p;
    if(w&&w.dmg<min) this.plateDmg(g,w,min-w.dmg);
  }
  scuffAdd(a){const w=wearTex(this); w.scuff=Math.min(1,w.scuff+a);}
  // a hit at world angle cang: crater, cracks that grow from the impact (or extend an earlier crack nearby), bare-metal scratches, heat tint
  markHull(cang,amt,g){
    const big=amt/this.maxHp; if(big<.012) return;
    const w=wearTex(this), c=w.c, r=this.r, a=angDiff(cang,this.angle), ca=Math.cos(a), sa=Math.sin(a), rho=rand(.74,.92);
    let sx=ca*r*rho, sy=sa*r*rho;
    let ne=-1, nd=r*.3; for(let i=0;i<w.ends.length;i++){const e=w.ends[i], d=Math.hypot(e[0]-sx,e[1]-sy); if(d<nd){nd=d;ne=i;}}
    if(ne>=0){sx=w.ends[ne][0]; sy=w.ends[ne][1]; w.ends.splice(ne,1);}   // extend an existing crack rather than adding a separate one
    // heat tint: repeated hits in one area go straw, then purple, then blue
    const bin=((Math.floor((a+TAU)%TAU/TAU*12))%12); w.tint[bin]+=.25+big*5;
    const L=w.tint[bin], tc=L<.6?'201,162,74':L<1.2?'122,63,156':'44,90,168';
    const gr=c.createRadialGradient(ca*r*.8,sa*r*.8,0,ca*r*.8,sa*r*.8,r*.3);
    gr.addColorStop(0,`rgba(${tc},.26)`); gr.addColorStop(1,`rgba(${tc},0)`); c.fillStyle=gr; c.fillRect(-r,-r,r*2,r*2);
    // cracks
    const nb=2+(big>.08?1:0), len=r*clamp(.16+big*1.8,.16,.6), lw=Math.max(1,r*.03);
    for(let b=0;b<nb;b++){
      let ang=Math.atan2(-sy,-sx)+rand(-.9,.9), x=sx, y=sy; const pts=[[x,y]], n=4+((Math.random()*3)|0);
      for(let i=0;i<n;i++){ang+=rand(-.55,.55); const l=len/n*rand(.7,1.3); x+=Math.cos(ang)*l; y+=Math.sin(ang)*l; pts.push([x,y]);}
      c.lineCap='round'; c.lineJoin='round';
      c.strokeStyle='rgba(6,5,5,.8)'; c.lineWidth=lw; c.beginPath(); pts.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1])); c.stroke();
      c.strokeStyle='rgba(235,240,250,.2)'; c.lineWidth=lw*.4; c.beginPath(); pts.forEach((q,i)=>i?c.lineTo(q[0]-lw*.7,q[1]):c.moveTo(q[0]-lw*.7,q[1])); c.stroke();
      w.ends.push([x,y]); if(w.ends.length>24) w.ends.shift();
    }
    // scratches that show bare metal
    c.strokeStyle='rgba(215,222,235,.45)'; c.lineWidth=Math.max(.8,r*.015); c.beginPath();
    for(let i=0;i<3;i++){const ta=a+Math.PI/2+rand(-.3,.3), l=r*rand(.12,.28), ox=sx+rand(-.1,.1)*r, oy=sy+rand(-.1,.1)*r; c.moveTo(ox,oy); c.lineTo(ox+Math.cos(ta)*l,oy+Math.sin(ta)*l);}
    c.stroke();
    // a dent (drawn live so it can be lit from the world); the oldest is baked into the canvas as a plain dark pit
    if(big>.03){
      w.craters.push({a,rho,s:r*clamp(.05+big*.7,.05,.2)});
      if(w.craters.length>CRATER_MAX){const k=w.craters.shift(); c.fillStyle='rgba(0,0,0,.4)'; c.beginPath(); c.arc(Math.cos(k.a)*r*k.rho,Math.sin(k.a)*r*k.rho,k.s,0,TAU); c.fill();}
    }
    // a heavy hit also knocks a flake of hull off at the crater (cosmetic debris)
    if(g&&big>.1){
      const wa=a+this.angle, fx=this.x+Math.cos(wa)*r*rho, fy=this.y+Math.sin(wa)*r*rho, s=r*rand(.05,.09), sp=rand(100,280), tg=rand(-120,120);
      spawnCosm(g,[[-s,-s*.6],[s,-s*.2],[s*.2,s*.8]],fx,fy,rand(0,TAU),this.vx*.5+Math.cos(wa)*sp-Math.sin(wa)*tg,this.vy*.5+Math.sin(wa)*sp+Math.cos(wa)*tg,rand(-30,30),shade(this.c1,-.3),1);
    }
    // structural damage: a heavy hit bites a notch out of the hull edge, and a battered spinner gets holes punched through the armour
    const hpf=this.hp/this.maxHp;
    if(big>.07){
      const ns=big>.16?2:1;
      for(let n=0;n<ns;n++) this.biteAdd(g,w.cuts,a+(n?rand(.25,.45)*(Math.random()<.5?-1:1):rand(-.12,.12)),1,r*clamp(.08+big*.9,.1,.26),6);
    }
    if(hpf<.5&&big>.025&&Math.random()<(hpf<.3?.8:.45)) this.biteAdd(g,w.holes,a+rand(-.8,.8),rand(.3,.7),r*rand(.07,.15)*(hpf<.3?1.2:1),6);
  }
  // adds a cut-out (a = angle in the body frame, rho = distance from the centre in r). At the cap, the nearest existing one just grows.
  biteAdd(g,list,a,rho,s,cap){
    const r=this.r;
    if(list.length>=cap){
      let b=null,bd=9; for(const k of list){const d=Math.abs(angDiff(k.a,a)); if(d<bd){bd=d;b=k;}}
      b.s=Math.min(r*.34,b.s*1.15); b.t0=this.t; return;
    }
    list.push({a,rho,s,t0:this.t,seed:rand(1,90)});
    if(g){
      const wa=a+this.angle, px=this.x+Math.cos(wa)*r*rho, py=this.y+Math.sin(wa)*r*rho;
      for(let i=0;i<9;i++){const q=rand(0,TAU),sp=rand(80,300); addSpark(g,px,py,Math.cos(q)*sp,Math.sin(q)*sp,rand(.2,.5),Math.random()<.5?'#fff3c4':'#ffb347',rand(1,2.2));}
    }
  }
  ai(dt,g){
    const o=g.fighters.find(f=>f!==this&&f.alive); if(!o) return [0,0];
    let dx=o.x-this.x, dy=o.y-this.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    // each spinner steers itself (spinners/<id>.js); (dx,dy) is the unit vector to the rival, d the distance
    // then the arena's navigation pass (arenas.js): steer around obstacles and out of gutters without touching the spinner's own tactics
    return arenaNav(g,this,this.unpin(this.aiMove(o,dx,dy,d,dt,g),o,dx,dy,d,dt),o,d,dt);
  }
  // Escape when pinned: if this spinner sits against the wall with the rival on top of it and barely moving, it slides along the rim
  // (away from the rival) instead of grinding in place. The aggressor (high danger) is never made to flee.
  unpin(v,o,dx,dy,d,dt){
    const dc=Math.hypot(this.x,this.y)||1, sp=Math.hypot(this.vx,this.vy);
    const atWall=dc>R-this.r-8, atObs=this.obsT<.15;   // pinned against the rim, or against an arena obstacle
    const pinned=(atWall||atObs)&&d<this.r+o.r+34&&sp<95&&this.danger()<.6&&this.launchT<=0;
    this.pinT=pinned?(this.pinT||0)+dt:Math.max(0,(this.pinT||0)-dt*2);
    if(this.pinT<.4) return v;
    // n points into the surface it is pinned against
    const nx=atWall?this.x/dc:-this.obsNx, ny=atWall?this.y/dc:-this.obsNy; let tx=-ny, ty=nx;
    if(tx*-dx+ty*-dy<0){tx=-tx; ty=-ty;}                        // the tangent that leads away from the rival
    const w=clamp((this.pinT-.4)/.25,0,1)*.85;
    return [v[0]*(1-w)+tx*w-nx*.15*w, v[1]*(1-w)+ty*w-ny*.15*w];
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
  // A hit throws the machinery away from the attacker (cang points toward the attacker); it springs back in mechStep. Touch hits only.
  jolt(cang,amt){
    const big=amt/this.maxHp, v=this.r*clamp(big*30,.5,4);
    if(cang==null){const a=rand(0,TAU); this.jvx+=Math.cos(a)*v*.5; this.jvy+=Math.sin(a)*v*.5;}
    else{this.jvx-=Math.cos(cang)*v; this.jvy-=Math.sin(cang)*v;}
  }
  // Mechanical condition and its visible symptoms. Everything here is draw-only (jx/jy, sa, ga, plate springs) or an effect (sparks, smoke, sounds):
  // it never touches position, velocity, spin, hitboxes or damage.
  //   cond 0..1 blends HP lost (70%) and plates lost (30%); tier: 0 pristine, 1 light, 2 moderate, 3 heavy, 4 critical
  //   1 light:    now and then a spark from a plate seam
  //   2 moderate: plates ring and swing on their springs (hits kick them, spin shakes the loose ones)
  //   3 heavy:    the motor sputters (the drawn rotation stalls and whips back, black smoke, the hum drops out), the body jolts now and then
  //   4 critical: violent jolts, and a part jams solid then tears free with sparks and a flying tooth
  mechStep(dt,g,hpF){
    const dying=this.dying, rpm=clamp(this.spin/this.baseSpin(),0,1.6);
    this.cond=dying?1:clamp(.7*(1-hpF)+.3*(1-this.aliveFrac()),0,1);
    const cond=this.cond, tier=this.tier=cond<.08?0:cond<.28?1:cond<.5?2:cond<.7?3:4;
    // the body's spring offset (hit jolts)
    this.jvx+=(-520*this.jx-11*this.jvx)*dt; this.jvy+=(-520*this.jy-11*this.jvy)*dt;
    this.jx+=this.jvx*dt; this.jy+=this.jvy*dt;
    const jm=Math.hypot(this.jx,this.jy), jl=this.r*.2; if(jm>jl){this.jx*=jl/jm; this.jy*=jl/jm;}
    // plates on hinge springs: worn plates are looser (lower stiffness and damping); loose ones are shaken by the spin
    for(const p of this.parts){
      if(!p.alive){p.sa=0; p.sv=0; continue;}
      const l=clamp((p.dmg-.2)/.5,0,1);
      if(p.dmg>=.45) p.sv+=(Math.random()-.5)*dt*60*l*Math.min(1.2,rpm);
      p.sv+=(-(420-260*l)*p.sa-(10-5.5*l)*p.sv)*dt; p.sa=clamp(p.sa+p.sv*dt,-.6,.6);
    }
    // light: a spark off a plate seam every so often
    if(tier>=1&&!dying){
      this.sparkT-=dt;
      if(this.sparkT<=0){
        this.sparkT=rand(1.2,3.4)/tier;
        const a=this.angle+(((Math.random()*this.parts.length)|0)+.5)/this.parts.length*TAU, x=this.x+Math.cos(a)*this.r*.95, y=this.y+Math.sin(a)*this.r*.95;
        for(let i=0;i<3;i++){const s=rand(40,150), d=a+rand(-.9,.9); addSpark(g,x,y,Math.cos(d)*s+this.vx*.3,Math.sin(d)*s+this.vy*.3,rand(.12,.28),'#ffd27a',rand(.8,1.5));}
      }
    }
    // heavy and critical: the body jolts on its own as parts knock about inside
    if(tier>=3){
      this.joltT-=dt;
      if(this.joltT<=0){
        this.joltT=rand(.35,.9)*(tier>=4?1:2.2);
        const a=rand(0,TAU), v=this.r*rand(1,2.2)*(tier>=4?1:.5); this.jvx+=Math.cos(a)*v; this.jvy+=Math.sin(a)*v;
      }
    }
    // sputter: the drawn rotation stalls for a moment (lag grows), then whips back to the true angle
    if(tier>=3&&!dying){
      if(this.sputT>0){
        this.sputT-=dt; this.lag=Math.min(2.5,this.lag+this.spin*dt*.9);
        if(this.sputT<=0){for(let i=0;i<8;i++){const a=rand(0,TAU), s=rand(100,260); addSpark(g,this.x+Math.cos(a)*this.r*.7,this.y+Math.sin(a)*this.r*.7,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.3),'#ff9a4a',rand(1,1.8));}}
      }else{
        this.sputNext-=dt;
        if(this.sputNext<=0){
          this.sputT=rand(.14,.32)*(tier>=4?1.3:1); this.sputNext=rand(1.3,3.2)/(1+(tier-3)*1.1);
          for(let i=0;i<2;i++){const life=rand(.7,1.1); g.parts.push({k:'smoke',x:this.x+rand(-.3,.3)*this.r,y:this.y+rand(-.3,.3)*this.r,vx:rand(-20,20),vy:-rand(25,50),life,max:life,size:this.r*rand(.16,.24),al:.5});}   // a black puff as the motor chokes
        }
      }
    }
    if(!(this.sputT>0)) this.lag*=Math.exp(-14*dt);
    this.sa=-this.lag;
    // critical: a part jams solid (the internals stop turning), then tears free: sparks and a loose tooth that skitters off (cosmetic)
    if(tier>=4&&!dying){
      if(this.jamT>0){
        this.jamT-=dt;
        if(this.jamT<=0){
          const a=rand(0,TAU), x=this.x+Math.cos(a)*this.r*.6, y=this.y+Math.sin(a)*this.r*.6;
          for(let i=0;i<10;i++){const d=rand(0,TAU), s=rand(80,300); addSpark(g,x,y,Math.cos(d)*s,Math.sin(d)*s,rand(.15,.4),Math.random()<.5?'#fff3c4':'#ff9a4a',rand(1,2));}
          spawnCosm(g,[[-2.6,-2],[2.6,-2],[1.6,2.6],[-1.6,2.6]],x,y,rand(0,TAU),Math.cos(a)*rand(120,260)+this.vx*.4,Math.sin(a)*rand(120,260)+this.vy*.4,rand(-30,30),'#9a8a6a',1);
          this.jvx+=Math.cos(a)*this.r*2; this.jvy+=Math.sin(a)*this.r*2;   // the release kicks the body
        }
      }else{
        this.jamNext-=dt;
        if(this.jamNext<=0){this.jamT=rand(.3,.7); this.jamNext=rand(2.5,5);}
      }
    }else this.jamT=0;
    if(!(this.jamT>0)) this.ga+=this.spin*dt;   // the machinery turns with the spin: slower as the machine wears down, still while jammed
    if(tier>=3&&!dying) this.malfunction(g,dt,tier);   // the spinner's own failure mode (visual only)
  }
  // scars cool, smoke once the machine is badly hurt (ramping in), electrical arcs once it is heavily damaged
  wear(dt,g,hpF){
    this.mechStep(dt,g,hpF);
    for(const s of this.scars) s.heat=Math.max(0,s.heat-dt/SCAR_COOL);
    let open=null;   // torn-off plates: smoke and arcs come out of these breaches
    for(const p of this.parts){p.t+=dt; if(!p.alive){p.tt+=dt; (open||(open=[])).push(p);}}
    if(this.cond>.4){
      const k=clamp((this.cond-.4)/.5,0,1);
      this.smokeT-=dt;
      if(this.smokeT<=0){
        this.smokeT=.16-.11*k;
        let a=rand(0,TAU), d=rand(0,this.r*.25);
        if(open&&Math.random()<.65){a=open[(Math.random()*open.length)|0].a+this.angle; d=this.r*rand(.72,.9);}
        else if(this.wx&&this.wx.holes.length&&Math.random()<.5){const h=this.wx.holes[(Math.random()*this.wx.holes.length)|0]; a=h.a+this.angle; d=this.r*h.rho;}   // smoke pours out of hull holes
        const life=rand(.9,1.5);
        g.parts.push({k:'smoke',x:this.x+Math.cos(a)*d,y:this.y+Math.sin(a)*d,vx:rand(-16,16),vy:-rand(18,42),
          life,max:life,size:this.r*rand(.14,.2),al:.22+.3*k});
      }
    }
    if(this.tier>=3){
      this.arcT-=dt;
      if(this.arcT<=0){
        this.arcT=rand(.15,.5)*(this.tier>=4?1:2.2);
        const pts=[[rand(-.2,.2)*this.r,rand(-.2,.2)*this.r]], n=rand(3,5)|0;
        let a=rand(0,TAU); if(open&&Math.random()<.75) a=open[(Math.random()*open.length)|0].a+this.angle+rand(-.1,.1);   // arcs leap from the open sockets
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
  // met a hard surface (the rim, or an arena obstacle) at normal speed vn. (nx,ny) points into the surface, (px,py) is the contact point.
  // The rim ring, sparks, and for a launched spinner the ricochet slam with its small damage. The velocity has already been reflected.
  surfaceHit(g,nx,ny,px,py,vn,launched){
    this.hitPt={x:px,y:py};   // where it last struck a hard surface (Monster's stack flash is drawn there)
    if(vn>150&&g.stats) g.stats[this.idx].ric++;
    if(vn>150){SFX.wall(vn,panAt(px),matOf(this)); if(vn>330) camKick(g,-nx,-ny,clamp(vn*.008,2,7));}   // the surface rings; a hard slam shoves the view
    const na=Math.atan2(ny,nx);
    if(launched&&vn>250){         // ricochet slam: big sparks, a whang, a shake, and a little damage
      g.shake=Math.max(g.shake,clamp(vn*.012,4,12));
      SFX.ricochet(vn,100);
      addRing(g,px,py,4,40+vn*.04,.3,this.c1,3);
      addShock(g,px,py,50+vn*.05,this.c1,.35);
      scorch(g,px-nx*6,py-ny*6,16+vn*.03,.3);
      if(this.wallCd<=0){
        this.wallCd=.2;
        if(!this.wallImmune()){
          const amt=1+(WALL_HIT_DMG-1)*clamp((vn-250)/850,0,1);
          addText(g,this.x,this.y-this.r-6,'-'+Math.round(amt),'#ffd166',16);
          damage(g,this,amt,true,na,true);   // raw: shields don't soften a wall slam
        }
      }
      for(let i=0;i<14;i++){
        const ta=na+Math.PI/2*(Math.random()<.5?1:-1)+rand(-1,1), s=rand(160,420);
        addSpark(g,px,py,Math.cos(ta)*s-nx*rand(60,160),Math.sin(ta)*s-ny*rand(60,160),rand(.2,.5),Math.random()<.5?'#ffb347':'#fff3c4',rand(1.2,2.8));
      }
    }
    if(vn>140){
      const cnt=clamp(vn/25,3,14)|0;
      for(let i=0;i<cnt;i++){
        const ta=na+Math.PI/2*(Math.random()<.5?1:-1)+rand(-.9,.9);
        const s=rand(120,320);
        addSpark(g,px,py,Math.cos(ta)*s-nx*rand(40,120),Math.sin(ta)*s-ny*rand(40,120),rand(.15,.4),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2.2));
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
      const tv=touchInput(this.idx); if(tv&&!ix&&!iy){ix=tv[0]; iy=tv[1];}   // a touch stick (touch.js), when no key is held
    } else [ix,iy]=this.ai(dt,g);
    const il=Math.hypot(ix,iy); if(il>1){ix/=il;iy/=il;}
    arenaEnv(g,this,dt);   // the arena sets this.env for this tick (gutters, hot plates...): the same rules for human and CPU
    const E=this.env;
    if(E.rot){const c=Math.cos(E.rot), s=Math.sin(E.rot), x0=ix; ix=x0*c-iy*s; iy=x0*s+iy*c;}   // unstable footing: the steering slews
    // post-hit dampener (AI only): almost no steering at the hit, easing back in over steerDur() (STEER_T unless the spinner says otherwise)
    const launched=this.launchT>0;
    if(launched){
      this.launchT-=dt; this.wallCd=Math.max(0,this.wallCd-dt);
      if(ai){ix=0;iy=0;}   // a launched AI spinner is a projectile: no steering until it lands
      if(Math.random()<.7) g.parts.push({k:'dot',x:this.x,y:this.y,vx:0,vy:0,life:.2,max:.2,col:this.c1,size:this.r*.4});   // motion streak
    }
    const damp=ai&&this.steerT>0&&!launched;
    if(damp){const sm=.12+.88*Math.pow(clamp(1-this.steerT/this.steerDur(),0,1),2); ix*=sm; iy*=sm;}
    const a=this.accel()*E.acc;
    this.vx+=ix*a*dt; this.vy+=iy*a*dt;
    // the arena is a shallow bowl: everything drifts to the middle (how strongly depends on the arena; Classic is .18)
    if(!launched){const pk=g.A.pull*E.pull; this.vx-=this.x*pk*dt; this.vy-=this.y*pk*dt;}
    const drag=Math.exp(-this.dragK()*E.drag*(launched?.15:1)*dt);
    this.vx*=drag; this.vy*=drag;
    const sp=Math.hypot(this.vx,this.vy), mx=this.maxSpeed()*E.top;
    if(sp>mx&&!launched){const ns=mx+(sp-mx)*Math.exp(-(damp?1.2:3)*dt); this.vx*=ns/sp; this.vy*=ns/sp;}
    this.x+=this.vx*dt; this.y+=this.vy*dt;
    // wall
    const dc=Math.hypot(this.x,this.y);
    if(dc+this.r>R){
      const nx=this.x/dc, ny=this.y/dc;
      this.x=nx*(R-this.r); this.y=ny*(R-this.r);
      // grinding along the wall: drives the scrape sound and a stream of sparks
      const vt=-this.vx*ny+this.vy*nx;
      this.dentCd=Math.max(0,this.dentCd-dt);
      if(Math.abs(vt)>190&&Math.random()<dt*5) gouge(g,nx*(R-3),ny*(R-3),ny*Math.sign(vt),-nx*Math.sign(vt),rand(14,34),.32);   // grinding along the wall scratches the floor
      if(Math.abs(vt)>70){
        this.scuffAdd(dt*Math.abs(vt)/320*.08);   // grinding the rim along the wall wears a bright band round the hull
        g.scrape=Math.max(g.scrape,clamp(Math.abs(vt)/320,0,1));
        if(Math.random()<dt*26) addSpark(g,nx*R,ny*R,-ny*Math.sign(vt)*rand(120,280)-nx*rand(20,80),nx*Math.sign(vt)*rand(120,280)-ny*rand(20,80),rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2));
      }
      const vn=this.vx*nx+this.vy*ny;
      if(vn>0){
        this.onWall(vn);
        if(vn>DENT_MIN&&this.dentCd<=0){this.dentCd=.25; addDent(g,Math.atan2(ny,nx),vn);}   // a hard hit cracks the rim, and it glows for a while
        const ew=launched?2:E_WALL;   // a launched spinner bounces off the wall with full restitution
        this.vx-=ew*vn*nx; this.vy-=ew*vn*ny;
        this.surfaceHit(g,nx,ny,nx*R,ny*R,vn,launched);
      }
    }
    arenaCollide(g,this,launched,true);   // arena obstacles (none on the Classic floor)
    const hpF=this.hp/this.maxHp;
    this.stallT=Math.max(0,this.stallT-dt);
    this.spin=this.baseSpin()*(.35+.65*hpF)*this.stallFactor()*E.spin;
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
// shockwave: a fast expanding ring with a faint filled disc behind it, sized by the blow
function addShock(g,x,y,r1,col,life,rt){g.parts.push({k:'shock',x,y,r1,life,max:life,col,rt});}

/* ---- permanent marks. Scorches and gouges are stamped onto the floor canvas (g.pw.fctx), clipped to the arena;
        rim dents are a permanent dark nick on that canvas plus a glow that cools (g.dents). ---- */
function floorCtx(g,clip){
  const c=g.pw.fctx, o=FLOOR_HALF*FLOOR_S;
  c.save(); c.setTransform(FLOOR_S,0,0,FLOOR_S,o,o);
  if(clip){c.beginPath(); c.arc(0,0,R,0,TAU); c.clip();}
  return c;
}
function scorch(g,x,y,r,a){
  const c=floorCtx(g,true), gr=c.createRadialGradient(x,y,0,x,y,r);
  gr.addColorStop(0,`rgba(0,0,0,${a})`); gr.addColorStop(.55,`rgba(10,4,12,${a*.5})`); gr.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle=gr; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill();
  c.restore();
  wearFloor(g,x,y,r,a*r/34);   // the floor panel under a scorch is worn too
}
// a soft coloured blot baked into the floor (cooled slag, spilled coolant): permanent and drawn once, like a scorch
function stain(g,x,y,r,col,a){
  const c=floorCtx(g,true), gr=c.createRadialGradient(x,y,0,x,y,r);
  gr.addColorStop(0,rgba(col,a)); gr.addColorStop(.6,rgba(col,a*.45)); gr.addColorStop(1,rgba(col,0));
  c.fillStyle=gr; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill();
  c.restore();
}
// a short curved scratch starting at (x,y) and running along (dx,dy): a dark groove with a faint lit edge
function gouge(g,x,y,dx,dy,len,a){
  const l=Math.hypot(dx,dy)||1; dx/=l; dy/=l;
  const bx=-dy*len*.14*rand(-1,1), by=dx*len*.14*rand(-1,1), c=floorCtx(g,true);
  c.lineCap='round';
  const path=(o)=>{c.beginPath(); c.moveTo(x+o,y+o); c.quadraticCurveTo(x+dx*len*.5+bx+o,y+dy*len*.5+by+o,x+dx*len+o,y+dy*len+o);};
  path(0); c.strokeStyle=`rgba(0,0,0,${a})`; c.lineWidth=rand(1.2,2.4); c.stroke();
  path(1); c.strokeStyle=`rgba(190,200,255,${a*.3})`; c.lineWidth=.7; c.stroke();
  c.restore();
  wearFloor(g,x+dx*len*.5,y+dy*len*.5,len*.5,a*.08);
}
function addDent(g,ang,vn){
  const w=clamp(.05+vn/9000,.05,.16);
  g.dents.push({a:ang,w,t0:g.time}); if(g.dents.length>40) g.dents.shift();
  const c=floorCtx(g,false);
  c.lineCap='round';
  c.beginPath(); c.arc(0,0,R+8,ang-w,ang+w); c.strokeStyle='rgba(8,8,16,.7)'; c.lineWidth=7; c.stroke();            // the dent
  c.beginPath(); c.arc(0,0,R+3,ang-w,ang+w); c.strokeStyle='rgba(150,160,255,.3)'; c.lineWidth=1; c.stroke();      // lit inner lip
  c.strokeStyle='rgba(0,0,0,.8)'; c.lineWidth=1.2;
  for(let i=0;i<4;i++){                                                                                           // jagged cracks running outward
    const a=ang+rand(-w,w), r0=R+2, r1=R+rand(8,16);
    c.beginPath(); c.moveTo(Math.cos(a)*r0,Math.sin(a)*r0);
    c.lineTo(Math.cos(a+rand(-.02,.02))*(r0+r1)/2,Math.sin(a+rand(-.02,.02))*(r0+r1)/2); c.lineTo(Math.cos(a+rand(-.03,.03))*r1,Math.sin(a+rand(-.03,.03))*r1); c.stroke();
  }
  c.restore();
  rimWear(g,ang,w,vn);
}

/* ---- ARENA WEAR (visual only: nothing here is read by physics, AI or damage).
        The floor is 80 panels (5 rings x 16 sectors, the same grid the floor art already draws). Scorches and gouges wear the panels
        they land on: rivets pop, a crack opens, an edge lifts, and finally the plate buckles open onto cables. The panels are painted
        into one cached canvas that is only redrawn when a panel changes. The rim is 48 segments: hard wall hits bulge a segment inward
        and kill, then flicker, its light strip, and badly hurt segments throw electrical arcs. ---- */
const PAN_RINGS=5, PAN_SECT=16, RIM_SEG=48, PAN_REDRAW=.25;
function newArena(){
  return {pan:new Float32Array(PAN_RINGS*PAN_SECT), rim:new Float32Array(RIM_SEG), any:false, dirty:false, redrawT:-9, cv:null};
}
function panelGeom(i){
  const ri=(i/PAN_SECT)|0, sj=i%PAN_SECT, rw=R/PAN_RINGS;
  const r0=ri===0?R*.12:ri*rw, r1=(ri+1)*rw, a0=sj/PAN_SECT*TAU, a1=(sj+1)/PAN_SECT*TAU, am=(a0+a1)/2, rm=(r0+r1)/2;
  return {ri,sj,r0,r1,a0,a1,x:Math.cos(am)*rm,y:Math.sin(am)*rm};
}
const PANELS=Array.from({length:PAN_RINGS*PAN_SECT},(_,i)=>panelGeom(i));
// a floor impact at (x,y) wears the panels around it; a panel that first buckles open throws a small burst of sparks
function wearFloor(g,x,y,r,amt){
  const A=g.arena; if(!A||amt<=.004||!g.A.classicWear) return;   // the panel grid is the Classic floor's own; other arenas keep just their scorches and gouges
  for(let i=0;i<PANELS.length;i++){
    const P=PANELS[i], d=Math.hypot(P.x-x,P.y-y), k=clamp(1-d/(r+40),0,1); if(k<=0) continue;
    const before=A.pan[i], after=Math.min(1,before+amt*k*k);
    if(after<=before) continue;
    A.pan[i]=after; A.any=A.dirty=true;
    if(before<.85&&after>=.85){
      for(let n=0;n<10;n++){const a=rand(0,TAU), s=rand(60,220); addSpark(g,P.x,P.y,Math.cos(a)*s,Math.sin(a)*s,rand(.2,.5),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2),true);}
      addRing(g,P.x,P.y,4,26,.25,'#ffb347',2,true);
    }
  }
}
function rimWear(g,ang,w,vn){
  const A=g.arena; if(!A||!g.A.classicWear) return;   // the light strip and its shorting segments belong to the Classic rim
  const amt=.12+vn/4000;
  for(let s=0;s<RIM_SEG;s++){
    const sc=(s+.5)/RIM_SEG*TAU; let d=Math.abs(sc-ang)%TAU; if(d>Math.PI) d=TAU-d;
    if(d<=w+TAU/RIM_SEG*.5) A.rim[s]=Math.min(1,A.rim[s]+amt*(1-d/(w+TAU/RIM_SEG)));
  }
  A.any=true;
}
const panRnd=(i,k)=>{const s=Math.sin(i*127.1+k*311.7)*43758.5453; return s-Math.floor(s);};   // stable per-panel noise, so a panel always looks the same
function drawPanel(c,i,d){
  const P=PANELS[i], ins=3, ra=(P.r0+ins), rb=(P.r1-ins), pa=P.a0+ins/rb, pb=P.a1-ins/rb;
  const pt=(r,a)=>[Math.cos(a)*r,Math.sin(a)*r];
  const outline=()=>{c.beginPath(); c.arc(0,0,rb,pa,pb); c.arc(0,0,ra,pb,pa,true); c.closePath();};
  if(d>.55){   // a lifted panel: the bent plate darkens and its raised edge catches the light, with a shadow underneath
    const lift=clamp((d-.55)/.3,0,1);
    outline(); c.fillStyle=`rgba(8,9,22,${.25+.25*lift})`; c.fill();
    c.lineWidth=3; c.strokeStyle=`rgba(0,0,0,${.55*lift})`; c.beginPath(); c.arc(0,0,rb-2,pa,pb); c.stroke();
    c.lineWidth=1.6; c.strokeStyle=`rgba(190,200,255,${.4*lift})`; c.beginPath(); c.arc(0,0,rb,pa,pb); c.stroke();
    const e0=pt(ra,pa), e1=pt(rb,pa); c.beginPath(); c.moveTo(e0[0],e0[1]); c.lineTo(e1[0],e1[1]); c.stroke();
  }
  if(d>.12){   // rivets at the corners: they go dark, then pop out as the panel wears
    const corners=[[ra+4,pa+5/ra],[ra+4,pb-5/ra],[rb-4,pa+5/rb],[rb-4,pb-5/rb]];
    corners.forEach(([r,a],k)=>{
      const q=pt(r,a), gone=d>.25+panRnd(i,k)*.4;
      c.fillStyle=gone?'rgba(0,0,0,.7)':'rgba(150,158,210,.35)'; c.beginPath(); c.arc(q[0],q[1],gone?2.2:1.6,0,TAU); c.fill();
    });
  }
  if(d>.3){    // a crack wandering across the plate
    c.strokeStyle=`rgba(0,0,0,${.35+.4*d})`; c.lineWidth=1.3; c.beginPath();
    let r=ra+panRnd(i,5)*(rb-ra)*.3, a=pa+panRnd(i,6)*(pb-pa); const n=3+(d*5|0);
    c.moveTo(...pt(r,a));
    for(let k=0;k<n;k++){r+=(rb-ra)*(.12+panRnd(i,7+k)*.1); a+=(panRnd(i,20+k)-.5)*(pb-pa)*.5; a=clamp(a,pa,pb); r=Math.min(r,rb); c.lineTo(...pt(r,a));}
    c.stroke();
  }
  if(d>.85){   // buckled open: a dark hole with cables running through it
    const k=clamp((d-.85)/.15,0,1), rr0=ra+(rb-ra)*.22, rr1=rb-(rb-ra)*.22, qa=pa+(pb-pa)*.22, qb=pb-(pb-pa)*.22;
    c.beginPath(); c.arc(0,0,rr1,qa,qb); c.arc(0,0,rr0,qb,qa,true); c.closePath();
    c.fillStyle=`rgba(2,2,8,${.55+.4*k})`; c.fill(); c.strokeStyle='rgba(120,128,190,.45)'; c.lineWidth=1.4; c.stroke();
    const cols=['#c0392b','#2e86de','#d4a017'];
    cols.forEach((col,n)=>{
      const a0=qa+(qb-qa)*(.2+.3*n), p0=pt(rr0+3,a0), p1=pt(rr1-3,a0+(panRnd(i,40+n)-.5)*(qb-qa)*.6), m=pt((rr0+rr1)/2,a0+(panRnd(i,50+n)-.5)*(qb-qa));
      c.strokeStyle=col; c.lineWidth=1.8; c.beginPath(); c.moveTo(p0[0],p0[1]); c.quadraticCurveTo(m[0],m[1],p1[0],p1[1]); c.stroke();
    });
  }
}
function redrawPanels(g){
  const A=g.arena;
  if(!A.cv){A.cv=document.createElement('canvas'); A.cv.width=A.cv.height=Math.ceil(FLOOR_HALF*2*FLOOR_S); A.cx=A.cv.getContext('2d');}
  const c=A.cx, o=FLOOR_HALF*FLOOR_S;
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,A.cv.width,A.cv.height);
  c.setTransform(FLOOR_S,0,0,FLOOR_S,o,o);
  c.save(); c.beginPath(); c.arc(0,0,R,0,TAU); c.clip();
  c.lineCap='round'; c.lineJoin='round';
  for(let i=0;i<PANELS.length;i++) if(A.pan[i]>.12) drawPanel(c,i,A.pan[i]);
  c.restore();
  A.dirty=false; A.redrawT=g.time;
}
// per frame: refresh the panel cache when something changed, and let the worst rim segments and open panels spit electricity
function arenaStep(g,dt){
  const A=g.arena; if(!A||!A.any) return;
  if(A.dirty&&g.time-A.redrawT>PAN_REDRAW) redrawPanels(g);
  for(let s=0;s<RIM_SEG;s++){
    const w=A.rim[s]; if(w<.5||Math.random()>dt*w*.7) continue;
    const a=(s+Math.random())/RIM_SEG*TAU, ca=Math.cos(a), sa=Math.sin(a), pts=[[ca*(R+6),sa*(R+6)]];
    let len=rand(24,60)*w, ang=a+Math.PI;   // the arc runs inward from the rim along a jagged path
    for(let k=1;k<=5;k++){const r=R+6-len*k/5, jit=rand(-9,9); pts.push([Math.cos(a)*r-sa*jit,Math.sin(a)*r+ca*jit]);}
    g.parts.push({k:'arc',abs:true,pts,life:.1,max:.1,rt:true,col:Math.random()<.5?'#5ab0ff':'#c4a8ff'});
    for(let n=0;n<4;n++){const sp=rand(60,200), d=a+Math.PI+rand(-.9,.9); addSpark(g,ca*(R+4),sa*(R+4),Math.cos(d)*sp,Math.sin(d)*sp,rand(.15,.35),'#9fd0ff',rand(1,2),true);}
  }
  for(let i=0;i<PANELS.length;i++){    // a buckled panel shorts its cables now and then
    if(A.pan[i]<.9||Math.random()>dt*.5) continue;
    const P=PANELS[i], pts=[[P.x,P.y]]; let x=P.x,y=P.y;
    for(let k=0;k<4;k++){x+=rand(-12,12); y+=rand(-12,12); pts.push([x,y]);}
    g.parts.push({k:'arc',abs:true,pts,life:.08,max:.08,rt:true,col:Math.random()<.5?'#ff3b3b':'#5ab0ff'});
    addSpark(g,P.x,P.y,rand(-90,90),rand(-90,90),rand(.15,.3),'#fff3c4',1.4,true);
  }
}
// drawn over the baked floor: bulged rim segments, and the light strip dying, flickering and going dark where the rim is hurt
function drawRimWear(c,g,t){
  const A=g.arena; if(!A||!A.any) return;
  c.save(); c.lineCap='butt';
  for(let s=0;s<RIM_SEG;s++){
    const w=A.rim[s]; if(w<.12) continue;
    const a0=s/RIM_SEG*TAU-.004, a1=(s+1)/RIM_SEG*TAU+.004;
    c.beginPath(); c.arc(0,0,R-1.5*w,a0,a1); c.strokeStyle=`rgba(6,6,14,${.5+.4*w})`; c.lineWidth=2+5*w; c.stroke();      // the wall bulges inward
    c.beginPath(); c.arc(0,0,R-1.5*w-(1+2.5*w),a0,a1); c.strokeStyle=`rgba(150,160,255,${.25*w})`; c.lineWidth=1; c.stroke(); // its lit edge
    const flick=Math.sin(t*37+s*5.1)*Math.sin(t*23+s*2.3), dead=w>.75?.92:(flick>.6-w?w*.9:0);
    if(dead>0){c.beginPath(); c.arc(0,0,R+9,a0,a1); c.strokeStyle=`rgba(43,46,80,${dead})`; c.lineWidth=7; c.stroke();}      // strip goes dark
  }
  c.restore();
}

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
const CAT={WALL:1,F0:2,F1:4,DEBRIS:8,PROP:16};   // PROP: arena props (Salvage Yard scrap and drums), kept in pw.props, never in pw.bodies
const FCAT=[CAT.F0,CAT.F1];
const DEBRIS_MASK=CAT.WALL|CAT.F0|CAT.F1|CAT.DEBRIS|CAT.PROP;
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
      collisionFilter:{category:CAT.WALL,mask:CAT.DEBRIS|CAT.PROP},label:'wall'});
    w.gd={type:'wall'}; walls.push(w);
  }
  Composite.add(engine.world,walls);
  Composite.add(engine.world,arenaBodies(g));   // static arena obstacles, so debris bounces off them too
  const floor=document.createElement('canvas');
  floor.width=floor.height=Math.ceil(FLOOR_HALF*2*FLOOR_S);
  const pw={engine,bodies:[],cosm:[],settled:[],hits:[],props:[],floor,fctx:floor.getContext('2d'),tick:0,rs:1};
  if(g.A.props) g.A.props(g,pw);   // the arena's own movable props (pw.props: no spinner ability ever looks at this list)
  Events.on(engine,'collisionStart',ev=>{
    for(const p of ev.pairs){
      const a=p.bodyA,b=p.bodyB; if(!a.gd||!b.gd||pw.hits.length>40) continue;
      if(a.gd.type==='cosm'||b.gd.type==='cosm'){   // cosmetic fragments never trigger hit logic; they only tick quietly
        const c=a.gd.type==='cosm'?a:b, o=c===a?b:a, cv=getVel(c), ov=getVel(o);
        const cr=Math.hypot(cv.x-ov.x,cv.y-ov.y)*VU*pw.rs;
        if(cr>120&&o.gd.type!=='cosm') SFX.tink(cr,panAt(c.position.x));
        continue;
      }
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
    collisionFilter:{category:FCAT[f.idx],mask:CAT.DEBRIS|CAT.PROP}});
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
  gd.heat=o.heat||0;   // 1 = red-hot from a fresh break; cools to 0 over HOT_T seconds
  b.gd=gd; Composite.add(pw.engine.world,b); pw.bodies.push(b);
  const sp0=Math.hypot(vx,vy);
  if(!o.sh&&PIECE[gd.kind]&&sp0>120){gd.z=.01; gd.vz=clamp(sp0*.55,110,270)*rand(.85,1.15);}   // a flung plate hops (visual only)
  while(pw.bodies.length>MAX_BODIES){   // over budget: the oldest non-captured piece lies down as a settled record
    const old=pw.bodies.find(q=>q.gd.state!=='captured'); if(!old) break;
    settlePiece(g,old);
  }
  return b;
}
function removeBody(g,b){
  const pw=g.pw, i=pw.bodies.indexOf(b); if(i>=0) pw.bodies.splice(i,1);
  if(b.gd.wob>0){g.wobN=Math.max(0,g.wobN-1); b.gd.wob=0;}
  Composite.remove(pw.engine.world,b);
}
function drawPiece(c,b){
  const d=b.gd, sh=d.shape, z=d.z>.5?d.z:0;
  if(z){   // mid-hop: the shadow slides away from the plate on the floor while the plate itself grows
    c.save(); c.translate(b.position.x+z*.28,b.position.y+z*.4); c.rotate(b.angle); polyPath(c,sh.pts);
    c.fillStyle=`rgba(0,0,0,${clamp(.38-z*.0025,.12,.38)})`; c.fill(); c.restore();
  }
  c.save(); c.translate(b.position.x,b.position.y); c.rotate(b.angle);
  if(z) c.scale(1+z*.0045,1+z*.0045);
  if(d.wob>0){   // coin-settling wobble: the plate squashes along one axis, shrinking as it settles
    const w=d.wob/WOB_T, q=Math.sin(d.wob*52)*.16*w; c.scale(1+q,1-q);
  }
  const P=PIECE[d.kind];   // a chipped part is drawn by its spinner (PIECE is filled by defineSpinner); anything else is a plain shard
  if(P){
    c.save(); c.translate(-sh.cx,-sh.cy); P.draw(c,d);
    if(d.dmg>=.2) partWear(c,d.r,d,d.wpts||(d.wpts=sh.pts.map(q=>[q[0]+sh.cx,q[1]+sh.cy])));   // the plate keeps the cracks and scratches it had on the spinner
    c.restore();
  } else {
    polyPath(c,sh.pts); c.fillStyle=d.col; c.fill();
    c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=1.3; c.lineJoin='round'; c.stroke();
  }
  if(d.heat>.02){   // a fresh break glows red-hot, then cools to grey
    const h=d.heat;
    polyPath(c,sh.pts); c.lineJoin='round'; c.globalCompositeOperation='lighter';
    c.fillStyle=`rgba(255,${(50+100*h)|0},15,${.6*h})`; c.fill();
    c.strokeStyle=`rgba(255,170,60,${.35*h})`; c.lineWidth=5; c.stroke();
    c.globalCompositeOperation='source-over';
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
  d.state='free'; d.shrap=false; d.shotBy=undefined; d.blast=null; d.hitCd=0; d.noCapT=0; d.heat=0;
  if(d.wob>0) g.wobN=Math.max(0,g.wobN-1);
  d.z=0; d.vz=undefined; d.wob=0;
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
  const d=b.gd, sh=d.shape, ang=rand(0,Math.PI), cn=d.cr&&d.cr.length?crackNormal(d):null;   // a cracked plate breaks along its crack
  const nx=cn?cn[0]:Math.cos(ang), ny=cn?cn[1]:Math.sin(ang);
  const bv=getVel(b), ca=Math.cos(b.angle), sa=Math.sin(b.angle), vx=bv.x*VU, vy=bv.y*VU;
  const col=PIECE[d.kind]?PIECE[d.kind].col(d):d.col, px=b.position.x, py=b.position.y, w=Body.getAngularVelocity(b)*VU;
  const group=-(100+((Math.random()*1e6)|0));
  let made=0;
  for(const s of [1,-1]){
    const half=clipHalf(sh.pts,nx*s,ny*s); if(half.length<3) continue;
    const wx=(ca*nx-sa*ny)*s, wy=(sa*nx+ca*ny)*s;
    const sp=rand(60,170)*(s>0?1:rand(.7,1.1));   // the two halves leave at different speeds and spins
    if(spawnPiece(g,half,px,py,b.angle,vx+wx*sp,vy+wy*sp,w+rand(-14,14),
      {kind:'shard',col,owner:d.owner,shrap:true,group,corrupt:d.corrupt,corruptBy:d.corruptBy,charges:d.charges},{density:.004,ghost:.3,heat:d.heat})) made++;   // corruption survives a split
  }
  if(!made) return;
  removeBody(g,b);
  for(let i=0;i<8;i++) addSpark(g,px,py,rand(-260,260),rand(-260,260),rand(.15,.35),'#fff3c4',rand(1,2.2));
  addRing(g,px,py,2,22,.2,'#ffffff',2);
}

// the unit normal that cuts a plate along its first crack (plate frame, which is also the debris body's local frame)
function crackNormal(d){
  const c=d.cr&&d.cr[0];
  if(c&&c.length>1){
    const a=c[0], b=c[c.length-1], dx=b[0]-a[0], dy=b[1]-a[1], l=Math.hypot(dx,dy);
    if(l>1e-4) return [-dy/l,dx/l];
  }
  const t=rand(0,Math.PI); return [Math.cos(t),Math.sin(t)];
}
/* Cosmetic fragments (bolt chips, slivers off a heavily hit plate, hull flakes) live in pw.cosm, NOT in pw.bodies, so no spinner's ability
   (Eater's eating, Scrap-King's magnet, Whirl's pull) or the shrapnel damage ever sees them. They collide with the walls and the fighters'
   proxies only, so they never shove real debris, and after COSM_LIFE seconds they are baked straight into the floor canvas. */
function spawnCosm(g,local,ox,oy,rot,vx,vy,vr,col,heat){
  const sh=makeShape(local); if(!sh) return null;
  const pw=g.pw, ca=Math.cos(rot), sa=Math.sin(rot);
  const b=Body.create({position:{x:ox+ca*sh.cx-sa*sh.cy,y:oy+sa*sh.cx+ca*sh.cy},vertices:sh.pts.map(([px,py])=>({x:px,y:py})),density:.003,
    restitution:.4,friction:.2,frictionAir:.03,sleepThreshold:30,label:'cosm',
    collisionFilter:{category:CAT.DEBRIS,mask:CAT.WALL|CAT.F0|CAT.F1,group:0}});
  Body.setAngle(b,rot); setVel(b,vx,vy); Body.setAngularVelocity(b,vr/VU);
  b.gd={type:'cosm',kind:'shard',col,shape:sh,born:g.time,age:0,heat:heat||0,flickCd:0};
  Composite.add(pw.engine.world,b); pw.cosm.push(b);
  while(pw.cosm.length>COSM_MAX) bakeCosm(g,0);
  return b;
}
function bakeCosm(g,i){
  const b=g.pw.cosm[i]; g.pw.cosm.splice(i,1);
  b.gd.heat=0; bakePiece(g,b); Composite.remove(g.pw.engine.world,b);
}
function stepCosm(g,dt){
  const C=g.pw.cosm;
  for(let i=C.length-1;i>=0;i--){
    const b=C[i], d=b.gd; d.age+=dt;
    if(d.flickCd>0) d.flickCd-=dt;
    if(d.heat>0) d.heat=Math.max(0,d.heat-dt/1.6);
    if(d.age>COSM_LIFE||(d.age>.7&&(b.isSleeping||Body.getSpeed(b)*VU<14))) bakeCosm(g,i);
  }
}
// Plate hops: height z is only ever drawn (scale and shadow), so it never touches the physics. Every landing clatters and sparks,
// each hop lower than the last; a big plate then wobbles down like a dropped coin with ticks that speed up. Captured pieces are left alone.
function stepHops(g,dt){
  for(const b of g.pw.bodies){
    const d=b.gd;
    if(d.state==='captured'){d.z=0; d.vz=undefined; d.wob=0; continue;}
    if(d.vz!==undefined){
      d.vz-=HOP_G*dt; d.z+=d.vz*dt;
      if(d.z<=0){
        d.z=0;
        const v=getVel(b), sp=Math.hypot(v.x,v.y)*VU, imp=-d.vz, sz=debRad(d);
        if(imp>HOP_MIN*.6&&sp>25){
          SFX.clatter(sz,Math.max(sp,imp*1.5),panAt(b.position.x));
          for(let i=0,n=imp>140?3:1;i<n;i++) addSpark(g,b.position.x,b.position.y,rand(-150,150),rand(-150,150),rand(.1,.22),Math.random()<.5?'#fff3c4':'#ffb347',rand(1,1.8));
          if(imp>150) gouge(g,b.position.x,b.position.y,v.x/(sp/VU||1),v.y/(sp/VU||1),rand(8,16),.18);
        }
        if(imp>HOP_MIN){d.vz=imp*HOP_BOUNCE;}
        else{
          d.vz=undefined;
          if(sz>13&&sp>45&&g.wobN<WOB_MAX&&!d.wob){d.wob=WOB_T; d.wobNext=0; g.wobN++;}   // the last wobble, like a coin settling
        }
      }
    }
    if(d.wob>0){
      d.wob-=dt; d.wobNext-=dt;
      if(d.wobNext<=0){d.wobNext=.03+.1*(d.wob/WOB_T); SFX.tink(300*(d.wob/WOB_T)+160,panAt(b.position.x));}   // ticks that speed up as it settles
      if(d.wob<=0){d.wob=0; g.wobN=Math.max(0,g.wobN-1);}
    }
  }
}
const debRad=d=>d.rad||(d.rad=d.shape.pts.reduce((m,p)=>Math.max(m,Math.hypot(p[0],p[1])),6));
// A spinning rim flings loose debris that reaches it sideways, in its direction of spin (debris only: a spinner is never pushed back).
// Hard contacts spit sparks, scratch the floor and scuff the rim. Captured ring pieces are skipped, and Eater opts out (flicks()).
function flickDebris(g,dt){
  const pw=g.pw; let n=0;
  for(const f of g.fighters){
    if(!f.alive||!f.flicks()||f.spin<5) continue;
    if(f.grindCd>0) f.grindCd-=dt;
    const rimV=f.spin*f.r, fvx=f.vx*f.ts, fvy=f.vy*f.ts;
    for(const list of [pw.bodies,pw.cosm]) for(const b of list){
      const d=b.gd; if(d.state==='captured'||d.flickCd>0) continue;
      const dx=b.position.x-f.x, dy=b.position.y-f.y, reach=f.r+debRad(d)+5;
      if(dx>reach||dx<-reach||dy>reach||dy<-reach) continue;
      const dist=Math.hypot(dx,dy); if(dist>reach||dist<1) continue;
      const v=getVel(b), px=v.x*VU, py=v.y*VU;
      const rel=Math.hypot(px-fvx,py-fvy); if(rel<FLICK_MIN) continue;   // only debris that is fast relative to the spinner
      const nx=dx/dist, ny=dy/dist, tx=-ny, ty=nx, k=clamp(rimV*.2,35,230)*rand(.8,1.1);
      setVel(b,px+tx*k+nx*50,py+ty*k+ny*50);
      Body.setAngularVelocity(b,Body.getAngularVelocity(b)+rand(6,20)/VU);
      d.flickCd=.2;
      if(rel>220&&f.grindCd<=0&&++n<=3){   // rate-limited grind: sparks along the rim, a scratch on the floor, a scuff on the rim
        f.grindCd=.07;
        const cx=f.x+nx*f.r, cy=f.y+ny*f.r;
        for(let i=0;i<4;i++){const s=rand(120,320); addSpark(g,cx,cy,tx*s+nx*rand(-60,100),ty*s+ny*rand(-60,100),rand(.12,.3),Math.random()<.5?'#fff3c4':'#ffb347',rand(1,2));}
        gouge(g,cx,cy,tx,ty,rand(10,20),.22);
        f.scuffAdd(.003);
        if(rel>320&&Math.random()<.4) SFX.debris(rel*.6);
      }
    }
  }
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
    const deb=h.a.gd.type==='debris'?h.a:(h.b.gd.type==='debris'?h.b:null);
    if(!deb){   // an arena prop knocked into something: just the sound
      const pr=h.a.gd.type==='prop'?h.a:(h.b.gd.type==='prop'?h.b:null), o=pr===h.a?h.b:h.a;
      if(pr&&n<=6) SFX.debris(h.rel,pr.gd.rad,o.gd.type==='wall'?'wall':'piece',panAt(h.x));
      continue;
    }
    if(!pw.bodies.includes(deb)) continue;
    const other=deb===h.a?h.b:h.a, d=deb.gd;
    if(d.state==='captured') continue;   // ring pieces are driven by the orbit, not by hits
    if(h.rel>130&&n<=6) for(let k=0;k<3;k++) addSpark(g,h.x,h.y,rand(-210,210),rand(-210,210),rand(.15,.35),'#ffd9a0',rand(1,2));
    SFX.debris(h.rel,debRad(d),other.gd.type==='wall'?'wall':(other.gd.type==='fighter'?'fighter':'piece'),panAt(h.x));
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
  flickDebris(g,dt);
  eng.timing.timeScale=g.timeScale*g.dil;
  Engine.update(eng,1000/120);
  stepCosm(g,dt);
  stepHops(g,dt);
  for(const b of pw.bodies){
    const v=getVel(b), s=Math.hypot(v.x,v.y), d=b.gd;
    if(s>MAXV) Body.setVelocity(b,{x:v.x*MAXV/s,y:v.y*MAXV/s});
    if(d.hitCd>0) d.hitCd-=dt;
    if(d.flickCd>0) d.flickCd-=dt;
    if(d.heat>0){   // cooling plate: trails thin smoke while it is still hot
      d.heat=Math.max(0,d.heat-dt/HOT_T);
      if(d.heat>.25&&Math.random()<.1*d.heat){const life=rand(.5,.9); g.parts.push({k:'smoke',x:b.position.x,y:b.position.y,vx:rand(-10,10),vy:-rand(10,26),life,max:life,size:rand(3,5),al:.1+.15*d.heat});}
    }
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
      const f=p.abs?{x:0,y:0,r:16}:p.f; c.globalCompositeOperation='lighter'; c.globalAlpha=a;   // arena arcs carry absolute points
      c.beginPath(); p.pts.forEach((q,i)=>i?c.lineTo(f.x+q[0],f.y+q[1]):c.moveTo(f.x+q[0],f.y+q[1]));
      c.strokeStyle=p.col; c.lineWidth=Math.max(3,f.r*.1); c.globalAlpha=a*.55; c.stroke();   // glow
      c.strokeStyle='#ffffff'; c.lineWidth=Math.max(1.2,f.r*.035); c.globalAlpha=a; c.stroke();  // hot core
    } else if(p.k==='spark'){
      // additive streak: hot sparks fade white -> orange -> red as they cool; coloured ones keep their hue but get a white-hot head
      c.globalCompositeOperation='lighter';
      const hot=p.col==='#fff3c4'||p.col==='#ffb347'||p.col==='#ffd9a0';
      const tx=p.x-p.vx*.045, ty=p.y-p.vy*.045;
      c.beginPath(); c.moveTo(p.x,p.y); c.lineTo(tx,ty);
      c.globalAlpha=a*.28; c.strokeStyle=hot?(a>.5?'#ff9a3a':'#ff3a14'):p.col; c.lineWidth=p.size*3; c.stroke();   // glow
      c.globalAlpha=a; c.strokeStyle=hot?(a>.66?'#fff6d8':(a>.33?'#ffb347':'#ff4a1a')):p.col; c.lineWidth=p.size; c.stroke();
      if(!hot&&a>.4){c.globalAlpha=a*.8; c.strokeStyle='#ffffff'; c.lineWidth=p.size*.5; c.beginPath(); c.moveTo(p.x,p.y); c.lineTo(p.x-p.vx*.015,p.y-p.vy*.015); c.stroke();}
    } else if(p.k==='dot'){
      c.globalCompositeOperation='lighter'; c.globalAlpha=a*.9; c.fillStyle=p.col;
      c.beginPath(); c.arc(p.x,p.y,p.size*(.5+a*.5),0,TAU); c.fill();
    } else if(p.k==='ring'){
      const t=1-a, r=p.r0+(p.r1-p.r0)*(1-Math.pow(1-t,2));
      c.globalCompositeOperation='lighter'; c.globalAlpha=a; c.strokeStyle=p.col; c.lineWidth=p.lw*a+.5;
      c.beginPath(); c.arc(p.x,p.y,r,0,TAU); c.stroke();
    } else if(p.k==='shock'){
      const t=1-a, r=Math.max(2,p.r1*(1-Math.pow(1-t,3)));
      c.globalCompositeOperation='lighter';
      const gr=c.createRadialGradient(p.x,p.y,r*.55,p.x,p.y,r);
      gr.addColorStop(0,'rgba(255,255,255,0)'); gr.addColorStop(1,rgba(p.col,.22*a));
      c.globalAlpha=1; c.fillStyle=gr; c.beginPath(); c.arc(p.x,p.y,r,0,TAU); c.fill();
      c.globalAlpha=a*a; c.strokeStyle=p.col; c.lineWidth=2+9*a; c.beginPath(); c.arc(p.x,p.y,r,0,TAU); c.stroke();
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
      {density:.003,ghost:.35,heat:1});
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
  addShock(g,f.x,f.y,300,'#ffe3b0',.6);
  scorch(g,f.x,f.y,f.r*2.2,.55);                                       // the KO leaves a big black burn and scratches radiating from it
  for(let i=0;i<9;i++){const a=rand(0,TAU); gouge(g,f.x+Math.cos(a)*f.r*.5,f.y+Math.sin(a)*f.r*.5,Math.cos(a),Math.sin(a),rand(30,90),.4);}
}

/* =====================================================================
   DAMAGE / KO
   ===================================================================== */
// raw=true skips the spinner's damage reduction (used by the stalemate penalty)
function damage(g,f,amt,isDot,cang,raw){
  if(!f.alive) return;
  const hp0=f.hp;
  if(isDot&&!raw) amt*=f.takenMul();   // burns and shrapnel
  f.onHurt(g,isDot,cang);              // e.g. a Scrap-King ring piece wears when a touch hit lands
  if(amt>0) g.idleT=0;                 // anything that hurts a spinner restarts the stalemate clock
  f.hp=Math.max(0,f.hp-amt);
  if(!raw&&g.stats) g.stats[1-f.idx].dealt+=hp0-f.hp;   // match summary: damage credited to the rival (stalemate and wall slams are nobody's)
  f.flash=Math.max(f.flash,isDot?.18:1);
  // heavy touch hits leave a glowing welt at the exact impact angle (same 7% threshold as the chip logic)
  if(!isDot&&cang!=null){const big=amt/f.maxHp; if(big>.07) f.addScar(cang,clamp(.2+big*.9,.2,.42),1);}
  if(amt>0){f.hurtPlates(g,amt,cang,isDot); if(cang!=null) f.markHull(cang,amt,g); if(!isDot&&cang!=null) f.jolt(cang,amt);}   // visual wear: plates, hull and a jolt through the machinery
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
  while(want-->0) if(!f.detachPart(g,isDot?null:cang,true,isDot?0:amt/f.maxHp)) break;
  const prog=target-f.lostCount();   // how far along to the next lost plate: a plate is visibly loose before it goes
  if(prog>.45) f.loosen(g,.5+.45*clamp((prog-.45)/.55,0,1));
}
// The match result is decided at once, but the loser plays a death spin first: it grinds along the floor, slowing, wobbling and
// tipping with a falling-pitch motor (the spin voice follows f.spin), then bursts with every remaining plate blowing off (finishDeath).
function kill(g,f){
  f.alive=false;
  dropProxy(g,f);              // so the dying body isn't pushed by, or boxed in by, its own circle
  f.onKill(g);                 // spinner-specific cleanup (a dead Scrap-King must release its ring)
  f.dying=true; g.dying.push({f,t:0,spin0:Math.max(10,f.spin),shed:rand(.05,.1)});
  g.shake=Math.max(g.shake,12); g.slowT=1.3; hitStop(g,HITSTOP.ko);
  const alive=g.fighters.filter(x=>x.alive);
  if(alive.length===0){g.over=true; g.winner=null;}
  else if(!g.over){g.over=true; g.winner=alive[0]; g.endT=0;}
  else if(g.over && g.winner && !g.winner.alive){g.winner=null;}
}

function updateDying(g,dt){
  for(let i=g.dying.length-1;i>=0;i--){
    const d=g.dying[i], f=d.f; d.t+=dt;
    const u=clamp(d.t/DEATH_T,0,1);
    f.t+=dt; f.flash=Math.max(0,f.flash-dt*3);
    const dr=Math.exp(-2.4*dt); f.vx*=dr; f.vy*=dr;
    f.x+=f.vx*dt; f.y+=f.vy*dt;
    const dc=Math.hypot(f.x,f.y);
    if(dc+f.r>R){const nx=f.x/dc, ny=f.y/dc; f.x=nx*(R-f.r); f.y=ny*(R-f.r); const vn=f.vx*nx+f.vy*ny; if(vn>0){f.vx-=1.5*vn*nx; f.vy-=1.5*vn*ny;}}
    arenaCollide(g,f,false,false);                                         // the wreck still can't slide through arena obstacles
    f.spin=d.spin0*Math.pow(1-u,1.6); f.angle+=f.spin*dt;
    f.mechStep(dt,g,0);                                                    // violent jolts and the machinery winding down
    f.dyU=u; f.deathStep(g,dt,u);                                          // spinner-specific death animation (draw-only)
    g.scrape=Math.max(g.scrape,.6*(1-u));                                  // the dying body drags along the floor
    if(Math.random()<dt*55){                                               // scraping sparks off the rim, pointing the way it slides
      const a=rand(0,TAU), sp=Math.hypot(f.vx,f.vy), s=rand(120,300);
      addSpark(g,f.x+Math.cos(a)*f.r*.9,f.y+Math.sin(a)*f.r*.9,-Math.sin(a)*s+f.vx*.3,Math.cos(a)*s+f.vy*.3,rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2.2));
      if(sp>40&&Math.random()<.5) gouge(g,f.x,f.y,-f.vx,-f.vy,rand(14,30),.3);
    }
    d.shed-=dt;
    if(d.shed<=0&&u<.9){   // the loosest plates tear free one at a time as the body grinds down; whatever is left blows off at the end
      d.shed=rand(SHED_GAP[0],SHED_GAP[1]);
      const at=f.detachPart(g,null,false,0,true);
      if(at){
        for(let i=0;i<8;i++){const a=rand(0,TAU),s=rand(90,300); addSpark(g,at.x,at.y,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.4),Math.random()<.5?'#fff3c4':'#ffb347',rand(1,2));}
        addRing(g,at.x,at.y,2,24,.2,f.c2,2);
        g.shake=Math.max(g.shake,3); SFX.chip();
      }
    }
    if(Math.random()<dt*16){const life=rand(.8,1.3); g.parts.push({k:'smoke',x:f.x+rand(-1,1)*f.r*.4,y:f.y+rand(-1,1)*f.r*.4,vx:rand(-16,16),vy:-rand(18,42),life,max:life,size:f.r*rand(.14,.2),al:.4});}
    if(u>=1){
      g.dying.splice(i,1); f.dying=false;
      f.spin=d.spin0; f.flash=1;
      f.detachAll(g);                                                      // every remaining plate blows off
      f.onBurst(g);                                                        // the spinner's own finale (spring, welded scrap, molten slag): cosmetic only
      shatter(g,f);
      SFX.shatter(f.r);
      g.shake=Math.max(g.shake,26); hitStop(g,HITSTOP.ko);
    }
  }
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
  // glancing contact: the rims slip past each other faster than they close, so it grinds instead of ringing
  const slip=Math.abs((a.vx*ta-b.vx*tb)*tx+(a.vy*ta-b.vy*tb)*ty)+Math.abs(a.spin*a.r*Math.sign(a.spin)-b.spin*b.r*Math.sign(b.spin))*.15;
  const glance=vn<130&&slip>Math.max(vn,40)*1.6;
  if(glance&&slip>140){
    const gx=a.x+nx*a.r, gy=a.y+ny*a.r;
    SFX.grind(slip/420,0,panAt(gx));
    if(Math.random()<.2) addSpark(g,gx,gy,tx*rand(-260,260)+rand(-40,40),ty*rand(-260,260)+rand(-40,40),rand(.12,.28),Math.random()<.5?'#fff3c4':'#ffb347',rand(1,2));
    a.scuffAdd(.004); b.scuffAdd(.004);
  }
  if(!closing||vn<45) return;
  const vout=-((a.vx*ta-b.vx*tb)*nx+(a.vy*ta-b.vy*tb)*ny);   // real separating speed after the bounce
  const cx=a.x+nx*a.r, cy=a.y+ny*a.r;
  const dA=a.hitCd<=0?a.contactDamage(vn)*a.weakMul()*b.takenMul():0;   // damage a deals to b
  const dB=b.hitCd<=0?b.contactDamage(vn)*b.weakMul()*a.takenMul():0;   // damage b deals to a
  let big=0;
  if(dA>0){a.hitCd=a.hitCdTime(); addText(g,b.x,b.y-b.r-6,'-'+Math.round(dA),'#ffd166',clamp(14+dA*.6,15,34)); damage(g,b,dA,false,Math.atan2(-ny,-nx)); big=Math.max(big,dA); a.rage=0; a.onHitDealt(g,dA); if(dA>14) b.stallT=STALL_TIME;}
  if(dB>0){b.hitCd=b.hitCdTime(); addText(g,a.x,a.y-a.r-6,'-'+Math.round(dB),'#ffd166',clamp(14+dB*.6,15,34)); damage(g,a,dB,false,Math.atan2(ny,nx)); big=Math.max(big,dB); b.rage=0; b.onHitDealt(g,dB); if(dB>14) a.stallT=STALL_TIME;}
  impactSparks(g,cx,cy,nx,ny,vn,[a.c1,b.c1,a.c2,b.c2],big>0);
  if(dA>0){const s=g.stats[a.idx]; s.hits++; s.big=Math.max(s.big,dA);}
  if(dB>0){const s=g.stats[b.idx]; s.hits++; s.big=Math.max(s.big,dB);}
  a.scuffAdd(.02+vn*.00008); b.scuffAdd(.02+vn*.00008);   // rims scrape each other
  if(big>0){   // permanent burn and scratches on the floor, and a shockwave sized by the blow
    scorch(g,cx,cy,16+big*1.8,clamp(.08+big*.012,.08,.4));
    for(let i=0,n=big>10?3:1;i<n;i++){const sg=Math.random()<.5?1:-1; gouge(g,cx,cy,-ny*sg+rand(-.3,.3),nx*sg+rand(-.3,.3),rand(18,26)+big*2,.35);}   // scratches run along the contact tangent
    if(big>5||vn>260) addShock(g,cx,cy,clamp(46+big*6,60,190),big>10?'#ffe3b0':a.c1,.3+big*.01);
  }
  const stop=big>14?HITSTOP.massive:(big>7||vn>220?HITSTOP.medium:0);
  const delay=stop/60;   // the clang waits for the freeze to end, so it lands at full volume right as time resumes
  if(!(glance&&big<4)) SFX.clang(vn,a.m,b.m,big,delay,matOf(a),matOf(b),panAt(cx));   // a glancing scrape already played its grind
  if(vout>RIC_MIN&&vn>260) SFX.ricochet(vout,Math.abs(jt*sum),delay);   // extra-hard ricochet gets its own whang on top
  if(big>7){   // the camera is shoved along the blow, toward whoever took the harder hit
    const sg=dA>=dB?1:-1; camKick(g,nx*sg,ny*sg,clamp(big*.55,3,big>14?12:7));
  }
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
  // near-death: when one spinner is critical and the pair is close, the view eases toward the pair and closes in a little
  let near=0;
  if(a.alive&&b.alive&&!g.over&&Math.hypot(a.x-b.x,a.y-b.y)<R*.95){
    const low=Math.min(a.hp/a.maxHp,b.hp/b.maxHp);
    near=clamp((.25-low)/.15,0,1);
    tx+=((a.x+b.x)/2*.55-tx)*near; ty+=((a.y+b.y)/2*.55-ty)*near;
  }
  g.nearK+=(near-g.nearK)*(1-Math.exp(-rdt/.8));
  const e=1-Math.exp(-rdt/.7);   // ~0.7 s ease
  g.camX+=(tx-g.camX)*e; g.camY+=(ty-g.camY)*e;
  g.zoomP*=Math.exp(-rdt*14);
  const kd=Math.exp(-rdt*9); g.kickX*=kd; g.kickY*=kd;   // a camera shove springs back in about 0.3 s
}
// shove the view along (dx,dy) by mag screen pixels; it springs back. Small hits keep the plain shake.
function camKick(g,dx,dy,mag){
  g.kickX+=dx*mag; g.kickY+=dy*mag;
  const l=Math.hypot(g.kickX,g.kickY); if(l>14){g.kickX*=14/l; g.kickY*=14/l;}
}
function renderGame(){
  const g=game; const t=g.time;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#07070d'; ctx.fillRect(0,0,W,H);
  const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.7);
  bg.addColorStop(0,'#14152a'); bg.addColorStop(1,'#050509');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  // the HUD takes 110 px on a desktop-sized window; on a phone it is compact (style.css) and the arena starts just below it
  const compact=!(W>=768&&H>=640), side=compact&&H<=500&&W>H;   // side: a phone held sideways (style.css moves the HUD into the corners)
  const top=!compact?110:side?8:Math.round(g.hudH||70)+6, availH=H-top-10;
  const fw=W/(2*R+70), fh=availH/(2*R+70), zb=(fw<fh||compact)?1:CAM_ZOOM;   // a phone (or any narrow screen) shows the whole arena instead of zooming past its edges
  const s0=Math.min(fw,fh), s=s0*(zb+g.zoomP+NEAR_ZOOM*g.nearK-(zb-1)*g.finalK);   // near-death closes in; the final view pulls back
  // keep every living spinner fully on screen and the view centre inside the arena
  let camX=g.camX*(1-g.finalK), camY=g.camY*(1-g.finalK);
  const hw=W/(2*s)-12, hh=availH/(2*s)-12;
  let loX=-1e9,hiX=1e9,loY=-1e9,hiY=1e9;
  for(const f of g.fighters) if(f.alive){
    loX=Math.max(loX,f.x+f.r-hw); hiX=Math.min(hiX,f.x-f.r+hw);
    loY=Math.max(loY,f.y+f.r-hh); hiY=Math.min(hiY,f.y-f.r+hh);
  }
  camX=loX>hiX?(loX+hiX)/2:clamp(camX,loX,hiX); camY=loY>hiY?(loY+hiY)/2:clamp(camY,loY,hiY);
  const cl=Math.hypot(camX,camY), cm=R*.25; if(cl>cm){camX*=cm/cl; camY*=cm/cl;}
  const sk=g.shake+(g.hitStop>0?3:0);   // a small tremor while the world is frozen on impact
  const cx=W/2-camX*s+rand(-1,1)*sk+g.kickX, cy=top+availH/2-camY*s+rand(-1,1)*sk+g.kickY;
  ctx.save(); ctx.translate(cx,cy); ctx.scale(s,s);
  g.A.drawFloor(ctx,t,g);   // the selected arena's floor (Classic: drawArenaFloor)
  if(g.arena.cv&&g.arena.any) ctx.drawImage(g.arena.cv,-FLOOR_HALF,-FLOOR_HALF,FLOOR_HALF*2,FLOOR_HALF*2);   // worn floor panels (cached), under the scorches
  ctx.drawImage(g.pw.floor,-FLOOR_HALF,-FLOOR_HALF,FLOOR_HALF*2,FLOOR_HALF*2);   // scorches, gouges, dents and the oldest overflow of the pile, baked
  // freshly dented rim sections glow and cool
  ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.lineCap='round';
  for(const d of g.dents){
    const h=1-(t-d.t0)/DENT_COOL; if(h<=0) continue;
    ctx.beginPath(); ctx.arc(0,0,R+7,d.a-d.w,d.a+d.w);
    ctx.strokeStyle=`rgba(255,${(80+120*h)|0},${(30+40*h*h)|0},${.55*h})`; ctx.lineWidth=14; ctx.stroke();
    ctx.strokeStyle=`rgba(255,235,190,${.85*h})`; ctx.lineWidth=3.5; ctx.stroke();
  }
  ctx.restore();
  drawRimWear(ctx,g,t);
  for(const b of g.pw.settled) drawPiece(ctx,b);                                // resting pieces that can still wake up
  for(const b of g.pw.bodies) drawPiece(ctx,b);
  for(const b of g.pw.cosm) drawPiece(ctx,b);
  arenaDrawOver(ctx,g,t);   // raised arena structures (hub walls, machinery) and their impact glows: above debris, below the spinners
  for(const f of g.fighters) if(f.alive) f.drawUnder(ctx,g,t);   // fields, auras and beams belong to their spinner
  // drawObj() adds the spinner's own fields (clock hands, scrap ring) to what drawTop needs
  const fo=drawObj;
  const boosted=f=>f.warpFactor()>0;   // the spinner currently dilating time
  for(const f of g.fighters) if(f.alive&&!(g.dilK>.01&&boosted(f))) drawTop(ctx,fo(f));
  for(const d of g.dying) drawTop(ctx,Object.assign(fo(d.f),{tip:clamp(d.t/DEATH_T*1.4,0,1),hp:0}));   // KO death spin: wobbling, tipping, slowing
  if(g.dilK>.01){
    // Sandevistan screen treatment: the arena cools and darkens, then the boosted fighter and its afterimages are drawn over it
    const k=g.dilK, og=ctx.createRadialGradient(0,0,R*.3,0,0,R*1.05);
    og.addColorStop(0,`rgba(10,34,56,${.2*k})`); og.addColorStop(1,`rgba(0,8,22,${.55*k})`);
    ctx.fillStyle=og; ctx.beginPath(); ctx.arc(0,0,R+22,0,TAU); ctx.fill();
    for(const f of g.fighters) if(f.alive&&boosted(f)){f.drawTrail(ctx); drawTop(ctx,fo(f));}
  } else {
    for(const f of g.fighters) if(f.alive) f.drawTrail(ctx);   // afterimages of an Overdrive that just ended fade out on their own
  }
  if(g.A.drawTop) g.A.drawTop(ctx,g,t);   // arena details that sit over the spinners (a gutter's lip edge, a gantry)
  drawParts(ctx,g);
  ctx.restore();
  // Last Stand vignette: a light red edge that pulses with the heartbeat (g.vigK 0..1 follows the heartbeat urgency)
  if(g.vigK>.01){
    const pulse=.5+.5*Math.sin(g.time*(7+4*g.vigK)), va=g.vigK*VIG_MAX*(.45+.55*pulse);
    const vg=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.38,W/2,H/2,Math.hypot(W,H)*.55);
    vg.addColorStop(0,'rgba(200,20,20,0)'); vg.addColorStop(1,`rgba(200,20,20,${va})`);
    ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
  }
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
  drawJoys(ctx,g);   // touch sticks and the how-to-steer hint (touch.js)
  drawKeyHint(ctx,g);   // keyboard version of that hint, plus the goal for a player's first few matches
  if(!g.over&&g.countdown<=0&&g.idleT>STALEMATE_T-2){   // warn before the stalemate penalty lands
    ctx.font='800 18px ui-sans-serif,system-ui'; ctx.fillStyle='rgba(255,154,90,.95)';
    ctx.fillText('NO DAMAGE  -  STALEMATE IN '+Math.max(1,Math.ceil(STALEMATE_T-g.idleT)),W/2,Math.max(18,top-10));
  }
  ctx.textBaseline='alphabetic';
}

/* =====================================================================
   HUD
   ===================================================================== */
function hudHTML(i,f){
  const right=i===1;
  const side=right?'right-0':'left-0';
  const hint=f.ctrl==='cpu'?'CPU':(TOUCH?'TOUCH':(i===0?'WASD':'ARROWS'));
  return `
    <div class="flex items-baseline justify-between ${right?'flex-row-reverse':''}">
      <span class="hud-name font-extrabold tracking-wide text-lg" style="color:${f.c1}">${f.name}</span>
      <span class="hud-hint text-[11px] text-slate-400 tracking-widest">${hint}</span>
    </div>
    <div class="relative h-4 rounded bg-black/50 border border-white/10 overflow-hidden mt-1">
      <div id="lag${i}" class="absolute inset-y-0 ${side} bg-white/60"></div>
      <div id="hp${i}" class="absolute inset-y-0 ${side}" style="background:linear-gradient(${right?270:90}deg,${f.c1},${f.c2})"></div>
    </div>
    <div class="hud-row flex justify-between gap-2 text-[11px] mt-1 text-slate-300 ${right?'flex-row-reverse':''}">
      <span id="hpt${i}"></span><span id="ml${i}" class="tracking-widest"></span>
    </div>
    <div class="h-1.5 rounded bg-black/50 mt-0.5 overflow-hidden relative">
      <div id="mt${i}" class="absolute inset-y-0 ${side}" style="background:${SPINNERS[f.id].meterBg||'linear-gradient(90deg,'+f.c1+','+f.c2+')'}"></div>
    </div>
    <div id="pp${i}" class="hud-pips flex flex-wrap gap-1 mt-1.5 ${right?'justify-end':''}"></div>`;
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
/* ---------------------------------------------------------------------
   MATCH PRESENTATION (all visual: nothing here is read by physics, damage, AI or abilities)
   Stats: per-spinner tallies shown on the end card.
   --------------------------------------------------------------------- */
function newStats(){return {dealt:0,big:0,hits:0,lost:0,ric:0};}
function fmtTime(s){s=Math.floor(s); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
// the fields drawTop needs for one fighter (spinner-specific ones come from drawState())
function drawObj(f){
  return Object.assign({id:f.id,x:f.x,y:f.y,r:f.r*(1-.08*f.sink),angle:f.angle,c1:f.c1,c2:f.c2,hp:f.hp/f.maxHp,rage:f.rage,flash:f.flash,t:f.t,parts:f.parts,scars:f.scars,wx:f.wx,jx:f.jx,jy:f.jy,sa:f.sa,ga:f.ga,cond:f.cond,tier:f.tier},f.drawState());
}
// stats row helper for the end card
function statsHTML(g){
  const S=g.stats, F=g.fighters;
  const rows=[['Damage dealt',S.map(s=>Math.round(s.dealt))],['Biggest hit',S.map(s=>Math.round(s.big))],['Hits landed',S.map(s=>s.hits)],['Plates lost',S.map(s=>s.lost)],['Wall hits',S.map(s=>s.ric)]];
  let h=`<div class="font-bold" style="color:${F[0].c1}">${F[0].name}</div><div class="text-slate-400 text-[11px] tracking-widest">${fmtTime(g.mt)}</div><div class="font-bold" style="color:${F[1].c1}">${F[1].name}</div>`;
  for(const [lab,v] of rows){
    const w=(v[0]>v[1]?0:(v[1]>v[0]?1:-1));
    h+=`<div class="${w===0?'font-black text-white':'text-slate-400'}">${v[0]}</div><div class="text-slate-400 text-[11px] tracking-widest uppercase">${lab}</div><div class="${w===1?'font-black text-white':'text-slate-400'}">${v[1]}</div>`;
  }
  return h;
}
// victory helper: loose wreckage is tugged toward the winner (a few of the nearest pieces). Only pieces nobody owns in a mechanical sense
// (free, not captured or launched) are touched, and the match is already decided.
function wreckTug(g,f,range,force,maxN){
  const c=[];
  for(const b of g.pw.bodies){
    const s=b.gd.state; if(s&&s!=='free') continue;
    const l=Math.hypot(f.x-b.position.x,f.y-b.position.y); if(l<range&&l>f.r*.8) c.push([l,b]);
  }
  c.sort((p,q)=>p[0]-q[0]);
  for(let i=0;i<Math.min(maxN,c.length);i++){
    const b=c[i][1], l=c[i][0], v=getVel(b);
    if(b.isSleeping) Sleeping.set(b,false);
    setVel(b,v.x*VU*.96+(f.x-b.position.x)/l*force*SIM_DT,v.y*VU*.96+(f.y-b.position.y)/l*force*SIM_DT);
  }
}

function show(id){
  ['menu','select','game','pause','end'].forEach(s=>$('#'+s).classList.toggle('hidden',s!==id&&!(id==='game'&&false)));
}
function setScreen(name){
  state=name;
  if(name!=='game') Ads.gameplayStop();
  $('#menu').classList.toggle('hidden',name!=='menu');
  $('#select').classList.toggle('hidden',name!=='select');
  $('#game').classList.toggle('hidden',name!=='game');
  $('#pause').classList.add('hidden');
  $('#end').classList.add('hidden');
  if(name==='select'){activeSlot=0; renderCards();}
}
function startGame(){
  applyDefaults();
  const A=ARENAS[matchArena]||ARENAS[selArena]||ARENAS.classic, sp=R*(A.spawn||.55);
  const f0=new Fighter(DEFS[sel[0].fighter],sel[0],0,-sp,0);
  const f1=new Fighter(DEFS[sel[1].fighter],sel[1],1,sp,0);
  game={fighters:[f0,f1],parts:[],shake:0,hitStop:0,slowT:0,timeScale:1,dil:1,dilK:0,acc:0,scrape:0,sizzle:0,magnet:0,
        countdown:3.0,fightT:0,idleT:0,over:false,winner:null,endT:0,endShown:false,paused:false,time:0,camX:0,camY:0,zoomP:0,kickX:0,kickY:0,wobN:0,
        dying:[],dents:[],vigK:0,arena:newArena(),A,as:A.init?A.init():{},obsGlow:[],
        stats:[newStats(),newStats()],mt:0,nearK:0,finalK:0};
  game.pw=createWorld(game);
  makeProxy(game,f0); makeProxy(game,f1);
  $('#hud0').innerHTML=hudHTML(0,f0); $('#hud1').innerHTML=hudHTML(1,f1);
  joyClear();
  setScreen('game');
  game.hudH=$('#game').getBoundingClientRect().height;
}
function showEnd(){
  const g=game; g.endShown=true;
  Ads.gameplayStop();
  // Second Wind: lost to the CPU in a one-player match? Offer one opt-in rewarded ad to get back up (once per match)
  const me=g.fighters.find(f=>f.ctrl==='human'), cpu=g.fighters.find(f=>f.ctrl==='cpu');
  $('#eWind').classList.toggle('hidden',!(me&&cpu&&!me.alive&&g.winner===cpu&&!g.secondUsed&&Ads.canReward()));
  const el=$('#endTitle');
  if(g.winner){el.textContent=g.winner.name+' WINS'; el.style.color=g.winner.c1; el.style.textShadow=`0 0 40px ${g.winner.c1}`;}
  else {el.textContent='DOUBLE K.O.'; el.style.color='#e2e8f0'; el.style.textShadow='none';}
  $('#endStats').innerHTML=statsHTML(g);
  if(!g.recorded){g.recorded=true; g.progLine=recordResult(g);}   // after a Second Wind the end screen keeps the first result
  $('#eProg').innerHTML=g.progLine||''; $('#eProg').classList.toggle('hidden',!g.progLine);
  $('#end').querySelector('p').textContent='K.O.';
  $('#end').classList.remove('hidden');
}
function setPause(p){
  if(state!=='game'||!game||game.over&&game.endShown) return;
  joyClear();
  if(p) Ads.gameplayStop(); else if(game.countdown<=0&&!game.over) Ads.gameplayStart();
  game.paused=p; $('#pause').classList.toggle('hidden',!p);
}

// Second Wind (opt-in rewarded ad on the end screen): the KO'd human spinner is rebuilt where it fell with half its HP and plates,
// and the round resumes after a short countdown. Once per match.
function secondWind(){
  const g=game, f=g&&g.fighters.find(x=>x.ctrl==='human'); if(!f||f.alive||g.secondUsed) return;
  g.secondUsed=true;
  if(g.recorded){g.recorded=false; prog.played=Math.max(0,prog.played-1);}   // the loss is undone: the real result is decided by the comeback
  g.dying=g.dying.filter(d=>d.f!==f); f.dying=false; f.dyU=0; f.alive=true;
  f.hp=f.hpLag=Math.round(f.maxHp*.5); f.lastStand=false; f.flash=1; f.stallT=0; f.launchT=0;
  const half=Math.ceil(f.parts.length/2); f.parts.forEach((p,i)=>{if(i<half){p.alive=true; p.dmg=Math.min(p.dmg,.3); p.tt=0;}});
  f._pk=-1;   // redraw the HUD's plate pips
  const dc=Math.hypot(f.x,f.y), lim=R*.6; if(dc>lim){f.x*=lim/dc; f.y*=lim/dc;}
  f.vx=f.vy=0; f.spin=f.baseSpin();
  makeProxy(g,f);
  g.over=false; g.winner=null; g.endShown=false; g.endT=0; g.finalK=0; g.idleT=0; g.slowT=0; g.countdown=1.5;
  $('#end').classList.add('hidden');
  for(let i=0;i<40;i++){const a=rand(0,TAU),sp=rand(120,380); addSpark(g,f.x,f.y,Math.cos(a)*sp,Math.sin(a)*sp,rand(.3,.6),Math.random()<.5?'#ffd166':f.c2,rand(1.2,2.6));}
  addRing(g,f.x,f.y,f.r,f.r*5,.6,'#ffd166',5); addText(g,f.x,f.y-f.r-26,'SECOND WIND!','#ffd166',24);
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
    g.countdown-=SIM_DT; if(g.countdown<=0){g.fightT=.9; Ads.gameplayStart();}
    for(const f of g.fighters){f.t+=dt; f.angle+=f.spin*dt;}
  } else {
    g.fightT=Math.max(0,g.fightT-SIM_DT);
    for(const f of g.fighters) if(f.alive) f.tickReal(dt,g);   // real-time spinner logic (Clockwork's clock): never dilated
    updateDilation(g);   // a clock step may have just started or ended Overdrive
    stepSim(dt/2,g); stepSim(dt/2,g);
    updateDying(g,dt);
    if(g.A.step) g.A.step(g,g.as,dt);   // arena machinery (timers, moving parts)
    if(!g.over) g.mt+=SIM_DT;
    else if(g.winner&&g.winner.alive&&!g.dying.length&&g.endT>1.3) g.winner.victory(g,dt,g.endT-1.3);   // victory flourish (visual only)
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
    for(const f of g.fighters) SFX.spin(f.idx,f.id,f.spin/f.baseSpin()*Math.max(.2,f.ts)*f.spinPitch(),clamp(f.x/R,-1,1),f.alive||f.dying,clamp((1-f.hp/f.maxHp-.2)/.8,0,1),f.sputT>0);   // last argument: the motor is sputtering, so the hum drops out with it
  }
  updateCam(g,rdt);
  if(g.endShown) g.finalK=Math.min(1,g.finalK+rdt/1.8);   // after the end card: the camera slowly pulls back over the wreck
  // heartbeat urgency 0..1: rises as a fighter in Last Stand drops from 20% HP toward 0. Silent once the match is decided.
  let hb=0;
  if(!g.over) for(const f of g.fighters) if(f.alive&&f.lastStand) hb=Math.max(hb,clamp(1-f.hp/(f.maxHp*LAST_STAND),0,1)*.85+.15);
  SFX.heartbeat(hb);
  g.vigK+=(hb-g.vigK)*Math.min(1,rdt*4);                       // Last Stand vignette eases in and out with the heartbeat
  while(g.dents.length&&g.time-g.dents[0].t0>DENT_COOL) g.dents.shift();   // dents whose glow has faded (the permanent nick stays on the floor canvas)
  if(g.A.vis) g.A.vis(g,g.as,rdt);                             // arena ambience (steam, sparks): visual only
  arenaStep(g,rdt);                                            // floor-panel cache refresh and rim/cable electrical discharges (visual only)
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
/* ---- Mode and picks. PLAY ('1p'): you against the CPU (its spinner is random unless you choose it). 2 PLAYERS ('2p'): both human,
        P1 picks then P2. WATCH ('cpu'): CPU against CPU, picked the same way as 2 players.
        The last picks are remembered, so a returning player can go straight to FIGHT. ---- */
let mode='1p', cpuRandom=true, matchArena=null;
let activeSlot=0;   // which slot the next roster pick goes to
const PICKS_KEY='spin.picks';
function savePicks(){try{localStorage.setItem(PICKS_KEY,JSON.stringify({p0:sel[0].fighter,p1:sel[1].fighter,cpuRandom,arena:selArena}));}catch{}}
function loadPicks(){
  try{const p=JSON.parse(localStorage.getItem(PICKS_KEY)); if(!p) return;
    if(DEFS[p.p0]) sel[0].fighter=p.p0; if(DEFS[p.p1]) sel[1].fighter=p.p1; cpuRandom=p.cpuRandom!==false;
    if(p.arena==='random'||(typeof ARENAS!=='undefined'&&ARENAS[p.arena])) selArena=p.arena;}catch{}
}
/* ---- PROGRESS: wins per spinner and which spinners you have beaten (vs the CPU). Saved in this browser only. ---- */
const PROG_KEY='spin.progress';
let prog={played:0,wins:{},beaten:{}};
try{const p=JSON.parse(localStorage.getItem(PROG_KEY)); if(p) prog={played:p.played|0,wins:p.wins||{},beaten:p.beaten||{}};}catch{}
const saveProg=()=>{try{localStorage.setItem(PROG_KEY,JSON.stringify(prog));}catch{}};
const beatenCount=()=>Object.keys(DEFS).filter(id=>prog.beaten[id]).length;
// called once per finished match; returns a line for the end screen (or '')
function recordResult(g){
  const humans=g.fighters.filter(f=>f.ctrl==='human'); if(!humans.length) return '';   // Watch mode counts for nothing
  prog.played++;
  let line='';
  const me=humans.length===1?humans[0]:null, cpu=g.fighters.find(f=>f.ctrl==='cpu');
  if(me&&cpu&&g.winner===me){
    prog.wins[me.id]=(prog.wins[me.id]||0)+1;
    const total=Object.keys(DEFS).length;
    if(!prog.beaten[cpu.id]){prog.beaten[cpu.id]=true; const n=beatenCount();
      line=n>=total?`&#127942; YOU BEAT ALL ${total} SPINNERS! CHAMPION!`:`NEW! YOU BEAT ${cpu.name.toUpperCase()} &middot; ${n}/${total} SPINNERS BEATEN`;}
    else line=`${me.name.toUpperCase()} WINS: ${prog.wins[me.id]}`;
  }
  saveProg(); return line;
}
// before the first key press of a match on a keyboard device: how to steer. For the first matches ever, also the goal.
function drawKeyHint(c,g){
  if(!g||g.over||!g.fighters.some(f=>f.ctrl==='human')) return;
  const y=H-Math.max(40,H*.08);
  if(!TOUCH&&!g.keyed){
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].some(k=>keys[k])) g.keyed=true;
    else{
      const a=.55+.35*Math.sin(g.time*4), two=g.fighters.every(f=>f.ctrl==='human');
      c.textAlign='center'; c.textBaseline='middle'; c.font='800 16px ui-sans-serif,system-ui'; c.fillStyle=`rgba(255,255,255,${a})`;
      c.fillText(two?'PLAYER 1: W A S D   \u00b7   PLAYER 2: ARROW KEYS':'STEER WITH W A S D',W/2,y);
    }
  }
  if(prog.played<3&&g.mt<9){   // a new player's first matches: what the point is
    const a=clamp(Math.min(g.mt+3,9-g.mt)/1.2,0,1)*.9;
    c.textAlign='center'; c.textBaseline='middle'; c.font='800 15px ui-sans-serif,system-ui'; c.fillStyle=`rgba(255,200,140,${a})`;
    if(W<560){c.fillText('HARD HITS KNOCK THEIR PLATES OFF',W/2,y-26); c.fillText('RAM YOUR RIVAL!',W/2,y-48);} else c.fillText('RAM YOUR RIVAL! HARD HITS KNOCK THEIR PLATES OFF',W/2,y-28);
  }
}
function setMode(m){
  mode=m; sel[0].ctrl=m==='cpu'?'cpu':'human'; sel[1].ctrl=m==='2p'?'human':'cpu'; activeSlot=0;
  setScreen('select');
}
const randomSlot=i=>mode==='1p'&&i===1&&cpuRandom;
function slotHTML(i){
  const s=sel[i], d=DEFS[s.fighter], rnd=randomSlot(i), on=activeSlot===i;
  const who=mode==='1p'?(i?'CPU':'YOU'):mode==='cpu'?'CPU '+(i+1):'PLAYER '+(i+1);
  const accent=i?'text-sky-300':'text-orange-300';
  const ring=on?(i?'border-sky-400/80 shadow-[0_0_24px_rgba(56,189,248,.3)] bg-sky-400/5':'border-orange-400/80 shadow-[0_0_24px_rgba(251,146,60,.3)] bg-orange-400/5'):'border-white/10 bg-white/5';
  const hint=on?(mode==='2p'||i===0?'PICKING':'PICK THE CPU'):(mode==='1p'&&i===1?'TAP TO CHOOSE':'TAP TO CHANGE');
  return `
  <button data-act="slot" data-i="${i}" class="rounded-2xl border ${ring} p-2 md:p-4 flex flex-col items-center gap-1 transition min-w-0">
    <span class="text-[10px] md:text-xs tracking-[.3em] font-black ${accent}">${who}</span>
    <canvas data-prev="${i}" width="200" height="200" class="w-20 h-20 md:w-32 md:h-32 rounded-xl bg-black/30"></canvas>
    <span class="font-extrabold text-base md:text-xl leading-tight">${rnd?'Random':d.name}</span>
    <span class="text-[10px] md:text-[11px] text-slate-400 text-center leading-tight">${rnd?'A surprise every match':d.sub}</span>
    <span class="text-[9px] md:text-[10px] tracking-[.25em] font-bold ${on?accent:'text-slate-500'} mt-1">${hint}</span>
  </button>`;
}
// roster: one tile per spinner in DEFS. Adding a spinner to DEFS adds a tile, no menu changes needed.
function rosterHTML(){
  const tiles=Object.values(DEFS).map(d=>{
    const picks=[0,1].filter(i=>sel[i].fighter===d.id&&!randomSlot(i));
    const badges=picks.map(i=>`<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${i?'bg-sky-400 text-black':'bg-orange-400 text-black'}">${mode==='1p'?(i?'CPU':'YOU'):(mode==='cpu'?'C':'P')+(i+1)}</span>`).join('');
    const ring=picks.includes(activeSlot)?'border-white/70 bg-white/15':picks.length?'border-white/30 bg-white/10':'border-white/10 bg-white/5 hover:bg-white/10';
    return `
    <button data-act="pick" data-v="${d.id}" data-sfx="select" class="relative flex flex-col items-center rounded-2xl border ${ring} p-2 md:p-3 transition hover:scale-[1.03]">
      <span class="absolute top-1.5 right-1.5 flex gap-1">${badges}</span>
      <canvas data-roster="${d.id}" width="120" height="120" class="w-14 h-14 md:w-20 md:h-20 rounded-xl bg-black/30"></canvas>
      <div class="mt-1 text-xs md:text-sm font-extrabold">${d.name}</div>
      ${mode==='1p'?`<div class="h-3 md:h-4 text-[9px] md:text-[10px] font-bold tracking-wider text-emerald-300">${prog.beaten[d.id]?'&#10003; BEATEN':''}</div>`:''}
    </button>`;
  });
  if(mode==='1p'&&activeSlot===1) tiles.push(`
    <button data-act="pick" data-v="random" data-sfx="select" class="flex flex-col items-center justify-center rounded-2xl border ${cpuRandom?'border-white/70 bg-white/15':'border-white/10 bg-white/5 hover:bg-white/10'} p-2 md:p-3 transition hover:scale-[1.03]">
      <div class="w-14 h-14 md:w-20 md:h-20 rounded-xl bg-black/30 flex items-center justify-center text-3xl md:text-4xl font-black text-slate-300">?</div>
      <div class="mt-1 text-xs md:text-sm font-extrabold">Random</div>
    </button>`);
  return tiles.join('');
}
function renderCards(){
  applyDefaults();
  $('#selTitle').textContent=mode==='1p'?(activeSlot?'PICK THE CPU':'PICK YOUR SPINNER'):mode==='cpu'?'PICK CPU '+(activeSlot+1):'PLAYER '+(activeSlot+1)+', PICK';
  $('#cards').innerHTML=slotHTML(0)+'<span class="text-2xl md:text-4xl font-black italic text-slate-400 px-1">VS</span>'+slotHTML(1);
  const d=DEFS[sel[activeSlot].fighter];
  $('#selDesc').innerHTML=randomSlot(activeSlot)?'Every match, the CPU picks a different spinner.':d.desc;
  $('#roster').innerHTML=rosterHTML();
  const tot=Object.keys(DEFS).length, nb=beatenCount();
  $('#selProg').innerHTML=mode==='1p'?(nb>=tot?`&#127942; CHAMPION: YOU HAVE BEATEN ALL ${tot} SPINNERS`:`BEAT EVERY SPINNER: ${nb}/${tot}`):'';
  $('#arenas').innerHTML=arenaPickHTML()+`
    <button data-act="arena" data-v="random" data-sfx="select" class="flex flex-col items-center justify-center rounded-2xl border ${selArena==='random'?'border-orange-300/80 bg-white/15':'border-white/10 bg-white/5 hover:bg-white/10'} p-2 transition">
      <div class="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-black/30 flex items-center justify-center text-2xl font-black text-slate-300">?</div>
      <div class="mt-1 text-xs md:text-sm font-extrabold">Random</div>
    </button>`;
  $('#arenaDesc').textContent=selArena==='random'?'A different arena every match.':(ARENAS[selArena]||ARENAS.classic).desc;
}
$('#select').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]'); if(!b) return;
  const act=b.dataset.act;
  if(act==='pick'){
    if(mode==='1p'){
      if(activeSlot===1){cpuRandom=b.dataset.v==='random'; if(!cpuRandom) sel[1].fighter=b.dataset.v; activeSlot=0;}   // chose the CPU: back to your own pick
      else if(b.dataset.v!=='random') sel[0].fighter=b.dataset.v;
    } else {sel[activeSlot].fighter=b.dataset.v; activeSlot=1-activeSlot;}   // two players or two CPUs: fill this one, then the other
    savePicks(); renderCards();
  }
  else if(act==='slot'){activeSlot=+b.dataset.i; renderCards();}
  else if(act==='arena'){selArena=b.dataset.v; savePicks(); renderCards();}
});
// FIGHT from the select screen: settle any random picks for this match (a rematch keeps them)
function beginMatch(){
  const ids=Object.keys(DEFS);
  if(mode==='1p'&&cpuRandom){const pool=ids.filter(id=>id!==sel[0].fighter); sel[1].fighter=pool[(Math.random()*pool.length)|0];}
  const ars=ARENA_LIST.map(a=>a.id);
  matchArena=selArena==='random'?ars[(Math.random()*ars.length)|0]:selArena;
  startGame();
}
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
    const i=+cn.dataset.prev, s=sel[i], c=cn.getContext('2d');
    if(randomSlot(i)){   // the random CPU: a dark spinner shape with a pulsing question mark
      c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,200,200); c.fillStyle='#14152a'; c.fillRect(0,0,200,200);
      c.save(); c.translate(100,100); c.rotate(t*2); c.strokeStyle='rgba(148,163,184,.35)'; c.lineWidth=6; c.setLineDash([18,14]); c.beginPath(); c.arc(0,0,62,0,TAU); c.stroke(); c.restore();
      c.fillStyle=`rgba(203,213,225,${.65+.35*Math.sin(t*3)})`; c.font='900 84px ui-sans-serif,system-ui'; c.textAlign='center'; c.textBaseline='middle'; c.fillText('?',100,104);
      return;
    }
    drawPreview(c,200,DEFS[s.fighter],s.c1,s.c2,t);
  });
  document.querySelectorAll('canvas[data-roster]').forEach(cn=>{
    const d=DEFS[cn.dataset.roster], p=SIG[d.id].main;
    drawPreview(cn.getContext('2d'),120,d,p[0],p[1],t);
  });
  document.querySelectorAll('canvas[data-arena]').forEach(cn=>arenaPreview(cn.getContext('2d'),cn.width,ARENAS[cn.dataset.arena],t));
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

// very first visit: PLAY drops straight into a match (Big Boy vs a random CPU, Classic arena); after that it opens the select screen
$('#btnPlay').onclick=()=>{
  let fresh=prog.played===0; try{if(localStorage.getItem(PICKS_KEY)!==null) fresh=false;}catch{}
  if(!fresh){setMode('1p'); return;}
  mode='1p'; sel[0].ctrl='human'; sel[1].ctrl='cpu'; activeSlot=0; sel[0].fighter='bigboy'; cpuRandom=true; selArena='classic';
  savePicks(); beginMatch();
};
$('#btn2p').onclick=()=>setMode('2p');
$('#btnWatch').onclick=()=>setMode('cpu');
$('#btnHow').onclick=()=>$('#how').classList.toggle('hidden');
$('#btnBack').onclick=()=>setScreen('menu');
$('#btnFight').onclick=beginMatch;
$('#btnPause').onclick=()=>setPause(true);
$('#btnMute').onclick=()=>{SFX.unlock(); SFX.toggleMute(); syncMute();};
syncMute();
$('#pResume').onclick=()=>setPause(false);
// leaving a match is a natural break: an ad may play first (Ads decides; nothing happens off Poki), then the next screen
const afterAd=fn=>()=>Ads.commercial().then(fn);
$('#pRestart').onclick=afterAd(startGame);
$('#pSelect').onclick=afterAd(()=>setScreen('select'));
$('#pMenu').onclick=afterAd(()=>setScreen('menu'));
$('#eAgain').onclick=afterAd(startGame);
$('#eSelect').onclick=afterAd(()=>setScreen('select'));
$('#eMenu').onclick=afterAd(()=>setScreen('menu'));
$('#eWind').onclick=()=>Ads.rewarded().then(ok=>{if(ok) secondWind();});
loadPicks(); Ads.loaded();

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
