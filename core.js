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
