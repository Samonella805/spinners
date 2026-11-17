/* =====================================================================
   BIG BOY: heavy, builds rage (speed and damage) until a hit lands, then the rage resets.
   ===================================================================== */
const RAGE_TIME = 9;   // seconds for Big Boy to reach full speed
const CHG_GAP = 85;    // px of clear space Big Boy backs off to for a run-up when stuck pushing
const TOOTH_W=Math.PI/10*.86;
function toothPts(r){return polar([[-TOOTH_W,.84],[-TOOTH_W*.4,1],[TOOTH_W*.4,1],[TOOTH_W,.84]],r);}
function tipPts(r){const w=TOOTH_W;return polar([[-w*.4,1],[w*.4,1],[w*.34,.9],[-w*.34,.9]],r);}
function drawTooth(c,r,i,c1,c2){
  polyPath(c,toothPts(r)); c.fillStyle=i%2?'#3b3e52':'#4b4f69'; c.fill();
  c.lineWidth=r*.045; c.lineJoin='round'; c.strokeStyle='#0d0e14'; c.stroke();
  polyPath(c,tipPts(r)); c.fillStyle=i%2?c2:c1; c.fill();
}
function drawBig(c,r,c1,c2,rage,parts){
  const N=10;
  c.save(); c.shadowColor='#ff6a00'; c.shadowBlur=rage*34;
  c.fillStyle='#1c1d27'; c.beginPath(); c.arc(0,0,r*.86,0,TAU); c.fill(); c.restore();
  for(let i=0;i<N;i++){
    c.save(); c.rotate(i/N*TAU);
    if(!parts||parts[i].alive){const p=parts&&parts[i]; partPose(c,r,p); drawTooth(c,r,i,c1,c2); partWear(c,r,p,toothPts(r));}
    else drawSocket(c,r,parts[i],{r0:.72,r1:.95,w:.2,kind:'piston'});
    c.restore();
  }
  c.lineWidth=r*.05; c.strokeStyle=c2; c.beginPath(); c.arc(0,0,r*.84,0,TAU); c.stroke();
  const g=c.createRadialGradient(-r*.22,-r*.22,r*.05,0,0,r*.74);
  g.addColorStop(0,shade(c1,.4)); g.addColorStop(1,shade(c1,-.45));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.72,0,TAU); c.fill();
  c.lineWidth=r*.045; c.strokeStyle='#0d0e14'; c.stroke();
  for(let i=0;i<4;i++){ // four-fang star
    c.save(); c.rotate(i*TAU/4+Math.PI/4);
    c.beginPath(); c.moveTo(r*.18,-r*.15); c.lineTo(r*.66,0); c.lineTo(r*.18,r*.15); c.closePath();
    c.fillStyle=c2; c.fill(); c.lineWidth=r*.035; c.lineJoin='round'; c.strokeStyle='#0d0e14'; c.stroke();
    c.restore();
  }
  c.fillStyle='#15161d'; c.beginPath(); c.arc(0,0,r*.24,0,TAU); c.fill();
  c.save(); c.shadowColor=c2; c.shadowBlur=6+rage*20; c.fillStyle=rage>.6?'#ffffff':c2;
  c.beginPath(); c.arc(0,0,r*.12+rage*r*.04,0,TAU); c.fill(); c.restore();
  if(rage>.05){c.strokeStyle=`rgba(255,120,40,${rage})`; c.lineWidth=r*.05; c.beginPath(); c.arc(0,0,r*.93,0,TAU); c.stroke();}
}

