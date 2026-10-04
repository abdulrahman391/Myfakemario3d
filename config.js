/* Sprocket Quest 3D - shared configuration (works in browser and Node tests) */
(function (root) {
  'use strict';
  const SQ = (root.SQ = root.SQ || {});

  SQ.VERSION = '1.0.0';

  SQ.CONST = {
    GRAVITY: 38,
    TERMINAL: -34,
    STEP: 0.35,          // max ledge a walking player auto-steps over
    KILL_MARGIN: 12,     // how far below the lowest platform the void kills
    MAX_PLAYERS: 4,
    START_LIVES: 5,
    PS_RATE: 1 / 15,     // online: player state send interval (s)
    SNAP_RATE: 1 / 12,   // online: host world snapshot interval (s)
  };

  /* ---------------- Playable characters ---------------- */
  SQ.CHARS = {
    sprocket: {
      id: 'sprocket', name: 'Sprocket', title: 'The Tinkerer',
      hex: '#9aa4ae', accent: '#4fc3ff',
      speed: 8, jump: 15.5, hp: 3, doubleJump: true, glide: false, immune: [],
      blurb: 'Grey robot. Rocket-hop double jump. Water blasts, and an Ice Wave that freezes enemies solid.',
      stats: { speed: 3, jump: 4, power: 3, health: 3 },
      attack: { kind: 'water', name: 'Water Blast', speed: 24, dmg: 1.0, cd: 0.28, life: 1.1, grav: 7, radius: 0.38, color: 0x4fc3ff, knock: 3 },
      special: { kind: 'ice', name: 'Ice Wave', cd: 4.5, radius: 5.5, dmg: 0.5, freeze: 4 },
    },
    flame: {
      id: 'flame', name: 'Flame', title: 'The Spark',
      hex: '#ff4a1c', accent: '#ffd23f',
      speed: 9.5, jump: 15, hp: 3, doubleJump: false, glide: false, immune: ['fire', 'lava'],
      blurb: 'Red robot. Fastest runner. Fireballs that set enemies alight. Immune to fire and magma.',
      stats: { speed: 5, jump: 3, power: 4, health: 3 },
      attack: { kind: 'fire', name: 'Fireball', speed: 19, dmg: 1.2, cd: 0.30, life: 1.0, grav: 0, radius: 0.4, color: 0xff7a1a, knock: 2 },
      special: { kind: 'inferno', name: 'Inferno Burst', cd: 4.5, radius: 4.6, dmg: 3 },
    },
    bull: {
      id: 'bull', name: 'Bull', title: 'The Gale',
      hex: '#b0122b', accent: '#e8f7ff',
      speed: 7.2, jump: 14.5, hp: 4, doubleJump: false, glide: true, immune: ['wind'],
      blurb: 'Crimson robot. Tough (4 hearts). Hold jump in the air to glide on wind. Gusts shove enemies away.',
      stats: { speed: 2, jump: 3, power: 3, health: 5 },
      attack: { kind: 'wind', name: 'Gust', speed: 17, dmg: 0.8, cd: 0.38, life: 0.9, grav: 0, radius: 0.75, color: 0xd9f4ff, knock: 11, pierce: true },
      special: { kind: 'cyclone', name: 'Cyclone', cd: 5, radius: 5, dmg: 2, pull: 9 },
    },
    rustbolt: {
      id: 'rustbolt', name: 'Rustbolt', title: "Sprocket's Evil Twin",
      hex: '#d01414', accent: '#ffe600',
      speed: 8, jump: 15, hp: 3, doubleJump: false, glide: false, immune: [],
      blurb: 'The villain.', stats: { speed: 3, jump: 3, power: 5, health: 3 },
      attack: null, special: null, villain: true,
    },
  };
  SQ.CHAR_ORDER = ['sprocket', 'flame', 'bull'];

  /* ---------------- Enemies ---------------- */
  SQ.ENEMIES = {
    walker: { hp: 2, hw: 0.55, h: 1.1, speed: 2.2, chase: 3.8, stomp: true,  contact: 1, name: 'Bolt Bot' },
    spiker: { hp: 3, hw: 0.65, h: 1.2, speed: 1.8, chase: 2.6, stomp: false, contact: 1, name: 'Spike Bot' },
    flyer:  { hp: 1, hw: 0.45, h: 0.9, speed: 3,   chase: 0,   stomp: true,  contact: 1, name: 'Prop Drone' },
    turret: { hp: 4, hw: 0.6,  h: 1.4, speed: 0,   chase: 0,   stomp: true,  contact: 1, name: 'Bolt Turret' },
    boss:   { hp: 16, hw: 1.15, h: 2.5, speed: 2.5, chase: 0,  stomp: true,  contact: 1, name: 'Rustbolt' },
  };

  /* ---------------- Power-ups ---------------- */
  SQ.POWERUPS = {
    heart:  { label: 'Repair Kit',    glyph: '+',   color: 0xff4d6d, dur: 0,  tip: '+1 heart' },
    shield: { label: 'Energy Shield', glyph: 'SH',  color: 0x4fc3ff, dur: 25, tip: 'Blocks the next hit' },
    speed:  { label: 'Turbo Boots',   glyph: 'SP',  color: 0xffd23f, dur: 12, tip: 'Run 45% faster' },
    jump:   { label: 'Spring Boots',  glyph: 'JP',  color: 0x7dff4a, dur: 12, tip: 'Jump 30% higher' },
    power:  { label: 'Power Core',    glyph: 'PW',  color: 0xb26bff, dur: 12, tip: 'Triple shots, more damage, faster fire' },
    star:   { label: 'Star Charge',   glyph: '*',   color: 0xfff27a, dur: 8,  tip: 'Invincible, and enemies fall on contact' },
    oneup:  { label: 'Extra Life',    glyph: '1UP', color: 0x55ff99, dur: 0,  tip: '+1 life' },
  };
  SQ.POWER_WEIGHTS = [['heart', 20], ['shield', 18], ['speed', 14], ['jump', 12], ['power', 18], ['star', 8], ['oneup', 4]];

  /* ---------------- Worlds ---------------- */
  SQ.WORLDS = [
    { id: 0, name: 'Meadow Gears',  sky: 0x7ec8ff, fog: 0xbfe6ff, top: 0x6fd04d, side: 0x8a5a2b, move: 0xffb13d, sea: 0xf4fbff, element: null,
      blurb: 'Rolling hills, clockwork windmills and friendly bolt bots.', bossName: 'Rustbolt Returns' },
    { id: 1, name: 'Dune Works',    sky: 0xffcf8a, fog: 0xffe6bd, top: 0xe8c66b, side: 0xb8893c, move: 0x5ad1c4, sea: 0xf2d79a, element: null,
      blurb: 'Blazing sands, bounce pads, blinking tiles and turrets.', bossName: 'Rustbolt: Sandstorm' },
    { id: 2, name: 'Frost Foundry', sky: 0xa9d8ff, fog: 0xdaf0ff, top: 0xd5f2ff, side: 0x6fa5d1, move: 0xff8fb1, sea: 0xcfe9ff, element: 'ice',
      blurb: 'Slippery ice. Frozen bots are weak to fire.', bossName: 'Rustbolt: Deep Freeze' },
    { id: 3, name: 'Magma Mill',    sky: 0x2d0d12, fog: 0x4a1418, top: 0x5a4545, side: 0x2b2024, move: 0xffc23d, sea: 0xff5a1a, element: 'fire',
      blurb: 'Lava everywhere. Fire bots hate water. Flame walks through magma.', bossName: 'Rustbolt: Meltdown' },
  ];
  SQ.LEVELS_PER_WORLD = 3;
  SQ.levelName = function (w, l) {
    const W = SQ.WORLDS[w];
    return l === SQ.LEVELS_PER_WORLD - 1 ? W.bossName : W.name + ' ' + (w + 1) + '-' + (l + 1);
  };
})(typeof window !== 'undefined' ? window : globalThis);
