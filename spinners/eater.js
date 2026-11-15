/* =====================================================================
   EATER: heavy industrial grinder with a furnace core. Devours loose scrap to heal, and at full health infects it with acid.
   Debris ownership is the existing gd.owner (the fighter index that shed the piece; -1 for rim shards, which count as rival scrap).
   Corruption lives on the debris record itself: gd.corrupt, gd.corruptBy (the infector's index) and gd.charges.
   ===================================================================== */
const EA_N = 7;               // jaw-plates around the rim
const EA_FULL = .999;         // HP fraction that counts as "full health" (infection mode); anything below is "hungry"
const EA_HEAL_OWN = 6;      // HP from eating a piece Eater itself shed
const EA_HEAL_RIVAL = 6;    // HP from eating a rival's (or rim) piece
const EA_HEAL_CAP = 250;      // most HP Eater can heal in one match (a safety valve; 25 pieces)
const EA_REACH = 12;          // extra px around the hull in which scrap is swallowed
const EA_SEEK = 520;          // hungry: scrap closer than this beats trading blows
const EA_CHARGES = 3;         // drains one infected piece can deliver before it goes inert
const EA_DRAIN = 3;           // HP an infected piece drains from a rival it touches
const EA_DRAIN_CD = 1.2;      // seconds between drains from the same piece (so it can't multi-tick in a frame)
const EA_WEAK_T = 2;          // seconds a drained rival deals reduced strike damage (weakMul in game.js: x0.85)
const EA_GREEN = '#7dff3a', EA_VIOLET = '#b04dff';

function mixHex(a,b,t){const A=hexRgb(a),B=hexRgb(b);return`rgb(${A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(',')})`;}
// one jagged jaw-plate, lying along +x (the same frame the spinner's other parts use)
function jawPts(r){
  const W=TAU/EA_N/2*.8;
  return polar([[-W,.7],[-W*.78,.94],[-W*.36,.84],[0,1],[W*.36,.84],[W*.78,.94],[W,.7]],r);
}
function drawJaw(c,r,c1,c2){
  const p=jawPts(r), g=c.createLinearGradient(r*.7,0,r,0);
  g.addColorStop(0,'#2e323b'); g.addColorStop(1,'#8a93a3');
  polyPath(c,p); c.fillStyle=g; c.fill();
  c.lineWidth=r*.04; c.lineJoin='round'; c.strokeStyle='#0b0d12'; c.stroke();
  c.strokeStyle=rgba(c2,.75); c.lineWidth=r*.025; c.lineCap='round';
  c.beginPath(); c.moveTo(p[1][0],p[1][1]); c.lineTo(p[3][0],p[3][1]); c.lineTo(p[5][0],p[5][1]); c.stroke();   // hot edge along the teeth
}
// o.hp (0..1) drives the furnace colour: hungry orange when hurt, toxic acid-green at full health. o.ea.chew flares it when it swallows scrap.
function drawEater(c,r,c1,c2,o){
  const hp=o.hp==null?1:o.hp, t=o.t||0, chew=(o.ea&&o.ea.chew)||0;
  let k=clamp((hp-.55)/.45,0,1); k=k*k*(3-2*k);
  const hot=mixHex('#ff6a10',EA_GREEN,k), lite=mixHex('#ffd27a','#eaffb8',k);
  for(let i=0;i<EA_N;i++){
    c.save(); c.rotate(i/EA_N*TAU);
    if(!o.parts||o.parts[i].alive) drawJaw(c,r,c1,c2);
    else{   // empty socket where a jaw-plate was torn off
      c.fillStyle='#0b0d12'; c.beginPath();
      c.moveTo(r*.66,-r*.2); c.lineTo(r*.8,-r*.12); c.lineTo(r*.8,r*.12); c.lineTo(r*.66,r*.2); c.closePath(); c.fill();
    }
    c.restore();
  }
  const g=c.createRadialGradient(-r*.2,-r*.2,r*.05,0,0,r*.82);   // heavy cast-iron hull
  g.addColorStop(0,shade(c1,.1)); g.addColorStop(1,shade(c1,-.7));
  c.fillStyle=g; c.beginPath(); c.arc(0,0,r*.8,0,TAU); c.fill();
  c.lineWidth=r*.05; c.strokeStyle='#0b0d12'; c.stroke();
  c.fillStyle='#0b0d12';
  for(let j=0;j<12;j++){c.save(); c.rotate(j/12*TAU); c.fillRect(r*.5,-r*.022,r*.2,r*.044); c.restore();}   // vent slits
  c.fillStyle='#07080b'; c.beginPath(); c.arc(0,0,r*.43,0,TAU); c.fill();                              // furnace mouth
  const flick=.5+.5*Math.sin(t*6.5)+.25*Math.sin(t*15);
  c.save(); c.shadowColor=hot; c.shadowBlur=10+16*clamp(flick*.5+chew*2,0,1.5);
  const g2=c.createRadialGradient(0,0,0,0,0,r*.34);
  g2.addColorStop(0,lite); g2.addColorStop(.55,hot); g2.addColorStop(1,shade('#ff6a10',-.7));
  c.fillStyle=g2; c.beginPath(); c.arc(0,0,r*.34,0,TAU); c.fill(); c.restore();
  c.save(); c.beginPath(); c.arc(0,0,r*.34,0,TAU); c.clip();   // furnace grate
  c.strokeStyle='rgba(8,6,4,.85)'; c.lineWidth=r*.045;
  for(let j=0;j<3;j++){c.save(); c.rotate(j*Math.PI/3+t*.6); c.beginPath(); c.moveTo(-r*.4,0); c.lineTo(r*.4,0); c.stroke(); c.restore();}
  c.restore();
  if(chew>0){c.globalCompositeOperation='lighter'; c.fillStyle=`rgba(255,240,200,${Math.min(.6,chew*2)})`; c.beginPath(); c.arc(0,0,r*.36,0,TAU); c.fill(); c.globalCompositeOperation='source-over';}
}

