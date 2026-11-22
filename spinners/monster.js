/* =====================================================================
   MONSTER: light and agile. Every bounce off the arena wall builds a Ricochet stack (up to 4) that raises his speed cap, acceleration
   and the damage of his next hit. The moment a hit lands he deals the boosted smash and every stack resets. Wall slams never hurt him.
   ===================================================================== */
const MO_MAX = 4;           // most Ricochet stacks
const MO_MIN_VN = 150;      // px/s into the wall a bounce needs to count as a stack (soft scrapes don't)
const MO_WALL_CD = .28;     // seconds between stacks, so one ricochet can't stack twice
const MO_SPEED = 275;       // base speed cap, and extra per stack
const MO_SPEED_STK = 42;
const MO_ACCEL = 1150;      // base acceleration, and the fraction added per stack
const MO_ACCEL_STK = .17;
const MO_DMG_STK = .4;      // fraction added to touch damage per stack (x2.6 at 4 stacks)
const MO_PITCH_STK = .12;   // spin sound pitch added per stack

function finPts(r){
  return [[.52,-.22],[.74,-.34],[1.02,-.14],[.88,-.04],[.98,.12],[.74,.1],[.56,.2]].map(p=>[p[0]*r,p[1]*r]);
}
function drawFin(c,r,i,c1,c2,k){
  polyPath(c,finPts(r)); c.fillStyle=i%2?'#363b4d':'#454b60'; c.fill();
  c.lineWidth=r*.04; c.lineJoin='round'; c.strokeStyle='#0d0e14'; c.stroke();
  c.strokeStyle=i%2?c2:c1; c.lineWidth=r*.055; c.lineCap='round';   // the bright leading edge
  c.beginPath(); c.moveTo(r*.74,-r*.34); c.lineTo(r*1.02,-r*.14); c.stroke();
  if(k>0){c.globalCompositeOperation='lighter'; polyPath(c,finPts(r)); c.fillStyle=rgba(c2,.22*k); c.fill(); c.globalCompositeOperation='source-over';}
}
function drawMonster(c,r,c1,c2,o){
  const m=o.mo||{k:0,st:0,fl:0}, parts=o.parts, N=6, k=m.k;
  for(let i=0;i<N;i++){
    c.save(); c.rotate(i/N*TAU);
    if(!parts||parts[i].alive){const p=parts&&parts[i]; partPose(c,r,p); drawFin(c,r,i,c1,c2,k); partWear(c,r,p,finPts(r));}
    else drawSocket(c,r,parts[i],{r0:.5,r1:.86,w:.15,kind:'piston'});   // shock-absorber pistons show where a fin was
    c.restore();
  }
  c.fillStyle='#14161f'; c.beginPath(); c.arc(0,0,r*.66,0,TAU); c.fill();
  c.lineWidth=r*.05; c.strokeStyle=c2; c.stroke();
  if(k>0||m.fl>0){   // the hull glows brighter with every stack, and flares on the bounce that adds one
    c.globalCompositeOperation='lighter'; c.strokeStyle=rgba(c2,clamp(.2+.55*k+.3*m.fl,0,1)); c.lineWidth=r*(.05+.06*k+.05*m.fl);
    c.beginPath(); c.arc(0,0,r*.7,0,TAU); c.stroke(); c.globalCompositeOperation='source-over';
  }
  const g=c.createRadialGradient(-r*.15,-r*.15,r*.04,0,0,r*.56);
  g.addColorStop(0,shade(c1,.45)); g.addColorStop(1,shade(c1,-.4));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.55,0,TAU); c.fill();
  c.lineWidth=r*.04; c.strokeStyle='#0d0e14'; c.stroke();
  // a zig-zag bounce path across the hub
  c.strokeStyle=c2; c.lineWidth=r*.07; c.lineCap='round'; c.lineJoin='round';
  c.beginPath(); c.moveTo(-r*.34,r*.2); c.lineTo(-r*.12,-r*.2); c.lineTo(r*.08,r*.2); c.lineTo(r*.3,-r*.2); c.stroke();
  for(let j=0;j<MO_MAX;j++){   // four pips on the hub rim: one lights per stack
    const a=j*TAU/MO_MAX+Math.PI/4, px=Math.cos(a)*r*.46, py=Math.sin(a)*r*.46, lit=j<m.st;
    c.fillStyle=lit?'#ffffff':'#0d0e14'; c.beginPath(); c.arc(px,py,r*.05,0,TAU); c.fill();
    if(lit){c.globalCompositeOperation='lighter'; c.fillStyle=rgba(c2,.7); c.beginPath(); c.arc(px,py,r*.09,0,TAU); c.fill(); c.globalCompositeOperation='source-over';}
  }
  c.fillStyle=m.st>=MO_MAX?'#ffffff':c2; c.beginPath(); c.arc(0,0,r*.07,0,TAU); c.fill();
}

