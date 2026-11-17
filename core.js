/* =====================================================================
   CORE: shared helpers and the spinner registry.
   Load order: core.js, spinners/*.js, audio.js, game.js (classic scripts, so file:// works).
   ===================================================================== */
const $ = s => document.querySelector(s);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a,b)=>a+Math.random()*(b-a);
const TAU = Math.PI*2;

function hexRgb(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255];}
function shade(h,amt){const[r,g,b]=hexRgb(h);const t=amt<0?0:255,p=Math.abs(amt);return`rgb(${Math.round((t-r)*p+r)},${Math.round((t-g)*p+g)},${Math.round((t-b)*p+b)})`;}
function rgba(h,a){const[r,g,b]=hexRgb(h);return`rgba(${r},${g},${b},${a})`;}
function angDiff(a,b){const d=a-b; return Math.atan2(Math.sin(d),Math.cos(d));}
function polyPath(c,pts){c.beginPath();pts.forEach((q,k)=>k?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.closePath();}
function polar(list,r){return list.map(([a,rr])=>[Math.cos(a)*rr*r,Math.sin(a)*rr*r]);}

/* ---------------------------------------------------------------------
   SPINNER REGISTRY. Each spinner lives in spinners/<id>.js and registers itself:

   defineSpinner({
     def:{id,name,r,m,hp,parts,kind,prev,sub,desc,stats},   // numbers and menu text ('kind' names its detachable part)
     sig:{main:[c1,c2], rival:[c1,c2]},                     // signature colours, and the palette for a mirror match
     draw(c,r,c1,c2,o){},        // paint the body (already translated and rotated). o: {angle,t,parts,rage,clk,sk,...}
     partPts(r){},               // outline of one detachable part; it becomes a Matter body when chipped off
     piece:{draw(c,d){},col(d){}},   // how a chipped part looks as debris, and the colour its fragments take
     preview:{spin,extra(t),under(c,h,k,c2,t)},   // select-screen preview (extra and under are optional)
     bg:{pos(t),spin,extra(t)},  // menu backdrop: position over time, spin rate, extra draw fields
     meterBg:'css gradient',     // optional: HUD meter colour
     methods:class{ ... }        // mixed into every Fighter of this kind: stats, AI and hooks (the hook defaults live on Fighter in game.js)
   });
   To add a spinner: create spinners/<id>.js, add a script tag in index.html before game.js. The roster, previews and backdrop pick it up.
   --------------------------------------------------------------------- */
const SPINNERS = {}, DEFS = {}, SIG = {}, PIECE = {};
function protoMethods(C){const o={}; for(const k of Object.getOwnPropertyNames(C.prototype)) if(k!=='constructor') o[k]=C.prototype[k]; return o;}
function defineSpinner(s){
  const id=s.def.id;
  s.methods=protoMethods(s.methods);
  SPINNERS[id]=s; DEFS[id]=s.def; SIG[id]=s.sig;
  if(s.piece) PIECE[s.def.kind]=s.piece;
}

/* ---------------------------------------------------------------------
   DESTRUCTION VISUALS shared by every spinner's plate loop (all visual only: a plate's wear never changes hitboxes or damage).
   Inside a plate's frame (rotated by i/N*TAU, +x pointing out) a spinner's loop does:
     alive: partPose(c,r,p); ...draw the plate...; partWear(c,r,p,outlinePts);
     torn:  drawSocket(c,r,p,{r0,r1,w,cy,kind,glow});
   p is the part record from Fighter.parts ({dmg,cr,sc,bolt,t,tt,...}); it is undefined for the menu previews, which stay pristine.
   --------------------------------------------------------------------- */
// a toothed wheel outline centred on the origin (n teeth, root radius r0, tip radius r1); call c.fill()/c.stroke() afterwards. Used by the spinners' internals().
function gearPath(c,n,r0,r1){
  c.beginPath();
  for(let i=0;i<n;i++){
    const a=i/n*TAU, w=TAU/n;
    c.lineTo(Math.cos(a)*r0,Math.sin(a)*r0); c.lineTo(Math.cos(a+w*.12)*r1,Math.sin(a+w*.12)*r1);
    c.lineTo(Math.cos(a+w*.38)*r1,Math.sin(a+w*.38)*r1); c.lineTo(Math.cos(a+w*.5)*r0,Math.sin(a+w*.5)*r0);
  }
  c.closePath();
}
/* INTERNALS (optional hook on a spinner definition): internals(c,r,o) paints the machinery you glimpse through cut-outs, holes and torn sockets.
   Already clipped to the hull and translated/rotated into the body frame. o.ga is the machinery angle: it advances with the spin, so every part
   turns in proportion to it (slower as the machine deteriorates) and stops dead while a part is jammed. o.cond (0..1) is how wrecked it is,
   o.tier 0..4, o.hp 0..1. Without the hook a spinner shows the generic chassis flywheel. */
function hash01(s,k){const v=Math.sin(s*127.1+k*311.7)*43758.5453; return v-Math.floor(v);}
// one crack: a random walk running from near the outer edge inward, in the plate's frame (units of r). cy: the plate's centre line.
function makeCrack(cy){
  let x=rand(.8,.97), y=cy+rand(-.1,.1), a=Math.PI+rand(-.5,.5); const pts=[[x,y]], n=4+((Math.random()*3)|0);
  for(let i=0;i<n;i++){a+=rand(-.7,.7); const l=rand(.05,.1); x+=Math.cos(a)*l; y+=Math.sin(a)*l; pts.push([x,y]);}
  return pts;
}
// a plate that is damaged lifts, bends on its inner hinge, rattles once loose, and finally hangs from one corner
function partPose(c,r,p){
  if(!p) return;
  if(p.sa){const hy=(p.cy||0)*r; c.translate(r*.72,hy); c.rotate(p.sa); c.translate(-r*.72,-hy);}   // sprung swing about the hinge (Fighter.mechStep: kicked by hits, shaken by spin)
  const d=p.dmg; if(!(d>=.4)) return;
  const t=p.t||0, hs=p.hs||1, ph=p.ph||0, cy=(p.cy||0)*r;
  const b=clamp((d-.4)/.4,0,1);
  c.translate(r*.035*b,0);                                              // lifts away from the hull
  c.translate(r*.72,cy); c.rotate(hs*.09*b); c.transform(1,0,hs*.2*b,1-.05*b,0,0); c.translate(-r*.72,-cy);   // bends on its inner hinge
  const l=clamp((d-.65)/.3,0,1);
  if(l>0){                                                              // loose: rattles tangentially
    c.translate(Math.sin(t*47+ph)*r*.006*l,Math.sin(t*61+ph*2)*r*.007*l);   // fine buzz; the visible swing comes from the spring (p.sa)
  }
  const h=clamp((d-.88)/.09,0,1);
  if(h>0){c.translate(r*.7,cy+hs*r*.12); c.rotate(hs*(.38+.1*Math.sin(t*9+ph))*h); c.translate(-r*.7,-cy-hs*r*.12);}   // hangs from one corner
}
// cracks, bare-metal scratches, soot, a missing bolt and a bend crease, clipped to the plate's outline (pts, or a function that builds the path)
function partWear(c,r,p,clip){
  const d=p&&p.dmg; if(!(d>=.2)) return;
  c.save(); if(typeof clip==='function') clip(c); else polyPath(c,clip); c.clip();
  const lw=Math.max(1,r*.03), cy=p.cy||0; c.lineCap='round'; c.lineJoin='round';
  if(d>.4){c.fillStyle=`rgba(8,6,4,${.45*(d-.4)})`; c.fillRect(r*.4,-r*.9,r*.7,r*1.8);}   // soot
  if(p.sc){c.strokeStyle='rgba(220,226,238,.5)'; c.lineWidth=Math.max(.8,r*.015); c.beginPath();
    for(const s of p.sc){c.moveTo(s[0]*r,s[1]*r); c.lineTo((s[0]+Math.cos(s[2])*s[3])*r,(s[1]+Math.sin(s[2])*s[3])*r);} c.stroke();}
  if(d>.4){c.strokeStyle='rgba(0,0,0,.45)'; c.lineWidth=lw*.9; c.beginPath(); c.moveTo(r*.84,(cy-.22)*r); c.lineTo(r*.9,(cy+.22)*r); c.stroke();   // bend crease
    c.strokeStyle='rgba(255,255,255,.22)'; c.lineWidth=lw*.4; c.beginPath(); c.moveTo(r*.84+lw*.8,(cy-.22)*r); c.lineTo(r*.9+lw*.8,(cy+.22)*r); c.stroke();}
  for(const cr of p.cr||[]){
    c.strokeStyle='rgba(6,5,5,.88)'; c.lineWidth=lw; c.beginPath();
    cr.forEach((q,i)=>i?c.lineTo(q[0]*r,q[1]*r):c.moveTo(q[0]*r,q[1]*r)); c.stroke();
    c.strokeStyle='rgba(235,240,250,.26)'; c.lineWidth=lw*.4; c.beginPath();
    cr.forEach((q,i)=>i?c.lineTo(q[0]*r-lw*.7,q[1]*r):c.moveTo(q[0]*r-lw*.7,q[1]*r)); c.stroke();
  }
  if(p.bolt){const bx=r*.78, by=(cy+.12*(p.hs||1))*r;   // a bolt has sheared off, leaving a dark hole
    c.fillStyle='#050505'; c.beginPath(); c.arc(bx,by,r*.04,0,TAU); c.fill();
    c.strokeStyle='rgba(200,206,218,.5)'; c.lineWidth=lw*.5; c.stroke();}
  c.restore();
}
// the torn mount where a plate used to be: a jagged breach, a bracket, sheared bolt stubs, the spinner's own internals showing through,
// and a glow that cools over about 3 s. st: {r0,r1 (radial span, in r), w (half width), cy, kind:'piston'|'spar'|'gear'|'coil'|'furnace', glow}
function drawSocket(c,r,p,st){
  const tt=p&&p.tt!=null?p.tt:9, sd=(p&&p.seed)||1, w=st.w*r, cy=(st.cy||0)*r, x0=st.r0*r, x1=st.r1*r, span=x1-x0;
  const pts=[[x0,cy-w],[x0,cy+w]];
  for(let k=0;k<5;k++) pts.push([x1-hash01(sd,k)*span*.42, cy+w-k/4*2*w+(hash01(sd,k+9)-.5)*w*.3]);   // jagged tear
  c.save(); polyPath(c,pts); c.fillStyle='#0a090c'; c.fill(); c.clip();
  const mx=x0+span*.45, gl=st.glow||'#ff8a3a', fl=.75+.25*Math.sin(tt*9+sd);
  switch(st.kind){
    case 'piston':   // hydraulic tooth-root: two cylinders and a snapped stump
      c.fillStyle='#3a3f4d'; c.fillRect(x0+span*.08,cy-w*.8,span*.55,w*.5); c.fillRect(x0+span*.08,cy+w*.3,span*.55,w*.5);
      c.fillStyle='#b9c2d0'; c.fillRect(x0+span*.3,cy-w*.62,span*.45,w*.14); c.fillRect(x0+span*.3,cy+w*.48,span*.3,w*.14);
      c.fillStyle='#585d6b'; polyPath(c,[[x0+span*.4,cy-w*.25],[x0+span*.78,cy-w*.12],[x0+span*.7,cy+w*.2],[x0+span*.4,cy+w*.28]]); c.fill();
      break;
    case 'spar':     // snapped blade spar and a field coil
      c.strokeStyle='#6b7280'; c.lineWidth=w*.7; c.lineCap='butt'; c.beginPath(); c.moveTo(x0,cy); c.lineTo(x0+span*.8,cy+w*.25); c.stroke();
      c.strokeStyle=rgba(gl,.55*fl); c.lineWidth=Math.max(1,w*.16); c.beginPath(); c.arc(mx,cy,w*.55,0,TAU); c.stroke();
      break;
    case 'gear': {   // small gears still turning inside the gap
      const gr=w*.72;
      c.save(); c.translate(mx,cy); c.rotate(tt*3+sd); c.fillStyle='#b98a34';
      for(let k=0;k<7;k++){c.rotate(TAU/7); c.fillRect(gr*.7,-gr*.16,gr*.42,gr*.32);}
      c.beginPath(); c.arc(0,0,gr*.85,0,TAU); c.fill(); c.fillStyle='#2a1708'; c.beginPath(); c.arc(0,0,gr*.28,0,TAU); c.fill(); c.restore();
      c.strokeStyle='#d9c27a'; c.lineWidth=Math.max(1,w*.12); c.beginPath(); c.arc(x0+span*.1,cy+w*.5,w*.45,0,TAU*.8); c.stroke();   // mainspring
      break;}
    case 'coil':     // bare copper windings that occasionally spark
      for(let j=0;j<3;j++){c.strokeStyle=j%2?'#7a3d1c':'#d98b4a'; c.lineWidth=Math.max(1,w*.28); c.beginPath(); c.arc(x0,cy,w*(.5+j*.42),-1.2,1.2); c.stroke();}
      if(((tt*2.7+sd)%1)<.1){c.fillStyle='#fff6d0'; c.beginPath(); c.arc(x0+span*.6,cy+(hash01(sd,Math.floor(tt*2.7))-.5)*w,w*.14,0,TAU); c.fill();}
      break;
    case 'furnace':  // the furnace light leaking through the breach
      c.globalCompositeOperation='lighter';
      c.fillStyle=rgba(gl,.7*fl); c.fillRect(x0,cy-w,span,w*2);
      c.fillStyle=`rgba(255,240,200,${.25*fl})`; c.fillRect(x0,cy-w*.45,span*.7,w*.9);
      break;
  }
  c.globalCompositeOperation='source-over';
  const heat=clamp(1-tt/3,0,1);   // the tear glows hot, then cools
  if(heat>0){c.globalCompositeOperation='lighter'; c.fillStyle=`rgba(255,${Math.round(110+90*heat)},40,${.5*heat})`; c.fillRect(x0,cy-w,span,w*2); c.globalCompositeOperation='source-over';}
  c.restore();
  c.lineWidth=Math.max(1,r*.022); c.lineJoin='round'; c.strokeStyle='#050405'; polyPath(c,pts); c.stroke();
  c.strokeStyle='#4a4f5c'; c.lineWidth=Math.max(1,r*.03); c.beginPath(); c.moveTo(x0,cy-w); c.lineTo(x0,cy+w); c.stroke();   // mounting bracket
  c.fillStyle='#9aa1ad'; c.beginPath(); c.arc(x0+span*.16,cy-w*.62,r*.032,0,TAU); c.fill(); c.beginPath(); c.arc(x0+span*.16,cy+w*.62,r*.032,0,TAU); c.fill();   // sheared bolt stubs
}
