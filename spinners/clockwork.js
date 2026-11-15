/* =====================================================================
   CLOCKWORK: brass gear with an escalating tick cycle. Wind-up, then Overdrive (time dilation for everyone else), then burnout.
   ===================================================================== */
// Clockwork's tick cycle. The timer runs on real sim time (never dilated), so "5 seconds" is 5 real seconds.
// boost scales base speed, acceleration and spin. Cycle 3 is the max and repeats.
const CW_CYCLES = [
  {ticks:12, iv:1.0,   burn:3, boost:1.0},
  {ticks:10, iv:.75,   burn:2, boost:1.1},
  {ticks:8,  iv:.625,  burn:1, boost:1.2}
];
const CW_OVER = 5;          // Overdrive ("Sandevistan") length in seconds
const CW_OVER_BOOST = 1.5;  // Clockwork's speed / acceleration / spin multiplier in Overdrive
const CW_SLOW = .2;         // everyone else's time scale in Overdrive
const CW_OVER_HITCD = .4;   // Clockwork's hit cooldown in Overdrive (normal is .35)
const CW_OVER_DMG = 1.6;    // Clockwork's contact-damage multiplier in Overdrive (was a .7 cap)
const CW_OVER_TAKEN = .3;   // damage Clockwork still takes in Overdrive (30%), from touch, shrapnel and burns
const CW_WALK = .45;        // AI gait: walk speed / accel as a fraction of the run (wind-up only)
const CW_BACK_GAP = 80;     // Overdrive slam loop: gap (px beyond touching) it pulls back to before charging again
const CW_BACK_MAX = .22;    // longest a single pull-back may take, so a retreat never eats the window
const CW_GHOST_MAX = 8, CW_GHOST_LIFE = .32;
const CW_N=12, COG_W=TAU/CW_N/2*.78, ROMAN=['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
function cogToothPts(r){return polar([[-COG_W,.82],[-COG_W*.72,1],[COG_W*.72,1],[COG_W,.82]],r);}
function drawCogTooth(c,r,i,c1,c2){
  polyPath(c,cogToothPts(r)); c.fillStyle=i%2?shade(c1,-.2):c1; c.fill();
  c.lineWidth=r*.04; c.lineJoin='round'; c.strokeStyle='#2a1708'; c.stroke();
  polyPath(c,polar([[-COG_W*.5,.97],[COG_W*.5,.97],[COG_W*.44,.89],[-COG_W*.44,.89]],r)); c.fillStyle=c2; c.fill();
}
function cogPath(c,rad,n){
  const s=TAU/n; c.beginPath();
  for(let i=0;i<n;i++){
    const a=i*s;
    [[-.3,.76],[-.2,1],[.2,1],[.3,.76]].forEach(([da,rr],k)=>{
      const x=Math.cos(a+da*s*1.6)*rad*rr, y=Math.sin(a+da*s*1.6)*rad*rr;
      (i||k)?c.lineTo(x,y):c.moveTo(x,y);
    });
  }
  c.closePath();
}
function drawCog(c,x,y,rad,n,rot,c1,c2){
  c.save(); c.translate(x,y); c.rotate(rot);
  cogPath(c,rad,n); c.fillStyle=c1; c.fill(); c.lineWidth=Math.max(1,rad*.08); c.lineJoin='round'; c.strokeStyle='#2a1708'; c.stroke();
  c.fillStyle='#2a1708'; c.beginPath(); c.arc(0,0,rad*.3,0,TAU); c.fill();   // axle hole
  c.strokeStyle=c2; c.lineWidth=Math.max(1,rad*.1); c.beginPath(); c.arc(0,0,rad*.55,0,TAU); c.stroke();
  c.restore();
}
// numerals and ring are pre-rendered once per size and colour pair, so there is no per-frame fillText
const dialCache={};
function dialImg(r,c1,c2){
  const key=Math.round(r)+'|'+c1+'|'+c2; if(dialCache[key]) return dialCache[key];
  const S=4, N=Math.ceil(r*1.5*S), cn=document.createElement('canvas'); cn.width=cn.height=N;
  const g=cn.getContext('2d'); g.translate(N/2,N/2); g.scale(S,S);
  g.fillStyle='rgba(28,16,6,.62)'; g.beginPath(); g.arc(0,0,r*.72,0,TAU); g.arc(0,0,r*.5,0,TAU,true); g.fill();
  g.strokeStyle=shade(c1,.35); g.lineWidth=r*.025; g.beginPath(); g.arc(0,0,r*.72,0,TAU); g.stroke();
  g.beginPath(); g.arc(0,0,r*.5,0,TAU); g.stroke();
  g.fillStyle='#f6e6b8'; g.textAlign='center'; g.textBaseline='middle'; g.font=`700 ${r*.14}px Georgia,'Times New Roman',serif`;
  for(let i=0;i<12;i++){const a=i/12*TAU; g.fillText(ROMAN[i],Math.sin(a)*r*.61,-Math.cos(a)*r*.61);}
  dialCache[key]=cn; return cn;
}
// k: {ang (body angle), phase:'wind'|'over'|'burn', hand (long hand, radians clockwise from 12), hr (short hand)}
function drawClock(c,r,c1,c2,parts,k){
  const ph=k.phase||'wind';
  c.save();
  if(ph==='over'){c.shadowColor='#5ff3ff'; c.shadowBlur=22;}
  c.fillStyle='#24160a'; c.beginPath(); c.arc(0,0,r*.86,0,TAU); c.fill(); c.restore();
  for(let i=0;i<CW_N;i++){
    c.save(); c.rotate(i/CW_N*TAU);
    if(!parts||parts[i].alive) drawCogTooth(c,r,i,c1,c2);
    else {
      c.fillStyle='#120a04'; c.beginPath();
      c.moveTo(r*.82,-r*.17); c.lineTo(r*.9,-r*.06); c.lineTo(r*.87,r*.06); c.lineTo(r*.82,r*.17); c.closePath(); c.fill();
    }
    c.restore();
  }
  c.lineWidth=r*.05; c.strokeStyle=c2; c.beginPath(); c.arc(0,0,r*.82,0,TAU); c.stroke();
  const g=c.createRadialGradient(-r*.2,-r*.2,r*.05,0,0,r*.76);   // brass plate
  g.addColorStop(0,shade(c1,.35)); g.addColorStop(1,shade(c1,-.5));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.76,0,TAU); c.fill();
  c.lineWidth=r*.035; c.strokeStyle='#2a1708'; c.stroke();
  c.strokeStyle='rgba(30,16,4,.8)'; c.lineWidth=Math.max(.8,r*.018); c.beginPath();   // minute ticks on the rotating rim
  for(let i=0;i<60;i++){const a=i/60*TAU, l=i%5?.045:.1, ca=Math.cos(a), sa=Math.sin(a); c.moveTo(ca*r*.74,sa*r*.74); c.lineTo(ca*r*(.74-l),sa*r*(.74-l));}
  c.stroke();
  // meshing cogs counter-rotate against the body at gear ratios
  const a=k.ang||0;
  drawCog(c,0,0,r*.27,10,-a*1.6,shade(c2,.1),c1);
  for(let i=0;i<3;i++){
    const ba=i*TAU/3+Math.PI/6;
    drawCog(c,Math.cos(ba)*r*.375,Math.sin(ba)*r*.375,r*.13,7,a*2.3*(i%2?1:-1)+i,shade(c1,-.1),c2);
  }
  // dial and hands stay upright however fast the rim spins
  c.save(); c.rotate(-a);
  const D=r*1.5; c.drawImage(dialImg(r,c1,c2),-D/2,-D/2,D,D);
  const cool=ph==='over'?'#7ff8ff':(ph==='burn'?'#7a5a38':'#fff3c4');
  c.strokeStyle='#1a0f05'; c.lineCap='round';
  for(const [ang,len,w] of [[k.hr||0,.4,.06],[k.hand||0,.63,.04]]){
    c.save(); c.rotate(ang);
    c.lineWidth=r*(w+.03); c.beginPath(); c.moveTo(0,r*.07); c.lineTo(0,-r*len); c.stroke();
    c.strokeStyle=cool; c.lineWidth=r*w; c.beginPath(); c.moveTo(0,r*.07); c.lineTo(0,-r*len); c.stroke();
    c.fillStyle=cool; c.beginPath(); c.moveTo(0,-r*(len+.07)); c.lineTo(r*.04,-r*len); c.lineTo(-r*.04,-r*len); c.closePath(); c.fill();
    c.restore(); c.strokeStyle='#1a0f05';
  }
  c.save(); if(ph==='over'){c.shadowColor='#5ff3ff'; c.shadowBlur=12;}
  c.fillStyle=ph==='over'?'#ffffff':c1; c.beginPath(); c.arc(0,0,r*.07,0,TAU); c.fill(); c.restore();
  c.restore();
  if(ph==='burn'){c.fillStyle='rgba(10,5,0,.4)'; c.beginPath(); c.arc(0,0,r*.98,0,TAU); c.fill();}   // dimmed brass
}
// fake wind-up for the select preview and menu backdrop so the hands tick
function previewClk(t){
  const tt=t%12, tick=Math.floor(tt), f=tt-tick;
  return {phase:'wind',hand:tick/12*TAU+Math.sin(f*16)*Math.exp(-f*6)*.3,hr:tt/12*TAU};
}
// simplified silhouette (rim and cogs, no numerals) used for the Sandevistan afterimages
function drawGhost(c,r,ang,col){
  c.save(); c.rotate(ang);
  c.fillStyle=col; c.beginPath(); c.arc(0,0,r*.8,0,TAU); c.fill();
  for(let i=0;i<CW_N;i++){c.save(); c.rotate(i/CW_N*TAU); polyPath(c,cogToothPts(r)); c.fill(); c.restore();}
  c.restore();
}
function drawGhosts(c,f){
  if(!f.ghosts.length) return;
  c.save(); c.globalCompositeOperation='lighter';
  for(const gh of f.ghosts){
    c.globalAlpha=.34*(1-gh.age/CW_GHOST_LIFE);
    c.save(); c.translate(gh.x,gh.y); drawGhost(c,f.r,gh.ang,gh.k%2?'#5ff3ff':'#ffc94d'); c.restore();
  }
  c.restore();
}

