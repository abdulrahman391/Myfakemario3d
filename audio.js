/* Sprocket Quest 3D - tiny procedural audio (no asset files needed) */
(function (root) {
  'use strict';
  const SQ = (root.SQ = root.SQ || {});
  let ctx = null, master = null, musicGain = null, muted = false, musicTimer = null, step = 0, scale = 0;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    return true;
  }

  function tone(freq, dur, type, vol, slide, when, dest) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, when) {
    if (!ctx || muted) return;
    const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf; g.gain.value = vol || 0.2; s.connect(g); g.connect(master);
    s.start(ctx.currentTime + (when || 0));
  }

  const SFX = {
    jump: () => tone(300, 0.16, 'square', 0.12, 380),
    djump: () => { tone(420, 0.14, 'triangle', 0.14, 520); noise(0.12, 0.05); },
    land: () => noise(0.07, 0.07),
    coin: () => { tone(988, 0.07, 'square', 0.1); tone(1319, 0.14, 'square', 0.1, 0, 0.06); },
    star: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'triangle', 0.16, 0, i * 0.07)),
    power: () => [440, 554, 659, 880].forEach((f, i) => tone(f, 0.1, 'square', 0.1, 0, i * 0.05)),
    oneup: () => [659, 784, 1319, 1047, 1175, 1568].forEach((f, i) => tone(f, 0.1, 'square', 0.1, 0, i * 0.07)),
    water: () => { noise(0.1, 0.06); tone(700, 0.1, 'sine', 0.1, -300); },
    fire: () => { noise(0.14, 0.09); tone(220, 0.14, 'sawtooth', 0.07, -80); },
    wind: () => { noise(0.22, 0.08); tone(300, 0.2, 'sine', 0.06, 200); },
    special: () => { tone(180, 0.5, 'sawtooth', 0.14, 500); noise(0.4, 0.1); },
    hit: () => { tone(200, 0.1, 'square', 0.14, -120); },
    stomp: () => { tone(160, 0.12, 'square', 0.2, -100); noise(0.05, 0.1); },
    hurt: () => { tone(330, 0.3, 'sawtooth', 0.16, -250); },
    die: () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'triangle', 0.18, 0, i * 0.13)); },
    enemyDie: () => { tone(500, 0.12, 'square', 0.12, -380); noise(0.1, 0.1); },
    bounce: () => tone(200, 0.28, 'sine', 0.2, 700),
    checkpoint: () => [523, 784].forEach((f, i) => tone(f, 0.14, 'triangle', 0.14, 0, i * 0.09)),
    clear: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'square', 0.12, 0, i * 0.11)),
    boss: () => { tone(90, 0.5, 'sawtooth', 0.22, -40); noise(0.3, 0.14); },
    click: () => tone(660, 0.05, 'square', 0.07),
    shield: () => tone(900, 0.2, 'triangle', 0.12, -600),
  };

  /* A very small procedural "chiptune" loop: bass + arpeggio, different mood per world. */
  const SONGS = [
    { bpm: 132, root: 55, mode: [0, 4, 7, 12], bass: [0, 0, 7, 5] },     // meadow: bright major
    { bpm: 118, root: 49, mode: [0, 3, 7, 10], bass: [0, 3, 5, 3] },     // desert: bluesy
    { bpm: 104, root: 58.3, mode: [0, 7, 12, 14], bass: [0, 5, 7, 2] },  // ice: airy
    { bpm: 146, root: 46.2, mode: [0, 3, 6, 9], bass: [0, 0, 3, 6] },    // magma: tense
    { bpm: 100, root: 55, mode: [0, 4, 7, 11], bass: [0, 5, 7, 4] },     // menu
  ];
  const hz = (root, semis) => root * Math.pow(2, semis / 12);

  function startMusic(idx) {
    stopMusic();
    if (!ensure()) return;
    const S = SONGS[idx] || SONGS[4];
    step = 0;
    const beat = 60 / S.bpm / 2;
    musicTimer = setInterval(() => {
      if (muted || !ctx) return;
      const bar = Math.floor(step / 8) % S.bass.length;
      const note = S.mode[step % S.mode.length];
      tone(hz(S.root * 4, note + S.bass[bar]), beat * 0.9, 'square', 0.5, 0, 0, musicGain);
      if (step % 2 === 0) tone(hz(S.root, S.bass[bar]), beat * 1.8, 'triangle', 0.9, 0, 0, musicGain);
      if (step % 4 === 2) noise(0.03, 0.12);
      step++;
    }, beat * 1000);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  SQ.Audio = {
    unlock: ensure,
    play(name) { if (!ensure()) return; const f = SFX[name]; if (f) f(); },
    startMusic, stopMusic,
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.5; },
    isMuted: () => muted,
  };
})(typeof window !== 'undefined' ? window : globalThis);
