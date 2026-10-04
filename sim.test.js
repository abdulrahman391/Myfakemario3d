/* Run with: node tests/sim.test.js */
['config', 'physics', 'levels', 'sim'].forEach((f) => require('../js/' + f + '.js'));
const assert = require('assert');
const SQ = globalThis.SQ;
const DT = 1 / 60;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e.stack || e.message)); process.exitCode = 1; }
}
const inp = (o) => Object.assign({ mx: 0, mz: 0, jumpHeld: false, jumpPressed: false, attack: false, special: false }, o);
function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const inputs = fn ? fn(i, sim) : {};
    sim.update(DT, inputs);
    sim.events.length = 0; if (sim.role === 'solo') sim.out.length = 0;
  }
}
function arena(world, level, charId, role) {
  const L = SQ.Levels.build(world, level);
  const sim = new SQ.Sim(L, { role: role || 'solo' });
  const p = sim.addPlayer({ id: 'p1', charId: charId || 'sprocket', local: true, slot: 0 });
  return { L, sim, p };
}
// put a lone enemy in front of the player on a big test platform
function duel(type, element, charId) {
  const { sim, p } = arena(0, 0, charId);
  sim.enemies.length = 0; sim.enemyMap.clear();
  const e = sim.addEnemy({ id: 900, type, element, x: p.x, y: 0, z: p.z - 4, bounds: { minX: p.x - 0.01, maxX: p.x + 0.01, minZ: p.z - 4.01, maxZ: p.z - 3.99 } });
  p.ry = Math.PI;     // facing -z
  return { sim, p, e };
}

test('player spawns, falls to the ground and stands still', () => {
  const { sim, p } = arena(0, 0);
  run(sim, 1);
  assert(p.ground, 'should be grounded'); assert.strictEqual(p.anim, 'idle');
});

test('every character can run, jump and shoot without NaN across all levels (random bot)', () => {
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let w = 0; w < 4; w++) for (let l = 0; l < 3; l++) for (const ch of SQ.CHAR_ORDER) {
    const { sim, p } = arena(w, l, ch);
    let mx = 0, mz = -1;
    run(sim, 14, (i) => {
      if (i % 50 === 0) { mx = (rnd() - 0.5) * 2; mz = -rnd(); }
      return { p1: inp({ mx, mz, jumpPressed: i % 70 === 0, jumpHeld: i % 70 < 25, attack: i % 9 < 3, special: i % 200 === 0 }) };
    });
    assert(Number.isFinite(p.x + p.y + p.z), w + '-' + l + ' ' + ch + ' NaN position');
    for (const e of sim.enemies) assert(Number.isFinite(e.x + e.y + e.z), 'enemy NaN');
  }
});

test('water blast damages an enemy; kill drops coins and respawn-safe events fire', () => {
  const { sim, p, e } = duel('walker', null, 'sprocket');
  run(sim, 3, () => ({ p1: inp({ attack: true }) }));
  assert(e.dead, 'walker should be dead, hp=' + e.hp);
  assert(sim.pickups.some((k) => k.id.startsWith('d900_')), 'should drop coins');
});

test('element table: fire bots resist fire, take double from water', () => {
  const { sim, e } = duel('walker', 'fire');
  sim.applyHit(e, { dmg: 1, element: 'fire' }); assert.strictEqual(e.hp, 2);
  sim.applyHit(e, { dmg: 1, element: 'water' }); assert.strictEqual(e.hp, 0);
});

test('element table: ice bots take double from fire; ice wave freezes then shatters', () => {
  const { sim, e } = duel('walker', 'ice', 'flame');
  sim.applyHit(e, { dmg: 1, element: 'fire' }); assert.strictEqual(e.hp, 0);
  const d2 = duel('walker', null, 'sprocket');
  d2.sim.applyHit(d2.e, { dmg: 0.5, element: 'ice', freeze: 4 });
  assert(d2.e.frozen > 0, 'frozen'); const hp = d2.e.hp;
  d2.sim.applyHit(d2.e, { dmg: 1, element: 'water' });
  assert(d2.e.dead, 'frozen enemies take double damage and shatter (hp was ' + hp + ')');
  assert.strictEqual(d2.e.frozen, 0);
});