defineSpinner({
  def:{
    id:'clockwork', name:'Clockwork', r:36, m:2.6, hp:150, parts:12, kind:'cogtooth', prev:1.9,
    sub:'Precise &middot; escalating time-warp',
    desc:'Every tick builds pressure until time fractures around them, blurring the arena into slow motion, followed by a brief, fragile burnout. They wind faster with every cycle. Break their teeth to dull their blows, never their rhythm.',
    stats:{Speed:62, Power:60, Health:62}
  },
  sig:{main:['#d9a441','#c0642f'], rival:['#9fb3c8','#2ec4b6']},
  draw(c,r,c1,c2,o){ drawClock(c,r,c1,c2,o.parts,{ang:o.angle,phase:o.clk&&o.clk.phase,hand:o.clk&&o.clk.hand,hr:o.clk&&o.clk.hr}); },
  partPts:r=>cogToothPts(r),
  piece:{draw:(c,d)=>drawCogTooth(c,d.r,d.idx||0,d.c1,d.c2), col:d=>d.c1},
  preview:{spin:12, extra:t=>({clk:previewClk(t)})},
  bg:{pos:t=>{const k=t*.4; return [Math.cos(k+4)*R*.5,Math.sin(k*1.4+2)*R*.45];}, spin:12, extra:t=>({clk:previewClk(t)})},
  methods:class{
    init(){
      this.clk={cycle:1,phase:'wind',tick:0,t:0,hand:0,hv:0,hr:0,gT:0,sT:0,running:false,run:0,gt:rand(.6,1.2)};
      this.ghosts=[];                  // Sandevistan afterimages
      this.cwDir=1; this.cwDirT=0;     // rim-orbit direction and its flip hysteresis
      this.cwSlam={back:0,cool:0};     // Overdrive slam loop: back = time left in the pull-back, cool = grace before the next pull-back
    }
    maxSpeed(){return 255*this.cwCfg().boost*this.cwMul(.55,true);}
    accel(){return 900*this.cwCfg().boost*this.cwMul(.5,true);}
    dragK(){return this.clk.phase==='burn'?2.7:.9;}   // burnout: heavy drag
    baseSpin(){return 18*this.cwCfg().boost*this.cwMul(.3);}
    contactDamage(impact){return impact*0.035*(.55+.45*this.aliveFrac())*(this.clk.phase==='over'?CW_OVER_DMG:1);}   // lost teeth weaken the hit, never the clock
    hitCdTime(){return this.clk.phase==='over'?CW_OVER_HITCD:.35;}
    takenMul(){return this.clk.phase==='over'?CW_OVER_TAKEN:1;}   // hard to hurt in Overdrive, never immune
    warpFactor(){return this.clk.phase==='over'?CW_SLOW:0;}       // time scale everyone else runs at while this clock is in Overdrive
    steerDur(){return this.clk.phase==='over'?STEER_T*.35:STEER_T;}   // in Overdrive it regains steering fast, so it can slam again at once
    tickReal(dt,g){this.clockStep(dt,g);}                         // the clock runs on real time, never dilated
    drawTrail(c){drawGhosts(c,this);}
    drawState(){return {clk:this.clk};}
    hud(lab,bar){
      const c=this.clk, cfg=this.cwCfg(), ph=c.phase;
      if(this._ph!==ph){   // recolour the meter only when the phase changes
        this._ph=ph;
        bar.style.background=ph==='over'?'linear-gradient(90deg,#22d3ee,#fde68a)':(ph==='burn'?'linear-gradient(90deg,#7f1d1d,#ef4444)':'linear-gradient(90deg,'+this.c2+','+this.c1+')');
      }
      let txt, wd;
      if(ph==='over'){txt='OVERDRIVE '+Math.max(0,CW_OVER-c.t).toFixed(1)+'s'; wd=Math.max(0,1-c.t/CW_OVER)*100;}
      else if(ph==='burn'){txt='BURNOUT'; wd=Math.max(0,1-c.t/cfg.burn)*100;}
      else{txt='C'+Math.min(c.cycle,9)+' WIND-UP '+c.tick+'/'+cfg.ticks; wd=(c.tick+c.t/cfg.iv)/cfg.ticks*100;}
      lab.textContent=txt; bar.style.width=Math.min(100,wd)+'%';
    }
  cwCfg(){return CW_CYCLES[Math.min(this.clk.cycle,CW_CYCLES.length)-1];}
  cwPhase(){return this.clk?this.clk.phase:null;}
  // Clockwork's tick cycle. Runs once per sim tick on real time, so dilation never stretches its own timers.
  clockStep(dt,g){
    const c=this.clk, cfg=this.cwCfg();
    for(let i=this.ghosts.length-1;i>=0;i--){this.ghosts[i].age+=dt; if(this.ghosts[i].age>CW_GHOST_LIFE) this.ghosts.splice(i,1);}
    if(g.over){ if(c.phase!=='wind'){c.phase='wind'; c.t=0;} return; }   // the match is decided: no more dilation or boost
    c.t+=dt;
    // AI gait: alternate walk and run during wind-up. c.run glides 0..1, so it never stops dead between bursts.
    if(c.phase==='wind'){
      c.gt-=dt;
      if(c.gt<=0){c.running=!c.running; c.gt=c.running?rand(.8,1.1):rand(1.1,1.6);}
    } else {c.running=true; c.gt=0;}
    c.run+=((c.running?1:0)-c.run)*Math.min(1,dt*6);
    if(c.phase==='wind'){
      if(c.t>=cfg.iv){
        c.t-=cfg.iv; c.tick++;
        if(c.tick>=cfg.ticks) this.startOverdrive(g);
        else{
          const ci=Math.min(c.cycle,CW_CYCLES.length)-1;
          SFX.tick(1+.1*ci+.08*c.tick/cfg.ticks,c.tick%2);
          const a=rand(0,TAU);
          addSpark(g,this.x+Math.cos(a)*this.r,this.y+Math.sin(a)*this.r,Math.cos(a)*90,Math.sin(a)*90,.2,'#ffd98a',1.4,true);
        }
      }
      if(c.phase==='wind') c.hr=Math.min(TAU,TAU*(c.tick+c.t/cfg.iv)/cfg.ticks);
    } else if(c.phase==='over'){
      c.hr=TAU*(1-c.t/CW_OVER);   // both hands race backward as a countdown
      c.gT-=dt;
      if(c.gT<=0){
        c.gT=.025; this.ghosts.push({x:this.x,y:this.y,ang:this.angle,age:0,k:c.sT++});
        if(this.ghosts.length>CW_GHOST_MAX) this.ghosts.shift();
        g.parts.push({k:'dot',x:this.x+rand(-6,6),y:this.y+rand(-6,6),vx:rand(-40,40),vy:rand(-40,40),life:.35,max:.35,
          col:c.sT%2?'#5ff3ff':'#ffd166',size:rand(2,3.5),rt:true});
      }
      if(c.t>=CW_OVER) this.startBurnout(g);
    } else { // burnout: the hands sag and the motor sputters
      c.hr+=(Math.PI-c.hr)*Math.min(1,dt*3);
      if(Math.random()<dt*16){
        const a=rand(0,TAU);
        addSpark(g,this.x+Math.cos(a)*this.r*.9,this.y+Math.sin(a)*this.r*.9,Math.cos(a)*rand(40,150),Math.sin(a)*rand(40,150)-30,rand(.15,.35),Math.random()<.5?'#ffb347':'#fff3c4',rand(1,2));
      }
      if(Math.random()<dt*5) g.parts.push({k:'smoke',x:this.x+rand(-1,1)*this.r*.5,y:this.y+rand(-1,1)*this.r*.5,vx:rand(-14,14),vy:-rand(20,45),
        life:1,max:1,size:this.r*rand(.12,.18),al:.2,col:'#d5dbe5'});   // steam
      if(c.t>=cfg.burn){c.cycle++; c.phase='wind'; c.tick=0; c.t=0;}
    }
    // long hand: a spring that overshoots on each tick; locked to the countdown in Overdrive
    if(c.phase==='over'){c.hand=c.hr; c.hv=0;}
    else{
      const burn=c.phase==='burn', tgt=burn?Math.PI:c.tick/cfg.ticks*TAU, kk=burn?18:240, dm=burn?5:16;
      c.hv+=((tgt-c.hand)*kk-c.hv*dm)*dt; c.hand+=c.hv*dt;
    }
  }
  startOverdrive(g){
    const c=this.clk; c.phase='over'; c.t=0; c.hand=c.hr=TAU; c.hv=0; c.gT=0;
    SFX.bellChime();
    addRing(g,this.x,this.y,this.r*.6,this.r*5,.6,'#5ff3ff',5,true);
    addRing(g,this.x,this.y,this.r*.4,this.r*3.2,.45,'#ffd166',3,true);
    addText(g,this.x,this.y-this.r-26,'OVERDRIVE','#7ff8ff',22,true);
    for(let i=0;i<30;i++){const a=rand(0,TAU),s=rand(160,460); addSpark(g,this.x,this.y,Math.cos(a)*s,Math.sin(a)*s,rand(.25,.6),Math.random()<.5?'#5ff3ff':'#ffd166',rand(1,2.6),true);}
    g.shake=Math.max(g.shake,10); hitStop(g,HITSTOP.massive);
  }
  startBurnout(g){
    const c=this.clk, cfg=this.cwCfg(); c.phase='burn'; c.t=0; c.hv=0;
    SFX.gearGroan(cfg.burn);
    addText(g,this.x,this.y-this.r-22,'BURNOUT','#ff9a5a',20);
    for(let i=0;i<14;i++){const a=rand(0,TAU),s=rand(80,260); addSpark(g,this.x,this.y,Math.cos(a)*s,Math.sin(a)*s,rand(.2,.5),'#ffb347',rand(1,2.2));}
  }
  // Clockwork's phase multiplier: Overdrive boosts, burnout drags. level picks the stat (speed, accel, spin).
  // gait=true also applies the AI walk/run burst cycle during wind-up (humans keep full control speed)
  cwMul(burn,gait){
    const ph=this.clk.phase;
    if(ph==='over') return CW_OVER_BOOST;
    if(ph==='burn') return burn;
    return gait&&this.ctrl!=='human'?CW_WALK+(1-CW_WALK)*this.clk.run:1;
  }
    // Wind-up and burnout: circle the rim, out of reach. Overdrive: lead the rival and slam, then bank off a wall before burnout.
    aiMove(o,dx,dy,d,dt){
      if(this.clk.phase!=='over'){this.cwSlam.back=0; this.cwSlam.cool=0; return this.evade(o,dx,dy,d,dt);}
      return this.cwAmbush(o,dx,dy,d,dt);
    }
    // Overdrive: hunt slams for the whole window, and bank off the nearest wall only as late as it has to.
    // The exit window is the time the wall run needs (plus a little), so every spare moment goes to attacking
    // instead of a fixed early retreat. It never gets so greedy that burnout starts with the rival in reach.
    // Slam loop: on contact it pulls straight back about CW_BACK_GAP px (at most CW_BACK_MAX s), then charges again,
    // so each pass is a fresh high-speed hit instead of one hit followed by pushing. Short enough to re-hit as the hit cooldown ends.
    cwAmbush(o,dx,dy,d,dt){
      const c=this.clk, left=CW_OVER-c.t;
      const dc=Math.hypot(this.x,this.y)||1, sp=Math.max(Math.hypot(this.vx,this.vy),100);
      const run=(R-dc-this.r)/sp;                    // seconds to reach the wall at the current speed
      const win=clamp(run+.25,.35,.75);              // when to stop attacking and start the exit
      if(left<win){
        if(run<left){
          const th=Math.atan2(this.y,this.x), ph=Math.atan2(o.y,o.x), dir=angDiff(th,ph)>=0?1:-1;   // slide to the side away from the rival
          const a=th+dir*.35, wx=Math.cos(a)*R-this.x, wy=Math.sin(a)*R-this.y, l=Math.hypot(wx,wy)||1;
          return [wx/l,wy/l];
        }
        return [-dx,-dy];
      }
      const s=this.cwSlam, gap=d-this.r-o.r;
      s.cool-=dt||0;
      if(s.back>0){
        s.back-=dt||0;
        if(gap>=CW_BACK_GAP||s.back<=0){s.back=0; s.cool=.15;}   // far enough (or out of time): charge
        else{
          let ax=-dx, ay=-dy; const wall=clamp((dc-R*.72)/(R*.2),0,1);
          if(wall>0){ax-=this.x/dc*wall*1.2; ay-=this.y/dc*wall*1.2;}   // near the wall, pull back toward the middle instead of into the rim
          const al=Math.hypot(ax,ay)||1; return [ax/al,ay/al];
        }
      } else if(gap<6&&s.cool<=0) s.back=CW_BACK_MAX;   // touching: back off for the next run-up
      const [lx,ly]=this.lead(o,.4), tx=lx-this.x, ty=ly-this.y, l=Math.hypot(tx,ty)||1;   // look further ahead: it is far faster than a slowed rival
      return [tx/l,ty/l];
    }
  // Clockwork's defensive AI: keep a safe gap from the rival (wider for Big Boy and a rival's gravity field),
  // back away harder when the rival is closing in, strafe toward the arena centre, and slide along the wall instead of
  // getting pinned. (dx,dy) is the unit vector to the rival, d the distance.
  // Blends away-from-rival steering with a tangential orbit of the arena rim, held at ~0.68R by a radial spring,
  // so it circles smoothly instead of backing into a wall. The orbit direction heads away from the rival (flips at most every 1.5s).
  evade(o,dx,dy,d,dt){
    const px=this.x, py=this.y, dc=Math.hypot(px,py)||1, nx=px/dc, ny=py/dc;
    this.cwDirT-=dt||0;
    const awayCcw=(-dx)*(-ny)+(-dy)*nx;   // away-vector component along the CCW rim tangent
    if(this.cwDirT<=0 && Math.abs(awayCcw)>.25){
      const nd=awayCcw>0?1:-1; if(nd!==this.cwDir){this.cwDir=nd; this.cwDirT=1.5;}
    }
    const safe=this.r+o.r+o.reach();   // how far the rival's reach extends past its body (gravity aura, rage, scrap ring)
    const closing=Math.max(0,-(o.vx*o.ts*dx+o.vy*o.ts*dy));
    const threat=clamp((safe-d)/safe,0,1)+(d<safe*1.6?clamp(closing/600,0,.6):0);
    let ax=-dx, ay=-dy;
    const wall=clamp((dc-R*.7)/(R*.25),0,1);
    if(wall>0){const ou=ax*nx+ay*ny; if(ou>0){ax-=nx*ou*wall; ay-=ny*ou*wall;}}   // last resort: slide along the wall
    const radial=clamp((R*.68-dc)/(R*.3),-1.2,1.2);
    const orb=.9*(1-.5*Math.min(1,threat))+.2, aw=threat*1.3;
    const wx=ax*aw+(-ny)*this.cwDir*orb+nx*radial*.9;
    const wy=ay*aw+nx*this.cwDir*orb+ny*radial*.9;
    const l=Math.hypot(wx,wy)||1, mag=Math.min(1,.45+threat);
    return [wx/l*mag,wy/l*mag];
  }
  }
});
