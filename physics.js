/* Sprocket Quest 3D - collision physics
 *
 * Everything here is pure logic (no rendering) so it runs in Node for tests.
 *
 * Model
 *  - A platform is an axis-aligned box. Its (x, z) is the CENTRE and `y` is the TOP surface;
 *    it extends `h` downward, `w` along x and `d` along z.
 *  - An entity is an AABB: (x, z) centre, `y` = feet, half-width `hw` on x and z, height `h`.
 *
 * Moving platforms
 *  - Platform position is a pure function of level time (see updatePlatform), which makes it
 *    deterministic - every online client computes the same position from the same clock.
 *  - Each frame the platform records its displacement (dx, dy, dz). An entity standing on it
 *    is carried by that displacement BEFORE its own movement is resolved, so riders never slide.
 *  - If a platform moves INTO an entity, depenetrate() pushes the entity out along the axis of
 *    least penetration (preferring "up" so rising lifts scoop players instead of squashing them).
 *    If the only way out is down into the floor, the entity is reported as crushed.
 *
 * Entity movement
 *  - Axis-separated sweep (X, then Z, then Y), sub-stepped so fast bodies cannot tunnel.
 *  - Landing only counts if the feet were above the platform top before the move.
 *  - Optional auto step-up for small ledges.
 *  - Ground snapping keeps entities glued to descending lifts and downhill steps.
 */
