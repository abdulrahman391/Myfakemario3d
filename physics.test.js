/* Run with: node tests/physics.test.js */
require('../js/config.js');
require('../js/physics.js');
const assert = require('assert');
const P = globalThis.SQ.Physics;
const G = globalThis.SQ.CONST.GRAVITY;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const ent = (o) => Object.assign({ x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 0, hw: 0.38, h: 1.7, ground: null }, o);
const plat = (o) => P.makePlatform(Object.assign({ x: 0, y: 0, z: 0, w: 10, d: 10, h: 1 }, o));

// Steps the world the way sim.js does: platforms first, then the entity.
function step(e, plats, t, dt, opts) {
  plats.forEach((p) => P.updatePlatform(p, t));
  e.vy -= G * dt;
  return P.moveEntity(e, plats, dt, opts);
}

test('falls onto a platform and stands exactly on its top', () => {
  const plats = [plat({})]; const e = ent({ y: 6 });
  let t = 0;
  for (let i = 0; i < 120; i++) { step(e, plats, t, 1 / 60); t += 1 / 60; }
  assert.strictEqual(e.ground, plats[0]);
  assert(Math.abs(e.y - 0) < 1e-6, 'y=' + e.y);
});

test('does not tunnel through a thin platform at terminal velocity', () => {
  const plats = [plat({ h: 0.3 })]; const e = ent({ y: 60, vy: -34 });
  let t = 0;
  for (let i = 0; i < 300; i++) { e.vy = Math.max(e.vy, -34); step(e, plats, t, 1 / 30); t += 1 / 30; }
  assert(e.y >= -0.01, 'fell through, y=' + e.y);
});

test('walks off an edge and falls', () => {
  const plats = [plat({ w: 4, d: 4 })]; const e = ent({ y: 0, vx: 6 });
  let t = 0;
  for (let i = 0; i < 90; i++) { e.vx = 6; step(e, plats, t, 1 / 60); t += 1 / 60; }
  assert(e.y < -2, 'should be falling, y=' + e.y);
  assert.strictEqual(e.ground, null);
});

test('is blocked by a tall wall (no step-up)', () => {
  const plats = [plat({ w: 20, d: 20 }), plat({ x: 3, y: 3, w: 2, d: 4, h: 3 })];
  const e = ent({ y: 0 }); let t = 0;
  for (let i = 0; i < 120; i++) { e.vx = 8; step(e, plats, t, 1 / 60, { stepUp: true }); t += 1 / 60; }
  assert(e.x <= 2 - e.hw + 1e-6, 'x=' + e.x);
});

test('auto steps up a small ledge but not a big one', () => {
  const plats = [plat({ w: 30, d: 10 }), plat({ x: 3, y: 0.3, w: 2, d: 10, h: 0.3 }), plat({ x: 8, y: 1.2, w: 2, d: 10, h: 1.2 })];
  const e = ent({ y: 0 }); let t = 0;
  for (let i = 0; i < 80; i++) { e.vx = 4; step(e, plats, t, 1 / 60, { stepUp: true }); t += 1 / 60; }
  assert(e.x > 3.5, 'should have stepped over the 0.3 ledge, x=' + e.x);
  assert(e.x < 7.1, 'should be stopped by the 1.2 wall, x=' + e.x);
});

test('head bump stops upward motion', () => {
  const plats = [plat({ w: 20, d: 20 }), plat({ y: 4, h: 0.5, w: 6, d: 6 })];
  const e = ent({ y: 0, vy: 20 }); let t = 0;
  for (let i = 0; i < 20; i++) { const r = step(e, plats, t, 1 / 60); t += 1 / 60; if (r.head) break; }
  assert(e.y + e.h <= 3.5 + 1e-6, 'head went through, top=' + (e.y + e.h));
});

test('rider is carried by a vertical lift (up and down) without sliding off the top', () => {
  const lift = plat({ w: 4, d: 4, move: { dx: 0, dy: 6, dz: 0, period: 6 } });
  const plats = [lift]; const e = ent({ y: 0 });
  let t = 0, maxGap = 0;
  for (let i = 0; i < 60 * 14; i++) {
    step(e, plats, t, 1 / 60); t += 1 / 60;
    maxGap = Math.max(maxGap, Math.abs(e.y - lift.y));
    assert.strictEqual(e.ground, lift, 'lost the lift at t=' + t.toFixed(2));
  }
  assert(maxGap < 1e-6, 'drifted from lift by ' + maxGap);
});

