/* =====================================================================
   PARADOX: counterattacker. Two rings spin against each other: the outer ring (even plates) carries its hits, the inner ring
   (odd plates) powers Reversal. Every few seconds, after a visible tell, it braces in Reversal for a moment: the inner ring
   whips round, it takes much less damage and is hard to shove, and the force of any ram it takes is stored. Its next hit
   releases that stored momentum as extra damage and a launch. Knock plates off a ring and that ring's job gets weaker; with both
   rings badly hurt the rings fall out of sync and Reversal recharges slower.
   ===================================================================== */
const PX_CD = 4.5;           // seconds between Reversals
const PX_TELL = .45;         // the warning before it braces
const PX_ON = 2;           // how long Reversal lasts
const PX_ABSORB = .55;       // damage it shrugs off in Reversal (with a whole inner ring)
const PX_MASS = 1.8;         // how much harder it is to shove in Reversal
const PX_STORE_K = .04;      // stored momentum per px/s of a ram taken in Reversal (with a whole inner ring)
const PX_STORE_MAX = 24;     // most extra damage one release can carry
const PX_KEEP = 4;           // seconds stored momentum keeps before it starts to fade
const PX_KICK = 12;          // px/s of extra knockback per stored point on release
const PX_ORANGE = '#ffb347', PX_BLUE = '#5ab0ff';

const PX_OUT=[[-.2,.76],[-.15,1],[.15,1],[.2,.76]], PX_IN=[[-.17,.44],[-.13,.66],[.13,.66],[.17,.44]];
const pxOut=r=>polar(PX_OUT,r), pxIn=r=>polar(PX_IN,r);
function drawPxOut(c,r,c1){polyPath(c,pxOut(r)); c.fillStyle='#3d3a44'; c.fill(); c.lineWidth=r*.04; c.lineJoin='round'; c.strokeStyle='#0d0c12'; c.stroke();
  c.fillStyle=c1; polyPath(c,polar([[-.11,.93],[.11,.93],[.09,.85],[-.09,.85]],r)); c.fill();}
function drawPxIn(c,r,c2){polyPath(c,pxIn(r)); c.fillStyle='#2c3648'; c.fill(); c.lineWidth=r*.035; c.strokeStyle='#0a0d14'; c.stroke();
  c.fillStyle=c2; c.fillRect(r*.5,-r*.035,r*.12,r*.07);}
function drawParadox(c,r,c1,c2,o){
  const parts=o.parts, N=parts?parts.length:12, t=o.t||0, s=o.px||{st:'idle',k:0,store:0,oa:0,ia:0}, oK=o.oK==null?1:o.oK, iK=o.iK==null?1:o.iK;
  const lit=s.st==='tell'?(Math.sin(t*40)>0?1:.3):s.st==='on'?1:0;
  c.fillStyle='#14131a'; c.beginPath(); c.arc(0,0,r*.9,0,TAU); c.fill();
  // OUTER RING (turns with the body; slowed a little in Reversal)
  c.save(); c.rotate(s.oa||0);
  if(oK<1) c.translate(Math.sin(t*13)*r*.035*(1-oK),Math.cos(t*11)*r*.035*(1-oK));   // a hurt ring wobbles off its axis
  c.strokeStyle='#26242e'; c.lineWidth=r*.1; c.beginPath(); c.arc(0,0,r*.82,0,TAU); c.stroke();
  for(let i=0;i<N;i+=2){c.save(); c.rotate(i/N*TAU);
    if(!parts||parts[i].alive){const p=parts&&parts[i]; partPose(c,r,p); drawPxOut(c,r,c1); partWear(c,r,p,pxOut(r));}
    else drawSocket(c,r,parts[i],{r0:.72,r1:.97,w:.16,kind:'spar',glow:PX_ORANGE});
    c.restore();}
  if(lit){c.save(); c.globalCompositeOperation='lighter'; c.strokeStyle=rgba(PX_ORANGE,.55*lit); c.lineWidth=r*.05; c.beginPath(); c.arc(0,0,r*.82,0,TAU); c.stroke(); c.restore();}
  c.restore();
  // INNER RING (counter-rotates on its own motor)
  c.save(); c.rotate(-(o.angle||0)+(s.ia||0));
  if(iK<1) c.translate(Math.cos(t*15)*r*.03*(1-iK),Math.sin(t*12)*r*.03*(1-iK));
  c.strokeStyle='#1e2533'; c.lineWidth=r*.08; c.beginPath(); c.arc(0,0,r*.55,0,TAU); c.stroke();
  for(let i=1;i<N;i+=2){c.save(); c.rotate(i/N*TAU);
    if(!parts||parts[i].alive){const p=parts&&parts[i]; drawPxIn(c,r,c2); partWear(c,r,p,pxIn(r));}
    else drawSocket(c,r,parts[i],{r0:.42,r1:.66,w:.12,kind:'coil',glow:PX_BLUE});
    c.restore();}
  if(lit){c.save(); c.globalCompositeOperation='lighter'; c.strokeStyle=rgba(PX_BLUE,.65*lit); c.lineWidth=r*.05; c.beginPath(); c.arc(0,0,r*.55,0,TAU); c.stroke(); c.restore();}
  c.restore();
  // arcs crackling between the two rings while it reverses
  if(s.st==='on'){c.save(); c.globalCompositeOperation='lighter'; c.lineWidth=r*.025;
    for(let k=0;k<3;k++){const a=t*7+k*2.1+Math.sin(t*31+k)*.4; c.strokeStyle=k%2?PX_BLUE:PX_ORANGE; c.beginPath(); c.moveTo(Math.cos(a)*r*.58,Math.sin(a)*r*.58);
      for(let q=1;q<=3;q++){const rr=r*(.58+.2*q/3), aa=a+(Math.random()-.5)*.25; c.lineTo(Math.cos(aa)*rr,Math.sin(aa)*rr);} c.stroke();}
    c.restore();}
  // the core: it glows with stored momentum
  const g=c.createRadialGradient(-r*.1,-r*.1,1,0,0,r*.36); g.addColorStop(0,shade(c2,.2)); g.addColorStop(1,shade(c1,-.5));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.34,0,TAU); c.fill(); c.lineWidth=r*.035; c.strokeStyle='#0d0c12'; c.stroke();
  gearPath(c,8,r*.12,r*.18); c.fillStyle='#8a8796'; c.fill();
  const st=(s.store||0)/PX_STORE_MAX;
  c.save(); c.shadowColor='#ffffff'; c.shadowBlur=4+st*18; c.fillStyle=st>.05?'#ffffff':c2; c.beginPath(); c.arc(0,0,r*(.07+.08*st),0,TAU); c.fill(); c.restore();
}

