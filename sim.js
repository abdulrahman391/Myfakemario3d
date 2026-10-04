/* Sprocket Quest 3D - simulation
 *
 * No rendering in here. The Sim owns the world state and is stepped with update(dt, inputs).
 * It pushes `events` (for particles / sound) and `out` (messages for the network layer).
 *
 * Roles
 *   solo  - everything is simulated locally (includes local co-op on one screen)
 *   host  - like solo, plus it is the authority for enemies/boss/pick-ups and sends snapshots
 *   guest - simulates only its own player; enemies come from host snapshots; hits are sent to host
 *
 * Authority rules (keep these in mind when changing anything):
 *   - Each client is authoritative for ITS OWN player (movement, damage taken).
 *   - The host is authoritative for enemies, the boss and who picked up what.
 *   - Whoever fired a shot reports its hits (so shots feel instant on the shooter's screen).
 */
(function (root) {
  'use strict';
  const SQ = (root.SQ = root.SQ || {});
  const K = SQ.CONST, Ph = SQ.Physics;
  const TAU = Math.PI * 2;
  const r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerpAngle = (a, b, t) => a + ((((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI) * t;
  const NOINPUT = { mx: 0, mz: 0, jumpHeld: false, jumpPressed: false, attack: false, special: false };
  const SLOT_OFF = [0, 1.7, -1.7, 3.4];

  class Sim {
    constructor(level, opts) {
      opts = opts || {};
      this.level = level;
      this.role = opts.role || 'solo';
      this.time = 0;
      this.events = [];
      this.out = [];
      this.plats = level.platforms.map(Ph.makePlatform);
      this.players = [];
      this.enemies = [];
      this.enemyMap = new Map();
      this.projs = [];
      this.waves = [];
      this.pickups = [];
      this.pickMap = new Map();
      this.nextProj = 1;
      this.cleared = false; this.failed = false; this.winner = null;
      this.goalActive = !(level.goal && level.goal.hidden);
      this.boss = null;
      this.checkpoints = level.checkpoints.map((c) => Object.assign({ active: !!c.start }, c));
      level.coins.forEach((c) => this.addPickup(c.id, 'coin', null, c));
      level.stars.forEach((c) => this.addPickup(c.id, 'star', null, c));
      level.powerups.forEach((c) => this.addPickup(c.id, 'power', c.type, c));
      level.enemies.forEach((d) => this.addEnemy(d));
      if (level.boss) {
        this.boss = this.addEnemy({ id: 'boss', type: 'boss', x: level.boss.x, y: level.boss.y, z: level.boss.z, element: null });
        this.boss.hp = this.boss.maxHp = level.boss.hp;
        this.boss.st = 2.5;
      }
    }

    emit(type, d) { const ev = d || {}; ev.type = type; this.events.push(ev); }

    /* ================= setup helpers ================= */
    addPickup(id, kind, sub, pos) {
      const pk = { id, kind, sub, x: pos.x, y: pos.y, z: pos.z, taken: false, mag: 0, phase: (this.pickups.length * 0.37) % TAU };
      this.pickups.push(pk); this.pickMap.set(id, pk); return pk;
    }

    addEnemy(def) {
      const T = SQ.ENEMIES[def.type];
      const e = {
        id: def.id, type: def.type, element: def.element || null,
        x: def.x, y: def.y, z: def.z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, hw: T.hw, h: T.h, ry: Math.PI,
        hp: T.hp, maxHp: T.hp, home: { x: def.x, y: def.y, z: def.z }, bounds: def.bounds || null, hover: !!def.hover,
        state: 'idle', st: 0, t: typeof def.id === 'number' ? def.id * 1.37 : 0, cd: 1 + (typeof def.id === 'number' ? (def.id % 5) * 0.4 : 0),
        frozen: 0, stun: 0, burn: 0, flash: 0, dead: false, deathT: 0.6, ground: null, goal: null, nextT: 0,
        tx: def.x, ty: def.y, tz: def.z, remote: this.role === 'guest',
      };
      this.enemies.push(e); this.enemyMap.set(e.id, e);
      return e;
    }

    addPlayer(info) {
      const C0 = SQ.CHARS[info.charId];
      const sp = this.level.spawn, slot = info.slot || 0;
      const x = sp.x + SLOT_OFF[slot % 4];
      const p = {
        id: info.id, charId: info.charId, name: info.name || C0.name, slot, remote: !info.local,
        x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0, hw: 0.38, h: 1.7, ry: Math.PI, ground: null,
        hp: C0.hp, maxHp: C0.hp, lives: K.START_LIVES, coins: 0, stars: 0, score: 0,
        invuln: 0, hurtT: 0, cd: { atk: 0, spc: 0 }, buffs: { speed: 0, jump: 0, shield: 0, power: 0, star: 0 },
        coyote: 0, jumpBuf: 0, jumpsLeft: 0, jumped: false, atkAnim: 0, anim: 'idle', dead: false, deadT: 0, out: false,
        cp: { x, y: sp.y, z: sp.z }, tx: x, ty: sp.y, tz: sp.z, gliding: false, preVy: 0,
      };
      this.players.push(p); return p;
    }
    removePlayer(id) { this.players = this.players.filter((p) => p.id !== id); }
    getPlayer(id) { return this.players.find((p) => p.id === id); }

    /* ================= main step ================= */
    update(dt, inputs) {
      dt = Math.min(dt, 1 / 30);
      this.time += dt;
      for (const p of this.plats) Ph.updatePlatform(p, this.time);
      for (const p of this.players) {
        if (p.remote) this.updateRemote(p, dt);
        else this.updatePlayer(p, (inputs && inputs[p.id]) || NOINPUT, dt);
      }
      for (const e of this.enemies) { if (this.role === 'guest') this.updateEnemyRemote(e, dt); else this.updateEnemy(e, dt); }
      this.updateProjectiles(dt);
      this.updateWaves(dt);
      this.updatePickups(dt);
      this.checkContacts();
      this.checkTriggers();
      if (!this.failed && this.players.length && this.players.every((p) => p.out)) { this.failed = true; this.emit('fail'); }
    }

    /* ================= players ================= */
    updatePlayer(p, inp, dt) {
      const C0 = SQ.CHARS[p.charId];
      if (p.out) { p.anim = 'dead'; return; }
      if (p.dead) { p.deadT -= dt; p.anim = 'dead'; if (p.deadT <= 0) this.respawn(p); return; }
      p.invuln = Math.max(0, p.invuln - dt); p.hurtT = Math.max(0, p.hurtT - dt);
      p.cd.atk -= dt; p.cd.spc -= dt; p.atkAnim = Math.max(0, p.atkAnim - dt);
      for (const k in p.buffs) if (p.buffs[k] > 0) p.buffs[k] = Math.max(0, p.buffs[k] - dt);
      p.coyote -= dt; p.jumpBuf -= dt;

      const ctl = p.hurtT > 0 ? 0.25 : 1;
      const sp = C0.speed * (p.buffs.speed > 0 ? 1.45 : 1);
      const surf = p.ground ? p.ground.surface : 'air';
      const acc = !p.ground ? 5.5 : surf === 'ice' ? 1.8 : 14;
      const k = Math.min(1, acc * dt);
      p.vx += (inp.mx * ctl * sp - p.vx) * k;
      p.vz += (inp.mz * ctl * sp - p.vz) * k;
      if (Math.hypot(inp.mx, inp.mz) > 0.2) p.ry = lerpAngle(p.ry, Math.atan2(inp.mx, inp.mz), Math.min(1, 16 * dt));

      // jumping
      if (inp.jumpPressed) p.jumpBuf = 0.12;
      if (p.ground) { p.coyote = 0.1; p.jumpsLeft = C0.doubleJump ? 1 : 0; }
      if (p.jumpBuf > 0 && p.coyote > 0) {
        const g = p.ground;                     // inherit a bit of the platform's velocity so jumping off sliders feels right
        if (g && g.solid && dt > 0) { p.vx += clamp(g.dx / dt, -8, 8) * 0.8; p.vz += clamp(g.dz / dt, -8, 8) * 0.8; }
        p.vy = C0.jump * (p.buffs.jump > 0 ? 1.3 : 1) + (g && g.solid && dt > 0 ? clamp(g.dy / dt, 0, 6) : 0);
        p.coyote = 0; p.jumpBuf = 0; p.ground = null; p.jumped = true;
        this.emit('jump', { x: p.x, y: p.y, z: p.z, pid: p.id });
      } else if (p.jumpBuf > 0 && !p.ground && p.jumpsLeft > 0) {
        p.vy = C0.jump * 0.82; p.jumpsLeft--; p.jumpBuf = 0; p.jumped = true;
        this.emit('djump', { x: p.x, y: p.y, z: p.z, pid: p.id, charId: p.charId });
      }
      if (!inp.jumpHeld && p.vy > 6 && p.jumped) { p.vy = 6; p.jumped = false; }

      // gravity / glide
      p.vy = Math.max(p.vy - K.GRAVITY * dt, K.TERMINAL);
      p.gliding = false;
      if (C0.glide && inp.jumpHeld && p.vy < 0 && !p.ground) { p.vy = Math.max(p.vy, -3.2); p.gliding = true; }

      if (inp.attack) this.tryAttack(p);
      if (inp.special) this.trySpecial(p);

      p.preVy = p.vy;
      const res = Ph.moveEntity(p, this.plats, dt, { stepUp: true });
      if (res.crushed) { this.killPlayer(p, 'crush'); return; }
      if (res.landed && p.preVy < -9) this.emit('land', { x: p.x, y: p.y, z: p.z, pid: p.id });
      if (p.ground) {
        p.jumped = false;
        if (p.ground.surface === 'bounce') {
          p.vy = inp.jumpHeld ? 29 : 25; p.ground = null; p.coyote = 0; p.jumpsLeft = C0.doubleJump ? 1 : 0;
          this.emit('bounce', { x: p.x, y: p.y, z: p.z });
        } else if (p.ground.surface === 'lava' && !C0.immune.includes('lava')) {
          this.hurtPlayer(p, 1, p.x, p.z + 0.01);
          p.vy = 11; p.ground = null;
        }
      }
      if (p.y < this.level.killY) { this.killPlayer(p, 'fall'); return; }

      const spd = Math.hypot(p.vx, p.vz);
      p.anim = p.hurtT > 0 ? 'hurt' : !p.ground ? (p.gliding ? 'glide' : p.vy > 0.5 ? 'jump' : 'fall') : spd > 0.8 ? 'run' : 'idle';
    }

    respawn(p) {
      p.dead = false; p.hp = p.maxHp; p.invuln = 2.2; p.hurtT = 0;
      p.x = p.cp.x + (p.slot ? SLOT_OFF[p.slot % 4] * 0.4 : 0); p.y = p.cp.y + 0.2; p.z = p.cp.z;
      p.vx = p.vy = p.vz = 0; p.ground = null;
      this.emit('respawn', { x: p.x, y: p.y, z: p.z, pid: p.id });
    }

    killPlayer(p, why) {
      if (p.dead || p.out) return;
      p.dead = true; p.deadT = 1.6; p.lives--; p.vx = p.vy = p.vz = 0; p.ground = null;
      for (const k in p.buffs) p.buffs[k] = 0;
      p.anim = 'dead';
      this.emit('die', { x: p.x, y: Math.max(p.y, this.level.killY + 2), z: p.z, pid: p.id, why });
      if (p.lives <= 0) { p.lives = 0; p.out = true; this.emit('out', { pid: p.id }); }
    }

    hurtPlayer(p, dmg, sx, sz, element) {
      const C0 = SQ.CHARS[p.charId];
      if (p.dead || p.out || p.invuln > 0 || p.buffs.star > 0) return false;
      if (element && C0.immune.includes(element)) return false;
      if (p.buffs.shield > 0) {
        p.buffs.shield = 0; p.invuln = 1.2;
        this.emit('shieldBreak', { x: p.x, y: p.y + 1, z: p.z });
        return true;
      }
      p.hp -= dmg; p.invuln = 1.6; p.hurtT = 0.35;
      const dx = p.x - sx, dz = p.z - sz, d = Math.hypot(dx, dz) || 1;
      const kb = C0.id === 'bull' ? 5 : 7.5;
      p.vx = (dx / d) * kb; p.vz = (dz / d) * kb; p.vy = Math.max(p.vy, 8); p.ground = null;
      this.emit('hurt', { x: p.x, y: p.y + 1, z: p.z, pid: p.id });
      if (p.hp <= 0) this.killPlayer(p, 'hit');
      return true;
    }

    applyPower(p, sub) {
      const def = SQ.POWERUPS[sub];
      if (sub === 'heart') p.hp = Math.min(p.maxHp, p.hp + 1);
      else if (sub === 'oneup') p.lives++;
      else p.buffs[sub] = def.dur;
      this.emit('power', { x: p.x, y: p.y + 1, z: p.z, sub, pid: p.id });
    }

    /* ================= attacks ================= */
    aimDir(p, A) {
      const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
      let best = null, bd = 16;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.5 || d > bd) continue;
        if ((dx * fx + dz * fz) / d < 0.72) continue;     // within ~44 degrees of where we face
        bd = d; best = e;
      }
      if (best) {
        const dx = best.x - p.x, dz = best.z - p.z, dy = (best.y + best.h * 0.5) - (p.y + 1.1);
        const l = Math.hypot(dx, dy, dz) || 1;
        return { x: dx / l, y: dy / l + (A.grav ? 0.06 : 0), z: dz / l };
      }
      return { x: fx, y: A.grav ? 0.1 : 0, z: fz };
    }

    spawnProj(d) {
      const q = Object.assign({ id: this.nextProj++, hostile: false, local: false, hit: new Set(), pierce: false, grav: 0, knock: 0, element: null }, d);
      q.maxLife = q.life;
      this.projs.push(q); return q;
    }

    tryAttack(p) {
      const A = SQ.CHARS[p.charId].attack;
      if (!A || p.cd.atk > 0) return;
      const power = p.buffs.power > 0;
      p.cd.atk = A.cd * (power ? 0.6 : 1); p.atkAnim = 0.25;
      const dir = this.aimDir(p, A);
      const ox = p.x + Math.sin(p.ry) * 0.5, oy = p.y + 1.1, oz = p.z + Math.cos(p.ry) * 0.5;
      for (const a of power ? [-0.22, 0, 0.22] : [0]) {
        const c = Math.cos(a), s = Math.sin(a);
        const data = {
          kind: A.kind, element: A.kind, owner: p.id, x: ox, y: oy, z: oz,
          vx: (dir.x * c - dir.z * s) * A.speed, vy: dir.y * A.speed, vz: (dir.x * s + dir.z * c) * A.speed,
          dmg: A.dmg * (power ? 1.4 : 1), life: A.life, grav: A.grav, radius: A.radius, pierce: !!A.pierce, color: A.color, knock: A.knock,
        };
        this.spawnProj(Object.assign({ local: true }, data));
        this.out.push({ t: 'shot', d: data });
      }
      this.emit('shoot', { x: ox, y: oy, z: oz, kind: A.kind, pid: p.id });
    }

    trySpecial(p) {
      const S = SQ.CHARS[p.charId].special;
      if (!S || p.cd.spc > 0) return;
      p.cd.spc = S.cd * (p.buffs.power > 0 ? 0.6 : 1); p.atkAnim = 0.4;
      this.doSpecial(p, S, true);
      this.out.push({ t: 'spc', pid: p.id, kind: S.kind, x: p.x, y: p.y, z: p.z });
    }

    doSpecial(p, S, local) {
      this.emit('special', { kind: S.kind, x: p.x, y: p.y, z: p.z, radius: S.radius, pid: p.id });
      if (!local) return;
      const element = S.kind === 'ice' ? 'ice' : S.kind === 'inferno' ? 'fire' : 'wind';
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
        if (d > S.radius + e.hw || Math.abs(e.y - p.y) > 3.2) continue;
        const kn = S.kind === 'cyclone' ? 14 : S.kind === 'inferno' ? 6 : 2;
        this.hitEnemy(e, { dmg: S.dmg * (p.buffs.power > 0 ? 1.4 : 1), element, kx: (dx / (d || 1)) * kn, kz: (dz / (d || 1)) * kn, freeze: S.freeze || 0, by: p.id });
      }
      for (let i = this.projs.length - 1; i >= 0; i--) {         // special clears enemy bullets
        const q = this.projs[i];
        if (q.hostile && Math.hypot(q.x - p.x, q.z - p.z) < S.radius) { this.emit('splash', { x: q.x, y: q.y, z: q.z, color: q.color }); this.projs.splice(i, 1); }
      }
      if (S.pull) for (const pk of this.pickups) {
        if (!pk.taken && pk.kind === 'coin' && Math.hypot(pk.x - p.x, pk.z - p.z) < S.pull && Math.abs(pk.y - p.y) < 6) { pk.mag = 1.6; pk.magPid = p.id; }
      }
    }

    /* ================= enemies ================= */
    nearest(x, y, z, range, dy) {
      let best = null, bd = range;
      for (const p of this.players) {
        if (p.dead || p.out) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd && (dy === undefined || Math.abs(p.y - y) < dy)) { bd = d; best = p; }
      }
      return best;
    }

    hitEnemy(e, info) {
      if (e.dead) return;
      if (this.role === 'guest') {
        this.out.push({ t: 'hit', id: e.id, dmg: info.dmg, el: info.element, kx: r2(info.kx || 0), kz: r2(info.kz || 0), fz: info.freeze || 0 });
        this.emit('hitfx', { x: e.x, y: e.y + e.h * 0.6, z: e.z, element: info.element });
        return;
      }
      this.applyHit(e, info);
    }

    applyHit(e, info) {
      if (e.dead) return;
      let m = 1;
      const el = info.element;
      if (e.element === 'fire') { if (el === 'water' || el === 'ice') m = 2; else if (el === 'fire') m = 0; }
      else if (e.element === 'ice') { if (el === 'fire') m = 2; else if (el === 'water') m = 0.5; else if (el === 'ice') m = 0.25; }
      if (e.type === 'flyer' && el === 'wind') m *= 2;
      if (e.type === 'boss') {       // shots chip, stomps hurt; being stunned (after a charge/slam) doubles the damage
        const heavy = el === 'stomp' || el === 'star';
        m *= heavy ? 1 : 0.25;
        if (e.state === 'stunned' || e.state === 'slam-rec') m *= 2;
      }
      if (info.freeze > 0 && m > 0) { if (e.type === 'boss') e.stun = Math.max(e.stun, 0.8); else e.frozen = info.freeze; }
      else if (e.frozen > 0 && info.dmg >= 0.7) { m *= 2; e.frozen = 0; this.emit('shatter', { x: e.x, y: e.y + e.h / 2, z: e.z }); }
      e.hp -= info.dmg * m; e.flash = 0.18;
      if (e.type !== 'boss') { e.kx += info.kx || 0; e.kz += info.kz || 0; }
      if (el === 'fire' && e.element !== 'fire' && m > 0 && e.type !== 'boss') e.burn = 2.5;
      this.emit(m === 0 ? 'resist' : 'enemyHit', { x: e.x, y: e.y + e.h * 0.6, z: e.z, element: el });
      if (e.hp <= 0) this.killEnemy(e);
    }

    applyNetHit(msg) {            // host: a guest reported a hit
      const e = this.enemyMap.get(msg.id);
      if (e) this.applyHit(e, { dmg: msg.dmg, element: msg.el, kx: msg.kx, kz: msg.kz, freeze: msg.fz });
    }

    killEnemy(e) {
      if (e.dead) return;
      e.dead = true; e.hp = 0; e.deathT = 0.6; e.frozen = 0;
      this.emit('enemyDie', { x: e.x, y: e.y + e.h / 2, z: e.z, boss: e.type === 'boss', element: e.element });
      const drops = e.type === 'boss' ? 0 : e.type === 'turret' || e.type === 'spiker' ? 3 : 2;
      for (let i = 0; i < drops; i++) {
        const id = 'd' + e.id + '_' + i;
        if (!this.pickMap.has(id)) this.addPickup(id, 'coin', null, { x: e.x + (i - (drops - 1) / 2) * 0.7, y: e.y + e.h * 0.5 + 0.6, z: e.z });
      }
      if (e.type === 'boss') { this.goalActive = true; this.emit('bossDown', { x: e.x, y: e.y, z: e.z }); }
    }

    enemyPhysics(e, dt) {
      e.vy = Math.max(e.vy - K.GRAVITY * dt, K.TERMINAL);
      Ph.moveEntity(e, this.plats, dt, {});
    }

    updateEnemy(e, dt) {
      if (e.dead) { e.deathT -= dt; return; }
      e.t += dt; e.flash = Math.max(0, e.flash - dt);
      if (e.burn > 0) { e.burn -= dt; e.hp -= 0.5 * dt; if (e.hp <= 0) { this.killEnemy(e); return; } }
      if (e.y < this.level.killY) { this.killEnemy(e); return; }
      if (e.frozen > 0) { e.frozen -= dt; e.vx = e.vz = 0; if (e.type !== 'flyer' && e.type !== 'turret') this.enemyPhysics(e, dt); return; }
      switch (e.type) {
        case 'walker': case 'spiker': this.aiWalker(e, dt); break;
        case 'flyer': this.aiFlyer(e, dt); break;
        case 'turret': this.aiTurret(e, dt); break;
        case 'boss': this.aiBoss(e, dt); break;
      }
    }

    updateEnemyRemote(e, dt) {
      if (e.dead) { e.deathT -= dt; return; }
      e.t += dt; e.flash = Math.max(0, e.flash - dt);
      const k = Math.min(1, 11 * dt);
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.z += (e.tz - e.z) * k;
    }

    aiWalker(e, dt) {
      const T = SQ.ENEMIES[e.type];
      const tgt = this.nearest(e.x, e.y, e.z, 8, 2.6);
      let dx, dz, sp = T.speed;
      if (tgt) { dx = tgt.x - e.x; dz = tgt.z - e.z; sp = T.chase; e.state = 'chase'; }
      else {
        e.state = 'patrol';
        const b = e.bounds;
        if (!e.goal || Math.hypot(e.goal.x - e.x, e.goal.z - e.z) < 0.5 || e.t > e.nextT) {
          e.goal = b ? { x: b.minX + Math.random() * (b.maxX - b.minX), z: b.minZ + Math.random() * (b.maxZ - b.minZ) } : { x: e.home.x, z: e.home.z };
          e.nextT = e.t + 3 + Math.random() * 3;
        }
        dx = e.goal.x - e.x; dz = e.goal.z - e.z;
      }
      const d = Math.hypot(dx, dz) || 1;
      e.vx = (dx / d) * sp + e.kx; e.vz = (dz / d) * sp + e.kz;
      const decay = Math.exp(-7 * dt); e.kx *= decay; e.kz *= decay;
      if (d > 0.2) e.ry = lerpAngle(e.ry, Math.atan2(dx, dz), Math.min(1, 8 * dt));
      this.enemyPhysics(e, dt);
      if (e.bounds) { e.x = clamp(e.x, e.bounds.minX, e.bounds.maxX); e.z = clamp(e.z, e.bounds.minZ, e.bounds.maxZ); }
    }

    aiFlyer(e, dt) {
      const h = e.home;
      e.cd -= dt;
      if (e.state === 'dive') {
        const dx = e.dive.x - e.x, dy = e.dive.y - e.y, dz = e.dive.z - e.z, d = Math.hypot(dx, dy, dz) || 1;
        e.x += (dx / d) * 10 * dt; e.y += (dy / d) * 10 * dt; e.z += (dz / d) * 10 * dt;
        e.ry = Math.atan2(dx, dz); e.st -= dt;
        if (e.st <= 0 || d < 0.6) e.state = 'return';
      } else {
        const a = e.t * 0.9;
        const tx = h.x + Math.cos(a) * 2.4, ty = h.y + Math.sin(e.t * 2.2) * 0.4, tz = h.z + Math.sin(a) * 2.4;
        const k = Math.min(1, (e.state === 'return' ? 2.5 : 4) * dt);
        e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; e.z += (tz - e.z) * k;
        e.ry = a + Math.PI / 2;
        if (e.state === 'return' && Math.hypot(tx - e.x, tz - e.z) < 0.8) e.state = 'orbit';
        const tgt = this.nearest(e.x, e.y, e.z, 9);
        if (tgt && e.cd <= 0 && e.state !== 'return') { e.state = 'dive'; e.st = 1.2; e.dive = { x: tgt.x, y: tgt.y + 0.8, z: tgt.z }; e.cd = 4; }
      }
      e.x += e.kx * dt; e.z += e.kz * dt;
      const decay = Math.exp(-5 * dt); e.kx *= decay; e.kz *= decay;
    }

    fireHostile(d) {
      const q = this.spawnProj(Object.assign({ hostile: true, life: 3.6, radius: 0.36, dmg: 1, color: 0xff3b3b, grav: 0 }, d));
      if (this.role === 'host') this.out.push({ t: 'eshot', d: Object.assign({}, d) });
      return q;
    }

    aiTurret(e, dt) {
      e.cd -= dt;
      const tgt = this.nearest(e.x, e.y, e.z, 18);
      if (!tgt) { if (e.cd < 0.8) e.cd = 0.8; return; }
      const dx = tgt.x - e.x, dz = tgt.z - e.z, dy = tgt.y + 1 - (e.y + 1.0), l = Math.hypot(dx, dy, dz) || 1;
      e.ry = lerpAngle(e.ry, Math.atan2(dx, dz), Math.min(1, 6 * dt));
      if (e.cd <= 0) {
        e.cd = 2.4;
        const col = e.element === 'fire' ? 0xff7a1a : e.element === 'ice' ? 0x9fe8ff : 0xff3b3b;
        this.fireHostile({ x: e.x + (dx / l) * 0.8, y: e.y + 1.0, z: e.z + (dz / l) * 0.8, vx: (dx / l) * 9, vy: (dy / l) * 9, vz: (dz / l) * 9, color: col, element: e.element });
      }
    }

    spawnWave(d) {
      const w = Object.assign({ speed: 10, maxR: 16, thick: 1.3, dmg: 1, r: 0.5, hit: new Set() }, d);
      this.waves.push(w);
      if (this.role === 'host') this.out.push({ t: 'ewave', d: Object.assign({}, d) });
      this.emit('wave', { x: w.x, y: w.y, z: w.z });
    }

    aiBoss(e, dt) {
      const A = this.level.arena;
      const ph2 = e.hp < e.maxHp * 0.5;
      const tgt = this.nearest(e.x, e.y, e.z, 999);
      e.st -= dt;
      const face = () => { if (tgt) e.ry = lerpAngle(e.ry, Math.atan2(tgt.x - e.x, tgt.z - e.z), Math.min(1, 9 * dt)); };
      let moveX = 0, moveZ = 0, clampedHit = false;
      switch (e.state) {
        case 'idle': {
          if (tgt) { face(); const dx = tgt.x - e.x, dz = tgt.z - e.z, d = Math.hypot(dx, dz) || 1; const s = ph2 ? 3.6 : 2.6; if (d > 4) { moveX = (dx / d) * s; moveZ = (dz / d) * s; } }
          if (e.st <= 0) {
            const opts = ['charge', 'volley', 'slam'].filter((a) => a !== e.last);
            const pick = opts[Math.floor(Math.random() * opts.length)]; e.last = pick;
            if (pick === 'charge') { e.state = 'tele-charge'; e.st = ph2 ? 0.7 : 0.95; }
            else if (pick === 'volley') { e.state = 'tele-volley'; e.st = 0.6; e.shots = ph2 ? 3 : 2; }
            else { e.state = 'tele-slam'; e.st = 0.55; }
          }
          break;
        }
        case 'tele-charge': face(); if (e.st <= 0) { const dx = tgt ? tgt.x - e.x : 0, dz = tgt ? tgt.z - e.z : 1, d = Math.hypot(dx, dz) || 1; e.cdir = { x: dx / d, z: dz / d }; e.state = 'charge'; e.st = 1.5; } break;
        case 'charge': { const s = ph2 ? 15 : 12.5; moveX = e.cdir.x * s; moveZ = e.cdir.z * s; e.ry = Math.atan2(e.cdir.x, e.cdir.z); if (e.st <= 0) { e.state = 'idle'; e.st = 0.8; } break; }
        case 'tele-volley': face(); if (e.st <= 0) { this.bossVolley(e, tgt, ph2); e.shots--; e.state = 'volley'; e.st = 0.7; } break;
        case 'volley': face(); if (e.st <= 0) { if (e.shots > 0) { this.bossVolley(e, tgt, ph2); e.shots--; e.st = 0.7; } else { e.state = 'idle'; e.st = 1.1; } } break;
        case 'tele-slam': face(); if (e.st <= 0) {
          const dx = tgt ? tgt.x - e.x : 0, dz = tgt ? tgt.z - e.z : 0, d = Math.hypot(dx, dz) || 1, s = Math.min(9, d / 1.0);
          e.vy = 20; e.vx = (dx / d) * s; e.vz = (dz / d) * s; e.state = 'slam-air'; e.slamT = 0; e.ground = null;
        } break;
        case 'slam-air': e.slamT += dt; moveX = e.vx; moveZ = e.vz;
          if (e.ground && e.slamT > 0.25) { e.state = 'slam-rec'; e.st = ph2 ? 0.9 : 1.2; this.spawnWave({ x: e.x, y: e.y, z: e.z, speed: ph2 ? 12 : 10, dmg: 1 }); this.emit('bossSlam', { x: e.x, y: e.y, z: e.z }); }
          break;
        case 'slam-rec': if (e.st <= 0) { e.state = 'idle'; e.st = 0.6; } break;
        case 'stunned': if (e.st <= 0) { e.state = 'idle'; e.st = 0.8; } break;
      }
      if (e.stun > 0) { e.stun -= dt; moveX = moveZ = 0; }
      e.vx = moveX; e.vz = moveZ;
      this.enemyPhysics(e, dt);
      if (A) {
        const nx = clamp(e.x, A.x - A.half, A.x + A.half), nz = clamp(e.z, A.z - A.half, A.z + A.half);
        clampedHit = nx !== e.x || nz !== e.z; e.x = nx; e.z = nz;
      }
      if (e.state === 'charge' && clampedHit) { e.state = 'stunned'; e.st = ph2 ? 1.8 : 2.4; this.emit('bossBonk', { x: e.x, y: e.y + 1.5, z: e.z }); }
    }

    bossVolley(e, tgt, ph2) {
      const n = ph2 ? 5 : 3, base = tgt ? Math.atan2(tgt.x - e.x, tgt.z - e.z) : e.ry;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.3;
        this.fireHostile({ x: e.x + Math.sin(a) * 1.4, y: e.y + 1.4, z: e.z + Math.cos(a) * 1.4, vx: Math.sin(a) * 10, vy: 0, vz: Math.cos(a) * 10, color: 0xff2020, radius: 0.42, life: 3.2 });
      }
      this.emit('bossShoot', { x: e.x, y: e.y + 1.4, z: e.z });
    }

    /* ================= projectiles & waves ================= */
    updateProjectiles(dt) {
      for (let i = this.projs.length - 1; i >= 0; i--) {
        const q = this.projs[i];
        q.life -= dt; q.vy -= (q.grav || 0) * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        let remove = q.life <= 0;
        if (!remove && Ph.pointHit(q.x, q.y, q.z, q.radius * 0.5, this.plats)) { remove = true; this.emit('splash', { x: q.x, y: q.y, z: q.z, color: q.color }); }
        if (!remove && q.hostile) {
          for (const p of this.players) {
            if (p.remote || p.dead || p.out) continue;
            if (Math.hypot(q.x - p.x, q.z - p.z) < q.radius + p.hw && q.y > p.y - q.radius && q.y < p.y + p.h + q.radius) {
              this.hurtPlayer(p, q.dmg, q.x - q.vx * 0.1, q.z - q.vz * 0.1, q.element);
              remove = true; this.emit('splash', { x: q.x, y: q.y, z: q.z, color: q.color });
              break;
            }
          }
        } else if (!remove) {
          for (const e of this.enemies) {
            if (e.dead || q.hit.has(e.id)) continue;
            const cx = clamp(q.x, e.x - e.hw, e.x + e.hw), cy = clamp(q.y, e.y, e.y + e.h), cz = clamp(q.z, e.z - e.hw, e.z + e.hw);
            if ((q.x - cx) ** 2 + (q.y - cy) ** 2 + (q.z - cz) ** 2 > q.radius * q.radius) continue;
            if (q.local) {
              const sp = Math.hypot(q.vx, q.vz) || 1;
              this.hitEnemy(e, { dmg: q.dmg, element: q.element, kx: (q.vx / sp) * q.knock, kz: (q.vz / sp) * q.knock, by: q.owner });
            }
            if (q.pierce) q.hit.add(e.id); else { remove = true; this.emit('splash', { x: q.x, y: q.y, z: q.z, color: q.color }); break; }
          }
        }
        if (remove) this.projs.splice(i, 1);
      }
    }

    updateWaves(dt) {
      for (let i = this.waves.length - 1; i >= 0; i--) {
        const w = this.waves[i];
        w.r += w.speed * dt;
        for (const p of this.players) {
          if (p.remote || p.dead || p.out || w.hit.has(p.id)) continue;
          const d = Math.hypot(p.x - w.x, p.z - w.z);
          if (Math.abs(d - w.r) < w.thick / 2 + p.hw && p.y < w.y + 0.8 && Math.abs(p.y - w.y) < 3) { w.hit.add(p.id); this.hurtPlayer(p, w.dmg, w.x, w.z); }
        }
        if (w.r > w.maxR) this.waves.splice(i, 1);
      }
    }

    /* ================= pickups, contacts, triggers ================= */
    updatePickups(dt) {
      for (const pk of this.pickups) {
        if (pk.taken) continue;
        if (pk.mag > 0) {
          pk.mag -= dt;
          const t = this.getPlayer(pk.magPid);
          if (t) { const dx = t.x - pk.x, dy = t.y + 0.9 - pk.y, dz = t.z - pk.z, d = Math.hypot(dx, dy, dz) || 1; pk.x += (dx / d) * 16 * dt; pk.y += (dy / d) * 16 * dt; pk.z += (dz / d) * 16 * dt; }
        }
        for (const p of this.players) {
          if (p.remote || p.dead || p.out) continue;
          const r = pk.kind === 'coin' ? 1.15 : 1.4;
          const dx = pk.x - p.x, dy = pk.y - (p.y + 0.9), dz = pk.z - p.z;
          if (dx * dx + dy * dy + dz * dz < r * r) { this.collect(p, pk); break; }
        }
      }
    }

    collect(p, pk) {
      pk.taken = true;
      if (this.role !== 'solo') this.out.push({ t: 'take', id: pk.id });
      if (pk.kind === 'coin') {
        p.coins++; p.score += 10;
        this.emit('coin', { x: pk.x, y: pk.y, z: pk.z, pid: p.id });
        if (p.coins % 100 === 0) { p.lives++; this.emit('oneup', { x: p.x, y: p.y + 1.5, z: p.z, pid: p.id }); }
      } else if (pk.kind === 'star') {
        p.stars++; p.score += 500;
        this.emit('star', { x: pk.x, y: pk.y, z: pk.z, pid: p.id });
      } else this.applyPower(p, pk.sub);
    }

    markTaken(id) { const pk = this.pickMap.get(id); if (pk && !pk.taken) { pk.taken = true; this.emit('vanish', { x: pk.x, y: pk.y, z: pk.z, kind: pk.kind }); } }

    checkContacts() {
      for (const p of this.players) {
        if (p.remote || p.dead || p.out) continue;
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (!(p.x - p.hw < e.x + e.hw && p.x + p.hw > e.x - e.hw && p.z - p.hw < e.z + e.hw && p.z + p.hw > e.z - e.hw && p.y < e.y + e.h && p.y + p.h > e.y)) continue;
          const T = SQ.ENEMIES[e.type];
          const stompable = (T.stomp || e.frozen > 0) && !(e.type === 'boss' && e.state === 'charge');
          if (p.vy < -1 && p.y > e.y + e.h * 0.5 && stompable) {
            p.vy = 13; p.ground = null; p.jumped = false;
            this.emit('stomp', { x: e.x, y: e.y + e.h, z: e.z, pid: p.id });
            this.hitEnemy(e, { dmg: 2.5, element: 'stomp', kx: 0, kz: 0, by: p.id });
            continue;
          }
          if (e.frozen > 0) continue;
          if (p.buffs.star > 0) { this.hitEnemy(e, { dmg: 4, element: 'star', kx: (e.x - p.x) * 6, kz: (e.z - p.z) * 6, by: p.id }); continue; }
          this.hurtPlayer(p, T.contact, e.x, e.z);
        }
      }
    }

    checkTriggers() {
      const g = this.level.goal;
      for (const p of this.players) {
        if (p.remote || p.dead || p.out) continue;
        for (const c of this.checkpoints) {
          if (c.start) continue;
          if (Math.abs(p.x - c.x) < 2.4 && Math.abs(p.z - c.z) < 2.4 && Math.abs(p.y - c.y) < 2.5) {
            p.cp = { x: c.x, y: c.y, z: c.z };
            if (!c.active) { c.active = true; this.emit('checkpoint', { x: c.x, y: c.y, z: c.z, id: c.id }); }
          }
        }
        if (this.goalActive && !this.cleared && Math.hypot(p.x - g.x, p.z - g.z) < g.r && Math.abs(p.y - g.y) < 3.5) {
          p.score += 1000;
          this.forceClear(p.id);
          this.out.push({ t: 'goal', pid: p.id });
        }
      }
    }

    forceClear(pid) { if (this.cleared) return; this.cleared = true; this.winner = pid; this.emit('clear', { pid }); }

    /* ================= network glue ================= */
    netShot(d) {                                   // someone else's shot: visuals only (their client reports the hits)
      this.spawnProj(Object.assign({}, d, { local: false, hostile: false }));
      this.emit('shoot', { x: d.x, y: d.y, z: d.z, kind: d.kind, pid: d.owner });
    }
    netEShot(d) { this.spawnProj(Object.assign({ hostile: true, life: 3.6, radius: 0.36, dmg: 1, color: 0xff3b3b, grav: 0 }, d)); }
    netEWave(d) { this.spawnWave(d); }
    netSpecial(m) {
      const p = this.getPlayer(m.pid), S = p && SQ.CHARS[p.charId].special;
      if (S) this.doSpecial(p, S, false);
    }
    playerState(p) {
      return { t: 'ps', id: p.id, ch: p.charId, x: r2(p.x), y: r2(p.y), z: r2(p.z), ry: r2(p.ry), a: p.anim, hp: p.hp, mh: p.maxHp,
               d: p.dead ? 1 : 0, o: p.out ? 1 : 0, c: p.coins, s: p.stars, lv: p.lives, iv: p.invuln > 0 ? 1 : 0, sh: p.buffs.shield > 0 ? 1 : 0, st: p.buffs.star > 0 ? 1 : 0, at: p.atkAnim > 0 ? 1 : 0 };
    }

    applyPlayerState(m) {
      const p = this.getPlayer(m.id);
      if (!p || !p.remote) return;
      p.tx = m.x; p.ty = m.y; p.tz = m.z; p.tryaw = m.ry; p.anim = m.a; p.hp = m.hp; p.maxHp = m.mh;
      p.dead = !!m.d; p.out = !!m.o; p.coins = m.c; p.stars = m.s; p.lives = m.lv;
      p.invuln = m.iv ? 1 : 0; p.buffs.shield = m.sh ? 1 : 0; p.buffs.star = m.st ? 1 : 0; p.atkAnim = m.at ? 0.2 : 0;
    }

    updateRemote(p, dt) {
      const k = Math.min(1, 14 * dt);
      if (Math.hypot(p.tx - p.x, p.tz - p.z) > 12) { p.x = p.tx; p.y = p.ty; p.z = p.tz; }
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
      if (p.tryaw !== undefined) p.ry = lerpAngle(p.ry, p.tryaw, k);
    }

    snapshot() {
      return { t: 'snap', time: r2(this.time), e: this.enemies.map((e) => [e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.ry), r2(e.hp), e.state, e.frozen > 0 ? 1 : 0, e.stun > 0 ? 1 : 0]) };
    }

    applySnapshot(s) {
      const target = s.time + 0.04, diff = target - this.time;
      if (Math.abs(diff) > 0.35) this.time = target; else this.time += diff * 0.15;
      for (const row of s.e) {
        const e = this.enemyMap.get(row[0]);
        if (!e || e.dead) continue;
        e.tx = row[1]; e.ty = row[2]; e.tz = row[3]; e.ry = row[4]; e.hp = row[5]; e.state = row[6]; e.frozen = row[7] ? 1 : 0; e.stun = row[8] ? 1 : 0;
        if (e.hp <= 0) this.killEnemy(e);
      }
    }
  }

  SQ.Sim = Sim;
  SQ.NOINPUT = NOINPUT;
})(typeof window !== 'undefined' ? window : globalThis);