defineSpinner({
  def:{
    id:'bigboy', mat:'iron', name:'Big Boy', r:44, m:5, hp:185, parts:10, kind:'tooth', prev:1.7,
    sub:'Heavy &middot; builds rage',
    desc:'Slow and heavy, but he never stops building speed. The faster he spins the harder he hits, and the speed resets on the hit that lands. Teeth snap off as he takes damage, and every lost tooth weakens his strikes.',
    stats:{Speed:28, Power:95, Health:90}
  },
  sig:{main:['#e8442b','#ffc93c'], rival:['#2f80ed','#e0f2ff']},
  draw(c,r,c1,c2,o){ drawBig(c,r,c1,c2,o.rage||0,o.parts); },
  // six hydraulic rams pumping around a hub; stronger strokes with rage, slower and weaker as the machine fails
  internals(c,r,o){
    const ga=o.ga||0, rg=o.rage||0, hp=o.hp==null?1:o.hp;
    c.strokeStyle='#4a4f5e'; c.lineWidth=r*.06; c.beginPath(); c.arc(0,0,r*.3,0,TAU); c.stroke();
    for(let i=0;i<6;i++){
      c.save(); c.rotate(i/6*TAU+.3);
      const ext=.5+.5*Math.sin(ga*1.1+i*2.1), L=(.16+.14*ext*(1+rg*.6))*(.6+.4*hp);
      c.fillStyle='#3a3f4d'; c.fillRect(r*.56,-r*.075,r*.3,r*.15);                 // cylinder
      c.fillStyle='#b9c2d0'; c.fillRect(r*(.56-L),-r*.035,r*L,r*.07);             // rod
      c.fillStyle='#6b7080'; c.beginPath(); c.arc(r*(.56-L),0,r*.05,0,TAU); c.fill();
      if(rg>.3){c.fillStyle=rgba('#ff8a3a',.5*rg*ext); c.fillRect(r*.56,-r*.075,r*.3,r*.15);}   // the cylinders run hot when enraged
      c.restore();
    }
  },
  partPts:r=>toothPts(r),
  piece:{draw:(c,d)=>drawTooth(c,d.r,d.idx||0,d.c1,d.c2), col:()=>'#4b4f69'},
  preview:{spin:8, extra:t=>({rage:.5+.5*Math.sin(t*1.5)})},
  bg:{pos:t=>{const a=t*.55; return [Math.cos(a)*R*.5,Math.sin(a*1.3)*R*.45];}, spin:9, extra:()=>({rage:.4})},
  meterBg:'linear-gradient(90deg,#f59e0b,#ef4444)',
  methods:class{
    maxSpeed(){return (110+this.rage*360)*(1+BANK_BOOST*this.bankK);}
    accel(){return (170+this.rage*520)*(1+.25*this.bankK);}
    dragK(){return .55*(1-.35*this.bankK);}
    baseSpin(){return 10+this.rage*20;}
    contactDamage(impact){return impact*0.05*(1+this.rage*3)*(.55+.45*this.aliveFrac());}
    reach(){return 170+this.rage*140;}      // how far past its body rivals should keep clear
    charges(){return true;}                  // rivals treat it as a charger that gets scarier as rage builds
    think(dt){this.rage=Math.min(1,this.rage+dt/RAGE_TIME);}
    trail(dt,g){
      this.trailT-=dt;
      if(this.trailT<=0&&this.rage>.3){
        this.trailT=.025;
        const s=Math.hypot(this.vx,this.vy)||1;
        g.parts.push({k:'dot',x:this.x-this.vx/s*this.r*.8+rand(-6,6),y:this.y-this.vy/s*this.r*.8+rand(-6,6),vx:rand(-30,30),vy:rand(-30,30),life:.4,max:.4,col:Math.random()<.5?'#ff7a1a':'#ffd166',size:rand(2,3+this.rage*3)});
      }
    }
    // visual only: a failing hydraulic ram springs a leak: a hiss of steam and a spray of amber fluid from its cylinder
    malfunction(g,dt,tier){
      this.bbT=(this.bbT||0)-dt; if(this.bbT>0) return;
      this.bbT=rand(.5,1.1)/(tier-2);
      const a=this.angle+((Math.random()*6)|0)/6*TAU+.3, x=this.x+Math.cos(a)*this.r*.8, y=this.y+Math.sin(a)*this.r*.8, life=rand(.5,.8);
      g.parts.push({k:'smoke',x,y,vx:Math.cos(a)*30,vy:Math.sin(a)*30-14,life,max:life,size:this.r*rand(.1,.15),al:.35,col:'#d5dbe5'});
      for(let i=0;i<4;i++){const d=a+rand(-.5,.5), s=rand(60,160); g.parts.push({k:'dot',x,y,vx:Math.cos(d)*s+this.vx*.3,vy:Math.sin(d)*s+this.vy*.3,life:.4,max:.4,col:'#d98a1c',size:rand(1.4,2.4)});}
    }
    hud(lab,bar){
      lab.textContent='RAGE  x'+(1+this.rage*3).toFixed(1)+' DMG';
      bar.style.width=(this.rage*100)+'%';
    }
    aiMove(o,dx,dy,d,dt){return this.aiBig(o,dx,dy,d,dt);}
  // Big Boy: lead-aiming chase, plus a wall-bank slingshot when the rival is kiting him from far away.
  aiBig(o,dx,dy,d,dt){
    this.bankCd-=dt;
    const dc=Math.hypot(this.x,this.y)||1, th=Math.atan2(this.y,this.x), ph=Math.atan2(o.y,o.x);
    const closing=-(o.vx*o.ts*dx+o.vy*o.ts*dy);
    if(!this.bank && this.bankCd<=0 && d>(this.r+o.r+230)*1.6 && closing<80){
      this.bank={t:rand(.8,1.2),dir:angDiff(ph,th)>=0?1:-1};
    }
    if(this.bank){
      this.bank.t-=dt;
      const near=Math.abs(angDiff(ph,th))<.5 && dc>R*.6;
      if(this.bank.t<=0||near){this.bank=null; this.bankCd=rand(5,7);}
      else{
        const dir=this.bank.dir; let wx,wy;
        if(dc>R*.78){ wx=-this.y/dc*dir+this.x/dc*.3; wy=this.x/dc*dir+this.y/dc*.3; }   // on the rim: ride it
        else{ const a=th+dir*.5; wx=Math.cos(a)*(R-this.r)-this.x; wy=Math.sin(a)*(R-this.r)-this.y; }   // shallow approach to the wall
        const l=Math.hypot(wx,wy)||1; return [wx/l,wy/l];
      }
    }
    // Stuck pushing: in contact at a low closing speed does almost no damage, so after a moment he backs off for a short run-up
    // (rarely, and only far enough to build speed) and charges again.
    const bb=this.bb||(this.bb={stuck:0,back:0,cd:0}), gap=d-this.r-o.r, vcl=this.vx*dx+this.vy*dy;
    bb.cd-=dt;
    if(bb.back>0){
      bb.back-=dt;
      if(gap>=CHG_GAP||bb.back<=0) bb.back=0;
      else{
        let ax=-dx, ay=-dy; const wall=clamp((dc-R*.7)/(R*.25),0,1);
        if(wall>0){ax-=this.x/dc*wall*1.3; ay-=this.y/dc*wall*1.3;}   // never back into the rim
        const al=Math.hypot(ax,ay)||1; return [ax/al,ay/al];
      }
    } else {
      bb.stuck=(gap<10&&vcl<110)?bb.stuck+dt:Math.max(0,bb.stuck-dt*2);
      if(bb.stuck>.45&&bb.cd<=0){bb.back=.5; bb.cd=2.5; bb.stuck=0;}
    }
    const [lx,ly]=this.lead(o,.45), [sx,sy]=this.steerTo(lx,ly,.45);
    const w=Math.sin(this.t*1.7)*.25;
    return [sx-sy*w, sy+sx*w];
  }
  danger(){return this.rage;}
  // victory (visual only): a rage flare, with heavy fire-coloured rings and a thump of shake every pulse
  victory(g,dt,u){
    this.vicT=(this.vicT||0)-dt;
    if(this.vicT>0) return;
    this.vicT=.8;
    addRing(g,this.x,this.y,this.r,this.r*4,.7,'#ff6a2b',6); addRing(g,this.x,this.y,this.r*.6,this.r*2.6,.5,'#ffd166',3);
    g.shake=Math.max(g.shake,5);
    for(let i=0;i<22;i++){const a=rand(0,TAU),s=rand(120,380); addSpark(g,this.x+Math.cos(a)*this.r,this.y+Math.sin(a)*this.r,Math.cos(a)*s,Math.sin(a)*s-60,rand(.3,.6),Math.random()<.5?'#ff8a3a':'#fff3c4',rand(1.2,2.8));}
  }
  }
});