defineSpinner({
  def:{
    id:'monster', mat:'spring', name:'Monster', r:30, m:1.6, hp:120, parts:6, kind:'fin', prev:2.2,
    sub:'Light &middot; ricochet frenzy',
    desc:'Fast, light and hard to pin down. Every bounce off the arena wall adds a Ricochet stack, up to four, boosting his speed, acceleration and the damage of his next hit. Wall slams never hurt him. The moment a hit lands, he deals the boosted smash and every stack resets.',
    stats:{Speed:88, Power:55, Health:50}
  },
  sig:{main:['#22d3a6','#ff5ea8'], rival:['#ffb020','#5b2bff']},
  draw(c,r,c1,c2,o){ drawMonster(c,r,c1,c2,o); },
  // four coil springs that compress and release around a hub; wound tighter by Ricochet stacks
  internals(c,r,o){
    const ga=o.ga||0, st=o.mo?o.mo.st:0, sn=(o.mo&&o.mo.sn)||0;   // sn: springs snapped by the malfunction
    c.strokeStyle='#4a4f5e'; c.lineWidth=r*.06; c.beginPath(); c.arc(0,0,r*.2,0,TAU); c.stroke();
    for(let i=0;i<4;i++){
      c.save(); c.rotate(i/4*TAU+.4);
      const comp=.5+.5*Math.sin(ga*1.4+i*1.6), x0=r*.2, x1=r*(.82-.22*comp-.04*st)*(i<sn?.5:1);   // a snapped spring hangs short
      c.strokeStyle='#c8ccd8'; c.lineWidth=Math.max(1,r*.045); c.lineJoin='round'; c.beginPath(); c.moveTo(x0,0);
      for(let j=1;j<=9;j++) c.lineTo(x0+(x1-x0)*j/9,j<9?(j%2?1:-1)*r*.07:0);
      c.stroke(); c.fillStyle='#585d6b'; c.fillRect(x1,-r*.1,r*.045,r*.2);
      c.restore();
    }
  },
  partPts:r=>finPts(r),
  piece:{draw:(c,d)=>drawFin(c,d.r,d.idx||0,d.c1,d.c2,0), col:()=>'#454b60'},
  preview:{spin:15, extra:t=>{const st=Math.round(2+2*Math.sin(t*1.3)); return {mo:{k:st/MO_MAX,st,fl:0}};}},
  bg:{pos:t=>{const a=t*.9; return [Math.cos(a)*R*.6,Math.sin(a*1.7)*R*.5];}, spin:16, extra:()=>({mo:{k:.5,st:2,fl:0}})},
  meterBg:'linear-gradient(90deg,#22d3a6,#ff5ea8)',
  methods:class{
    init(){this.mo={stk:0,cd:0,fx:0,fl:0,plan:null,planT:0,jink:1,jinkAmp:.4,jinkT:0,lunge:0,nsn:0,malT:rand(1,2)};}
    // visual only: an overstressed coil spring snaps (more of them as the damage worsens) and a cosmetic bit of it skitters away
    malfunction(g,dt,tier){
      const m=this.mo; m.malT-=dt; if(m.malT>0) return;
      m.malT=rand(1.4,3)/(tier-2);
      const a=this.angle+m.nsn/4*TAU+.4, x=this.x+Math.cos(a)*this.r*.6, y=this.y+Math.sin(a)*this.r*.6;
      if(m.nsn<tier-1) m.nsn++;   // tier 3: up to 2 snapped springs, tier 4: up to 3
      spawnCosm(g,[[-7,-1.3],[7,-1.3],[7,1.3],[-7,1.3]],x,y,rand(0,TAU),Math.cos(a)*rand(120,260)+this.vx*.4,Math.sin(a)*rand(120,260)+this.vy*.4,rand(-30,30),'#c8ccd8',.2);
      for(let i=0;i<5;i++) addSpark(g,x,y,rand(-150,150),rand(-150,150),rand(.12,.28),'#fff3c4',rand(1,1.8));
      SFX.tink(520,panAt(this.x));
      this.jvx+=Math.cos(a)*this.r*.8; this.jvy+=Math.sin(a)*this.r*.8;   // the snap kicks the body (draw offset only)
    }
    maxSpeed(){return MO_SPEED+MO_SPEED_STK*this.mo.stk;}
    accel(){return MO_ACCEL*(1+MO_ACCEL_STK*this.mo.stk);}
    dragK(){return .8;}
    baseSpin(){return 20;}
    spinPitch(){return 1+MO_PITCH_STK*this.mo.stk;}   // the spin sound climbs with every stack
    contactDamage(impact){return impact*.046*(1+MO_DMG_STK*this.mo.stk)*(.6+.4*this.aliveFrac());}   // .046 (was .04)
    reach(){return 110;}
    charges(){return this.mo.stk>=2;}   // rivals keep clear once he is wound up
    wallImmune(){return true;}          // his own ricochets (and launches into the wall) never cost him HP
    drawState(){return {mo:{k:this.mo.stk/MO_MAX,st:this.mo.stk,fl:this.mo.fl,sn:this.mo.nsn}};}
    // met the wall: a hard enough bounce is a stack. The effects are emitted next tick in think(), which has the game state.
    onWall(vn){
      const m=this.mo; if(vn<MO_MIN_VN||m.cd>0) return;
      m.cd=MO_WALL_CD;
      if(m.plan&&m.plan.strike) m.lunge=rand(1.1,1.6);   // the rebound was aimed at the rival: commit to the hit
      m.plan=null; m.planT=0;
      if(m.stk<MO_MAX){m.stk++; m.fx=1; m.fl=1;}
    }
    think(dt,g){
      const m=this.mo; m.cd=Math.max(0,m.cd-dt); m.fl=Math.max(0,m.fl-dt*3); m.lunge=Math.max(0,m.lunge-dt);
      if(!m.fx) return;
      m.fx=0;
      const hp=this.hitPt, a=hp?Math.atan2(hp.y-this.y,hp.x-this.x):Math.atan2(this.y,this.x);   // the surface he bounced off (the rim, or an arena obstacle)
      const wx=hp?hp.x:Math.cos(a)*(R-2), wy=hp?hp.y:Math.sin(a)*(R-2), col=m.stk>=MO_MAX?'#ffffff':this.c2;
      addRing(g,wx,wy,4,26+m.stk*10,.3,col,3);
      for(let i=0;i<5+m.stk*3;i++){
        const q=a+Math.PI+rand(-1.1,1.1), s=rand(120,260+m.stk*40);
        addSpark(g,wx,wy,Math.cos(q)*s,Math.sin(q)*s,rand(.15,.35),Math.random()<.5?col:this.c1,rand(1,2));
      }
      addText(g,this.x,this.y-this.r-8,'x'+m.stk,col,13+m.stk*2.5);
      SFX.stack(m.stk);
    }
    // a hit landed: the boosted damage has already been dealt, so bleed off the extra speed and reset every stack
    onHitDealt(g,dmg){
      const m=this.mo, s=m.stk;
      m.lunge=0; m.plan=null; m.planT=0; m.fl=0; m.stk=0; m.fx=0;
      const sp=Math.hypot(this.vx,this.vy), cap=this.maxSpeed()*1.25;
      if(sp>cap){this.vx*=cap/sp; this.vy*=cap/sp;}
      if(s>0){
        addRing(g,this.x,this.y,this.r,this.r+30+s*12,.3,'#ffffff',3);
        addText(g,this.x,this.y-this.r-26,s>=MO_MAX?'MAX SMASH!':'SMASH',s>=MO_MAX?'#ffffff':this.c2,15+s*3);
      }
    }
    trail(dt,g){
      const s=this.mo.stk; if(s<1) return;
      this.trailT-=dt; if(this.trailT>0) return;
      this.trailT=.032-.004*s;
      const sp=Math.hypot(this.vx,this.vy)||1, life=.28+.06*s;
      g.parts.push({k:'dot',x:this.x-this.vx/sp*this.r*.7+rand(-4,4),y:this.y-this.vy/sp*this.r*.7+rand(-4,4),vx:rand(-20,20),vy:rand(-20,20),
        life,max:life,col:s>=MO_MAX?'#ffffff':(Math.random()<.5?this.c1:this.c2),size:rand(2,3+s)});
      if(s>=MO_MAX&&Math.random()<.35) addSpark(g,this.x,this.y,-this.vx*.25+rand(-60,60),-this.vy*.25+rand(-60,60),rand(.15,.3),this.c2,rand(1,2));
    }
    hud(lab,bar){
      const s=this.mo.stk;
      lab.textContent=s?'RICOCHET  x'+s+'  +'+Math.round(s*MO_DMG_STK*100)+'% SMASH':'RICOCHET  BANK OFF THE WALL';
      bar.style.width=(s/MO_MAX*100)+'%';
    }
    // Erratic AI: he doesn't chase. He zig-zags between wall bank points picked by chance, preferring off-angle bounces that rebound toward
    // the rival. Once wound up (3+ stacks) he commits to a bank shot aimed at the rival, then lunges straight at them off that rebound.
    aiMove(o,dx,dy,d,dt){
      const m=this.mo; m.planT-=dt; m.jinkT-=dt;
      if(m.jinkT<=0){m.jinkT=rand(.35,.9); m.jink=Math.random()<.5?-1:1; m.jinkAmp=rand(.15,.6);}   // changes weave direction at random
      const sp=Math.hypot(this.vx,this.vy), fast=clamp(sp/(this.maxSpeed()*.8),0,1);
      if(m.lunge>0||(m.stk>=2&&d<this.r+o.r+80)){   // commit: aim at the rival, still weaving a little (less at speed, so the weave never bleeds momentum)
        const [lx,ly]=this.lead(o,.4), [sx,sy]=this.steerTo(lx,ly,.35);
        const w=m.jink*m.jinkAmp*.5*(1-.7*fast); return [sx-sy*w,sy+sx*w];
      }
      if(!m.plan||m.planT<=0){m.plan=this.moPlan(o); m.planT=rand(.6,1.2);}
      const p=m.plan; let tx=p.x-this.x, ty=p.y-this.y; const dist=Math.hypot(tx,ty)||1; tx/=dist; ty/=dist;
      if(dist<this.r*1.4){m.planT=0;}   // arrived without a counted bounce (a graze): pick another
      const w=m.jink*m.jinkAmp*clamp(dist/220,.15,1)*(1-.75*fast);   // the weave dies away as he reaches the wall, and when he is already moving fast
      return [tx-ty*w,ty+tx*w];
    }
    // Pick the next wall bank. He plans the moment a bounce lands (onWall clears the plan), so the plan starts from the rebound velocity:
    // half the candidates sit around where his current heading meets the wall, and anything that would make him turn back is rejected.
    // Banks therefore chain like billiard shots and he keeps his speed instead of braking to reverse. An off-angle approach
    // (about 50 degrees) whose rebound points at the rival still scores best.
    moPlan(o){
      const m=this.mo, strike=m.stk>=MO_MAX-1, Rc=R-this.r, [lx,ly]=this.lead(o,.35);
      const sp=Math.hypot(this.vx,this.vy), moving=sp>90, hx=moving?this.vx/sp:0, hy=moving?this.vy/sp:0;
      let thAhead=null;
      if(moving){   // where the current heading ray meets the wall
        const pb=this.x*hx+this.y*hy, disc=pb*pb-(this.x*this.x+this.y*this.y-Rc*Rc);
        if(disc>0){const s=-pb+Math.sqrt(disc); thAhead=Math.atan2(this.y+hy*s,this.x+hx*s);}
      }
      let best=null, bs=-9;
      for(let k=0;k<22;k++){
        const th=(thAhead!=null&&k%2===0)?thAhead+rand(-1.1,1.1):rand(0,TAU), nx=Math.cos(th), ny=Math.sin(th), wx=nx*Rc, wy=ny*Rc;
        let ux=wx-this.x, uy=wy-this.y; const ul=Math.hypot(ux,uy); if(ul<this.r*3) continue;
        ux/=ul; uy/=ul;
        const un=ux*nx+uy*ny; if(un<.3) continue;                 // heading into the wall, not skimming along it
        const hd=ux*hx+uy*hy;                                     // 1 = straight ahead of where he is already going, -1 = a U-turn
        if(moving&&hd<.2) continue;                               // never turn around for a bank
        const vx=ux-2*un*nx, vy=uy-2*un*ny;                       // rebound direction
        let ox=lx-wx, oy=ly-wy; const ol=Math.hypot(ox,oy)||1; ox/=ol; oy/=ol;
        const al=vx*ox+vy*oy;                                     // 1 = the rebound points straight at the rival
        const off=1-Math.abs(un-.64)/.64;                         // 1 at about 50 degrees incidence
        let sc=(strike?al*2.4:al*.7)+off*.8-ul/(R*2.2)*(strike?.2:.5)+hd*1.1*Math.min(1.2,sp/MO_SPEED)+rand(0,.4);
        sc-=arenaWallCost(th)*1.6;                                // arena: avoid banking off a bad stretch of rim (a gutter)
        if(sc>bs){bs=sc; best={x:wx,y:wy,strike:strike&&al>.55};}
      }
      return best||{x:o.x,y:o.y,strike:false};
    }
    // victory (visual only): a run of rising zings, each with a ring and a burst of sparks in his colours
    victory(g,dt,u){
      this.vicT=(this.vicT||0)-dt;
      if(this.vicT>0) return;
      this.vicT=.38; this.vicN=((this.vicN||0)%4)+1;
      SFX.stack(this.vicN);
      addRing(g,this.x,this.y,this.r,this.r*(2.2+this.vicN*.5),.45,this.c1,3+this.vicN);
      for(let i=0;i<8+this.vicN*3;i++){const a=rand(0,TAU),s=rand(120,340); addSpark(g,this.x,this.y,Math.cos(a)*s,Math.sin(a)*s,rand(.2,.45),Math.random()<.5?this.c1:'#ffffff',rand(1,2.2));}
    }
    danger(){return this.mo.stk/MO_MAX;}
  }
});
