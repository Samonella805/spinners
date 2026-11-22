/* =====================================================================
   ADS: one small wrapper over the portal SDKs, so the game itself never cares where it runs.
   - Poki         (a poki.com / poki-gdn.com host, or ?poki):              Poki SDK v2
   - CrazyGames   (a crazygames host, or ?crazygames):                   CrazyGames SDK v3
   - anywhere else (GitHub Pages, local files): every call is harmless, no ads, rewarded offers are hidden
   - ?adtest: fake, clearly labelled ads anywhere, to test the flow without a portal
   - window.SPIN_NO_ADS (set by build.ps1 -NoAds, e.g. for a CrazyGames Basic Launch): the SDK still gets loading and gameplay events,
     but no ad is ever requested and Second Wind is hidden
   The game only asks for ads at natural breaks: leaving the end screen, restarting or quitting from pause, and the opt-in Second
   Wind on the end screen. Never during a round. While an ad plays the game is silent and waits.
   Check the SDK calls below against each portal's current documentation when uploading.
   ===================================================================== */
const Ads=(()=>{
  const q=location.search, host=location.hostname, test=/[?&]adtest\b/.test(q), noAds=!!window.SPIN_NO_ADS;
  const portal=/(^|\.)poki(-gdn)?\.com$/.test(host)||/[?&]poki\b/.test(q)?'poki'
              :/crazygames/.test(host)||/[?&]crazygames\b/.test(q)?'crazy':null;
  // a portal adapter: init(), loaded(), start(), stop(), midgame(onStart) -> Promise, rewarded(onStart) -> Promise<bool>
  let A=null, playing=false, busy=false, device=null;
  const ADAPTERS={
    poki:{src:'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
      make(){const P=window.PokiSDK; if(!P) return null; return P.init().catch(()=>{}).then(()=>({   // an ad blocker rejects init; the game must still run
        loaded:()=>P.gameLoadingFinished(), start:()=>P.gameplayStart(), stop:()=>P.gameplayStop(),
        midgame:on=>P.commercialBreak(on), rewarded:on=>P.rewardedBreak(on).then(r=>!!r)}));}},
    crazy:{src:'https://sdk.crazygames.com/crazygames-sdk-v3.js',
      make(){const C=window.CrazyGames&&window.CrazyGames.SDK; if(!C) return null;
        const ad=(type,on)=>new Promise(res=>C.ad.requestAd(type,{adStarted:on,adFinished:()=>res(true),adError:()=>res(false)}));
        return C.init().catch(()=>{}).then(()=>{try{C.game.loadingStart();}catch{}
          // the portal's mute setting overrides the in-game sound toggle
          try{const s=C.game.settings; const m=v=>{SFX.portalMute(v); try{syncMute();}catch{}}; m(!!(s&&s.muteAudio)); C.game.addSettingsChangeListener(n=>m(!!(n&&n.muteAudio)));}catch{}
          try{const d=C.user.systemInfo.device.type; if(d) device=d;}catch{}   // 'desktop' | 'tablet' | 'mobile'
          return {
          loaded:()=>C.game.loadingStop(), start:()=>C.game.gameplayStart(), stop:()=>C.game.gameplayStop(),
          midgame:on=>ad('midgame',on), rewarded:on=>ad('rewarded',on)};});}},
  };
  const ready=new Promise(res=>{
    const P=ADAPTERS[portal]; if(!P){res(); return;}
    const s=document.createElement('script'); s.src=P.src;
    s.onload=()=>Promise.resolve(P.make()).then(a=>{A=a; res();}).catch(()=>res());
    s.onerror=()=>res();   // blocked or offline: play on without ads
    document.head.appendChild(s);
  });
  const call=(fn,...a)=>{try{return A&&A[fn](...a);}catch{}};
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
    portal, ready,
    loaded(){ready.then(()=>call('loaded'));},
    gameplayStart(){if(playing) return; playing=true; call('start');},
    gameplayStop(){if(!playing) return; playing=false; call('stop');},
    // an ad break at a natural pause; resolves when the game may carry on (immediately when there is no ad)
    commercial(){
      this.gameplayStop();
      if(busy) return Promise.resolve();
      busy=true; quiet(true);
      const p=noAds?null:A?call('midgame',()=>quiet(true)):(test?fake(2,'AD BREAK'):null);
      return Promise.resolve(p).catch(()=>{}).then(()=>{busy=false; quiet(false);});
    },
    // an opt-in rewarded ad; resolves true only if the player watched it through
    rewarded(){
      this.gameplayStop();
      if(busy) return Promise.resolve(false);
      busy=true; quiet(true);
      const p=noAds?false:A?call('rewarded',()=>quiet(true)):(test?fake(3,'REWARDED AD').then(()=>true):false);
      return Promise.resolve(p).catch(()=>false).then(ok=>{busy=false; quiet(false); return !!ok;});
    },
    canReward(){return !noAds&&(!!A||test);},
    device(){return device;},   // the portal's device type, when it reports one
  };
})();
