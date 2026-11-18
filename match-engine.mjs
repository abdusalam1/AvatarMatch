// 头像撑瓶 · 规则与物理（纯逻辑，不碰 DOM，可在 Node 里单测）
//
// 一句话玩法：观众互动 → 他的头像从瓶口掉进圆瓶 → 同一个人、同一尺寸的头像
// 碰到一起就合成更大的一个 → 一直合到瓶子被撑满 → 炸开、播报、换新瓶。
//
// 坐标系：世界固定 1200×1000（渲染层再缩放到画布），y 向下。
// 容器：圆瓶（圆心 cx, cy，半径 R）+ 顶部细瓶颈（宽 2*neckHalf），用并集
//       SDF 做碰撞：点在瓶内 ⇔ min(圆 SDF, 瓶颈 SDF) < 0。

export const WORLD = Object.freeze({
  w: 1200,
  h: 1000,
  cx: 600,
  cy: 610,
  R: 310,
  neckHalf: 52,
  circleTop: 300,
  chuteTop: -500,      // 瓶口上方敞开，堆满了会一路堆到画面外，看得见"撑满"
  shoulderY: 360,      // 肩部斜边结束的位置（在圆瓶内部）
  shoulderHalf: 183,
  spawnY: 22
});

export const MATCH_DEFAULTS = Object.freeze({
  v: 1,
  // 物理
  gravity: 1700,
  bounce: 0.2,
  friction: 0.25,
  // 合成
  baseRadius: 24,
  mergeScale: 1.26,
  maxTier: 12,
  // 节奏
  spawnPerSec: 12,
  maxPieces: 150,
  burstFill: 0.82,
  // 互动 → 掉落
  likePerDrop: 5,
  comboWindow: 3,
  comboCap: 5,
  giftBoost: 1,
  demoRate: 4.5
});

export const TIER_NAMES_ZH = ['', '迷你', '小圆', '中圆', '大圆', '巨圆', '超巨', '传说', '史诗', '神话', '终极', '灭世', '瓶王'];