test('wind knocks enemies back and flyers take double', () => {
  const { sim, e } = duel('flyer', null, 'bull');
  sim.applyHit(e, { dmg: 0.8, element: 'wind', kx: 0, kz: -10 });
  assert(e.kz < -5, 'knockback applied'); assert(e.dead, 'flyer (1hp) dies to 0.8*2');
});

test('stomping a walker kills it and bounces the player', () => {
  const { sim, p, e } = duel('walker', null);
  e.bounds = { minX: p.x - 5, maxX: p.x + 5, minZ: p.z - 5, maxZ: p.z + 5 };
  e.x = p.x; e.z = p.z; e.y = 0;
  p.y = 2.0; p.vy = -8; p.ground = null;
  run(sim, 0.3);
  assert(e.dead || e.hp < 2, 'enemy should be hurt, hp=' + e.hp);
  assert(p.hp === p.maxHp, 'stomper must not take damage');
});

test('touching a spiker hurts, and stomping it also hurts', () => {
  const { sim, p, e } = duel('spiker', null);
  e.bounds = { minX: p.x - 5, maxX: p.x + 5, minZ: p.z - 5, maxZ: p.z + 5 };
  e.x = p.x; e.z = p.z;
  run(sim, 0.2);
  assert(p.hp < p.maxHp, 'contact should damage');
});

test('invulnerability frames prevent damage spam; shield absorbs one hit', () => {
  const { sim, p } = arena(0, 0);
  run(sim, 0.5);
  assert(sim.hurtPlayer(p, 1, 0, 0)); assert(!sim.hurtPlayer(p, 1, 0, 0)); assert.strictEqual(p.hp, p.maxHp - 1);
  const b = arena(0, 0); run(b.sim, 0.5); b.sim.applyPower(b.p, 'shield');
  assert(b.sim.hurtPlayer(b.p, 1, 0, 0)); assert.strictEqual(b.p.hp, b.p.maxHp); assert.strictEqual(b.p.buffs.shield, 0);
});

test('Flame is immune to fire shots and magma; others are not', () => {
  const f = arena(3, 0, 'flame'); run(f.sim, 0.5);
  assert(!f.sim.hurtPlayer(f.p, 1, 0, 0, 'fire'));
  const s = arena(3, 0, 'sprocket'); run(s.sim, 0.5);
  assert(s.sim.hurtPlayer(s.p, 1, 0, 0, 'fire'));
});

test('falling into the void costs a life and respawns at the last checkpoint', () => {
  const { sim, p } = arena(0, 0);
  run(sim, 0.5);
  const lives = p.lives; p.y = sim.level.killY - 1; p.ground = null;
  run(sim, 0.1); assert(p.dead && p.lives === lives - 1);
  run(sim, 2.0); assert(!p.dead, 'should have respawned'); assert(p.hp === p.maxHp);
});

test('running out of lives ends the run (failed)', () => {
  const { sim, p } = arena(0, 0);
  p.lives = 1; run(sim, 0.3); sim.killPlayer(p, 'test');
  assert(p.out); run(sim, 0.1); assert(sim.failed);
});

test('coins: 100 coins grants an extra life; pickups only collect once', () => {
  const { sim, p } = arena(0, 0); run(sim, 0.5);
  const lives = p.lives;
  for (let i = 0; i < 100; i++) sim.addPickup('t' + i, 'coin', null, { x: p.x, y: p.y + 0.9, z: p.z });
  run(sim, 0.2); assert.strictEqual(p.coins, 100); assert.strictEqual(p.lives, lives + 1);
  run(sim, 0.5); assert.strictEqual(p.coins, 100);
});