(function (root) {
  'use strict';
  const SQ = (root.SQ = root.SQ || {});
  const EPS = 1e-4;

  function makePlatform(def) {
    const p = Object.assign({}, def);
    p.bx = def.x; p.by = def.y; p.bz = def.z;     // base position
    p.solid = true; p.warn = false;
    p.dx = 0; p.dy = 0; p.dz = 0;
    p.move = def.move || null;
    p.blink = def.blink || null;
    p.surface = def.surface || 'normal';
    updatePlatform(p, 0);
    p.dx = p.dy = p.dz = 0;
    return p;
  }

  /* Deterministic motion: smooth ping-pong between base and base+delta; blink = on/off cycle. */
  function updatePlatform(p, t) {
    const ox = p.x, oy = p.y, oz = p.z;
    if (p.move) {
      const m = p.move;
      const s = 0.5 - 0.5 * Math.cos(Math.PI * 2 * (t / m.period + (m.phase || 0)));
      p.x = p.bx + m.dx * s;
      p.y = p.by + m.dy * s;
      p.z = p.bz + m.dz * s;
    }
    if (p.blink) {
      const b = p.blink;
      const ph = (((t + b.offset) % b.period) + b.period) % b.period;
      p.solid = ph < b.on;
      p.warn = p.solid && ph > b.on - 0.9;
    }
    p.dx = p.x - ox; p.dy = p.y - oy; p.dz = p.z - oz;
  }

  function overlaps(e, p) {
    return e.x - e.hw < p.x + p.w / 2 - EPS && e.x + e.hw > p.x - p.w / 2 + EPS &&
           e.z - e.hw < p.z + p.d / 2 - EPS && e.z + e.hw > p.z - p.d / 2 + EPS &&
           e.y < p.y - EPS && e.y + e.h > p.y - p.h + EPS;
  }

  function overXZ(e, p) {
    return e.x - e.hw < p.x + p.w / 2 - EPS && e.x + e.hw > p.x - p.w / 2 + EPS &&
           e.z - e.hw < p.z + p.d / 2 - EPS && e.z + e.hw > p.z - p.d / 2 + EPS;
  }

  function blocked(e, plats, except) {
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p !== except && p.solid && overlaps(e, p)) return true;
    }
    return false;
  }

  /* Push an overlapping entity out along the cheapest axis. Returns true if it was crushed. */
  function depenetrate(e, p, plats) {
    const up = p.y - e.y;
    const down = e.y + e.h - (p.y - p.h);
    const xp = p.x + p.w / 2 - (e.x - e.hw);
    const xn = e.x + e.hw - (p.x - p.w / 2);
    const zp = p.z + p.d / 2 - (e.z - e.hw);
    const zn = e.z + e.hw - (p.z - p.d / 2);
    const upBias = up <= 0.6 ? up * 0.5 : up;      // strongly prefer being scooped up
    let best = upBias, axis = 'up';
    if (down < best) { best = down; axis = 'down'; }
    if (xp < best) { best = xp; axis = 'xp'; }
    if (xn < best) { best = xn; axis = 'xn'; }
    if (zp < best) { best = zp; axis = 'zp'; }
    if (zn < best) { best = zn; axis = 'zn'; }
    switch (axis) {
      case 'up': e.y = p.y; if (e.vy < 0) e.vy = 0; break;
      case 'down':
        e.y = p.y - p.h - e.h;
        if (e.vy > 0) e.vy = 0;
        return !!(plats && (blocked(e, plats, p) || findGround(e, plats, 0.3)));
      case 'xp': e.x += xp; break;
      case 'xn': e.x -= xn; break;
      case 'zp': e.z += zp; break;
      case 'zn': e.z -= zn; break;
    }
    return false;
  }

  function sweepH(e, plats, axis, amt, stepUp) {
    if (!amt) return false;
    e[axis] += amt;
    const size = axis === 'x' ? 'w' : 'd';
    let hit = false;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (!p.solid || !overlaps(e, p)) continue;
      const rise = p.y - e.y;
      if (stepUp && rise > 0 && rise <= SQ.CONST.STEP && e.vy <= 0.01) {
        const oy = e.y; e.y = p.y;
        if (!blocked(e, plats, p)) continue;     // stepped up cleanly
        e.y = oy;
      }
      const half = p[size] / 2;
      e[axis] = amt > 0 ? p[axis] - half - e.hw : p[axis] + half + e.hw;
      hit = true;
    }
    return hit;
  }

  function sweepY(e, plats, amt, prevY, res) {
    if (!amt) return null;
    e.y += amt;
    let landed = null;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (!p.solid || !overlaps(e, p)) continue;
      if (amt < 0) {
        if (prevY >= p.y - 0.06) { e.y = p.y; e.vy = 0; if (!landed || p.y > landed.y) landed = p; }
      } else if (prevY + e.h <= p.y - p.h + 0.06) {
        e.y = p.y - p.h - e.h; if (e.vy > 0) e.vy = 0; res.head = true;
      }
    }
    return landed;
  }

  function findGround(e, plats, tol) {
    let best = null;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (!p.solid || !overXZ(e, p)) continue;
      const d = e.y - p.y;
      if (d >= -0.05 && d <= tol && (!best || p.y > best.y)) best = p;
    }
    return best;
  }

  /* Advance an entity by dt. Uses e.vx/vy/vz. Returns {landed, head, wallX, wallZ, crushed}.
   * opts: {stepUp:boolean}. Sets e.ground to the platform being stood on (or null). */
  function moveEntity(e, plats, dt, opts) {
    opts = opts || {};
    const res = { landed: false, head: false, wallX: false, wallZ: false, crushed: false };
    const prevGround = e.ground;
    // 1. ride the platform we were standing on
    if (prevGround && prevGround.solid) { e.x += prevGround.dx; e.y += prevGround.dy; e.z += prevGround.dz; }
    // 2. get pushed out of platforms that moved into us
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.solid && (p.dx || p.dy || p.dz) && overlaps(e, p)) { if (depenetrate(e, p, plats)) res.crushed = true; }
    }
    // 3. sub-stepped sweep
    const speed = Math.max(Math.abs(e.vx), Math.abs(e.vy), Math.abs(e.vz));
    const n = Math.min(10, Math.max(1, Math.ceil((speed * dt) / 0.25)));
    const sdt = dt / n;
    e.ground = null;
    let landedOn = null;
    for (let i = 0; i < n; i++) {
      if (sweepH(e, plats, 'x', e.vx * sdt, opts.stepUp)) { e.vx = 0; res.wallX = true; }
      if (sweepH(e, plats, 'z', e.vz * sdt, opts.stepUp)) { e.vz = 0; res.wallZ = true; }
      const l = sweepY(e, plats, e.vy * sdt, e.y, res);
      if (l) landedOn = l;
    }
    // 4. final safety depenetration (static geometry)
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.solid && overlaps(e, p)) { if (depenetrate(e, p, plats)) res.crushed = true; }
    }
    // 5. ground detection / snapping
    if (e.vy <= 0.001) {
      const g = findGround(e, plats, prevGround ? 0.3 : 0.06) || landedOn;
      if (g) { e.y = g.y; e.vy = 0; e.ground = g; res.landed = !prevGround; }
    }
    return res;
  }

  /* Is the point (with radius) inside any solid platform? Used by projectiles. */
  function pointHit(x, y, z, r, plats) {
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (!p.solid) continue;
      if (x + r > p.x - p.w / 2 && x - r < p.x + p.w / 2 &&
          z + r > p.z - p.d / 2 && z - r < p.z + p.d / 2 &&
          y + r > p.y - p.h && y - r < p.y) return p;
    }
    return null;
  }

  SQ.Physics = { makePlatform, updatePlatform, moveEntity, overlaps, findGround, depenetrate, pointHit, EPS };
})(typeof window !== 'undefined' ? window : globalThis);
