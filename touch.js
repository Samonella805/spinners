/* =====================================================================
   TOUCH CONTROLS: floating virtual joysticks for phones and tablets.
   Put a thumb down anywhere on the arena and drag: the stick appears where the thumb landed, and how far it is dragged
   (up to JOY_R px) is how hard the spinner accelerates, exactly like holding the keys but analogue. With one human player
   the whole screen is that player's stick; with two humans on one device the screen splits down the middle (left: P1, right: P2).
   Mouse input never creates a stick, so desktop play is unchanged. Loaded after game.js (it uses its state and canvas).
   ===================================================================== */
const TOUCH=('ontouchstart' in window)||navigator.maxTouchPoints>0;
const JOY_R=60;          // px of drag for full deflection
const JOY_DEAD=.12;      // fraction of JOY_R that counts as centred
const JOY_FOLLOW=1.5;    // drag further than this many JOY_R and the stick's base follows the thumb, so it never feels stuck
const joys=[null,null];  // per player: {id, ox, oy (base), x, y (thumb)}

// which player a touch at screen x steers, or -1 when nobody human is playing
function joySlot(x){
  const hum=game?game.fighters.filter(f=>f.ctrl==='human'&&f.alive).map(f=>f.idx):[];
  if(!hum.length) return -1;
  if(hum.length===1) return hum[0];
  return x<W/2?0:1;
}
function joyClear(){joys[0]=joys[1]=null;}
// the stick's steering vector for player i (length 0..1), or null when that player has no thumb down
function touchInput(i){
  const j=joys[i]; if(!j) return null;
  let dx=(j.x-j.ox)/JOY_R, dy=(j.y-j.oy)/JOY_R; const l=Math.hypot(dx,dy);
  if(l<JOY_DEAD) return [0,0];
  const k=Math.min(1,(l-JOY_DEAD)/(1-JOY_DEAD))/l;
  return [dx*k,dy*k];
}
cv.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'||state!=='game'||!game||game.paused||game.over) return;
  const s=joySlot(e.clientX); if(s<0||joys[s]) return;
  joys[s]={id:e.pointerId,ox:e.clientX,oy:e.clientY,x:e.clientX,y:e.clientY};
  try{cv.setPointerCapture(e.pointerId);}catch{}
  e.preventDefault();
});
cv.addEventListener('pointermove',e=>{
  const j=joys.find(q=>q&&q.id===e.pointerId); if(!j) return;
  j.x=e.clientX; j.y=e.clientY;
  const dx=j.x-j.ox, dy=j.y-j.oy, l=Math.hypot(dx,dy), m=JOY_R*JOY_FOLLOW;
  if(l>m){j.ox=j.x-dx/l*m; j.oy=j.y-dy/l*m;}
  e.preventDefault();
});
const joyEnd=e=>{for(let i=0;i<2;i++) if(joys[i]&&joys[i].id===e.pointerId) joys[i]=null;};
cv.addEventListener('pointerup',joyEnd); cv.addEventListener('pointercancel',joyEnd); cv.addEventListener('lostpointercapture',joyEnd);
// the page must never scroll, bounce or zoom under a thumb that is steering
cv.addEventListener('touchstart',e=>{if(state==='game') e.preventDefault();},{passive:false});
cv.addEventListener('touchmove',e=>{if(state==='game') e.preventDefault();},{passive:false});

// drawn in screen space over the finished frame: the stick's base ring and the thumb knob, in the player's HUD colour.
// Before the first touch of a match on a touch device, a hint says how to steer.
function drawJoys(c,g){
  if(!TOUCH) return;
  c.save();
  for(let i=0;i<2;i++){
    const j=joys[i]; if(!j) continue;
    const col=i?'56,189,248':'251,146,60', v=touchInput(i)||[0,0], kx=j.ox+v[0]*JOY_R, ky=j.oy+v[1]*JOY_R;
    c.fillStyle=`rgba(${col},.08)`; c.strokeStyle=`rgba(${col},.45)`; c.lineWidth=2;
    c.beginPath(); c.arc(j.ox,j.oy,JOY_R,0,TAU); c.fill(); c.stroke();
    c.fillStyle=`rgba(${col},.55)`; c.strokeStyle='rgba(255,255,255,.7)';
    c.beginPath(); c.arc(kx,ky,24,0,TAU); c.fill(); c.stroke();
  }
  if(g&&!g.touched&&g.fighters.some(f=>f.ctrl==='human')){
    if(joys[0]||joys[1]) g.touched=true;
    else{
      const a=.55+.35*Math.sin(g.time*4), two=g.fighters.every(f=>f.ctrl==='human');
      c.textAlign='center'; c.textBaseline='middle'; c.font='800 15px ui-sans-serif,system-ui'; c.fillStyle=`rgba(255,255,255,${a})`;
      c.fillText(two?'EACH PLAYER: DRAG ON YOUR HALF TO STEER':'DRAG ANYWHERE TO STEER',W/2,H-Math.max(40,H*.08));
    }
  }
  c.restore();
}

// the page went to the background (tab switched, app minimised, phone locked): pause the match, drop any held input, stop the sound
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    for(const k in keys) keys[k]=false; joyClear();
    if(state==='game'&&game&&!game.over) setPause(true);
  }
  SFX.background(document.hidden);
});
