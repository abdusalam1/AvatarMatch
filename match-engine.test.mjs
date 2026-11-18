// 头像撑瓶 · 规则单测（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchEngine, MATCH_DEFAULTS, WORLD, containerSdf, tierRadius, giftPlan, makeRng
} from './match-engine.mjs';

const quiet = { spawnPerSec: 0, gravity: 0 };
const make = (cfg = {}, seed = 7) => new MatchEngine({ cfg: { ...quiet, ...cfg }, rng: makeRng(seed) });

test('礼物分档：小心心 3 个 + 2 级，玫瑰 6 个 + 2 级，火箭 12 个 + 3 级', () => {
  assert.deepEqual(giftPlan('小心心', 'heart'), { drops: 3, bonusTier: 2 });
  assert.deepEqual(giftPlan('玫瑰', 'other'), { drops: 6, bonusTier: 2 });
  assert.deepEqual(giftPlan('火箭', 'other'), { drops: 12, bonusTier: 3 });
  // 认不出名字就按上游给的 kind 兜底
  assert.equal(giftPlan('未知礼物', 'beer').drops, 6);
  assert.equal(giftPlan('', '').drops, 6);
});

test('容器 SDF：圆心/瓶口在内部，瓶外和肩角在外部', () => {
  assert.ok(containerSdf(WORLD.cx, WORLD.cy) < -200);
  assert.ok(containerSdf(WORLD.cx, WORLD.circleTop + 40) < 0);
  assert.ok(containerSdf(WORLD.cx, WORLD.spawnY) < 0);          // 瓶颈里
  assert.ok(containerSdf(WORLD.cx - 160, WORLD.circleTop + 10) > 0); // 肩角外
  assert.ok(containerSdf(WORLD.cx, WORLD.h + 20) > 0);          // 瓶底外
  assert.ok(containerSdf(WORLD.cx - WORLD.R - 30, WORLD.cy) > 0);
});

test('尺寸：每升一级都更大，且面积增长慢于 2 倍（合成要能泄压）', () => {
  let prev = 0;
  for (let tier = 1; tier <= 8; tier++) {
    const r = tierRadius(tier, MATCH_DEFAULTS);
    assert.ok(r > prev, `tier ${tier} 应该更大`);
    if (tier > 1) assert.ok(Math.PI * r * r < 2 * Math.PI * prev * prev);
    prev = r;
  }
});

test('点赞每 5 个掉 1 个，余数留到下次', () => {
  const e = make();
  e.feed({ type: 'like', name: '小鱼干', count: 3 });
  assert.equal(e.queue.length, 0);
  e.feed({ type: 'like', name: '小鱼干', count: 2 });
  assert.equal(e.queue.length, 1);
  assert.equal(e.queue[0].uid, '小鱼干');
  e.feed({ type: 'like', name: '小鱼干', count: 12 });
  assert.equal(e.queue.length, 3); // 12 → 2 个，剩下 2 点
});

test('评论掉 2 个、关注/分享掉 3 个、进场掉 1 个', () => {
  const e = make();
  e.feed({ type: 'comment', name: 'A', text: '666' });
  assert.equal(e.queue.length, 2);
  e.feed({ type: 'follow', name: 'B' });
  assert.equal(e.queue.length, 5);
  e.feed({ type: 'share', name: 'C' });
  assert.equal(e.queue.length, 8);
  e.feed({ type: 'join', name: 'D' });
  assert.equal(e.queue.length, 9);
  e.feed({ type: 'join', name: 'D' });
  assert.equal(e.queue.length, 10);   // 进场每次都掉，但欢迎播报只播一次
  assert.equal(e.drainEvents().filter((x) => x.kind === 'join').length, 1);
});

test('礼物：掉落数 + 直接送一个高级头像', () => {
  const e = make();
  e.feed({ type: 'gift', name: '榜一', raw: '火箭', gift: 'other', count: 1 });
  // 12 个 1 级 + 1 个 3 级
  assert.equal(e.queue.length, 13);
  assert.equal(e.queue.filter((q) => q.tier === 3).length, 1);
});