test('rider is carried horizontally by a slider', () => {
  const slider = plat({ w: 4, d: 4, move: { dx: 0, dy: 0, dz: -10, period: 8 } });
  const plats = [slider]; const e = ent({ y: 0 });
  let t = 0;
  for (let i = 0; i < 60 * 4; i++) { step(e, plats, t, 1 / 60); t += 1 / 60; }
  assert(Math.abs(e.z - slider.z) < 1e-6, 'rider z=' + e.z + ' slider z=' + slider.z);
  assert(e.z < -9, 'should have travelled ~10 units, z=' + e.z);
});

test('player can walk around on a moving platform', () => {
  const slider = plat({ w: 6, d: 6, move: { dx: 8, dy: 0, dz: 0, period: 6 } });
  const plats = [slider]; const e = ent({ y: 0 });
  let t = 0;
  for (let i = 0; i < 60 * 3; i++) { e.vz = e.z > 1.5 ? 0 : 3; step(e, plats, t, 1 / 60); t += 1 / 60; }
  assert.strictEqual(e.ground, slider);
  assert(e.z > 1 && e.z <= 3, 'z=' + e.z);
});

test('a rising platform scoops an entity standing beside/below its edge instead of trapping it', () => {
  const floor = plat({ y: 0, w: 40, d: 40 });
  const lift = plat({ x: 0, y: -0.5, w: 4, d: 4, h: 1, move: { dx: 0, dy: 4, dz: 0, period: 4 } });
  const plats = [floor, lift]; const e = ent({ x: 0, y: 0 });
  let t = 0;
  for (let i = 0; i < 60 * 2; i++) { step(e, plats, t, 1 / 60); t += 1 / 60; }   // lift is at the top of its travel
  assert.strictEqual(e.ground, lift, 'entity should be riding the lift');
  assert(e.y > 3, 'should have been lifted, y=' + e.y);
});

test('a descending platform that squeezes an entity against the floor reports crushing', () => {
  const floor = plat({ y: 0, w: 40, d: 40 });
  const press = plat({ x: 0, y: 6, w: 6, d: 6, h: 1, move: { dx: 0, dy: -5.2, dz: 0, period: 4 } });
  const plats = [floor, press]; const e = ent({ x: 0, y: 0 });
  let t = 0, crushed = false;
  for (let i = 0; i < 60 * 3; i++) { const r = step(e, plats, t, 1 / 60); t += 1 / 60; if (r.crushed) crushed = true; }
  assert(crushed, 'expected crush');
  assert(!P.overlaps(e, floor) && !P.overlaps(e, press), 'must never remain inside geometry');
});

test('blink platforms drop riders when they vanish and are solid again later', () => {
  const b = plat({ w: 4, d: 4, blink: { period: 5, on: 3, offset: 0 } });
  const plats = [b]; const e = ent({ y: 0 });
  let t = 0, fellAt = null;
  for (let i = 0; i < 60 * 6; i++) { step(e, plats, t, 1 / 60); t += 1 / 60; if (!e.ground && e.y < -0.5 && fellAt === null) fellAt = t; }
  assert(fellAt !== null && fellAt > 2.9 && fellAt < 4, 'fellAt=' + fellAt);
  P.updatePlatform(b, 6); assert.strictEqual(b.solid, true);
});

test('platform motion is deterministic from the clock (online clients agree)', () => {
  const a = plat({ move: { dx: 3, dy: 2, dz: -7, period: 5, phase: 0.25 } });
  const b = plat({ move: { dx: 3, dy: 2, dz: -7, period: 5, phase: 0.25 } });
  P.updatePlatform(a, 12.345); P.updatePlatform(b, 12.345);
  assert.deepStrictEqual([a.x, a.y, a.z], [b.x, b.y, b.z]);
});

test('random stress: entity never ends up embedded in geometry', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const plats = [plat({ w: 30, d: 30 }), plat({ x: 6, y: 1, w: 3, d: 3, h: 2 }), plat({ x: -6, y: 3, w: 4, d: 4, move: { dx: 0, dy: 3, dz: 6, period: 5 } }),
                 plat({ x: 0, y: 4, w: 5, d: 5, h: 1, move: { dx: 8, dy: 0, dz: 0, period: 7 } })];
  const e = ent({ x: 1, y: 3 }); let t = 0;
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 40 === 0) { e.vx = (rnd() - 0.5) * 18; e.vz = (rnd() - 0.5) * 18; if (rnd() < 0.5 && e.ground) e.vy = 15; }
    step(e, plats, t, 1 / 60, { stepUp: true }); t += 1 / 60;
    if (e.y < -30) { e.x = 0; e.y = 6; e.z = 0; e.vy = 0; e.ground = null; }
    for (const p of plats) assert(!P.overlaps(e, p), 'embedded in platform at t=' + t.toFixed(2));
    assert(Number.isFinite(e.x + e.y + e.z));
  }
});

console.log('\n' + passed + ' physics tests passed');
