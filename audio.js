/* =====================================================================
   SPIN ARENA - procedural audio (Web Audio API, no sample files)
   No dependency on the game: game.js only calls the SFX API below.

     SFX.unlock()              call from any user gesture (browsers require one)
     SFX.click(kind)           UI button sound: 'click' (default), 'select', 'back', 'start'
     SFX.duck(sec)             hit-stop muffle: spin hum down to ~15% and lowpassed for sec seconds, then released
     SFX.ricochet(speed,kick,delay)  extra-hard bounce, layered over clang (pitch-bent whang + crack)
     SFX.clang(impact,m1,m2,damage,delay,mat1,mat2,pan)  spinner-vs-spinner hit. impact ~45..700 px/s, masses set the pitch,
                               damage (HP taken, optional) layers a sub-bass punch above ~6 HP; mat1/mat2 are the spinners'
                               material ids (iron, brass, junk, furnace, alloy, spring) so every pairing rings differently
     SFX.grind(level,delay,pan)  glancing contact: short rasping scrape instead of a clang
     SFX.wall(speed,pan,mat)   the arena rim taking a hard hit: low long ring plus a dull slap
     SFX.clatter(size,speed,pan)  a plate landing after a hop on the floor
     SFX.tink(speed,pan)       quiet tick of a cosmetic fragment bouncing
     SFX.heartbeat(urgency)    0..1, call every frame: Last Stand heartbeat + faint alarm (0 = off)
     SFX.tick(pitch,alt)       Clockwork escapement tick (alt=0) / tock (alt=1), pitch ~1..1.3 rises with the cycle
     SFX.sproing(pan)          Clockwork's mainspring uncoiling from a dying body
     SFX.pop(pan)              Scrap-King's magnet failing at death
     SFX.collapse(pan)         Eater's furnace caving in during its death spin
     SFX.bellChime()           clock-tower gong plus sub drop: the final tick that starts Overdrive
     SFX.gearGroan(dur)        winding-down gear groan for burnout, dur in seconds
     SFX.timeWarp(on)          call every frame: muffles the mix while time is dilated
     SFX.magnet(level)         0..1, call every frame: Scrap-King's low electromagnet hum
     SFX.salvage()             scrap snapping onto Scrap-King's ring (or ripped off the rim)
     SFX.polarity(n)           polarity blast: pneumatic thump, whoosh and metallic scatter, n = pieces fired
     SFX.spin(idx,id,speed01,pan,on,wear)  (wear 0..1 = dying-motor wobble) call every frame per spinner: a quiet looping spin voice with its own timbre per
                               spinner id; pitch follows speed01 (spin / base spin), pan -1..1, on=false silences it
     SFX.stack(n)              Monster gaining Ricochet stack n (1..4): a short zing that climbs in pitch with n
     SFX.eat(size)             Eater swallowing a piece of scrap: heavy metallic crunch plus a downward gulp
     SFX.acid(kind)            'infect' or 'drain': sizzling acid hiss with bubbling; 'drain' adds a descending zap
     SFX.scrape(level)         0..1, call every frame: looping wall-grind
     SFX.sizzle(level)         0..1, call every frame: looping gravity-field crackle
     SFX.chip()                a tooth or blade snaps off
     SFX.debris(speed)         debris ticking off walls, fighters and other debris
     SFX.shatter(size)         KO explosion
     SFX.toggleMute() / setMuted(bool) / isMuted()
     SFX.silence()             zero the looping voices (pause, menus)
   ===================================================================== */
