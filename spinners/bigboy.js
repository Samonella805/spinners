/* =====================================================================
   BIG BOY: heavy, builds rage (speed and damage) until a hit lands, then the rage resets.
   ===================================================================== */
const RAGE_TIME = 9;   // seconds for Big Boy to reach full speed
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
    if(!parts||parts[i].alive) drawTooth(c,r,i,c1,c2);
    else {
      c.fillStyle='#14151c'; c.beginPath();
      c.moveTo(r*.84,-r*.2); c.lineTo(r*.93,-r*.06); c.lineTo(r*.89,r*.07); c.lineTo(r*.84,r*.2); c.closePath(); c.fill();
    }
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
    id:'bigboy', name:'Big Boy', r:44, m:5, hp:185, parts:10, kind:'tooth', prev:1.7,
    sub:'Heavy &middot; builds rage',
    desc:'Slow and heavy, but he never stops building speed. The faster he spins the harder he hits, and the speed resets on the hit that lands. Teeth snap off as he takes damage, and every lost tooth weakens his strikes.',
    stats:{Speed:28, Power:95, Health:90}
  },
  sig:{main:['#e8442b','#ffc93c'], rival:['#2f80ed','#e0f2ff']},
  draw(c,r,c1,c2,o){ drawBig(c,r,c1,c2,o.rage||0,o.parts); },
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
    const [lx,ly]=this.lead(o,.45); let tx=lx-this.x, ty=ly-this.y; const l=Math.hypot(tx,ty)||1; tx/=l; ty/=l;
    const w=Math.sin(this.t*1.7)*.25;
    return [tx-ty*w, ty+tx*w];
  }
  }
});