test('连击：3 秒内连续互动额外掉落，最多 +5', () => {
  const e = make({ comboWindow: 3 });
  const drops = [];
  for (let i = 0; i < 9; i++) {
    e.time = i * 0.1;
    e.feed({ type: 'comment', name: '连击王' });
    drops.push(2 + Math.min(5, i));
  }
  assert.equal(e.queue.length, drops.reduce((a, b) => a + b, 0));
  // 断档后连击归零
  e.time = 100;
  e.feed({ type: 'comment', name: '连击王' });
  assert.equal(e.queue.length, drops.reduce((a, b) => a + b, 0) + 2);
});

test('合成：同一个人 + 同一等级 → 升一级；不同人 / 不同级不合成', () => {
  const e = make({ gravity: 0, bounce: 0 });
  const put = (uid, tier, x) => {
    const r = tierRadius(tier, e.cfg);
    e.pieces.push({ id: e.nextId++, uid, name: uid, avatar: '', tier, r, x, y: 800, vx: 0, vy: 0, born: 0, mergedAt: -9 });
  };
  put('A', 1, 550); put('A', 1, 585);
  e.step(0.016);
  const aPieces = e.pieces.filter((p) => p.uid === 'A');
  assert.equal(aPieces.length, 1);
  assert.equal(aPieces[0].tier, 2);
  assert.ok(Math.abs(aPieces[0].r - tierRadius(2, e.cfg)) < 1e-9);

  const e2 = make({ gravity: 0, bounce: 0 });
  const put2 = (uid, tier, x) => {
    const r = tierRadius(tier, e2.cfg);
    e2.pieces.push({ id: e2.nextId++, uid, name: uid, avatar: '', tier, r, x, y: 800, vx: 0, vy: 0, born: 0, mergedAt: -9 });
  };
  put2('A', 1, 550); put2('B', 1, 580);
  e2.step(0.016);
  assert.equal(e2.pieces.length, 2, '不同用户不能合成');

  const e3 = make({ gravity: 0, bounce: 0 });
  const put3 = (uid, tier, x) => {
    const r = tierRadius(tier, e3.cfg);
    e3.pieces.push({ id: e3.nextId++, uid, name: uid, avatar: '', tier, r, x, y: 800, vx: 0, vy: 0, born: 0, mergedAt: -9 });
  };
  put3('A', 1, 550); put3('A', 2, 600);
  e3.step(0.016);
  assert.equal(e3.pieces.length, 2, '不同等级不能合成');
});

test('物理稳定：掉一会儿之后所有头像都在瓶里，速度不出 NaN', () => {
  const e = new MatchEngine({ cfg: { ...MATCH_DEFAULTS, spawnPerSec: 14, maxPieces: 60 }, rng: makeRng(11) });
  const names = ['小鱼干', '橘子汽水', '早八人', '阿莫', '柠檬不酸', '夜猫子'];
  for (let i = 0; i < 90; i++) {
    e.time = i * 0.1;
    e.feed({ type: 'like', name: names[i % names.length], count: 5 });
  }
  for (let i = 0; i < 600; i++) e.step(1 / 60);
  assert.ok(e.pieces.length > 20, `应该掉进来一些: ${e.pieces.length}`);
  for (const p of e.pieces) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), '坐标必须有限');
    assert.ok(Number.isFinite(p.vx) && Number.isFinite(p.vy), '速度必须有限');
    assert.ok(p.y < WORLD.h + 220, `头像飞出去了: y=${p.y}`);
    assert.ok(containerSdf(p.x, p.y) <= -p.r + 4, `头像穿出瓶壁: ${p.x},${p.y} r=${p.r} sdf=${containerSdf(p.x, p.y)}`);
  }
});

test('瓶满会撑破：炸开、记录撑破者、换新瓶', () => {
  const e = make({ burstFill: 0.05, spawnPerSec: 0, gravity: 0, bounce: 0 });
  const put = (uid, x, y) => {
    const r = tierRadius(1, e.cfg);
    e.pieces.push({ id: e.nextId++, uid, name: uid, avatar: '', tier: 1, r, x, y, vx: 0, vy: 0, born: 0, mergedAt: -9 });
  };
  // 20 个头像把瓶子塞满；相邻的都不是同一个人，不会先合掉
  for (let i = 0; i < 10; i++) put(i % 2 ? '小红' : '小明', 400 + i * 40, 720);
  for (let i = 0; i < 10; i++) put(i % 2 ? '小明' : '小红', 420 + i * 40, 800);
  e.step(1 / 60);
  assert.equal(e.state, 'bursting');
  assert.ok(e.lastBurst);
  assert.ok(['小明', '小红'].includes(e.lastBurst.breaker.name));
  const burst = e.drainEvents().find((x) => x.kind === 'burst');
  assert.ok(burst, '要发撑破事件给画面播报');
  assert.equal(e.stats.bursts, 1);
  const before = e.bottleNo;
  for (let i = 0; i < 100; i++) e.step(1 / 60);
  assert.equal(e.state, 'playing');
  assert.equal(e.bottleNo, before + 1);
  assert.equal(e.pieces.length, 0);
});