/* ---- eating, infection and drain: run every half-step of the Matter world from Eater's physStep ---- */
function pieceR(d){return d.rad||(d.rad=d.shape.pts.reduce((m,p)=>Math.max(m,Math.hypot(p[0],p[1])),6));}
function acidSparks(g,x,y,n){
  for(let i=0;i<n;i++){const a=rand(0,TAU), s=rand(60,260); addSpark(g,x,y,Math.cos(a)*s,Math.sin(a)*s,rand(.2,.5),Math.random()<.5?EA_GREEN:EA_VIOLET,rand(1,2.4));}
}
// swallow a piece: every piece heals a flat 10 HP, trimmed by up to 25% when most jaw-plates are gone
function eatPiece(g,f,d,x,y,pr){
  const own=d.owner===f.idx, jaw=.75+.25*f.aliveFrac();
  const amt=Math.min((own?EA_HEAL_OWN:EA_HEAL_RIVAL)*jaw,EA_HEAL_CAP-f.ea.healed);
  f.ea.healed+=heal(g,f,amt);
  f.ea.chew=.3;
  for(let i=0;i<14;i++){const a=rand(0,TAU), s=rand(80,340); addSpark(g,x,y,Math.cos(a)*s,Math.sin(a)*s,rand(.15,.4),['#ffb347','#fff3c4',EA_GREEN][(Math.random()*3)|0],rand(1,2.4));}
  addRing(g,x,y,3,30,.25,'#ffb347',3);
  SFX.eat(pr);
}
// full health: the piece is not destroyed, it becomes Drain Scrap
function infect(g,f,d,x,y){
  d.corrupt=true; d.corruptBy=f.idx; d.charges=EA_CHARGES; d.drainCd=.3;
  acidSparks(g,x,y,10);
  addRing(g,x,y,2,24,.3,EA_GREEN,3);
  SFX.acid('infect');
}
function drainHit(g,o,b,d){
  d.drainCd=EA_DRAIN_CD; d.charges=(d.charges==null?EA_CHARGES:d.charges)-1;
  o.weakT=EA_WEAK_T;
  addText(g,o.x,o.y-o.r-6,'-'+EA_DRAIN,EA_GREEN,18);
  acidSparks(g,b.position.x,b.position.y,12);
  addRing(g,b.position.x,b.position.y,2,28,.25,EA_GREEN,3);
  SFX.acid('drain');
  if(d.charges<=0){d.corrupt=false; acidSparks(g,b.position.x,b.position.y,8);}   // spent: the piece goes inert
  damage(g,o,EA_DRAIN,true,null);   // DoT-flagged: Scrap-King's shield cuts it, and it never wears a ring piece
}
function eaterPhys(g,f,dt){
  const ea=f.ea, pw=g.pw;
  ea.chew=Math.max(0,ea.chew-dt);
  const full=f.hp>=f.maxHp*EA_FULL, hungry=!full&&ea.healed<EA_HEAL_CAP;
  let inf=0;
  for(let i=pw.bodies.length-1;i>=0;i--){
    const b=pw.bodies[i]; if(!b) continue;   // damage() can shed debris and shift the list
    const d=b.gd; if(d.state==='captured') continue;
    const px=b.position.x, py=b.position.y, pr=pieceR(d);
    if(d.corrupt&&d.corruptBy===f.idx){
      inf++;
      if(d.drainCd>0) d.drainCd-=dt;
      if(Math.random()<dt*16&&g.parts.length<1500)   // toxic particle trail
        g.parts.push({k:'dot',x:px+rand(-4,4),y:py+rand(-4,4),vx:rand(-25,25),vy:rand(-25,25),life:.5,max:.5,col:Math.random()<.5?EA_GREEN:EA_VIOLET,size:rand(1.5,3)});
      if(!(d.drainCd>0)) for(const o of g.fighters){
        if(o===f||!o.alive) continue;
        const dx=o.x-px, dy=o.y-py, lim=o.r+pr+2;
        if(dx*dx+dy*dy>lim*lim) continue;
        drainHit(g,o,b,d); break;
      }
    }
    const dx=px-f.x, dy=py-f.y, lim=f.r+pr+EA_REACH;
    if(dx*dx+dy*dy>lim*lim) continue;
    if(d.owner===f.idx&&d.ghostT>0) continue;   // a plate it just shed flies clear first
    if(hungry){ if(d.corrupt&&d.corruptBy===f.idx) inf--; eatPiece(g,f,d,px,py,pr); removeBody(g,b); }
    else if(full&&!d.corrupt) infect(g,f,d,px,py);
  }
  const S=pw.settled;   // resting pieces under it get eaten or infected too
  for(let i=S.length-1;i>=0;i--){
    const p=S[i], d=p.gd;
    if(d.corrupt&&d.corruptBy===f.idx) inf++;
    const dx=p.position.x-f.x, dy=p.position.y-f.y, pr=pieceR(d), lim=f.r+pr+EA_REACH;
    if(dx*dx+dy*dy>lim*lim) continue;
    if(hungry){ if(d.corrupt&&d.corruptBy===f.idx) inf--; eatPiece(g,f,d,p.position.x,p.position.y,pr); S.splice(i,1); }
    else if(full&&!d.corrupt) infect(g,f,d,p.position.x,p.position.y);
  }
  ea.inf=inf;
}

