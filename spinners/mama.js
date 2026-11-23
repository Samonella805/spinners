/* =====================================================================
   MAMA: summoner. Two baby spinners fly with her and harass the rival on their own. Each time a baby comes home and bumps her,
   that baby's stack grows (up to MA_STACKS): Mama hits harder and the baby flies faster. A baby that is destroyed takes its
   stacks with it, and a fresh one pops out of her cradle a few seconds later with nothing.
   The babies are not Fighters: Mama simulates them herself (field hook, every half-step), so Versus stays a two-fighter game.
   They bounce off the rim and arena obstacles, ram the rival, and take damage from the rival's ram (by its own hit formula).
   Rival fields and auras ignore them.
   ===================================================================== */
const MA_STACKS = 3;          // most stacks each baby can hold
const MA_DMG_STK = .10;       // Mama's touch damage per stack, from both babies together (6 stacks: x1.84)
const MA_BABY_R = 15, MA_BABY_M = .9, MA_BABY_HP = 34;
const MA_BABY_SPD = 235, MA_BABY_SPD_STK = 28;   // baby top speed, and extra per stack
const MA_BABY_DMG = .018;     // baby touch damage per px/s of closing speed (x1.1 per stack)
const MA_BABY_HURT = .6;      // a baby takes the rival's own ram damage times this
const MA_RESPAWN = 4;         // seconds before a lost baby is replaced
const MA_RETURN_T = 4;        // seconds a baby hunts before it comes home anyway
const MA_LEASH = 520;         // a baby this far from Mama comes home
const MA_MARK = ['#ffd166','#7ee8fa'];   // each baby's own marking colour

