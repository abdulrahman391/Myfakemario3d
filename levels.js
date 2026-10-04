/* Sprocket Quest 3D - level generator
 *
 * Levels are generated from a seed (world, level) with a tiny PRNG, so every browser
 * produces the identical course. That is what makes online multiplayer simple: nobody
 * has to send level geometry, only "world 2, level 1".
 *
 * Courses run toward -Z. Jump budget used when placing gaps (single jump, no power-ups):
 *   max gap ~ 4.2, max rise ~ 2, bounce pad ~ +6.5.
 */
(function (root) {
  'use strict';
  const SQ = (root.SQ = root.SQ || {});

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  SQ.rng = rng;

  function build(wi, li) {
    const W = SQ.WORLDS[wi];
    const R = rng(1000 + wi * 37 + li * 101);
    const rnd = (a, b) => a + (b - a) * R();
    const ri = (a, b) => Math.floor(rnd(a, b + 1));
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const isBoss = li === SQ.LEVELS_PER_WORLD - 1;

    const L = {
      world: wi, level: li, name: SQ.levelName(wi, li), boss: null, arena: null,
      platforms: [], coins: [], stars: [], powerups: [], enemies: [], checkpoints: [],
      spawn: null, goal: null, killY: 0, theme: W,
    };
    let pid = 0, cid = 0, eid = 0, sid = 0, wid = 0, kid = 0;
    const cur = { x: 0, y: 0, z: 0 };
    const elem = W.element;           // 'ice' | 'fire' | null

    function plat(x, y, zNear, w, d, o) {
      o = o || {};
      const p = { id: pid++, x, y, z: zNear - d / 2, w, d, h: o.h || 1.2, surface: o.surface || 'normal',
                  move: o.move || null, blink: o.blink || null, kind: o.kind || 'static' };
      L.platforms.push(p);
      return p;
    }
    const coin = (x, y, z) => L.coins.push({ id: 'c' + cid++, x, y, z });
    function coinLine(x, y, z0, z1, step) {
      for (let z = z0; z > z1; z -= step) coin(x, y + 1.2, z);
    }
    function enemy(type, x, y, z, bounds, extra) {
      L.enemies.push(Object.assign({ id: eid++, type, element: elem, x, y, z, bounds: bounds || null }, extra || {}));
    }
    function powerBox(x, y, z) {
      let tot = 0; SQ.POWER_WEIGHTS.forEach((w) => (tot += w[1]));
      let r = R() * tot, type = 'heart';
      for (const w of SQ.POWER_WEIGHTS) { if ((r -= w[1]) <= 0) { type = w[0]; break; } }
      L.powerups.push({ id: 'p' + wid++, type, x, y: y + 1.4, z });
    }

    /* ---------- segments ---------- */
    function runway(len, w, o) {
      o = o || {};
      const gap = o.gap !== undefined ? o.gap : rnd(2.8, 4.0);
      const x = o.x !== undefined ? o.x : clamp(cur.x + rnd(-2, 2), -7, 7);
      const z0 = cur.z - gap;
      const p = plat(x, cur.y, z0, w, len, { surface: o.surface, kind: o.kind });
      cur.x = x; cur.z = z0 - len;
      if (!o.noCoins) coinLine(x, cur.y, z0 - 1.5, z0 - len + 1, 2.4);
      return { p, x, w, z0, len, y: cur.y };
    }
    function stones(n) {
      const first = { y: cur.y };
      for (let i = 0; i < n; i++) {
        const gap = rnd(2.8, 4.0), s = rnd(2.5, 3.3);
        const dy = cur.y > 4 ? -rnd(0.3, 1.0) : rnd(-0.5, 1.0);
        const x = clamp(cur.x + rnd(-2.6, 2.6), -9, 9);
        const z0 = cur.z - gap;
        cur.y = Math.round((cur.y + dy) * 10) / 10;
        plat(x, cur.y, z0, s, s, { h: 1.6 });
        coin(x, cur.y + 1.6, z0 - s / 2);
        if (i === 1 && R() < 0.4 + wi * 0.1) {
          enemy('flyer', x, cur.y + 2.4, z0 - s - gap / 2 - 1, null, { hover: true });
        }
        cur.x = x; cur.z = z0 - s;
      }
      return first;
    }
    function stairs(n) {
      let gap = 2.4;
      for (let i = 0; i < n; i++) {
        cur.y += 1.0;
        const z0 = cur.z - gap;
        plat(cur.x, cur.y, z0, 7, 2.4, { h: 6 });
        coin(cur.x, cur.y + 1.2, z0 - 1.2);
        cur.z = z0 - 2.4; gap = 0;
      }
    }
    function lift(dy) {
      const zA = cur.z, size = 3.4;
      plat(cur.x, cur.y, zA - 0.8, size, size, { kind: 'lift', move: { dx: 0, dy, dz: 0, period: 8, phase: 0 } });
      coin(cur.x, cur.y + dy / 2 + 2.2, zA - 0.8 - size / 2);
      cur.z = zA - 0.8 - size - 0.0; cur.y += dy;
      return 0.8;
    }
    function slider(len) {
      const zA = cur.z, size = 3.4, travel = len - 1.6 - size;
      plat(cur.x, cur.y, zA - 0.8, size, size, { kind: 'slide', move: { dx: 0, dy: 0, dz: -travel, period: 7, phase: 0 } });
      coin(cur.x, cur.y + 1.4, zA - 0.8 - size / 2 - travel / 2);
      cur.z = zA - len + 0.8;      // far edge of the slider at its end of travel; next runway adds a 0.8 gap
    }
    function blinkRow(n) {
      for (let i = 0; i < n; i++) {
        const gap = rnd(3.0, 3.6), s = 3.2;
        const z0 = cur.z - gap;
        plat(cur.x, cur.y, z0, s, s, { h: 1, kind: 'blink', blink: { period: 5, on: 3.4, offset: i * 1.3 } });
        coin(cur.x, cur.y + 1.5, z0 - s / 2);
        cur.z = z0 - s;
      }
    }
    function bounce() {
      const z0 = cur.z - rnd(2.8, 3.6);
      plat(cur.x, cur.y, z0, 3.2, 3.2, { surface: 'bounce', h: 1, kind: 'bounce' });
      cur.z = z0 - 3.2;
      const rise = 6.0;
      const z1 = cur.z - 2.4;
      cur.y += rise;
      plat(cur.x, cur.y, z1, 7, 6, { h: 6 });
      coinLine(cur.x, cur.y, z1 - 1, z1 - 5, 1.5);
      cur.z = z1 - 6;
    }
    function magmaPatches(info) {
      // rectangular magma patches sitting flush in the runway: walk around or jump over
      const n = 2 + (li > 0 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const z0 = info.z0 - 3 - i * ((info.len - 5) / n);
        const lane = i % 2 ? -1 : 1;
        const pw = info.w * 0.45;
        const px = info.x + lane * (info.w / 4);
        plat(px, info.y + 0.02, z0, pw, 2.6, { surface: 'lava', h: 0.4, kind: 'lava' });
      }
    }
    function restEnemies(info, count) {
      const b = { minX: info.x - info.w / 2 + 0.9, maxX: info.x + info.w / 2 - 0.9, minZ: info.z0 - info.len + 1.0, maxZ: info.z0 - 1.0 };
      for (let i = 0; i < count; i++) {
        const choices = ['walker', 'walker'];
        if (wi >= 1) choices.push('spiker', 'turret');
        if (wi >= 2) choices.push('flyer');
        const type = pick(choices);
        const ex = rnd(b.minX + 1, b.maxX - 1), ez = rnd(b.minZ + 1.5, b.maxZ - 1.5);
        if (type === 'flyer') enemy('flyer', ex, info.y + 2.6, ez, null, { hover: true });
        else if (type === 'turret') enemy('turret', info.x + pick([-1, 1]) * (info.w / 2 - 1), info.y, ez, null);
        else enemy(type, ex, info.y, ez, b);
      }
    }
    function detourStar(info) {
      const side = R() < 0.5 ? -1 : 1;
      const zMid = info.z0 - info.len / 2;
      const edge = info.x + side * info.w / 2;
      const x1 = edge + side * (2.6 + 1.3);
      const x2 = x1 + side * (3.8);
      const x3 = x2 + side * 3.9;
      plat(x1, info.y + 0.4, zMid + 1.3, 2.6, 2.6, { h: 1.6, kind: 'detour' });
      plat(x2, info.y + 0.9, zMid + 1.3, 2.6, 2.6, { h: 1.6, kind: 'detour' });
      plat(x3, info.y + 1.2, zMid + 1.8, 3.6, 3.6, { h: 1.6, kind: 'detour' });
      L.stars.push({ id: 's' + sid++, x: x3, y: info.y + 1.2 + 1.6, z: zMid + 1.8 - 1.8 });
      coin(x1, info.y + 0.4 + 1.2, zMid); coin(x2, info.y + 0.9 + 1.2, zMid);
    }

    /* ---------- start platform ---------- */
    const start = plat(0, 0, 0, 10, 12, { kind: 'static' });
    cur.z = -12;
    L.spawn = { x: 0, y: 0, z: -4 };
    L.checkpoints.push({ id: kid++, x: 0, y: 0, z: -4, start: true });
    coinLine(0, 0, -7, -11, 2);

    if (!isBoss) {
      /* ---------- normal course: alternate a challenge with a rest platform ---------- */
      const nCh = li === 0 ? 4 : 6;
      const pool = ['stones', 'slider', 'lift', 'stairs'];
      if (wi >= 1) pool.push('bounce', 'blink', 'stones');
      if (wi >= 2) pool.push('blink', 'slider');
      if (wi >= 3) pool.push('lift', 'blink');
      const starAt = {}; for (let k = 0; k < 3; k++) starAt[Math.floor((nCh * (k + 0.5)) / 3)] = true;
      const cp1 = Math.floor(nCh / 3), cp2 = Math.floor((nCh * 2) / 3);
      let nextGap = undefined;
      for (let i = 0; i < nCh; i++) {
        let ch = pick(pool);
        if (i === 0) ch = 'stones';
        if (ch === 'stones') stones(ri(4, 6));
        else if (ch === 'stairs') stairs(ri(3, 4));
        else if (ch === 'slider') { slider(ri(12, 16)); nextGap = 0.8; }
        else if (ch === 'lift') { lift(cur.y > 3 ? -rnd(3, 5) : rnd(3.5, 5.5)); nextGap = 0.8; }
        else if (ch === 'blink') blinkRow(ri(3, 5));
        else if (ch === 'bounce') bounce();
        // rest platform
        const surface = (wi === 2 && R() < 0.65) ? 'ice' : 'normal';
        const len = ri(10, 15), w = ri(8, 11);
        const info = runway(len, w, { gap: nextGap, surface });
        nextGap = undefined;
        if (wi === 3) magmaPatches(info);
        const cnt = Math.min(4, Math.round(1 + li * 1.2 + wi * 0.5 + R()));
        restEnemies(info, cnt);
        if (starAt[i]) detourStar(info);
        if (R() < 0.45 || i === cp1) powerBox(info.x + rnd(-1.5, 1.5), info.y, info.z0 - 3);
        if (i === cp1 || i === cp2) {
          L.checkpoints.push({ id: kid++, x: info.x - info.w / 2 + 1.4, y: info.y, z: info.z0 - 2 });
        }
      }
      // goal platform
      const g = runway(12, 12, { gap: rnd(2.8, 3.6), noCoins: true });
      L.goal = { x: g.x, y: g.y, z: g.z0 - 8, r: 2.4 };
    } else {
      /* ---------- boss level: short approach + big arena ---------- */
      const intro = runway(10, 9, { gap: 3.2 });
      L.checkpoints.push({ id: kid++, x: intro.x, y: intro.y, z: intro.z0 - 3 });
      powerBox(intro.x + 2, intro.y, intro.z0 - 6);
      stones(3);
      L.stars.push({ id: 's' + sid++, x: cur.x, y: cur.y + 3.2, z: cur.z + 1.2 });
      const size = 32, ay = cur.y, z0 = cur.z - 3.2;
      const ax = 0;
      plat(ax, ay, z0, size, size, { h: 3 });
      L.arena = { x: ax, z: z0 - size / 2, y: ay, half: size / 2 - 1.2, w: size, d: size };
      L.checkpoints.push({ id: kid++, x: ax, y: ay, z: z0 - 3 });
      // cover pillars
      const px = [-9, 9, -9, 9], pz = [-8, -8, -22, -22];
      for (let i = 0; i < 4; i++) plat(ax + px[i], ay + 1.6, z0 + pz[i] + 1.1, 2.2, 2.2, { h: 1.6, kind: 'pillar' });
      powerBox(ax - 11, ay, z0 - 12);
      powerBox(ax + 11, ay, z0 - 20);
      L.boss = { x: ax, y: ay, z: L.arena.z - 7, hp: 14 + wi * 4 };
      L.goal = { x: ax, y: ay, z: L.arena.z + 2, r: 2.6, hidden: true };
    }

    /* ---------- finish ---------- */
    let minY = Infinity;
    L.platforms.forEach((p) => {
      const low = p.move ? p.y + Math.min(0, p.move.dy) : p.y;
      minY = Math.min(minY, low - p.h);
    });
    L.killY = minY - SQ.CONST.KILL_MARGIN;
    L.seaY = L.killY + 7;
    L.length = Math.abs(cur.z);
    return L;
  }

  SQ.Levels = { build };
})(typeof window !== 'undefined' ? window : globalThis);