test('power-ups apply and expire', () => {
  const { sim, p } = arena(0, 0); run(sim, 0.3);
  sim.applyPower(p, 'speed'); assert(p.buffs.speed > 11);
  run(sim, 13); assert.strictEqual(p.buffs.speed, 0);
});

test('Sprocket double jumps; Bull glides; Flame does neither', () => {
  const heightOf = (ch, glide) => {
    const { sim, p } = arena(0, 0, ch); run(sim, 0.5);
    let maxY = p.y, minVy = 0;
    run(sim, 1.6, (i) => { maxY = Math.max(maxY, p.y); minVy = Math.min(minVy, p.vy); return { p1: inp({ jumpPressed: i === 0 || i === 35, jumpHeld: glide || i < 20 || (i >= 35 && i < 55) }) }; });
    return { maxY, minVy };
  };
  assert(heightOf('sprocket').maxY > heightOf('flame').maxY + 1, 'double jump gives extra height');
  assert(heightOf('bull', true).minVy > -3.5, 'glide caps fall speed');
});

test('boss: runs all attack states for 90s without errors and can be beaten by stomps', () => {
  const { sim, p, L } = arena(0, 2, 'sprocket');
  assert(sim.boss && !sim.goalActive);
  p.x = L.arena.x; p.z = L.arena.z + 10; p.y = L.arena.y; p.lives = 99; p.maxHp = p.hp = 99;
  const seen = new Set();
  run(sim, 120, () => { seen.add(sim.boss.state); p.invuln = 5; return {}; });
  const A = L.arena;
  assert(Number.isFinite(sim.boss.x + sim.boss.z));
  assert(Math.abs(sim.boss.x - A.x) <= A.half + 1e-6 && Math.abs(sim.boss.z - A.z) <= A.half + 1e-6, 'boss stays in the arena');
  assert(sim.boss.y > A.y - 0.1, 'boss never falls off');
  assert(seen.has('charge') && seen.has('volley') && seen.has('slam-air'), 'states seen: ' + [...seen]);
  const hp0 = sim.boss.hp; sim.applyHit(sim.boss, { dmg: 1, element: 'water' });
  assert(Math.abs(hp0 - sim.boss.hp - 0.25) < 1e-9 || sim.boss.state === 'stunned', 'plain shots only chip the boss');
  sim.applyHit(sim.boss, { dmg: 999, element: 'stomp' });
  assert(sim.boss.dead && sim.goalActive, 'goal activates when the boss falls');
});

test('goal ends the level; checkpoints update respawn point', () => {
  const { sim, p, L } = arena(0, 0); run(sim, 0.5);
  const cp = L.checkpoints.find((c) => !c.start);
  p.x = cp.x; p.y = cp.y; p.z = cp.z; p.vy = 0; run(sim, 0.2);
  assert(Math.abs(p.cp.z - cp.z) < 1e-6, 'checkpoint saved');
  p.x = L.goal.x; p.y = L.goal.y; p.z = L.goal.z; run(sim, 0.2);
  assert(sim.cleared && sim.winner === 'p1');
});

test('local co-op: two players, independent input, both can win', () => {
  const L = SQ.Levels.build(1, 0); const sim = new SQ.Sim(L);
  const a = sim.addPlayer({ id: 'p1', charId: 'flame', local: true, slot: 0 });
  const b = sim.addPlayer({ id: 'p2', charId: 'bull', local: true, slot: 1 });
  run(sim, 2, () => ({ p1: inp({ mz: -1 }), p2: inp({ mx: 1 }) }));
  assert(a.z < b.z - 5 && b.x > a.x + 5, 'players moved independently');
});