// her four armour plates; the two docking cradles sit between them
const MA_PL=[[-.42,.66],[-.36,.98],[.36,.98],[.42,.66]];
function maPts(r){return polar(MA_PL,r);}
function drawMaPlate(c,r,i,c1){
  polyPath(c,maPts(r)); c.fillStyle=i%2?'#4a3a44':'#57454f'; c.fill();
  c.lineWidth=r*.045; c.lineJoin='round'; c.strokeStyle='#120c10'; c.stroke();
  c.fillStyle=c1; polyPath(c,polar([[-.26,.9],[.26,.9],[.22,.82],[-.22,.82]],r)); c.fill();   // painted stripe
  c.fillStyle='#b9a8b2'; for(const s of [-1,1]){const p=polar([[s*.26,.74]],r)[0]; c.beginPath(); c.arc(p[0],p[1],r*.03,0,TAU); c.fill();}
}
function drawMama(c,r,c1,c2,o){
  const parts=o.parts, N=parts?parts.length:4, t=o.t||0, dock=o.dock||[0,0], ga=o.ga||t*6;
  c.fillStyle='#1c1418'; c.beginPath(); c.arc(0,0,r*.9,0,TAU); c.fill();
  for(let i=0;i<N;i++){
    c.save(); c.rotate(i/N*TAU);
    if(!parts||parts[i].alive){const p=parts&&parts[i]; partPose(c,r,p); drawMaPlate(c,r,i,c1); partWear(c,r,p,maPts(r));}
    else drawSocket(c,r,parts[i],{r0:.62,r1:.95,w:.22,kind:'piston'});
    c.restore();
  }
  // the two docking cradles: a clamp that snaps shut and glows when a baby comes home, with a gear that spins up
  for(let k=0;k<2;k++){
    const d=dock[k]||0;
    c.save(); c.rotate(TAU/8+k*Math.PI);
    c.fillStyle='#2a2026'; c.fillRect(r*.6,-r*.2,r*.34,r*.4);
    const jaw=r*(.15-.06*d);   // the jaws close on a dock
    c.fillStyle='#8a7a84'; c.fillRect(r*.7,-jaw-r*.06,r*.26,r*.06); c.fillRect(r*.7,jaw,r*.26,r*.06);
    c.strokeStyle=d>.05?MA_MARK[k]:'#3d3138'; c.lineWidth=r*.04; c.beginPath(); c.arc(r*.83,0,r*.1,0,TAU); c.stroke();
    if(d>.05){c.save(); c.globalCompositeOperation='lighter'; c.fillStyle=rgba(MA_MARK[k],.5*d); c.beginPath(); c.arc(r*.83,0,r*.2,0,TAU); c.fill(); c.restore();}
    c.save(); c.translate(r*.6,-r*.26); c.rotate(ga*(1+2*d)); gearPath(c,7,r*.05,r*.08); c.fillStyle='#c9a24a'; c.fill(); c.restore();
    c.restore();
  }
  const g=c.createRadialGradient(-r*.2,-r*.2,r*.05,0,0,r*.62); g.addColorStop(0,shade(c1,.35)); g.addColorStop(1,shade(c1,-.45));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.58,0,TAU); c.fill(); c.lineWidth=r*.04; c.strokeStyle='#120c10'; c.stroke();
  // the Mother Engine: pistons round a hub that pump harder with her stacks
  const st=o.stk||0;
  for(let i=0;i<6;i++){c.save(); c.rotate(i/6*TAU+.3); const ext=.5+.5*Math.sin(ga*(1.2+st*.25)+i*2.1);
    c.fillStyle='#3a2f36'; c.fillRect(r*.24,-r*.05,r*.22,r*.1); c.fillStyle='#d9c9d2'; c.fillRect(r*(.24-.1*ext),-r*.025,r*.12,r*.05); c.restore();}
  c.fillStyle='#120c10'; c.beginPath(); c.arc(0,0,r*.2,0,TAU); c.fill();
  c.save(); c.shadowColor=c2; c.shadowBlur=6+st*4; c.fillStyle=st>=4?'#ffffff':c2; c.beginPath(); c.arc(0,0,r*(.09+.012*st),0,TAU); c.fill(); c.restore();
}
// a baby: a little copy of her silhouette in its own marking colour, cracking and darkening as it is hurt
function drawBaby(c,b,c1,c2,t){
  const r=MA_BABY_R, hp=b.hp/MA_BABY_HP;
  c.save(); c.translate(b.x,b.y);
  c.fillStyle='rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(r*.15,r*.25,r,r*.92,0,0,TAU); c.fill();
  if(b.stk){c.save(); c.globalCompositeOperation='lighter'; c.strokeStyle=rgba(MA_MARK[b.i],.25+.12*b.stk); c.lineWidth=2+b.stk; c.beginPath(); c.arc(0,0,r+3,0,TAU); c.stroke(); c.restore();}   // speed stacks glow round it
  c.rotate(b.ang);
  c.fillStyle='#1c1418'; c.beginPath(); c.arc(0,0,r*.9,0,TAU); c.fill();
  for(let i=0;i<4;i++){c.save(); c.rotate(i/4*TAU); polyPath(c,maPts(r)); c.fillStyle=i%2?'#4a3a44':'#57454f'; c.fill(); c.lineWidth=1; c.strokeStyle='#120c10'; c.stroke(); c.restore();}
  c.fillStyle=shade(c1,.1); c.beginPath(); c.arc(0,0,r*.56,0,TAU); c.fill();
  c.fillStyle=MA_MARK[b.i]; c.fillRect(-r*.5,-r*.12,r,r*.24);   // its own stripe
  c.fillStyle='#120c10'; c.beginPath(); c.arc(0,0,r*.2,0,TAU); c.fill();
  if(hp<.7){c.strokeStyle='rgba(8,5,5,.85)'; c.lineWidth=1.2; c.beginPath(); c.moveTo(r*.7,-r*.1); c.lineTo(r*.3,r*.15); c.lineTo(r*.05,-r*.05); if(hp<.4){c.moveTo(-r*.6,r*.3); c.lineTo(-r*.2,0); c.lineTo(-r*.35,-r*.35);} c.stroke();}
  if(hp<.4){c.fillStyle='rgba(0,0,0,.3)'; c.beginPath(); c.arc(0,0,r*.9,0,TAU); c.fill();}
  c.restore();
  if(b.flash>0){c.fillStyle=`rgba(255,255,255,${b.flash*.8})`; c.beginPath(); c.arc(b.x,b.y,r,0,TAU); c.fill();}
}
function maNewBaby(m,i){
  const a=TAU/8+i*Math.PI+m.angle, d=m.r+MA_BABY_R+2;
  return {i,alive:true,x:m.x+Math.cos(a)*d,y:m.y+Math.sin(a)*d,vx:Math.cos(a)*160+m.vx,vy:Math.sin(a)*160+m.vy,hp:MA_BABY_HP,stk:0,
    mode:'out',modeT:.35,hunt:0,hitCd:.4,hurtCd:0,flash:0,ang:rand(0,TAU),flank:i?.85:-.85};
}

