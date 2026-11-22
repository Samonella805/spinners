/* =====================================================================
   ADS: a thin wrapper round the Poki SDK.
   - On Poki (a poki.com / poki-gdn.com host, or ?poki in the URL) it loads the SDK and uses it.
   - Anywhere else (GitHub Pages, local files) every call is harmless: no ads, and rewarded offers are hidden.
   - ?adtest in the URL shows fake, clearly labelled ads instead, so the flow can be tested without Poki.
   The game only ever asks for ads at natural breaks: leaving the end screen, restarting or quitting from pause, and the opt-in
   Second Wind on the end screen. Never during a round.
   ===================================================================== */
const Ads=(()=>{
  const q=location.search, test=/[?&]adtest\b/.test(q), onPoki=/(^|\.)poki(-gdn)?\.com$/.test(location.hostname)||/[?&]poki\b/.test(q);
  let sdk=null, playing=false, busy=false;
  const ready=new Promise(res=>{
    if(!onPoki){res(); return;}
    const s=document.createElement('script'); s.src='https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
    s.onload=()=>{const P=window.PokiSDK; if(!P){res(); return;} P.init().then(()=>{sdk=P; res();}).catch(()=>{sdk=P; res();});};   // an ad blocker rejects init; the game must still run
    s.onerror=()=>res();
    document.head.appendChild(s);
  });
  // while an ad plays the game is silent and frozen (the caller waits for the promise before doing anything)
  const quiet=on=>{try{SFX.background(on);}catch{}};
  // a stand-in ad for ?adtest: a dark screen with a countdown
  function fake(sec,label){
    return new Promise(res=>{
      const d=document.createElement('div');
      d.style.cssText='position:fixed;inset:0;z-index:100;background:#000d;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font:800 22px ui-sans-serif,system-ui;letter-spacing:.2em';
      d.innerHTML=`<div>${label}</div><div style="font-size:13px;opacity:.6;margin-top:10px">TEST AD (?adtest)</div><div id="adT" style="font-size:40px;margin-top:16px"></div>`;
      document.body.appendChild(d);
      let t=sec; const tick=()=>{d.querySelector('#adT').textContent=Math.ceil(t); if((t-=.25)<=0){d.remove(); res();} else setTimeout(tick,250);}; tick();
    });
  }
  return {
    ready,
    loaded(){ready.then(()=>{try{sdk&&sdk.gameLoadingFinished();}catch{}});},
    gameplayStart(){if(playing) return; playing=true; try{sdk&&sdk.gameplayStart();}catch{}},
    gameplayStop(){if(!playing) return; playing=false; try{sdk&&sdk.gameplayStop();}catch{}},
    // an ad break at a natural pause; resolves when the game may carry on (immediately when there is no ad)
    commercial(){
      this.gameplayStop();
      if(busy) return Promise.resolve();
      busy=true; quiet(true);
      const p=sdk?sdk.commercialBreak(()=>quiet(true)):(test?fake(2,'AD BREAK'):Promise.resolve());
      return Promise.resolve(p).catch(()=>{}).then(()=>{busy=false; quiet(false);});
    },
    // an opt-in rewarded ad; resolves true only if the player watched it through
    rewarded(){
      this.gameplayStop();
      if(busy) return Promise.resolve(false);
      busy=true; quiet(true);
      const p=sdk?sdk.rewardedBreak(()=>quiet(true)):(test?fake(3,'REWARDED AD').then(()=>true):Promise.resolve(false));
      return Promise.resolve(p).catch(()=>false).then(ok=>{busy=false; quiet(false); return !!ok;});
    },
    canReward(){return !!sdk||test;},
  };
})();
