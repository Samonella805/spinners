/* =====================================================================
   WHIRL: light and quick. A gravity field drags rivals (and loose scrap) in and burns them.
   ===================================================================== */
const AURA = 160;       // gravity radius
const DEBRIS_PULL = 2600;   // px/s^2 the field applies to scraps at point-blank range
const DEBRIS_REACH = 1.5;   // scraps feel the field out to this multiple of the visible aura
const PULL = 520;       // pull force on rivals
const DOT_DPS = 125;    // max damage per second (rival right next to her)
function bladePath(c,r){
  c.beginPath(); c.moveTo(r*.25,-r*.12);
  c.quadraticCurveTo(r*.8,-r*.8,r*1.0,r*.1);
  c.quadraticCurveTo(r*.66,-r*.2,r*.25,r*.22); c.closePath();
}
function drawWhirl(c,r,c1,c2,parts){
  for(let i=0;i<3;i++){
    c.save(); c.rotate(i*TAU/3);
    if(!parts||parts[i].alive){
      const p=parts&&parts[i]; partPose(c,r,p);
      c.shadowColor=c2; c.shadowBlur=14; bladePath(c,r); c.fillStyle=c2; c.fill();
      c.shadowBlur=0; c.lineWidth=r*.045; c.lineJoin='round'; c.strokeStyle='#0d0e14'; c.stroke();
      partWear(c,r,p,cc=>bladePath(cc,r));
    } else drawSocket(c,r,parts[i],{r0:.55,r1:.84,w:.14,cy:-.2,kind:'spar',glow:c2});   // the snapped root pokes out past the hub
    c.restore();
  }
  const g=c.createRadialGradient(-r*.15,-r*.15,r*.05,0,0,r*.65);
  g.addColorStop(0,shade(c1,.4)); g.addColorStop(1,shade(c1,-.5));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.62,0,TAU); c.fill();
  c.lineWidth=r*.045; c.strokeStyle='#0d0e14'; c.stroke();
  c.strokeStyle=c2; c.lineWidth=r*.07; c.lineCap='round';
  for(let k=0;k<3;k++){ // spiral emblem
    c.beginPath();
    for(let s=0;s<=14;s++){const u=s/14,a=k*TAU/3+u*2.2,rr=r*(.1+.4*u); s?c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):c.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);}
    c.stroke();
  }
  c.save(); c.shadowColor=c2; c.shadowBlur=10; c.fillStyle='#ffffff'; c.beginPath(); c.arc(0,0,r*.09,0,TAU); c.fill(); c.restore();
}
function bladePts(r){
  const q=(p0,c,p1,t)=>{const u=1-t;return[u*u*p0[0]+2*u*t*c[0]+t*t*p1[0],u*u*p0[1]+2*u*t*c[1]+t*t*p1[1]];};
  const P0=[.25,-.12],C1=[.8,-.8],P1=[1,.1],C2=[.66,-.2],P2=[.25,.22], out=[];
  for(let i=0;i<=5;i++){out.push(q(P0,C1,P1,i/5));out.push(q(P1,C2,P2,i/5));}
  return out.map(p=>[p[0]*r,p[1]*r]);
}
function drawAura(c,w,t){
  const A=w.auraR(), a=.5+.5*w.pull;
  const g=c.createRadialGradient(w.x,w.y,w.r,w.x,w.y,A);
  g.addColorStop(0,rgba(w.c2,.05+.1*w.pull)); g.addColorStop(.85,rgba(w.c1,.12+.1*w.pull)); g.addColorStop(1,rgba(w.c1,0));
  c.fillStyle=g; c.beginPath(); c.arc(w.x,w.y,A,0,TAU); c.fill();
  c.save(); c.translate(w.x,w.y); c.rotate(t*1.4);
  c.strokeStyle=rgba(w.c2,.35*a+.1); c.lineWidth=2; c.setLineDash([10,14]);
  c.beginPath(); c.arc(0,0,A*.98,0,TAU); c.stroke();
  c.rotate(-t*2.6); c.setLineDash([4,18]); c.strokeStyle=rgba(w.c1,.5*a); c.beginPath(); c.arc(0,0,A*.7,0,TAU); c.stroke();
  c.restore();
}