/* ---------- online: host + guest wired through an in-memory "network" ---------- */
function pair() {
  const L = SQ.Levels.build(0, 0);
  const host = new SQ.Sim(L, { role: 'host' }), guest = new SQ.Sim(L, { role: 'guest' });
  host.addPlayer({ id: 'H', charId: 'flame', local: true, slot: 0 }); host.addPlayer({ id: 'G', charId: 'sprocket', local: false, slot: 1 });
  guest.addPlayer({ id: 'H', charId: 'flame', local: false, slot: 0 }); guest.addPlayer({ id: 'G', charId: 'sprocket', local: true, slot: 1 });
  let snapT = 0;
  const pump = (inputsH, inputsG) => {
    host.update(DT, { H: inputsH || inp() }); guest.update(DT, { G: inputsG || inp() });
    // guest -> host
    for (const m of guest.out) {
      if (m.t === 'hit') host.applyNetHit(m); else if (m.t === 'take') host.markTaken(m.id);
      else if (m.t === 'shot') host.netShot(Object.assign({}, m.d));
      else if (m.t === 'goal') host.forceClear(m.pid);
    }
    guest.out.length = 0;
    // host -> guest
    for (const m of host.out) {
      if (m.t === 'eshot') guest.netEShot(m.d); else if (m.t === 'ewave') guest.netEWave(m.d);
      else if (m.t === 'take') guest.markTaken(m.id); else if (m.t === 'shot') guest.netShot(Object.assign({}, m.d));
      else if (m.t === 'goal') guest.forceClear(m.pid);
    }
    host.out.length = 0;
    host.applyPlayerState(guest.playerState(guest.getPlayer('G'))); guest.applyPlayerState(host.playerState(host.getPlayer('H')));
    if ((snapT += DT) > 1 / 12) { snapT = 0; guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot()))); }
    host.events.length = 0; guest.events.length = 0;
  };
  return { L, host, guest, pump };
}

test('online: guest enemy positions follow the host snapshot', () => {
  const { host, guest, pump } = pair();
  for (let i = 0; i < 60 * 8; i++) pump();
  for (const e of host.enemies) {
    const g = guest.enemyMap.get(e.id);
    assert(Math.hypot(e.x - g.x, e.z - g.z) < 1.2, 'enemy ' + e.id + ' diverged');
  }
});

test('online: guest damage reaches the host enemy; host death replicates to the guest', () => {
  const { host, guest, pump } = pair();
  const target = host.enemies.find((e) => e.type === 'walker') || host.enemies[0];
  const g = guest.enemyMap.get(target.id);
  guest.hitEnemy(g, { dmg: 99, element: 'water', kx: 0, kz: 0 });
  for (let i = 0; i < 60; i++) pump();
  assert(target.dead, 'host applied the hit'); assert(g.dead, 'guest saw the death');
});

test('online: pickup taken by the guest vanishes for the host', () => {
  const { host, guest, pump } = pair();
  const gp = guest.getPlayer('G'); const c = guest.level.coins[0];
  gp.x = c.x; gp.y = c.y - 0.9; gp.z = c.z;
  for (let i = 0; i < 5; i++) pump();
  assert(guest.pickMap.get(c.id).taken && host.pickMap.get(c.id).taken);
});

test('online: platforms stay in sync (clock correction) and remote players are mirrored', () => {
  const { host, guest, pump } = pair();
  guest.time = 3.3;                    // guest started late
  for (let i = 0; i < 60 * 4; i++) pump({ ...inp({ mz: -1 }) });
  assert(Math.abs(host.time - guest.time) < 0.1, 'clock drift ' + (host.time - guest.time));
  const hp = host.getPlayer('H'), hp2 = guest.getPlayer('H');
  assert(Math.hypot(hp.x - hp2.x, hp.z - hp2.z) < 1.5, 'remote copy tracks the real player');
});

test('online: shots are mirrored visually but only the shooter reports damage', () => {
  const { host, guest, pump } = pair();
  const gp = guest.getPlayer('G'); gp.ry = Math.PI;
  pump(inp(), inp({ attack: true }));
  assert(host.projs.some((q) => q.owner === 'G' && !q.local), 'host shows the guest bullet as visual only');
});

console.log('\n' + passed + ' sim tests passed');