defineSpinner({
  def:{
    id:'eater', name:'Eater', r:38, m:3.6, hp:150, parts:EA_N, kind:'jaw', prev:1.9,
    sub:'Heavy &middot; devours scrap',
    desc:'Ravenous and relentless. Devours shattered scrap from the arena floor to mend its hull&mdash;feasting even harder on rival parts. At full health, its touch infects loose debris with a corrosive drain that saps anyone else who collides with it. Shatter its jaw-plates to slow its feast.',
    stats:{Speed:40, Power:60, Health:75}
  },
  sig:{main:['#7a8c4a','#ff8a1f'], rival:['#8a5cff','#c8ff3a']},
  draw(c,r,c1,c2,o){ drawEater(c,r,c1,c2,o); },
  partPts:r=>jawPts(r),
  piece:{draw:(c,d)=>drawJaw(c,d.r,d.c1,d.c2), col:()=>'#7b8493'},
  preview:{spin:9},
  bg:{pos:t=>[Math.cos(t*.4+3)*R*.5,Math.sin(t*.5+1)*R*.5], spin:9},
  meterBg:'linear-gradient(90deg,#ff6a10,#7dff3a)',
  methods:class{
    init(){this.ea={healed:0,chew:0,planT:0,tgt:null,inf:0};}
    maxSpeed(){return 215;}
    accel(){return 700;}
    dragK(){return .85;}
    baseSpin(){return 13;}
    contactDamage(impact){return impact*.04*(.6+.4*this.aliveFrac());}   // lost jaw-plates weaken the bite
    reach(){return 50;}
    physStep(g,dtIn){eaterPhys(g,this,dtIn*this.ts);}
    drawState(){return {ea:{chew:this.ea.chew}};}
    drawUnder(c,g,t){
      if(this.hp>=this.maxHp*EA_FULL){   // a faint toxic halo while it is at full health
        c.save(); c.translate(this.x,this.y); c.rotate(t*1.5); c.strokeStyle=rgba(EA_GREEN,.22+.1*Math.sin(t*5)); c.lineWidth=3; c.setLineDash([5,9]);
        c.beginPath(); c.arc(0,0,this.r+10,0,TAU); c.stroke(); c.restore();
      }
      for(const v of g.fighters){   // rivals sapped by Drain Scrap wear a sickly ring while their strikes are weakened
        if(v===this||!v.alive||!(v.weakT>0)) continue;
        c.save(); c.translate(v.x,v.y); c.rotate(-t*2); c.strokeStyle=rgba(EA_GREEN,clamp(v.weakT/EA_WEAK_T,0,1)*.6); c.lineWidth=3; c.setLineDash([6,8]);
        c.beginPath(); c.arc(0,0,v.r+8,0,TAU); c.stroke(); c.restore();
      }
    }
    hud(lab,bar){
      const full=this.hp>=this.maxHp*EA_FULL, inf=this.ea.inf;
      lab.textContent=(full?'ACID CHARGED':'HUNGRY  '+Math.round(this.ea.healed)+'/'+EA_HEAL_CAP+' EATEN')+(inf?'  INFECTED '+inf:'');
      bar.style.width=(this.hp/this.maxHp*100)+'%';
    }
    // where to go for scrap. Hungry: the densest scrap, rival scrap weighted higher. Full health: its own infected pieces to bat at the rival,
    // otherwise the densest clean scrap to infect. Samples at most ~60 pieces, so it stays cheap.
    scout(g,o,full){
      const cand=[];
      const take=(list,isBody)=>{
        const m=list.length; if(!m) return;
        for(let i=0;i<(isBody?m:40)&&cand.length<110;i++){
          const b=isBody?list[i]:list[(Math.random()*m)|0], d=b.gd;
          if(isBody&&d.state==='captured') continue;
          if(d.owner===this.idx&&d.ghostT>0) continue;
          cand.push({x:b.position.x,y:b.position.y,own:d.owner===this.idx,bat:!!(d.corrupt&&d.corruptBy===this.idx&&d.charges>0),r:pieceR(d)});
        }
      };
      take(g.pw.bodies,true); take(g.pw.settled,false);
      let best=null, bs=-1;
      if(full){
        for(const p of cand) if(p.bat){const sc=1/(1+Math.hypot(p.x-this.x,p.y-this.y)/200); if(sc>bs){bs=sc; best=Object.assign({mode:'bat'},p);}}
        if(best) return best;
      }
      for(const p of cand){
        if(full&&p.bat) continue;
        let nb=0; for(const q of cand) if(Math.hypot(p.x-q.x,p.y-q.y)<110) nb++;
        const sc=(p.own?1:1.3)*(1+nb*.5)/(1+Math.hypot(p.x-this.x,p.y-this.y)/160);   // near scrap wins: every piece is worth the same 10 HP
        if(sc>bs){bs=sc; best=Object.assign({mode:'eat'},p);}
      }
      return best;
    }
    // Hurt: trade blows when the rival is close, otherwise run through the densest scrap. Full health: sweep clean scrap to infect it, and
    // bat infected pieces toward the rival by lining up behind them and driving through. No scrap at all: chase the rival.
    aiMove(o,dx,dy,d,dt,g){
      const ea=this.ea, full=this.hp>=this.maxHp*EA_FULL;
      ea.planT-=dt; if(ea.planT<=0){ea.planT=.35; ea.tgt=this.scout(g,o,full);}
      const seek=(tx,ty)=>{const l=Math.hypot(tx-this.x,ty-this.y)||1; return [(tx-this.x)/l,(ty-this.y)/l];};
      const chase=()=>{const [lx,ly]=this.lead(o,.3); return seek(lx,ly);};
      const t=ea.tgt;
      if(!t) return chase();
      if(!full){   // hungry: scrap is the priority, even mid-fight. Only chase the rival when no scrap is in range (or it has eaten its fill)
        if(ea.healed<EA_HEAL_CAP&&t.mode==='eat'&&Math.hypot(t.x-this.x,t.y-this.y)<EA_SEEK) return seek(t.x,t.y);
        return chase();
      }
      if(t.mode==='bat'){
        let ux=o.x-t.x, uy=o.y-t.y; const ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
        const gx=t.x-ux*(this.r+t.r+26), gy=t.y-uy*(this.r+t.r+26);
        if(Math.hypot(gx-this.x,gy-this.y)<55) return seek(t.x+ux*40,t.y+uy*40);   // lined up behind it: drive through toward the rival
        return seek(gx,gy);
      }
      return seek(t.x,t.y);
    }
  }
});