defineSpinner({
  def:{
    id:'whirl', mat:'alloy', name:'Whirl', r:29, m:1.2, hp:110, parts:3, partY:-.2, kind:'blade', prev:2.3,
    sub:'Light &middot; gravity field',
    desc:'Quick and slippery. Her gravity field drags rivals in and burns them, and the closer they are the more it hurts. Touching her does nothing. Lose her blades and the field shrinks and weakens.',
    stats:{Speed:92, Power:65, Health:40}
  },
  sig:{main:['#7c4dff','#2ef2d0'], rival:['#ff3d8b','#ffe0ef']},
  draw(c,r,c1,c2,o){ drawWhirl(c,r,c1,c2,o.parts); },
  // a gyro rotor with three weights inside a stator ring, and a field coil that flickers once the machine is heavily damaged
  internals(c,r,o){
    const t=o.t||0, ga=o.ga||0, fl=o.tier>=3?(Math.sin(t*40+Math.sin(t*7)*3)>.1?1:.2):1, pu=(.6+.4*Math.sin(t*5))*fl;
    c.strokeStyle='#4b5160'; c.lineWidth=r*.06; c.beginPath(); c.arc(0,0,r*.5,0,TAU); c.stroke();
    c.save(); c.rotate(ga*1.5); c.fillStyle='#8892a6';
    for(let i=0;i<3;i++){c.rotate(TAU/3); c.fillRect(r*.05,-r*.02,r*.28,r*.04); c.beginPath(); c.arc(r*.34,0,r*.09,0,TAU); c.fill();}
    c.restore();
    c.lineWidth=Math.max(1,r*.03);
    for(let j=0;j<3;j++){c.strokeStyle=rgba(o.c2||'#2ef2d0',(.55-j*.12)*pu); c.beginPath(); c.arc(0,0,r*(.62+j*.09),ga*-.6+j,ga*-.6+j+2.2); c.stroke();}
  },
  partPts:r=>bladePts(r),
  piece:{
    draw:(c,d)=>{bladePath(c,d.r); c.fillStyle=d.c2; c.fill(); c.lineWidth=d.r*.045; c.lineJoin='round'; c.strokeStyle='#0d0e14'; c.stroke();},
    col:d=>d.c2
  },
  preview:{
    spin:20,
    under:(c,h,k,c2,t)=>{
      c.save(); c.translate(h,h); c.rotate(t*1.2); c.strokeStyle=rgba(c2,.4); c.lineWidth=2*k; c.setLineDash([8*k,10*k]);
      c.beginPath(); c.arc(0,0,92*k,0,TAU); c.stroke(); c.restore();
    }
  },
  bg:{pos:t=>{const b=t*.8; return [Math.cos(b+2)*R*.55,Math.sin(b*1.2+1)*R*.5];}, spin:22},
  methods:class{
    init(){this.orbit=Math.random()<.5?1:-1; this.orbitT=rand(2,4); this.pull=0; this.emitT=0;}
    auraR(){return AURA*(.62+.38*this.aliveFrac());}
    fieldPow(){return .45+.55*this.aliveFrac();}
    reach(){return this.auraR();}
    // victory (visual only): her field pulses, a ring collapsing into her and another flaring out
    victory(g,dt,u){
      this.vicT=(this.vicT||0)-dt;
      if(this.vicT>0) return;
      this.vicT=.75;
      addRing(g,this.x,this.y,this.auraR()*1.1,this.r,.55,this.c2,3);
      addRing(g,this.x,this.y,this.r,this.auraR()*1.3,.7,this.c1,4);
    }
    maxSpeed(){return 330;}
    accel(){return 1000;}
    dragK(){return 1.1;}
    baseSpin(){return 24;}
    contactDamage(){return 0;}   // Whirl does no damage by touch
    onClash(closing,vn){if(closing&&vn>45) this.orbit*=-1;}
    trail(dt,g){
      this.trailT-=dt;
      if(this.trailT<=0){
        this.trailT=.04;
        const a=rand(0,TAU);
        g.parts.push({k:'dot',x:this.x+Math.cos(a)*this.r,y:this.y+Math.sin(a)*this.r,vx:Math.cos(a+1.6)*60,vy:Math.sin(a+1.6)*60,life:.45,max:.45,col:this.c2,size:rand(1.5,2.5)});
      }
    }
    // visual only: the field generator misfires: the aura flickers (drawing only, the pull is untouched) and a blade throws sparks
    malfunction(g,dt,tier){
      this.auFl=Math.sin(this.t*43+Math.sin(this.t*9)*4)>(tier>=4?0:-.4)?1:.3;
      this.whT=(this.whT||0)-dt; if(this.whT>0) return;
      this.whT=rand(.4,1)/(tier-2);
      const a=rand(0,TAU);
      for(let i=0;i<4;i++){const d=a+rand(-.6,.6), s=rand(80,220); addSpark(g,this.x+Math.cos(a)*this.r,this.y+Math.sin(a)*this.r,Math.cos(d)*s,Math.sin(d)*s,rand(.15,.3),this.c2,rand(1,1.8));}
    }
    pileSource(){return [this.x,this.y,this.auraR()*DEBRIS_REACH];}   // settled scrap inside her field wakes up
    drawUnder(c,g,t){
      const w=this;
      c.save(); c.globalAlpha=w.auFl==null?1:w.auFl; drawAura(c,w,t); c.restore();   // the field gutters once she is failing (malfunction)
      const A=w.auraR();
      for(const v of g.fighters){   // beams to rivals inside the field
        if(v===w||!v.alive) continue;
        const d=Math.hypot(w.x-v.x,w.y-v.y); if(d>=A) continue;
        const touch=w.r+v.r, k=clamp(1-(d-touch)/(A-touch),0,1);
        c.save(); c.globalCompositeOperation='lighter';
        c.strokeStyle=rgba(w.c2,.25+.6*k); c.lineWidth=1.5+4.5*k; c.setLineDash([4,8]); c.lineDashOffset=t*60;
        c.beginPath(); c.moveTo(w.x,w.y); c.lineTo(v.x,v.y); c.stroke(); c.restore();
      }
    }
    hud(lab,bar){
      lab.textContent=this.pull>.05?'GRAVITY LOCKED ON':'GRAVITY FIELD';
      bar.style.width=(30+this.pull*70)+'%';
    }
    aiMove(o,dx,dy,d,dt){return this.aiWhirl(o,dx,dy,d,dt);}
    // her field also drags nearby debris
    physStep(g,dtIn){
      const w=this, pw=g.pw;
    const A=w.auraR()*DEBRIS_REACH, pw2=w.fieldPow(), dt=dtIn*w.ts;
    for(const b of pw.bodies){
      if(b.gd.state==='captured') continue;   // a scrap ring is not Whirl's to steal
      const dx=w.x-b.position.x, dy=w.y-b.position.y, d=Math.hypot(dx,dy);
      if(d<A&&d>w.r*.8){
        const k=1-d/A, s=DEBRIS_PULL*pw2*k*(.35+.65*k)*dt/VU/d; // pull, strongest up close
        const sw=s*.35;                                         // a little sideways swirl so scraps orbit, not just fall in
        if(b.isSleeping) Sleeping.set(b,false);
        const v=getVel(b), damp=1-.05*k;                        // field also eases the floor drag
        Body.setVelocity(b,{x:v.x/damp+dx*s-dy*sw,y:v.y/damp+dy*s+dx*sw});
      }
    }
    }
    // gravity field: the closer the rival, the harder it burns
    field(g,dtIn){
      const w=this;
    const dt=dtIn*w.ts;   // her field runs on her own (possibly dilated) clock
    const A=w.auraR(); let hit=false;
    for(const v of g.fighters){
      if(v===w||!v.alive) continue;
      const dx=w.x-v.x, dy=w.y-v.y, d=Math.hypot(dx,dy);
      if(d<A&&d>1){
        hit=true;
        const touch=w.r+v.r, k=clamp(1-(d-touch)/(A-touch),0,1), nx=dx/d, ny=dy/d;
        g.sizzle=Math.max(g.sizzle,k);
        const pull=PULL*(.3+.7*k)*(.6+.4*w.aliveFrac());
        v.vx+=nx*pull/v.m*dt; v.vy+=ny*pull/v.m*dt;
        const dmg=DOT_DPS*w.fieldPow()*(.06+.94*k*k)*dt;
        v.dotAcc+=dmg; v.dotT-=dt; v.dotSpark-=dt;
        if(v.dotSpark<=0){
          v.dotSpark=.1-.07*k;
          g.parts.push({k:'dot',x:v.x+rand(-v.r,v.r)*.8,y:v.y+rand(-v.r,v.r)*.8,vx:nx*90+rand(-30,30),vy:ny*90+rand(-30,30),life:.35,max:.35,col:w.c2,size:rand(2,3.5)});
        }
        if(v.dotT<=0&&v.dotAcc>=.5){
          addText(g,v.x+rand(-8,8),v.y-v.r-4,'-'+Math.max(1,Math.round(v.dotAcc)),w.c2,clamp(12+v.dotAcc*1.2,12,26));
          v.dotAcc=0; v.dotT=.5;
        }
        damage(g,v,dmg,true,null);
      }
    }
    w.pull+=((hit?1:0)-w.pull)*Math.min(1,dt*6);
    w.emitT-=dt;
    if(w.emitT<=0){
      w.emitT=.02;
      const a=rand(0,TAU), rr=A*rand(.7,1);
      g.parts.push({k:'dot',x:w.x+Math.cos(a)*rr,y:w.y+Math.sin(a)*rr,vx:-Math.cos(a)*170-Math.sin(a)*60,vy:-Math.sin(a)*170+Math.cos(a)*60,life:.7,max:.7,col:w.c2,size:rand(1,2.2)});
    }
    }
  // Whirl: circle the rival at close range so it stays inside her burning ring, sidestepping head-on slams.
  aiWhirl(o,dx,dy,d,dt){
    const A=this.auraR(), touch=this.r+o.r;
    const vt=-dy*(o.vx*o.ts-this.vx)+dx*(o.vy*o.ts-this.vy);   // rival's motion around us (along the CCW tangent)
    this.orbitT-=dt;
    if(this.orbitT<=0){this.orbit=Math.abs(vt)>60?Math.sign(vt):-this.orbit; this.orbitT=rand(2,4);}
    const [lx,ly]=this.lead(o,.3); let ux=lx-this.x, uy=ly-this.y; const ud=Math.hypot(ux,uy)||1; ux/=ud; uy/=ud;
    const closing=Math.max(0,-(o.vx*o.ts*dx+o.vy*o.ts*dy));
    const threat=clamp(closing/450+(o.charges()&&d<touch+130?o.danger()*.6:0),0,1);
    const slow=clamp(1-Math.hypot(o.vx*o.ts,o.vy*o.ts)/220,0,1);   // a slow or pinned rival can be held in the burn from closer in
    const rr=Math.min(Math.max(touch+34,A*.62)*(1+.35*threat)*(1-.12*slow*(1-threat)),A*.95);
    const rad=clamp((rr-ud)/50,-1,1);
    let wx=-ux*rad+(-uy)*this.orbit*.9, wy=-uy*rad+ux*this.orbit*.9;
    wx+=-uy*this.orbit*threat*.8; wy+=ux*this.orbit*threat*.8;   // sidestep a charge
    if(o.charges() && d<rr*1.15){const th=.4+o.danger()*1.2; wx-=dx*th; wy-=dy*th;}
    const dc=Math.hypot(this.x,this.y);
    if(dc>R*.72){const k=(dc-R*.72)/(R*.28)*2; wx-=this.x/dc*k; wy-=this.y/dc*k;}
    const l=Math.hypot(wx,wy)||1; return [wx/l,wy/l];
  }
  }
});