// 可复现随机（测试 / 截图用），返回 [0,1)
export function makeRng(seed = 1) {
  let a = (Number(seed) | 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const area = (r) => Math.PI * r * r;
const hypot = (x, y) => Math.sqrt(x * x + y * y);

// 礼物的三档：少 / 中 / 多；bonusTier = 直接送一个几级的头像
const GIFT_PRESETS = [
  { test: /嘉年华|火箭|跑车|飞机|游艇|城堡|派对|神秘|宇宙|大炮|龙/, drops: 12, bonusTier: 3 },
  { test: /玫瑰|啤酒|棒棒糖|冰淇淋|奶茶|咖啡|炸弹|狮子|鲜花/, drops: 6, bonusTier: 2 },
  { test: /小心心|心心|点赞|荧光棒|加油|干杯|气球/, drops: 3, bonusTier: 2 }
];
const GIFT_BY_KIND = {
  heart: { drops: 3, bonusTier: 2 },
  lollipop: { drops: 3, bonusTier: 2 },
  beer: { drops: 6, bonusTier: 2 },
  other: { drops: 12, bonusTier: 3 }
};

export function giftPlan(raw, kind) {
  const name = String(raw || '');
  for (const preset of GIFT_PRESETS) {
    if (preset.test.test(name)) return { drops: preset.drops, bonusTier: preset.bonusTier };
  }
  const fallback = GIFT_BY_KIND[kind];
  return fallback ? { ...fallback } : { drops: 6, bonusTier: 2 };
}

// 瓶身是一个"高度场"：每一层 y 有一个允许的半宽 W(y)。
// 下半段是圆瓶的横截面，上半段是直瓶颈 + 斜肩。这样瓶里没有凹角、没有接缝，
// 头像不会卡在肩膀上（早先用"圆 SDF ∪ 瓶颈矩形"就卡在接缝上了）。
const NECK_BOTTOM = 240;

export function halfWidth(y) {
  const dy = y - WORLD.cy;
  let w = Math.abs(dy) <= WORLD.R ? Math.sqrt(WORLD.R * WORLD.R - dy * dy) : 0;
  if (y <= WORLD.shoulderY) {
    const t = Math.min(1, Math.max(0, (y - NECK_BOTTOM) / (WORLD.shoulderY - NECK_BOTTOM)));
    w = Math.max(w, WORLD.neckHalf + (WORLD.shoulderHalf - WORLD.neckHalf) * t);
  }
  return w;
}

// <0 在瓶内（瓶底以下是外面，瓶口向上敞开）
export function containerSdf(x, y) {
  return Math.max(Math.abs(x - WORLD.cx) - halfWidth(y), y - (WORLD.cy + WORLD.R));
}

export function tierRadius(tier, cfg = MATCH_DEFAULTS) {
  return cfg.baseRadius * Math.pow(cfg.mergeScale, Math.max(0, tier - 1));
}

export class MatchEngine {
  constructor({ cfg = {}, rng = Math.random, now = 0 } = {}) {
    this.cfg = { ...MATCH_DEFAULTS, ...cfg };
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.pieces = [];
    this.queue = [];
    this.events = [];
    this.people = new Map();     // uid → { name, avatar }
    this.likeAcc = new Map();    // uid → 累积点赞
    this.combo = new Map();      // uid → 连击次数
    this.lastAct = new Map();    // uid → 上次互动时间
    this.state = 'playing';      // playing | bursting
    this.time = now;
    this.bottleNo = 1;
    this.burstT = 0;
    this.cleared = false;
    this.spawnAcc = 0;
    this.nextLane = 1;
    this.pressure = 0;
    this.milestones = new Set();
    this.stats = { drops: 0, merges: 0, bursts: 0, maxTier: 1, joined: new Set() };
    this.lastBurst = null;
    this.nextId = 1;
  }

  // ---------- 互动 → 掉落 ----------

  feed(ev = {}) {
    const type = String(ev.type || '');
    const name = String(ev.name || '').trim();
    if (!name || !['like', 'comment', 'gift', 'join', 'follow', 'share'].includes(type)) return 0;
    const uid = name;
    const avatar = typeof ev.avatar === 'string' ? ev.avatar : '';
    this.people.set(uid, { name, avatar: avatar || this.people.get(uid)?.avatar || '' });

    const now = this.time;
    const gap = now - (this.lastAct.get(uid) ?? -999);
    const combo = gap <= this.cfg.comboWindow
      ? Math.min(this.cfg.comboCap + 1, (this.combo.get(uid) || 0) + 1)
      : 1;
    this.combo.set(uid, combo);
    this.lastAct.set(uid, now);

    let count = 0;
    let bonusTier = 0;
    let plan = null;

    if (type === 'like') {
      const n = clamp(Math.round(Number(ev.count) || 1), 1, 999);
      const acc = (this.likeAcc.get(uid) || 0) + n;
      const whole = Math.floor(acc / this.cfg.likePerDrop);
      this.likeAcc.set(uid, acc - whole * this.cfg.likePerDrop);
      count = whole;
    } else if (type === 'comment') {
      count = 2;
    } else if (type === 'join') {
      count = 1;
      if (!this.stats.joined.has(uid)) {
        this.stats.joined.add(uid);
        this.emit({ kind: 'join', uid, name, avatar });
      }
    } else if (type === 'follow' || type === 'share') {
      count = 3;
    } else if (type === 'gift') {
      plan = giftPlan(ev.raw, ev.gift);
      const mult = clamp(Number(ev.count) || 1, 1, 3);
      count = plan.drops * mult;
      bonusTier = plan.bonusTier;
      count = Math.round(count * clamp(this.cfg.giftBoost, 0.2, 4));
      this.emit({ kind: 'gift', uid, name, avatar, raw: String(ev.raw || '礼物'), tier: bonusTier });
    }

    // 连击：同一个观众连续互动，额外多掉（点赞本身已经按次数累积，进场不叠）
    if (type !== 'like' && type !== 'join' && combo > 1) count += combo - 1;

    if (count > 0) this.enqueue(uid, 1, count);
    if (bonusTier > 0) this.enqueue(uid, bonusTier, 1);
    return count + (bonusTier > 0 ? 1 : 0);
  }

  enqueue(uid, tier, count) {
    const info = this.people.get(uid) || { name: uid, avatar: '' };
    const n = Math.max(0, Math.round(count));
    for (let i = 0; i < n && this.queue.length < 320; i++) {
      this.queue.push({ uid, tier: clamp(tier, 1, this.cfg.maxTier), name: info.name, avatar: info.avatar });
    }
    if (n > 0) this.emit({ kind: 'queue', uid, name: info.name, tier, count: n });
  }

  // ---------- 主循环 ----------

  step(dt) {
    const d = clamp(Number(dt) || 0, 0, 0.05);
    if (d <= 0) return;
    this.time += d;

    if (this.state === 'bursting') {
      this.burstT += d;
      this.#flyApart(d);
      if (this.burstT > 0.45 && !this.cleared) {
        this.pieces = [];
        this.cleared = true;
      }
      if (this.burstT > 1.35) this.#newBottle();
      return;
    }

    // 从待落区按节奏放行
    this.spawnAcc = Math.min(this.spawnAcc + d * this.cfg.spawnPerSec, 12);
    let guard = 0;
    while (this.spawnAcc >= 1 && guard++ < 24) {
      this.spawnAcc -= 1;
      if (!this.#spawnOne()) break;
    }

    const steps = clamp(Math.ceil(d / (1 / 120)), 1, 5);
    const h = d / steps;
    for (let i = 0; i < steps; i++) this.#substep(h);

    this.#updatePressure();
    if (this.pressure >= 1 || this.#tooBig()) this.#burst(this.pressure >= 1 ? 'full' : 'giant');
  }

  #spawnOne() {
    if (!this.queue.length || this.pieces.length >= this.cfg.maxPieces) return false;
    const next = this.queue[0];
    const r = tierRadius(next.tier, this.cfg);
    if (r > WORLD.neckHalf - 8) {
      // 瓶颈塞不下这么大的初始头像（正常只可能是配置写歪），丢掉别卡住整条队列
      this.queue.shift();
      this.emit({ kind: 'skip', uid: next.uid, tier: next.tier });
      return true;
    }
    const info = this.people.get(next.uid) || next;
    // 两条车道轮流放行：单车道时一件头像要落开 40 多像素才放下一件，吞吐不够用
    const offset = Math.max(0, WORLD.neckHalf - r - 6);
    const lanes = this.nextLane > 0 ? [1, -1] : [-1, 1];
    for (const lane of lanes) {
      const x = WORLD.cx + lane * offset;
      let blocked = false;
      for (const p of this.pieces) {
        if (p.y > WORLD.spawnY + 90) continue;        // 只看瓶口这一段有没有堵住
        if (hypot(p.x - x, p.y - WORLD.spawnY) < p.r + r + 2) { blocked = true; break; }
      }
      if (blocked) continue;
      this.pieces.push({
        id: this.nextId++,
        uid: next.uid,
        name: info.name || next.name,
        avatar: info.avatar || next.avatar,
        tier: next.tier,
        r,
        x,
        y: WORLD.spawnY,
        vx: (this.rng() * 2 - 1) * 10,
        vy: 220,
        born: this.time,
        mergedAt: -999
      });
      this.queue.shift();
      this.nextLane = -lane;
      this.stats.drops += 1;
      this.stats.maxTier = Math.max(this.stats.maxTier, next.tier);
      this.emit({ kind: 'drop', uid: next.uid, name: info.name, tier: next.tier });
      return true;
    }
    return false;
  }

  #substep(h) {
    const cfg = this.cfg;
    const pieces = this.pieces;

    for (const p of pieces) {
      p.vy += cfg.gravity * h;
      p.vx *= 0.999;
      p.vy *= 0.999;
      p.x += p.vx * h;
      p.y += p.vy * h;
      this.#wall(p);
    }

    // 两两碰撞（n ≤ 150，O(n²) 足够）
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        this.#collide(pieces[i], pieces[j]);
      }
    }
    // 互相挤开之后可能又压进瓶壁了，再收一次
    for (const p of pieces) this.#wall(p);

    // 合成：同一个人 + 同一等级，接触即合
    const merged = new Set();
    for (let i = 0; i < pieces.length; i++) {
      const a = pieces[i];
      if (merged.has(a.id)) continue;
      for (let j = i + 1; j < pieces.length; j++) {
        const b = pieces[j];
        if (merged.has(b.id) || a.uid !== b.uid || a.tier !== b.tier) continue;
        if (a.tier >= cfg.maxTier) continue;
        const dist = hypot(a.x - b.x, a.y - b.y);
        if (dist > a.r + b.r + 1.6) continue;
        // 合成：一个变两倍大，另一个消失
        const tier = a.tier + 1;
        const nr = tierRadius(tier, cfg);
        const nx = (a.x + b.x) / 2, ny = (a.y + b.y) / 2;
        const vx = (a.vx + b.vx) / 2, vy = (a.vy + b.vy) / 2;
        a.tier = tier; a.r = nr; a.x = nx; a.y = ny; a.vx = vx * 0.6; a.vy = vy * 0.6 - 40;
        a.mergedAt = this.time;
        merged.add(b.id);
        this.stats.merges += 1;
        this.stats.maxTier = Math.max(this.stats.maxTier, tier);
        this.emit({ kind: 'merge', uid: a.uid, name: a.name, avatar: a.avatar, tier, x: nx, y: ny });
        if (tier >= 4) this.emit({ kind: 'record', uid: a.uid, name: a.name, tier });
        break;
      }
    }
    if (merged.size) this.pieces = pieces.filter((p) => !merged.has(p.id));
  }

  #wall(p) {
    const bounce = this.cfg.bounce;
    const dx = p.x - WORLD.cx;
    const dy = p.y - WORLD.cy;
    const dist = hypot(dx, dy);
    const inCircle = dist + p.r <= WORLD.R;
    const limit = halfWidth(p.y);
    const inFunnel = p.y <= WORLD.shoulderY && Math.abs(dx) + p.r <= limit;
    if (inCircle || inFunnel) return;          // 在圆瓶里，或在漏斗里，都算合法

    const penCircle = dist + p.r - WORLD.R;
    const penFunnel = Math.abs(dx) + p.r - limit;
    let nx, ny, pen;
    if (p.y <= WORLD.shoulderY && penFunnel <= penCircle) {
      // 撞在斜肩/瓶颈侧壁：沿坡面法线推回去
      const side = dx >= 0 ? 1 : -1;
      const e = 0.75;
      const slope = (halfWidth(p.y + e) - halfWidth(p.y - e)) / (2 * e);
      nx = side; ny = -slope;
      const len = hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      pen = penFunnel;
    } else {
      // 撞在圆瓶壁上（含瓶底）：沿半径推回去
      nx = dist > 1e-6 ? dx / dist : 0;
      ny = dist > 1e-6 ? dy / dist : 1;
      pen = penCircle;
    }
    p.x -= nx * pen;
    p.y -= ny * pen;
    const vn = p.vx * nx + p.vy * ny;
    if (vn <= 0) return;
    p.vx -= (1 + bounce) * vn * nx;
    p.vy -= (1 + bounce) * vn * ny;
    // 切向摩擦：贴着瓶壁滑动，不会抖成筛子
    const tx = -ny, ty = nx;
    const vt = p.vx * tx + p.vy * ty;
    const keep = 1 - clamp(this.cfg.friction, 0, 0.9);
    p.vx += (vt * keep - vt) * tx;
    p.vy += (vt * keep - vt) * ty;
  }

  #collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = hypot(dx, dy);
    const minD = a.r + b.r;
    if (dist >= minD || dist < 1e-6) return;
    const nx = dx / dist, ny = dy / dist;
    const overlap = minD - dist;
    const ma = a.r * a.r, mb = b.r * b.r, total = ma + mb;
    const push = overlap * 0.82;
    a.x -= nx * push * (mb / total); a.y -= ny * push * (mb / total);
    b.x += nx * push * (ma / total); b.y += ny * push * (ma / total);
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const j = -(1 + this.cfg.bounce) * vn / (1 / ma + 1 / mb);
    a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx; b.vy += (j / mb) * ny;
    // 一点点切向摩擦，堆叠更稳
    const tx = -ny, ty = nx;
    const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    const jt = -vt * 0.06 / (1 / ma + 1 / mb);
    a.vx -= (jt / ma) * tx; a.vy -= (jt / ma) * ty;
    b.vx += (jt / mb) * tx; b.vy += (jt / mb) * ty;
  }

  #flyApart(dt) {
    for (const p of this.pieces) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.985; p.vy *= 0.985;
    }
  }

  #tooBig() {
    const limit = WORLD.R * 0.94;
    return this.pieces.some((p) => p.r >= limit);
  }

  #updatePressure() {
    // 瓶压 = max(瓶内真的快满了, 瓶口堵死了)。
    // 待落区只是"排队"，瓶子还空着的时候排再长也只是没来得及掉，不能算压力——
    // 否则一次刷屏就会在空瓶上"直接炸"，看着像 bug。
    let filled = 0;
    for (const p of this.pieces) filled += area(p.r);
    const capacity = area(WORLD.R) * clamp(this.cfg.burstFill, 0.05, 1.2);
    const fillP = clamp(filled / capacity, 0, 1.2);
    const crowded = this.pieces.length >= this.cfg.maxPieces * 0.5;
    const jamP = crowded ? clamp((this.queue.length - 100) / 180, 0, 1) : 0;
    const next = Math.max(fillP, jamP);
    this.pressure = next;
    for (const mark of [0.5, 0.8, 0.95]) {
      if (next >= mark && !this.milestones.has(mark)) {
        this.milestones.add(mark);
        this.emit({ kind: 'pressure', value: mark });
      }
    }
  }

  #burst(reason) {
    const breaker = this.breaker();
    this.state = 'bursting';
    this.burstT = 0;
    this.cleared = false;
    this.stats.bursts += 1;
    this.pressure = Math.max(this.pressure, 1);
    this.lastBurst = {
      bottleNo: this.bottleNo,
      reason,
      breaker,
      pieces: this.pieces.length,
      pressure: this.pressure,
      at: this.time
    };
    this.emit({ kind: 'burst', ...this.lastBurst });
    // 炸开：所有头像向外飞
    for (const p of this.pieces) {
      const dx = p.x - WORLD.cx, dy = p.y - WORLD.cy;
      const len = hypot(dx, dy) || 1;
      p.vx = (dx / len) * (260 + this.rng() * 420);
      p.vy = (dy / len) * (260 + this.rng() * 420) - 180;
    }
    this.queue = [];
    this.milestones.clear();
  }

  // 谁撑破的：头像总面积最大的那位（同面积看谁的最大单块更大）
  breaker() {
    if (!this.pieces.length) return null;
    const acc = new Map();
    for (const p of this.pieces) {
      const cur = acc.get(p.uid) || { uid: p.uid, name: p.name, avatar: p.avatar, area: 0, maxR: 0 };
      cur.area += area(p.r);
      cur.maxR = Math.max(cur.maxR, p.r);
      cur.avatar = p.avatar || cur.avatar;
      acc.set(p.uid, cur);
    }
    const list = [...acc.values()].sort((a, b) => b.area - a.area || b.maxR - a.maxR);
    const top = list[0];
    return { uid: top.uid, name: top.name, avatar: top.avatar, area: top.area, pieces: this.pieces.filter((p) => p.uid === top.uid).length };
  }

  #newBottle() {
    this.bottleNo += 1;
    this.pieces = [];
    this.queue = [];
    this.state = 'playing';
    this.burstT = 0;
    this.cleared = false;
    this.pressure = 0;
    this.spawnAcc = 0;
    this.emit({ kind: 'bottle', no: this.bottleNo });
  }

  reset({ keepLeader = true } = {}) {
    if (!keepLeader) this.stats.bursts = 0;
    this.#newBottle();
  }

  // 现场调参/验收用：手动炸一瓶（没有头像时不记撑破者）
  forceBurst(reason = 'manual') {
    if (this.state !== 'playing') return false;
    this.#burst(reason);
    return true;
  }

  clearBottle() {
    this.pieces = [];
    this.queue = [];
    this.pressure = 0;
    this.milestones.clear();
    this.emit({ kind: 'clear' });
  }

  emit(ev) {
    this.events.push(ev);
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // 榜：按用户聚合最大头像
  topAvatars(limit = 5) {
    const acc = new Map();
    for (const p of this.pieces) {
      const cur = acc.get(p.uid) || { uid: p.uid, name: p.name, avatar: p.avatar, tier: 0, r: 0, count: 0, area: 0 };
      cur.count += 1;
      cur.area += area(p.r);
      if (p.r > cur.r) { cur.r = p.r; cur.tier = p.tier; cur.avatar = p.avatar || cur.avatar; }
      acc.set(p.uid, cur);
    }
    return [...acc.values()].sort((a, b) => b.r - a.r || b.area - a.area).slice(0, limit);
  }

  snapshot() {
    return {
      state: this.state,
      time: this.time,
      pressure: this.pressure,
      pieces: this.pieces.length,
      queued: this.queue.length,
      bottleNo: this.bottleNo,
      burstT: this.burstT,
      stats: this.stats,
      lastBurst: this.lastBurst
    };
  }
}