test('撑破者 = 头像总面积最大的观众', () => {
  const e = make({ burstFill: 0.5 });
  const put = (uid, tier) => {
    const r = tierRadius(tier, e.cfg);
    e.pieces.push({ id: e.nextId++, uid, name: uid, avatar: '', tier, r, x: 600, y: 600, vx: 0, vy: 0, born: 0, mergedAt: -9 });
  };
  put('小头像', 1); put('小头像', 1); put('小头像', 1);
  put('大头像', 4);
  assert.equal(e.breaker().name, '大头像');
});

test('瓶压认「瓶口排队」：瓶子快满了才把排队算成压力', () => {
  const e = make({ spawnPerSec: 0, maxPieces: 10 });
  e.feed({ type: 'follow', name: 'A' });
  for (let i = 0; i < 120; i++) e.enqueue('B', 1, 1);
  e.step(1 / 60);
  assert.ok(e.pressure < 0.05, '瓶子还空着，排长队不等于快炸');
  for (let i = 0; i < 6; i++) {
    const r = tierRadius(1, e.cfg);
    e.pieces.push({ id: e.nextId++, uid: 'U' + i, name: 'U' + i, avatar: '', tier: 1, r, x: 500 + i * 30, y: 700, vx: 0, vy: 0, born: 0, mergedAt: -9 });
  }
  e.queue = [];
  for (let i = 0; i < 120; i++) e.enqueue('B', 1, 1);
  e.step(1 / 60);
  assert.ok(e.pressure > 0.05, `瓶口堵死要顶起瓶压: ${e.pressure}`);
  e.queue = [];
  e.step(1 / 60);
  assert.ok(e.pressure < 0.4);
});

test('清瓶 / 换瓶：头像清空、瓶号递增', () => {
  const e = make({ spawnPerSec: 200 });
  e.feed({ type: 'follow', name: 'A' });
  for (let i = 0; i < 12; i++) e.step(1 / 60);
  assert.ok(e.pieces.length > 0);
  const no = e.bottleNo;
  e.reset();
  assert.equal(e.pieces.length, 0);
  assert.equal(e.bottleNo, no + 1);
  e.feed({ type: 'follow', name: 'A' });
  for (let i = 0; i < 12; i++) e.step(1 / 60);
  assert.ok(e.pieces.length > 0);
  e.clearBottle();
  assert.equal(e.pieces.length, 0);
  assert.equal(e.bottleNo, no + 1, '清屏不算换瓶');
});

test('同时在瓶上限：到顶后不再放行，转成瓶压', () => {
  const e = make({ maxPieces: 5, spawnPerSec: 200 });
  for (let i = 0; i < 4; i++) e.feed({ type: 'follow', name: 'U' + i });
  for (let i = 0; i < 240; i++) e.step(1 / 60);
  assert.equal(e.pieces.length, 5);
  assert.ok(e.queue.length > 0);
  assert.ok(e.pressure > 0);
});

test('同样输入 + 同样随机种子 = 同样结果（截图/回归可复现）', () => {
  const run = () => {
    const e = new MatchEngine({ rng: makeRng(42) });
    const names = ['A', 'B', 'C'];
    for (let i = 0; i < 40; i++) {
      e.time = i * 0.25;
      e.feed({ type: i % 3 ? 'like' : 'comment', name: names[i % 3], count: 3 });
      e.step(0.05);
    }
    return e.pieces.map((p) => [p.uid, p.tier, Math.round(p.x), Math.round(p.y)]);
  };
  assert.deepEqual(run(), run());
});

test('未知事件 / 空名字不影响引擎', () => {
  const e = make();
  assert.equal(e.feed({ type: 'unknown', name: 'x' }), 0);
  assert.equal(e.feed({ type: 'like', name: '' }), 0);
  assert.equal(e.feed({ type: 'like' }), 0);
  assert.equal(e.queue.length, 0);
});