defineSpinner({
  def:{
    id:'paradox', mat:'iron', name:'Paradox', r:36, m:3, hp:170, parts:12, kind:'pxring', prev:1.7,
    sub:'Counterattacker &middot; two rings',
    desc:'Two rings spinning opposite ways, which is either genius or a mistake. Every few seconds it flips into Reversal: hit it then and it barely flinches, keeps your force, and throws it back at you. Break a ring and the trick gets wobbly.',
    stats:{Speed:60, Power:65, Health:80}
  },
  sig:{main:['#f59e0b','#38bdf8'], rival:['#a855f7','#22c55e']},
  draw(c,r,c1,c2,o){drawParadox(c,r,c1,c2,o);},
  partPts:r=>pxOut(r),
  piece:{draw:(c,d)=>((d.idx||0)%2?drawPxIn(c,d.r,d.c2):drawPxOut(c,d.r,d.c1)), col:d=>(d.idx||0)%2?'#2c3648':'#3d3a44'},
  preview:{spin:7, extra:t=>{const ph=(t%4); return {px:{st:ph>2.8?'on':ph>2.4?'tell':'idle',store:ph>2.8?12:0,oa:0,ia:t*14}};}},
  bg:{pos:t=>{const a=t*.6+4; return [Math.cos(a*1.1)*R*.5,Math.sin(a)*R*.55];}, spin:10, extra:t=>({px:{st:'idle',store:0,oa:0,ia:t*16}})},
  meterBg:'linear-gradient(90deg,#f59e0b,#38bdf8)',
  methods:class{
    init(){this.px={st:'idle',cd:PX_CD*.6,t:0,store:0,storeNew:0,keep:0,oa:0,ia:0}; this.m0=this.m; this.pdir=Math.random()<.5?1:-1;}
    // each ring's health: the share of its plates still on
    ringK(odd){let a=0,n=0; for(let i=odd?1:0;i<this.parts.length;i+=2){n++; if(this.parts[i].alive) a++;} return n?a/n:1;}
    maxSpeed(){return 235;}
    accel(){return 720;}
    dragK(){return this.px.st==='on'?1.6:.85;}
    baseSpin(){return 15*(.6+.2*this.ringK(0)+.2*this.ringK(1))*(this.px.st==='on'?1.3:1);}
    contactDamage(impact){return impact*.05*(.5+.5*this.ringK(0))+this.px.store;}   // the outer ring carries the hit; stored momentum adds to it
    takenMul(){return this.px.st==='on'?1-PX_ABSORB*this.ringK(1):1;}
    hitCdTime(){return .35;}
    reach(){return 90;}
    charges(){return this.px.store>3;}
    danger(){return this.px.store>3?.8:(this.px.st==='on'?.5:0);}
    drawState(){return {px:this.px,oK:this.ringK(0),iK:this.ringK(1)};}
    onClash(closing,vn){   // a ram taken in Reversal is banked (it only counts from the next hit on)
      if(this.px.st==='on'&&closing) this.px.storeNew+=vn*PX_STORE_K*this.ringK(1);
    }
    onHitDealt(g,dmg){   // the release: stored momentum throws the rival back
      const s=this.px; if(s.store<2) return;
      const o=g.fighters.find(f=>f!==this&&f.alive);
      if(o){const dx=o.x-this.x, dy=o.y-this.y, l=Math.hypot(dx,dy)||1, kick=120+s.store*PX_KICK;
        o.vx+=dx/l*kick/o.ts; o.vy+=dy/l*kick/o.ts; if(o.ts>=1){o.launchT=LAUNCH_T*.7; o.wallCd=0;}
        const x=this.x+dx/l*this.r, y=this.y+dy/l*this.r;
        addRing(g,x,y,6,60+s.store*3,.35,'#ffffff',4); addShock(g,x,y,90+s.store*4,PX_BLUE,.4);
        for(let i=0;i<24;i++){const a=rand(0,TAU),sp=rand(150,420); addSpark(g,x,y,Math.cos(a)*sp,Math.sin(a)*sp,rand(.2,.45),Math.random()<.5?PX_ORANGE:PX_BLUE,rand(1.2,2.6));}
        addText(g,this.x,this.y-this.r-24,'REVERSAL!','#ffffff',18);
        SFX.ricochet(500+s.store*20,120,0); g.shake=Math.max(g.shake,6);
      }
      s.store=0;
    }
    think(dt,g){
      const s=this.px, sync=this.ringK(0)+this.ringK(1)>=1;   // both rings badly hurt: out of sync, Reversal recharges slower
      s.t-=dt;
      if(s.storeNew>0){s.store=Math.min(PX_STORE_MAX,s.store+s.storeNew); s.storeNew=0; s.keep=PX_KEEP;}
      if(s.store>0){s.keep-=dt; if(s.keep<=0) s.store=Math.max(0,s.store-dt*4);}
      if(s.st==='idle'){s.cd-=dt; if(s.cd<=0){s.st='tell'; s.t=PX_TELL;}}
      else if(s.st==='tell'){if(s.t<=0){s.st='on'; s.t=PX_ON; this.m=this.m0*PX_MASS; addRing(g,this.x,this.y,this.r,this.r*2,.3,PX_BLUE,3);}}
      else if(s.st==='on'&&s.t<=0){s.st='idle'; s.cd=PX_CD*(sync?1:1.5); this.m=this.m0;}
      // the rings' drawn angles: in Reversal the inner ring whips round and the outer one drags
      const sp=this.spin; s.ia+=sp*(s.st==='on'?2.4:.9)*dt; s.oa-=s.st==='on'?sp*.55*dt:0;
    }
    onKill(g){this.m=this.m0;}
    hud(lab,bar){
      const s=this.px;
      lab.textContent=s.st==='on'?'REVERSAL!':s.st==='tell'?'REVERSING...':s.store>1?'CHARGED +'+Math.round(s.store)+' DMG':'REVERSAL '+Math.max(0,s.cd).toFixed(1)+'s';
      bar.style.width=(s.st==='idle'?(1-Math.max(0,s.cd)/PX_CD)*100:100)+'%';
    }
    // counterattacker: hang back and circle while Reversal recharges, close in to bait as it comes up, brace in Reversal,
    // and go straight in to spend stored momentum. If nobody is fighting, it stops waiting.
    aiMove(o,dx,dy,d,dt,g){
      const s=this.px;
      if(s.store>3||g.idleT>3){const [lx,ly]=this.lead(o,.35); return this.steerTo(lx,ly,.45);}
      if(s.st==='tell') return [dx*.5,dy*.5];
      if(s.st==='on'){const [lx,ly]=this.lead(o,.3); return this.steerTo(lx,ly,.4);}   // in Reversal it wades in: every ram it takes is banked
      const want=s.cd<1.5?150:240, rad=clamp((d-want)/70,-1,1), dc=Math.hypot(this.x,this.y)||1;
      let vx=dx*rad-dy*.8*this.pdir, vy=dy*rad+dx*.8*this.pdir;
      if(dc>R*.7){vx-=this.x/dc*(dc-R*.7)/60; vy-=this.y/dc*(dc-R*.7)/60;}
      return [vx,vy];
    }
  }
});