defineSpinner({
  def:{
    id:'mama', mat:'iron', name:'Mama', r:40, m:4.2, hp:165, parts:4, kind:'mplate', prev:1.5,
    sub:'Summoner &middot; two babies',
    desc:'Never leaves home without the kids. Her two babies zoom off to pester you, then race back for a hug, and every hug makes her hit harder and them fly faster. Break a baby and that bonus is gone (she makes a new one, of course).',
    stats:{Speed:45, Power:60, Health:85}
  },
  sig:{main:['#d9539a','#ffd1e8'], rival:['#2f9e93','#c9fff8']},
  draw(c,r,c1,c2,o){drawMama(c,r,c1,c2,o);},
  partPts:r=>maPts(r),
  piece:{draw:(c,d)=>drawMaPlate(c,d.r,d.idx||0,d.c1), col:()=>'#57454f'},
  preview:{spin:5, extra:t=>({dock:[Math.max(0,Math.sin(t*1.3)),Math.max(0,Math.sin(t*1.3+2))],stk:2}),
    under(c,h,k,c2,t){   // two babies circling her in the menu
      for(let i=0;i<2;i++){const a=t*1.4+i*Math.PI, d=h*.78; c.save(); c.translate(h+Math.cos(a)*d,h+Math.sin(a)*d); c.scale(k*1.3,k*1.3);
        drawBaby(c,{x:0,y:0,ang:t*9,hp:MA_BABY_HP,stk:1,i,flash:0},'#d9539a',c2,t); c.restore();}
    }},
  bg:{pos:t=>{const a=t*.45+2; return [Math.cos(a)*R*.55,Math.sin(a*1.2)*R*.5];}, spin:6, extra:()=>({stk:2})},
  meterBg:'linear-gradient(90deg,#d9539a,#ffd166)',
  methods:class{
    init(){this.ma={kids:[null,null],respawn:[.01,.01],dock:[0,0],pulse:0,sndT:0};}
    stacks(){let s=0; for(const b of this.ma.kids) if(b&&b.alive) s+=b.stk; return s;}
    maxSpeed(){return 175;}
    accel(){return 520;}
    dragK(){return .85;}
    baseSpin(){return 11*(1+.25*this.ma.pulse);}
    contactDamage(impact){return impact*.034*(1+MA_DMG_STK*this.stacks())*(.6+.4*this.aliveFrac());}
    hitCdTime(){return .4;}
    reach(){return 140;}
    danger(){return this.stacks()/(2*MA_STACKS);}
    drawState(){return {dock:this.ma.dock,stk:this.stacks()};}
    hud(lab,bar){
      const n=this.ma.kids.filter(b=>b&&b.alive).length, s=this.stacks();
      lab.textContent='BABIES '+n+'/2  +'+Math.round(s*MA_DMG_STK*100)+'% DMG';
      bar.style.width=(s/(2*MA_STACKS)*100)+'%';
    }
    onKill(g){for(const b of this.ma.kids) if(b&&b.alive) this.babyDie(g,b,true);}   // the kids go down with her
    // Mama hangs back while the babies work, and wades in once they have powered her up (or the rival is close and hurt)
    aiMove(o,dx,dy,d,dt,g){
      const s=this.stacks(), gap=d-this.r-o.r, hurt=o.hp/o.maxHp<.35;
      // a baby on its way home: turn to meet it (she would otherwise drift away from her own kid)
      for(const b of this.ma.kids) if(b&&b.alive&&b.mode==='home'&&gap>60){const bx=b.x-this.x, by=b.y-this.y, bl=Math.hypot(bx,by)||1; if(bl<320) return [bx/bl*.6,by/bl*.6];}
      if(s>=3||hurt||gap<40){const [lx,ly]=this.lead(o,.35); return this.steerTo(lx,ly,.4);}
      const want=200, rad=clamp((d-want)/80,-1,1), dc=Math.hypot(this.x,this.y)||1;
      let vx=dx*rad-dy*.7, vy=dy*rad+dx*.7;
      if(dc>R*.7){vx-=this.x/dc*(dc-R*.7)/60; vy-=this.y/dc*(dc-R*.7)/60;}   // stay off the rim
      return [vx,vy];
    }
    babyDie(g,b,quiet){
      b.alive=false; this.ma.respawn[b.i]=MA_RESPAWN;
      for(let i=0;i<16;i++){const a=rand(0,TAU),s=rand(100,320); addSpark(g,b.x,b.y,Math.cos(a)*s,Math.sin(a)*s,rand(.2,.45),Math.random()<.5?MA_MARK[b.i]:'#fff3c4',rand(1,2.2));}
      addRing(g,b.x,b.y,4,40,.3,MA_MARK[b.i],3);
      for(let i=0;i<3;i++){const s=rand(3,5.5), a=rand(0,TAU), sp=rand(120,300); spawnCosm(g,[[-s,-s*.7],[s,-s*.3],[s*.2,s]],b.x,b.y,rand(0,TAU),b.vx*.4+Math.cos(a)*sp,b.vy*.4+Math.sin(a)*sp,rand(-30,30),i%2?MA_MARK[b.i]:'#57454f',1);}
      if(!quiet){addText(g,b.x,b.y-24,b.stk?'BABY DOWN -'+Math.round(b.stk*MA_DMG_STK*100)+'%':'BABY DOWN','#ff9a9a',14); SFX.chip();}
    }
    // the babies: hunt the rival, ram it, come home for a bump, go again (every half-step, on Mama's own clock)
    field(g,dtIn){
      const M=this.ma, dt=dtIn*this.ts, o=g.fighters.find(f=>f!==this&&f.alive);
      M.pulse=Math.max(0,M.pulse-dt*1.5); M.dock[0]=Math.max(0,M.dock[0]-dt*2); M.dock[1]=Math.max(0,M.dock[1]-dt*2);
      for(let i=0;i<2;i++){
        const b=M.kids[i];
        if(!b||!b.alive){M.respawn[i]-=dt; if(M.respawn[i]<=0){M.kids[i]=maNewBaby(this,i); if(g.time>.1){addRing(g,M.kids[i].x,M.kids[i].y,4,30,.3,MA_MARK[i],2); if(SFX.babyPop) SFX.babyPop(panAt(M.kids[i].x));}} continue;}
        b.hitCd-=dt; b.hurtCd-=dt; b.flash=Math.max(0,b.flash-dt*5); b.modeT-=dt; b.ang+=(16+b.stk*4)*dt;
        const spd=MA_BABY_SPD+MA_BABY_SPD_STK*b.stk;
        // where to go
        let tx,ty;
        const dm=Math.hypot(this.x-b.x,this.y-b.y);
        if(b.mode==='out'&&b.modeT<=0) b.mode='hunt';
        if(b.mode==='hunt'){b.hunt+=dt; if(!o||b.hunt>MA_RETURN_T||dm>MA_LEASH) b.mode='home';}
        if(b.mode==='home'||!o){tx=this.x+this.vx*.3; ty=this.y+this.vy*.3;}   // aim where Mama is going
        else{
          const ox=o.x-b.x, oy=o.y-b.y, od=Math.hypot(ox,oy)||1, fl=b.flank*clamp((od-60)/220,0,1);   // come at it from her own side
          const lx=o.x+o.vx*o.ts*.25, ly=o.y+o.vy*o.ts*.25;
          tx=lx-(-oy/od)*fl*od*.5; ty=ly-(ox/od)*fl*od*.5;
        }
        let ux=tx-b.x, uy=ty-b.y; const ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
        b.vx+=ux*900*dt; b.vy+=uy*900*dt;
        const dr=Math.exp(-1.2*dt); b.vx*=dr; b.vy*=dr;
        const cap=b.mode==='home'?spd+70:spd, sp=Math.hypot(b.vx,b.vy); if(sp>cap){b.vx*=cap/sp; b.vy*=cap/sp;}   // a little faster on the way home
        b.x+=b.vx*dt; b.y+=b.vy*dt;
        // the rim and arena obstacles
        const dc=Math.hypot(b.x,b.y);
        if(dc+MA_BABY_R>R){const nx=b.x/dc, ny=b.y/dc; b.x=nx*(R-MA_BABY_R); b.y=ny*(R-MA_BABY_R); const vn=b.vx*nx+b.vy*ny; if(vn>0){b.vx-=1.8*vn*nx; b.vy-=1.8*vn*ny;}}
        if(g.A&&g.A.shapes) for(const s of g.A.shapes){shapeNear(s,b.x,b.y,NEAR); const pen=MA_BABY_R-NEAR.d; if(pen>0){b.x+=NEAR.nx*pen; b.y+=NEAR.ny*pen; const vn=-(b.vx*NEAR.nx+b.vy*NEAR.ny); if(vn>0){b.vx+=1.8*vn*NEAR.nx; b.vy+=1.8*vn*NEAR.ny;}}}
        // the other baby
        const b2=M.kids[1-i];
        if(b2&&b2.alive&&i===0){const dx=b2.x-b.x, dy=b2.y-b.y, d=Math.hypot(dx,dy)||1, mn=MA_BABY_R*2; if(d<mn){const nx=dx/d, ny=dy/d, ov=(mn-d)/2; b.x-=nx*ov; b.y-=ny*ov; b2.x+=nx*ov; b2.y+=ny*ov;}}
        // home: a bump on Mama is a hug
        if(dm<this.r+MA_BABY_R){
          const nx=(b.x-this.x)/(dm||1), ny=(b.y-this.y)/(dm||1);
          b.x=this.x+nx*(this.r+MA_BABY_R); b.y=this.y+ny*(this.r+MA_BABY_R);
          if(b.mode==='home'){
            if(b.stk<MA_STACKS) b.stk++;
            b.mode='out'; b.modeT=.3; b.hunt=0;
            const a=o?Math.atan2(o.y-b.y,o.x-b.x):Math.atan2(ny,nx); b.vx=Math.cos(a)*(spd+60)+this.vx; b.vy=Math.sin(a)*(spd+60)+this.vy;
            M.dock[i]=1; M.pulse=1;
            addRing(g,b.x,b.y,MA_BABY_R,MA_BABY_R*3,.3,MA_MARK[i],3);
            addText(g,this.x,this.y-this.r-14,'+'+Math.round(MA_DMG_STK*100)+'% x'+this.stacks(),MA_MARK[i],14);
            if(SFX.babyDock) SFX.babyDock(this.stacks(),panAt(this.x)); else SFX.stack(Math.min(4,this.stacks()));
          } else {const vn=b.vx*nx+b.vy*ny; if(vn<0){b.vx-=1.6*vn*nx; b.vy-=1.6*vn*ny;}}
        }
        // the rival: rams both ways
        if(o){
          const dx=o.x-b.x, dy=o.y-b.y, d=Math.hypot(dx,dy)||1, mn=o.r+MA_BABY_R;
          if(d<mn){
            const nx=dx/d, ny=dy/d, ovx=o.vx*o.ts, ovy=o.vy*o.ts, im1=1/MA_BABY_M, im2=1/o.m, sum=im1+im2, ov=mn-d;
            b.x-=nx*ov*im1/sum; b.y-=ny*ov*im1/sum; o.x+=nx*ov*im2/sum; o.y+=ny*ov*im2/sum;
            const vn=(b.vx-ovx)*nx+(b.vy-ovy)*ny;
            if(vn>0){
              let j=1.9*vn/sum; const vsep=j*sum-vn; if(vsep<200) j+=(200-vsep)/sum;
              b.vx-=j*nx*im1; b.vy-=j*ny*im1; o.vx+=j*nx*im2/o.ts; o.vy+=j*ny*im2/o.ts;
              if(vn>40){
                const x=b.x+nx*MA_BABY_R, y=b.y+ny*MA_BABY_R;
                for(let k=0;k<8;k++){const a=rand(0,TAU),s=rand(80,240); addSpark(g,x,y,Math.cos(a)*s,Math.sin(a)*s,rand(.12,.3),Math.random()<.5?'#fff3c4':MA_MARK[i],rand(1,2));}
                if(b.hitCd<=0){   // the baby's bite
                  const dmg=vn*MA_BABY_DMG*(1+.1*b.stk);
                  b.hitCd=.55; b.mode='home'; b.hunt=0;
                  addText(g,o.x,o.y-o.r-6,'-'+Math.round(dmg),MA_MARK[i],13);
                  damage(g,o,dmg,false,Math.atan2(-ny,-nx));
                }
                if(b.hurtCd<=0&&o.alive){   // the rival's ram
                  const hurt=o.contactDamage(vn)*MA_BABY_HURT; b.hurtCd=.35;
                  if(hurt>.5){b.hp-=hurt; b.flash=1; addText(g,b.x,b.y-20,'-'+Math.round(hurt),'#ffd166',12); if(b.hp<=0) this.babyDie(g,b,false);}
                }
                if(g.time-M.sndT>.08){M.sndT=g.time; SFX.clang(vn*.7,MA_BABY_M,o.m,0,0,'iron',matOf(o),panAt(x));}
              }
            }
          }
        }
      }
    }
    drawUnder(c,g,t){for(const b of this.ma.kids) if(b&&b.alive) drawBaby(c,b,this.c1,this.c2,t);}
  }
});