const SFX = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const KEY_MUTE = 'spinarena.muted', KEY_VOL = 'spinarena.vol';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable: ignore */ } }
  };

  let spinBus = null, spinLp = null;
  let ctx = null, master = null, bus = null, noiseBuf = null, clip = null, warp = null, warpOn = false;
  let beatNext = 0;         // heartbeat: next scheduled beat (audio clock)
  let muted = store.get(KEY_MUTE) === '1';
  let volume = clamp(parseFloat(store.get(KEY_VOL) || '0.7'), 0, 1);
  let voices = 0;
  const last = {};          // per-sound rate limiting
  const loops = {};         // looping voices: scrape, sizzle
  const spins = {};         // per-spinner spin voices, keyed by player index
  const SPIN_GAIN = 0.05;   // spin voices stay far below the clangs (0.2..0.7)
  const MAX_VOICES = 28;
  const METAL = [1, 2.76, 5.4, 8.93];     // inharmonic partial ratios of a struck metal plate

  function masterLevel() { return muted ? 0 : volume; }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = masterLevel();
    // compressor so a pile-up of clangs can't clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    bus = ctx.createGain(); bus.gain.value = 0.9;
    // lowpass on the whole mix, wide open (20 kHz) until timeWarp() closes it during Clockwork's Overdrive
    warp = ctx.createBiquadFilter(); warp.type = 'lowpass'; warp.frequency.value = 20000; warp.Q.value = 0.5;
    bus.connect(comp); comp.connect(warp); warp.connect(master); master.connect(ctx.destination);
    // soft clipper for the sub-bass layer
    clip = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 512) - 1) * 2.2) / Math.tanh(2.2);
    clip.curve = curve; clip.connect(bus);
    // every spin voice goes through spinBus: duck() muffles it (volume down, lowpass closed) during a hit-stop freeze
    spinLp = ctx.createBiquadFilter(); spinLp.type = 'lowpass'; spinLp.frequency.value = 20000; spinLp.Q.value = 0.5;
    spinBus = ctx.createGain(); spinBus.gain.value = 1;
    spinBus.connect(spinLp); spinLp.connect(bus);
    // one shared second of white noise, reused by every noise-based sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function ready() { return ctx && ctx.state === 'running' && !muted; }
  function limit(name, ms) {
    const now = performance.now();
    if (last[name] && now - last[name] < ms) return false;
    last[name] = now; return true;
  }
  // count a one-shot voice until its last node ends
  function track(node) {
    voices++;
    node.onended = () => { voices--; };
  }

  // a decaying sine partial
  function partial(freq, t, dur, vol, dest, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || bus);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  // a filtered noise burst
  function noise(t, dur, vol, type, freq, q, dest) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || bus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
    return s;
  }

  function unlock() {
    if (!ctx) build();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // a sine with a pitch drop, routed through the soft clipper so big hits get weight without hard distortion
  function thump(t, f0, f1, dur, vol, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || bus); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  // damage is the HP the hit took. Hits above ~6 HP add a deep sub-bass punch under the metallic ring.
  // delay (seconds) holds the whole sound back, so a hit-stop freeze can end before the clang lands.
  // Materials: what a spinner's armour is made of. pitch scales the ring, ring its decay, ratios are the partials (inharmonic = clangy),
  // type the oscillator shape, hiss the strike noise, body the low thump. Unknown ids fall back to iron.
  const MATS = {
    iron:    { pitch: 0.8,  ring: 0.8,  ratios: [1, 2.76, 5.4, 8.93],  type: 'sine',     hiss: 0.8, body: 1.3 },   // Big Boy: dull low thud
    brass:   { pitch: 1.05, ring: 1.5,  ratios: [1, 2.0, 3.01, 4.2],   type: 'sine',     hiss: 0.5, body: 0.8 },   // Clockwork: bell-like
    junk:    { pitch: 0.95, ring: 0.6,  ratios: [1, 2.31, 4.1, 6.77],  type: 'square',   hiss: 1.4, body: 1.0 },   // Scrap-King: rattly
    furnace: { pitch: 0.7,  ring: 0.7,  ratios: [1, 1.6, 3.3, 5.2],    type: 'triangle', hiss: 0.9, body: 1.5 },   // Eater: dull and heavy
    alloy:   { pitch: 1.35, ring: 1.0,  ratios: [1, 2.76, 5.4, 8.93],  type: 'sine',     hiss: 1.2, body: 0.6 },   // Whirl: thin and bright
    spring:  { pitch: 1.2,  ring: 1.3,  ratios: [1, 2.4, 4.8, 7.1],    type: 'triangle', hiss: 0.7, body: 0.7 }    // Monster: springy ping
  };
  const mat = id => MATS[id] || MATS.iron;
  // pan = -1..1, or undefined for centre: returns the node a one-shot should connect to
  function dest(pan) {
    if (pan == null || !ctx.createStereoPanner) return bus;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1) * 0.7; p.connect(bus); return p;
  }

  // damage is the HP the hit took. Hits above ~6 HP add a deep sub-bass punch under the metallic ring.
  // delay (seconds) holds the whole sound back, so a hit-stop freeze can end before the clang lands.
  // mat1/mat2: the two spinners' material ids, so every pairing sounds different. pan: screen position -1..1.
  function clang(impact, m1, m2, damage, delay, mat1, mat2, pan) {
    if (!ready() || voices > MAX_VOICES || !limit('clang', 40)) return;
    const k = clamp((impact - 45) / 520, 0, 1);
    const sub = clamp(((damage || 0) - 6) / 16, 0, 1);
    const mass = ((m1 || 2) + (m2 || 2)) / 2;
    const A = mat(mat1), B = mat(mat2 || mat1), out = dest(pan);
    const base = 640 / Math.sqrt(mass) * (A.pitch + B.pitch) / 2;      // heavier spinners ring lower, and the metals shift it
    const ring = (A.ring + B.ring) / 2, hiss = (A.hiss + B.hiss) / 2, body = (A.body + B.body) / 2;
    const t = ctx.currentTime + (delay || 0), v = (0.22 + 0.5 * k) * (1 - 0.3 * sub);   // duck the ring a little while the sub plays
    for (let i = 0; i < 4; i++) {
      const M = i % 2 ? B : A;                                          // the partials alternate between the two materials
      const o = partial(base * M.ratios[i] * rand(0.985, 1.015), t, (0.55 - i * 0.11) * (0.6 + k) * ring, v * [1, 0.6, 0.35, 0.2][i], out, M.type);
      if (i === 0) track(o);
    }
    if (sub > 0) {
      track(thump(t, 68, 28, 0.3, 0.95 * sub + 0.15, clip));
      thump(t, 135, 45, 0.12, 0.35 * sub, clip);                                       // short punch on top
    }
    noise(t, 0.03 + 0.03 * k, (0.35 * k + 0.1) * hiss, 'highpass', 2200, 0.7, out);    // strike transient
    if (k > 0.25) {                                                                    // body thump
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130 / Math.sqrt(mass) + 60, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
      g.gain.setValueAtTime(0.55 * k * body, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.18);
    }
  }

  // Two rims slipping past each other without a solid hit: a short rasping scrape instead of a clang. level 0..1.
  function grind(level, delay, pan) {
    if (!ready() || voices > MAX_VOICES - 4 || !limit('grind', 110)) return;
    const k = clamp(level, 0.1, 1), t = ctx.currentTime + (delay || 0), out = dest(pan);
    const s = noise(t, 0.12 + 0.12 * k, 0.16 + 0.22 * k, 'bandpass', 1500 + 1600 * k, 2.4, out);   // rasp
    track(s);
    noise(t, 0.09, 0.1 * k, 'highpass', 4200, 0.8, out);                                           // shrill edge
    partial(rand(310, 420) * (1 + k * 0.4), t, 0.1, 0.07 * k, out, 'sawtooth');                    // gritty buzz underneath
  }

  // The arena rim taking a hit: a low, long ring (steel wall) with a dull slap. speed = impact speed px/s, id = the spinner's material.
  function wall(speed, pan, matId) {
    if (!ready() || voices > MAX_VOICES - 3 || !limit('wall', 90)) return;
    const k = clamp((speed - 120) / 700, 0, 1), M = mat(matId), t = ctx.currentTime, out = dest(pan);
    const f = 92 * (0.9 + 0.2 * M.pitch);
    [[1, 0.2], [1.58, 0.12], [2.9, 0.06]].forEach(([r, vol], i) => {
      const o = partial(f * r * rand(0.99, 1.01), t, (0.35 + 0.5 * k) * (1 - i * 0.2), vol * (0.5 + 0.9 * k), out, 'sine');
      if (i === 0) track(o);
    });
    thump(t, 150, 48, 0.16, 0.25 + 0.45 * k, clip);
    noise(t, 0.04, 0.12 + 0.2 * k, 'bandpass', 1200, 1.1, out);
  }

  // a plate landing on the floor after a hop: noisy clatter plus a short ring. size ~6..30 px, speed px/s.
  function clatter(size, speed, pan) {
    if (!ready() || voices > MAX_VOICES - 6 || !limit('clatter', 45)) return;
    const k = clamp(speed / 500, 0.15, 1), sz = clamp(size / 26, 0.3, 1.2), t = ctx.currentTime, out = dest(pan);
    const f = rand(900, 1500) / Math.sqrt(sz);                                                     // big plates ring lower
    track(partial(f, t, 0.09 + 0.18 * sz, 0.16 * k, out));
    partial(f * 2.76, t, 0.06 + 0.06 * sz, 0.08 * k, out);
    noise(t, 0.03 + 0.03 * sz, 0.2 * k, 'bandpass', 2600 / sz, 1.3, out);
    if (sz > 0.6) thump(t, 140 / sz, 60, 0.07, 0.15 * k * sz, clip);                               // heavy plates thud
  }

  // quiet tick of a cosmetic fragment bouncing off the wall or a spinner
  function tink(speed, pan) {
    if (!ready() || voices > MAX_VOICES - 8 || !limit('tink', 55)) return;
    const t = ctx.currentTime, v = clamp(speed / 600, 0.2, 0.6) * 0.09, f = rand(2600, 5200), out = dest(pan);
    track(partial(f, t, rand(0.03, 0.07), v, out));
  }

  // Extra-hard Beyblade ricochet, layered over clang(): a sharp crack, a pitch-bent metallic "whang" that sweeps
  // down as the spinners fly apart, and a short heavy slap. speed = separating speed (px/s), kick = spin-kick (px/s).
  function ricochet(speed, kick, delay) {
    if (!ready() || voices > MAX_VOICES - 2 || !limit('ricochet', 90)) return;
    const k = clamp((speed - 430) / 500, 0, 1), s = clamp((kick || 0) / 140, 0, 1);
    const t = ctx.currentTime + (delay || 0), f0 = 1500 + 900 * k + 500 * s, dur = 0.2 + 0.18 * k;
    noise(t, 0.025, 0.45, 'bandpass', 5200, 1.4);                          // crack
    for (const [mul, type, vol] of [[1, 'triangle', 0.2], [1.51, 'sine', 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0 * mul, t);
      o.frequency.exponentialRampToValueAtTime(f0 * mul * 0.3, t + dur);   // downward pitch bend: the whang
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * (0.7 + 0.5 * k), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
      if (mul === 1) track(o);
    }
    thump(t, 190, 70, 0.14, 0.3 + 0.3 * k, clip);                          // slap
  }

  // stalemate penalty: a two-tone warning stab over a low thump, so it reads as a rule kicking in rather than a hit
  function stalemate() {
    if (!ready() || !limit('stalemate', 800)) return;
    const t = ctx.currentTime;
    track(partial(392, t, 0.28, 0.2, null, 'sawtooth'));
    partial(294, t + 0.16, 0.36, 0.2, null, 'sawtooth');
    thump(t, 120, 38, 0.4, 0.7, clip);
    noise(t, 0.18, 0.25, 'bandpass', 900, 1.2);
  }

  function chip() {
    if (!ready() || voices > MAX_VOICES || !limit('chip', 50)) return;
    const t = ctx.currentTime, f = rand(1900, 2700);
    track(partial(f, t, 0.16, 0.3));
    partial(f * 2.76, t, 0.1, 0.16);
    noise(t, 0.045, 0.3, 'bandpass', 3200, 1.2);
  }

  // size ~6..30 px (big pieces ring lower and longer), surface 'wall' | 'fighter' | 'piece', pan -1..1. All but speed are optional.
  function debris(speed, size, surface, pan) {
    if (!ready() || voices > MAX_VOICES - 6 || !limit('debris', 30)) return;
    const sz = clamp((size || 10) / 24, 0.3, 1.3), out = dest(pan);
    const t = ctx.currentTime, v = clamp(speed / 700, 0.12, 0.55) * 0.3, f = rand(1400, 3800) / (0.6 + 0.6 * sz);
    track(partial(f, t, rand(0.05, 0.13) * (0.7 + sz), v, out));
    partial(f * 1.5, t, 0.05, v * 0.4, out);
    if (surface === 'wall') thump(t, 120, 55, 0.08, v * 0.9, clip);                // skids off the steel rim with a dull knock
    else if (surface === 'fighter') noise(t, 0.025, v * 0.8, 'highpass', 3000, 0.8, out);   // a bright slap off the armour
  }

  function shatter(size) {
    if (!ready() || !limit('shatter', 150)) return;
    const t = ctx.currentTime, s = clamp((size || 30) / 38, 0.6, 1.3);
    noise(t, 0.6, 0.7, 'highpass', 1400, 0.7);                         // glassy burst
    noise(t, 0.3, 0.55, 'bandpass', 700 / s, 0.9);                     // crunch
    const o = ctx.createOscillator(), g = ctx.createGain();            // sub-thump with a pitch drop
    o.frequency.setValueAtTime(150 / s, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.4);
    g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.5);
    const n = 10 + ((Math.random() * 11) | 0);                         // falling shards: random high tinks
    for (let i = 0; i < n; i++) {
      const at = t + rand(0.02, 0.6), f = rand(1800, 6500);
      partial(f, at, rand(0.12, 0.3), rand(0.07, 0.2));
      partial(f * 2.76, at, 0.08, 0.05);
    }
  }

  // Clockwork escapement. alt=0 is the high "tick", alt=1 the lower "tock". pitch ~1.0..1.3 rises with the cycle.
  function tick(pitch, alt) {
    if (!ready() || voices > MAX_VOICES || !limit('tick', 60)) return;
    const t = ctx.currentTime, p = pitch || 1, f = (alt ? 1450 : 2050) * p;
    noise(t, 0.008, 0.32, 'bandpass', 3600 * p, 2.2);          // the click of the pallet hitting the wheel
    track(partial(f, t, 0.03, 0.26));                          // damped metallic ping
    partial(f * 2.1, t, 0.018, 0.1);
    partial((alt ? 300 : 410) * p, t, 0.05, 0.2);              // small wooden-case body
  }

  // Clockwork's mainspring uncoiling out of a dying body: a wobbling, falling sine "sproing" over a metallic ping and a rattle
  function sproing(pan) {
    if (!ready() || voices > MAX_VOICES - 2 || !limit('sproing', 400)) return;
    const t = ctx.currentTime, out = dest(pan), dur = 0.65;
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine'; lfo.frequency.value = 24; lg.gain.value = 140;
    lfo.connect(lg); lg.connect(o.frequency);
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(150, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || bus); o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02); track(o);
    partial(2300, t, 0.25, 0.14, out);
    noise(t, 0.12, 0.18, 'bandpass', 4200, 1.6, out);
  }

  // Scrap-King's magnet failing: a flat electrical pop, a short falling zap and a dull thud
  function pop(pan) {
    if (!ready() || voices > MAX_VOICES - 2 || !limit('pop', 300)) return;
    const t = ctx.currentTime, out = dest(pan);
    noise(t, 0.05, 0.5, 'bandpass', 1800, 0.9, out);
    thump(t, 160, 45, 0.22, 0.6, clip);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(out || bus); o.start(t); o.stop(t + 0.3); track(o);
  }

  // Eater's furnace caving in: a long falling groan with a wet rattle, ending in a heavy gulp
  function collapse(pan) {
    if (!ready() || voices > MAX_VOICES - 2 || !limit('collapse', 600)) return;
    const t = ctx.currentTime, out = dest(pan), dur = 0.7;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(34, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || bus); o.start(t); o.stop(t + dur + 0.02); track(o);
    noise(t, dur * 0.8, 0.22, 'lowpass', 600, 0.8, out);
    thump(t + dur * 0.85, 90, 30, 0.2, 0.5, clip);
  }

  // Clock-tower gong for the final tick: inharmonic bell partials (the low ones detuned in pairs so they beat),
  // a dull strike transient and a sub-bass drop. One voice, rate-limited to once a second.
  function bellChime() {
    if (!ready() || !limit('bell', 1000)) return;
    const t = ctx.currentTime, base = 98;
    const RATIO = [0.5, 1, 1.19, 1.5, 2, 2.74], VOL = [0.32, 0.42, 0.22, 0.16, 0.14, 0.08], DUR = [4, 3.6, 3, 2.4, 1.8, 1.2];
    RATIO.forEach((r, i) => {
      const o = partial(base * r, t, DUR[i], VOL[i]);
      if (i === 1) track(o);
      if (i < 3) partial(base * r * 1.004, t, DUR[i], VOL[i] * 0.8);   // slow shimmer against the twin
    });
    noise(t, 0.06, 0.4, 'lowpass', 1800, 0.7);
    thump(t, 90, 24, 0.9, 0.9, clip);
  }

  // Winding-down gear groan for burnout. dur follows the burnout length (1..3 s): a sawtooth sliding down through a
  // closing lowpass, a tremolo that slows from 14 to 3 Hz, a decelerating ratchet and a little crackle.
  function gearGroan(dur) {
    if (!ready() || voices > MAX_VOICES || !limit('groan', 400)) return;
    const t = ctx.currentTime, d = clamp(dur || 2, 0.8, 3.5);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(35, t + d);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + d);
    const trem = ctx.createGain(); trem.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.type = 'sine';
    lfo.frequency.setValueAtTime(14, t); lfo.frequency.exponentialRampToValueAtTime(3, t + d);
    const depth = ctx.createGain(); depth.gain.value = 0.4;
    lfo.connect(depth); depth.connect(trem.gain);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.28, t + 0.05);
    out.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(lp); lp.connect(trem); trem.connect(out); out.connect(bus);
    o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    track(o);
    for (let at = 0, gap = 0.05; at < d * 0.9; at += gap, gap *= 1.17) noise(t + at, 0.012, 0.2, 'bandpass', 2200, 3);
    noise(t, d * 0.6, 0.08, 'highpass', 3500, 0.7);
  }

  // Sandevistan muffle: ease a lowpass on the master mix down while time is dilated, and back open afterwards.
  function timeWarp(on) {
    if (!ctx || !warp || on === warpOn) return;
    warpOn = on;
    warp.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, on ? 0.08 : 0.2);
  }

  // looping voice: band-passed noise plus a saw, gain follows `level`
  function loopVoice(name, make) {
    if (loops[name]) return loops[name];
    loops[name] = make();
    return loops[name];
  }
  function scrapeVoice() {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2.5;
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 150;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const sawG = ctx.createGain(); sawG.gain.value = 0.18;
    const out = ctx.createGain(); out.gain.value = 0;
    src.connect(bp); bp.connect(out); saw.connect(lp); lp.connect(sawG); sawG.connect(out); out.connect(bus);
    src.start(); saw.start();
    return { out, bp, saw, level: 0 };
  }
  function sizzleVoice() {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const am = ctx.createGain(); am.gain.value = 0.5;                  // crackle: noise amplitude-modulated by a fast LFO
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 33;
    const depth = ctx.createGain(); depth.gain.value = 0.5;
    lfo.connect(depth); depth.connect(am.gain);
    const out = ctx.createGain(); out.gain.value = 0;
    src.connect(hp); hp.connect(am); am.connect(out); out.connect(bus);
    src.start(); lfo.start();
    return { out, lfo, level: 0 };
  }
  function setLoop(v, level, gain, tc) {
    const t = ctx.currentTime;
    v.level = level;
    v.out.gain.setTargetAtTime(muted ? 0 : level * gain, t, tc || 0.05);
  }
  // hit-stop muffle: the spin hum drops to ~15% and its lowpass closes for sec seconds, then opens again in ~40 ms
  function duck(sec) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, end = t + Math.max(0.03, sec);
    for (const [p, lo, hi] of [[spinBus.gain, 0.15, 1], [spinLp.frequency, 350, 20000]]) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(lo, t, 0.008);
      p.setTargetAtTime(hi, end, hi > 1000 ? 0.015 : 0.012);
    }
  }
  function scrape(level) {
    if (!ctx || ctx.state !== 'running') return;
    if (level <= 0.001 && !loops.scrape) return;
    const v = loopVoice('scrape', scrapeVoice);
    if (Math.abs(v.level - level) < 0.01) return;
    v.bp.frequency.setTargetAtTime(1100 + 2800 * level, ctx.currentTime, 0.06);
    v.saw.frequency.setTargetAtTime(110 + 160 * level, ctx.currentTime, 0.06);
    setLoop(v, level, 0.3);
  }
  function sizzle(level) {
    if (!ctx || ctx.state !== 'running') return;
    if (level <= 0.001 && !loops.sizzle) return;
    const v = loopVoice('sizzle', sizzleVoice);
    if (Math.abs(v.level - level) < 0.01) return;
    v.lfo.frequency.setTargetAtTime(24 + 26 * level, ctx.currentTime, 0.08);
    setLoop(v, level, 0.12);
  }
  // Last Stand heartbeat. Call every frame with urgency 0..1 (0 = off). A "lub-dub" of two low thumps,
  // with a faint 880 Hz alarm tick tucked under the first one. Beats come faster as urgency rises.
  function heartbeat(urgency) {
    if (urgency <= 0 || !ready()) { beatNext = 0; return; }
    const t = ctx.currentTime;
    if (beatNext === 0) beatNext = t;
    if (t < beatNext) return;
    const u = clamp(urgency, 0, 1);
    thump(t, 78, 46, 0.2, 0.5 + 0.2 * u, clip);                  // lub
    thump(t + 0.17, 66, 40, 0.22, 0.34 + 0.16 * u, clip);        // dub
    partial(880, t, 0.09, 0.025 + 0.02 * u);                     // alarm tick, kept very quiet
    beatNext = t + 1.0 - 0.45 * u;
  }
  // Scrap-King's electromagnet: a low looping hum (50 Hz sine + detuned 100 Hz saw through a lowpass) with a slow wobble.
  // Call every frame with level 0..1; the pitch and brightness rise as the magnet works harder.
  function magnetVoice() {
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 50;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 100.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
    const sawG = ctx.createGain(); sawG.gain.value = 0.3;
    const am = ctx.createGain(); am.gain.value = 0.7;                   // wobble: slow tremolo
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 3.2;
    const depth = ctx.createGain(); depth.gain.value = 0.3;
    lfo.connect(depth); depth.connect(am.gain);
    const out = ctx.createGain(); out.gain.value = 0;
    o1.connect(am); o2.connect(sawG); sawG.connect(lp); lp.connect(am); am.connect(out); out.connect(bus);
    o1.start(); o2.start(); lfo.start();
    return { out, o2, lp, lfo, level: 0 };
  }
  function magnet(level) {
    if (!ctx || ctx.state !== 'running') return;
    if (level <= 0.001 && !loops.magnet) return;
    const v = loopVoice('magnet', magnetVoice);
    if (Math.abs(v.level - level) < 0.01) return;
    const t = ctx.currentTime;
    v.lp.frequency.setTargetAtTime(300 + 500 * level, t, 0.08);
    v.o2.frequency.setTargetAtTime(100.7 + 26 * level, t, 0.1);
    v.lfo.frequency.setTargetAtTime(2.6 + 4 * level, t, 0.1);
    setLoop(v, level, 0.2);
  }
  // scrap snapping onto the ring (or ripped off the rim): a magnetic thunk and a few metallic rattles
  function salvage() {
    if (!ready() || voices > MAX_VOICES || !limit('salvage', 70)) return;
    const t = ctx.currentTime;
    track(thump(t, 150, 70, 0.14, 0.26, clip));
    noise(t, 0.03, 0.12, 'bandpass', 2600, 3);
    for (let i = 0; i < 3; i++) {
      const dt = 0.02 + i * rand(0.03, 0.06);
      partial(rand(1500, 4200), t + dt, 0.09, 0.05 - i * 0.01, bus, 'triangle');
    }
  }
  // polarity reversal: pneumatic thump, rising air whoosh and hiss, then a metallic scatter. n = pieces fired.
  function polarity(n) {
    if (!ready() || !limit('polarity', 200)) return;
    const t = ctx.currentTime, k = clamp((n || 3) / 8, 0.3, 1);
    track(thump(t, 95, 28, 0.42, 0.55 + 0.25 * k, clip));              // the pneumatic thump
    thump(t, 62, 22, 0.6, 0.8, clip);                                    // deeper shockwave boom underneath
    noise(t, 0.14, 0.3, 'lowpass', 520, 0.8);
    partial(150, t, 0.1, 0.14, bus, 'square');                           // short punch on top so small speakers still hear it
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;   // whoosh: band-passed noise sweeping up
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 1.5); s.stop(t + 0.55);
    noise(t, 0.22, 0.18, 'highpass', 6000, 0.7);                         // air hiss
    const tinks = 6 + Math.round(10 * k);                                // metallic scatter over ~0.5 s
    for (let i = 0; i < tinks; i++) {
      const dt = 0.04 + Math.random() * 0.5;
      partial(rand(1800, 5600), t + dt, rand(0.07, 0.16), rand(0.03, 0.07), bus, i % 3 ? 'sine' : 'triangle');
    }
  }
  // UI button sounds: a short mechanical key-click. kind: 'click' (default), 'select' (pick a spinner),
  // 'back' (menu / back / pause), 'start' (enter arena, fight, rematch)
  function click(kind) {
    if (!ready() || !limit('click', 35)) return;
    const t = ctx.currentTime;
    if (kind === 'start') {
      noise(t, 0.04, 0.12, 'highpass', 3200, 0.7);
      partial(220, t, 0.22, 0.12, bus, 'triangle');
      partial(330, t + 0.07, 0.24, 0.11, bus, 'triangle');
      partial(495, t + 0.14, 0.34, 0.1, bus, 'triangle');
      thump(t, 110, 48, 0.25, 0.28, clip);
    } else if (kind === 'select') {
      noise(t, 0.02, 0.1, 'bandpass', 4200, 2);
      partial(740, t, 0.1, 0.1, bus, 'triangle');
      partial(1110, t + 0.035, 0.14, 0.08, bus, 'sine');
    } else if (kind === 'back') {
      noise(t, 0.02, 0.08, 'bandpass', 2400, 2);
      partial(420, t, 0.09, 0.1, bus, 'triangle');
      partial(280, t + 0.04, 0.12, 0.09, bus, 'triangle');
    } else {
      noise(t, 0.015, 0.1, 'bandpass', 3600, 2.5);
      partial(980, t, 0.06, 0.09, bus, 'triangle');
      partial(150, t, 0.05, 0.12, bus, 'sine');
    }
  }
  /* ---- spin voices: one quiet looping sound per spinner, each with its own timbre, like a beyblade's whirr ---- */
  // Every voice is built as sources -> mix -> out (the gain setLoop drives) -> stereo pan -> bus.
  // set(s,t) retunes it for speed s (about 0..1, 1 = the spinner's full base spin): pitch rises with s.
  function spinVoice(id) {
    const nodes = [];
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); nodes.push(o); return o; };
    const nz = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(0, Math.random() * 1.5); nodes.push(s); return s; };
    const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; };
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const mix = gain(1), out = gain(0);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : { pan: { setTargetAtTime() {} }, connect() {}, disconnect() {} };
    mix.connect(out);
    if (ctx.createStereoPanner) { out.connect(pan); pan.connect(spinBus); } else out.connect(spinBus);
    const tc = 0.06, to = (p, v, t) => p.setTargetAtTime(v, t, tc);
    let set;
    if (id === 'bigboy') {            // heavy: low lowpassed saw plus a rumble
      const o = osc('sawtooth', 60), lp = filt('lowpass', 300, 1), n = nz(), nl = filt('lowpass', 150), ng = gain(0.5), og = gain(0.6);
      o.connect(lp); lp.connect(og); og.connect(mix); n.connect(nl); nl.connect(ng); ng.connect(mix);
      set = (s, t) => { to(o.frequency, 52 + 70 * s, t); to(lp.frequency, 220 + 380 * s, t); };
    } else if (id === 'whirl') {      // light: a high, narrow noise whistle sweeping with speed plus a thin tone
      const n = nz(), bp = filt('bandpass', 1500, 9), w = osc('sine', 1200), wg = gain(0.25);
      n.connect(bp); bp.connect(mix); w.connect(wg); wg.connect(mix);
      set = (s, t) => { to(bp.frequency, 900 + 2600 * s, t); to(w.frequency, 1100 + 1900 * s, t); };
    } else if (id === 'clockwork') {  // a ratchet: a tone and tick-noise chopped by a square gate whose rate follows the spin
      const o = osc('triangle', 450), n = nz(), bp = filt('bandpass', 3200, 2), ng = gain(0.4), gate = gain(0.5);
      const lfo = osc('square', 20), depth = gain(0.5);
      lfo.connect(depth); depth.connect(gate.gain);
      o.connect(gate); n.connect(bp); bp.connect(ng); ng.connect(gate); gate.connect(mix);
      set = (s, t) => { to(lfo.frequency, 12 + 30 * s, t); to(o.frequency, 380 + 520 * s, t); };
    } else if (id === 'scrapking') {  // gritty: noise amplitude-modulated at a fast rate plus two detuned saws
      const n = nz(), bp = filt('bandpass', 700, 3), am = gain(0.6), lfo = osc('sine', 26), depth = gain(0.4);
      const a = osc('sawtooth', 90), b = osc('sawtooth', 91.2), lp = filt('lowpass', 700), sg = gain(0.3);
      lfo.connect(depth); depth.connect(am.gain);
      n.connect(bp); bp.connect(am); am.connect(mix);
      a.connect(lp); b.connect(lp); lp.connect(sg); sg.connect(mix);
      set = (s, t) => { const f = 70 + 90 * s; to(a.frequency, f, t); to(b.frequency, f * 1.013, t); to(bp.frequency, 500 + 900 * s, t); to(lfo.frequency, 18 + 30 * s, t); };
    } else if (id === 'monster') {    // zippy: a detuned saw pair through a bright, opening lowpass, a rushing noise band and a fast tremolo
      const a = osc('sawtooth', 180), b = osc('sawtooth', 183), lp = filt('lowpass', 900, 2), sg = gain(0.3);
      const n = nz(), bp = filt('bandpass', 2400, 4), ng = gain(0.22);
      const lfo = osc('sine', 14), depth = gain(0.18);
      lfo.connect(depth); depth.connect(sg.gain);
      a.connect(lp); b.connect(lp); lp.connect(sg); sg.connect(mix); n.connect(bp); bp.connect(ng); ng.connect(mix);
      set = (s, t) => { const f = 130 + 260 * s; to(a.frequency, f, t); to(b.frequency, f * 1.015, t); to(lp.frequency, 700 + 2600 * s, t); to(bp.frequency, 1800 + 2600 * s, t); to(lfo.frequency, 9 + 22 * s, t); };
    } else {                          // eater (and any unknown spinner): a growling saw with a wobble plus churning noise
      const o = osc('sawtooth', 80), lp = filt('lowpass', 450, 3), vib = osc('sine', 6.5), vd = gain(4);
      const n = nz(), nl = filt('lowpass', 260), ng = gain(0.35);
      vib.connect(vd); vd.connect(o.frequency);
      o.connect(lp); lp.connect(mix); n.connect(nl); nl.connect(ng); ng.connect(mix);
      set = (s, t) => { const f = 62 + 84 * s; to(o.frequency, f, t); vd.gain.value = f * 0.05; to(lp.frequency, 300 + 500 * s, t); };
    }
    return {
      id, out, pan, level: 0, set,
      kill() { out.gain.value = 0; for (const n of nodes) { try { n.stop(); } catch (e) { /* already stopped */ } } try { out.disconnect(); pan.disconnect(); } catch (e) { /* ignore */ } }
    };
  }
  // wear 0..1: how badly the spinner is hurt. The hum pulses in and out at an uneven rate (matching the visual wobble) and
  // its pitch wavers; near 1 (Last Stand) it sputters with short dropouts. Never louder than SPIN_GAIN.
  // stall (optional boolean): the game says the motor is sputtering right now. The hum drops out and sags in pitch for exactly that moment,
  // replacing the random dropouts below, so what you hear matches what you see.
  function spin(idx, id, s, pan, on, wear, stall) {
    if (!ctx || ctx.state !== 'running') return;
    let v = spins[idx];
    if (v && v.id !== id) { v.kill(); v = spins[idx] = null; }   // a different spinner now owns this slot
    if (!on) { if (v && v.level > 0) setLoop(v, 0, 1); return; }
    if (!v) v = spins[idx] = spinVoice(id);
    s = clamp(s, 0, 1.6);   // above 1 only while a spinner is wound up (Monster's Ricochet stacks)
    const w = clamp(wear || 0, 0, 1), t = ctx.currentTime;
    const wob = Math.sin(t * 23 + idx) * 0.6 + Math.sin(t * (7 + 5 * w) + idx * 2) * 0.4;   // -1..1, uneven
    if (v.dropUntil === undefined) v.dropUntil = 0;
    if (stall === undefined && w > 0.75 && t > v.dropUntil && Math.random() < 0.04 * (w - 0.7) * 3) v.dropUntil = t + rand(0.05, 0.16);
    v.set(s * (1 + w * 0.06 * wob) * (stall ? 0.8 : 1), t);
    v.pan.pan.setTargetAtTime(clamp(pan || 0, -1, 1) * 0.6, t, 0.08);
    let lvl = clamp(0.35 + 0.65 * s, 0, 1) * (1 - w * 0.65 * (0.5 + 0.5 * wob));
    if (t < v.dropUntil || stall) lvl *= 0.08;
    setLoop(v, lvl, SPIN_GAIN, w > 0 ? 0.02 : 0.05);
  }

  // Monster banking off the wall: a short bright zing and a click. Pitch climbs with each stack n (1..4).
  function stack(n) {
    if (!ready() || voices > MAX_VOICES || !limit('stack', 60)) return;
    const t = ctx.currentTime, k = clamp(n || 1, 1, 4), f = 520 * Math.pow(1.26, k - 1);   // about a major third per stack
    partial(f, t, 0.16, 0.16, bus, 'triangle');
    partial(f * 2.01, t, 0.1, 0.07, bus, 'sine');
    partial(f * 3, t + 0.02, 0.07, 0.04 + 0.01 * k, bus, 'sine');
    noise(t, 0.04, 0.1, 'bandpass', 2400 + 700 * k, 3);
    if (k >= 4) partial(f * 1.5, t + 0.05, 0.22, 0.12, bus, 'triangle');   // a bright fifth on top: fully wound up
  }

  // Eater swallowing scrap: a heavy metallic crunch (noise body, shard snap, a few square clacks, a low thump) and a gulp
  // (a sine that slides down). size is the piece radius in px.
  function eat(size) {
    if (!ready() || voices > MAX_VOICES || !limit('eat', 55)) return;
    const t = ctx.currentTime, k = clamp((size || 12) / 16, 0.5, 1.3);
    noise(t, 0.1, 0.5, 'bandpass', 700 / k, 1.1);
    noise(t, 0.04, 0.35, 'highpass', 2400, 0.8);
    for (let i = 0; i < 3; i++) partial(rand(180, 420) / k, t + i * 0.025, 0.07, 0.1, bus, 'square');
    track(thump(t, 120 / k, 40, 0.2, 0.55 * k, clip));
    const o = ctx.createOscillator(), g = ctx.createGain();           // the gulp
    o.type = 'sine';
    o.frequency.setValueAtTime(340, t + 0.07); o.frequency.exponentialRampToValueAtTime(110, t + 0.3);
    g.gain.setValueAtTime(0.0001, t + 0.07); g.gain.exponentialRampToValueAtTime(0.22, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(bus); o.start(t + 0.07); o.stop(t + 0.35);
  }
  // acid: short chopped bursts of bright noise (a sizzle) with bubbling blips. 'drain' adds a descending zap.
  function acid(kind) {
    const drain = kind === 'drain';
    if (!ready() || voices > MAX_VOICES || !limit('acid' + kind, drain ? 120 : 90)) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) noise(t + i * 0.03 + rand(0, 0.015), 0.035, drain ? 0.2 : 0.14, 'highpass', rand(4500, 7500), 0.9);
    for (let i = 0; i < 3; i++) partial(rand(300, 900), t + rand(0.02, 0.2), 0.05, 0.06, bus, 'sine');
    if (drain) {
      const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 1800;
      o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.26);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
      track(o);
    }
  }
  function silence() {
    beatNext = 0;
    timeWarp(false);
    if (!ctx) return;
    for (const k in loops) if (loops[k].level > 0) setLoop(loops[k], 0, 1);
    for (const k in spins) if (spins[k] && spins[k].level > 0) setLoop(spins[k], 0, 1);
  }

  function applyMaster() {
    if (master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02);
    if (muted) silence();
  }
  function setMuted(m) { muted = !!m; store.set(KEY_MUTE, muted ? '1' : '0'); applyMaster(); }
  function setVolume(v) { volume = clamp(v, 0, 1); store.set(KEY_VOL, String(volume)); applyMaster(); }

  return {
    unlock, duck, click, clang, grind, wall, clatter, tink, ricochet, stalemate, chip, debris, shatter, scrape, sizzle, magnet, salvage, polarity, spin, stack, eat, acid, heartbeat, tick, sproing, pop, collapse, bellChime, gearGroan, timeWarp, silence, setMuted, setVolume,
    toggleMute() { setMuted(!muted); },
    isMuted() { return muted; }
  };
})();
