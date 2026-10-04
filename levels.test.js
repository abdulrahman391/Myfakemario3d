/* Run with: node tests/levels.test.js */
require('../js/config.js');
require('../js/physics.js');
require('../js/levels.js');
const assert = require('assert');
const SQ = globalThis.SQ;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

function boxGap(a, b) {            // horizontal distance between two platform footprints
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  return Math.hypot(dx, dz);
}
function poses(p) {                // start and end of travel
  const out = [{ x: p.x, y: p.y, z: p.z, w: p.w, d: p.d }];
  if (p.move) out.push({ x: p.x + p.move.dx, y: p.y + p.move.dy, z: p.z + p.move.dz, w: p.w, d: p.d });
  return out;
}

const MAX_GAP = 4.6, MAX_RISE = 2.3, MAX_BOUNCE_RISE = 6.8;

for (let w = 0; w < SQ.WORLDS.length; w++) {
  for (let l = 0; l < SQ.LEVELS_PER_WORLD; l++) {
    const name = 'world ' + (w + 1) + ' level ' + (l + 1);
    const L = SQ.Levels.build(w, l);

    test(name + ': deterministic (same seed -> identical level)', () => {
      assert.deepStrictEqual(JSON.stringify(SQ.Levels.build(w, l)), JSON.stringify(L));
    });

    test(name + ': has spawn, goal, checkpoints, 3 stars (or boss)', () => {
      assert(L.spawn && L.goal && L.checkpoints.length >= 2);
      assert(L.stars.length >= (L.boss ? 1 : 3), 'stars=' + L.stars.length);
      if (L.boss) assert(L.arena && L.boss.hp > 10);
      assert(Number.isFinite(L.killY));
    });

    test(name + ': main path is traversable with a single jump', () => {
      const main = L.platforms.filter((p) => !['detour', 'lava', 'pillar'].includes(p.kind));
      for (let i = 1; i < main.length; i++) {
        const A = poses(main[i - 1]), B = poses(main[i]);
        let ok = false;
        for (const a of A) for (const b of B) {
          const gap = boxGap(a, b), rise = b.y - a.y;
          const lim = main[i - 1].surface === 'bounce' ? MAX_BOUNCE_RISE : MAX_RISE;
          if (gap <= MAX_GAP && rise <= lim) ok = true;
        }
        assert(ok, 'platform #' + main[i].id + ' (' + main[i].kind + ') not reachable from #' + main[i - 1].id);
      }
    });

    test(name + ': spawn, checkpoints and goal sit on a platform', () => {
      const on = (pt) => L.platforms.some((p) => Math.abs(pt.x - p.x) <= p.w / 2 && Math.abs(pt.z - p.z) <= p.d / 2 && Math.abs(pt.y - p.y) < 0.6);
      assert(on(L.spawn), 'spawn floating');
      L.checkpoints.forEach((c) => assert(on(c), 'checkpoint ' + c.id + ' floating'));
      assert(on(L.goal), 'goal floating');
    });

    test(name + ': enemies start on a platform (or hover)', () => {
      for (const e of L.enemies) {
        if (e.hover) continue;
        const ok = L.platforms.some((p) => Math.abs(e.x - p.x) <= p.w / 2 && Math.abs(e.z - p.z) <= p.d / 2 && Math.abs(e.y - p.y) < 0.6);
        assert(ok, 'enemy ' + e.id + ' (' + e.type + ') floating at ' + [e.x, e.y, e.z].map((v) => v.toFixed(1)));
      }
    });
  }
}
console.log('\n' + passed + ' level tests passed');
