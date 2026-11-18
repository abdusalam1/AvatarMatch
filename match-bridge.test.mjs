// 头像撑瓶 · 事件源单测（演示模拟器 + 数据桥协议不回归）
import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoFeed, DEMO_NAMES, connectBridge } from './match-bridge.mjs';

const TYPES = new Set(['comment', 'like', 'gift', 'join', 'follow']);

test('演示观众名字不重复、够多', () => {
  assert.ok(DEMO_NAMES.length >= 18);
  assert.equal(new Set(DEMO_NAMES).size, DEMO_NAMES.length);
});

test('演示事件结构合法，最终都喂给引擎', () => {
  const seen = [];
  const engine = { feed: (ev) => seen.push(ev) };
  const demo = new DemoFeed(engine, { rate: 5 });
  for (let i = 0; i < 60 * 12; i++) demo.tick(1 / 60);
  assert.ok(seen.length >= 50, `12 秒应该有足够事件: ${seen.length}`);
  for (const ev of seen) {
    assert.ok(TYPES.has(ev.type), '未知事件类型 ' + ev.type);
    assert.ok(String(ev.name || '').length > 0);
    if (ev.type === 'like') assert.ok(ev.count >= 1);
    if (ev.type === 'gift') assert.ok(ev.raw && ev.gift);
  }
  // 榜一大哥会送大礼，保证能合出大物
  assert.ok(seen.some((ev) => ev.type === 'gift' && ev.name === '榜一大哥' && ev.raw === '火箭'));
});

test('演示可以静音（接真实直播时不许假装观众）', () => {
  const seen = [];
  const demo = new DemoFeed({ feed: (ev) => seen.push(ev) }, { rate: 5 });
  demo.quiet = true;
  for (let i = 0; i < 600; i++) demo.tick(1 / 60);
  assert.equal(seen.length, 0);
});

test('onEvent 回调异常不会打断模拟', () => {
  const seen = [];
  const demo = new DemoFeed({ feed: (ev) => seen.push(ev) }, { rate: 5, onEvent: () => { throw new Error('ui boom'); } });
  for (let i = 0; i < 300; i++) demo.tick(1 / 60);
  assert.ok(seen.length > 0);
});

test('connectBridge 的返回值形状稳定（不发真实连接也能停）', () => {
  // 只验证接口：这里有真实 WebSocket 才连，Node 里会走 catch 分支
  const link = connectBridge({ onEvent: () => {}, onStatus: () => {} });
  assert.equal(typeof link.stop, 'function');
  assert.equal(typeof link.reconnect, 'function');
  assert.equal(typeof link.setRoom, 'function');
  link.setRoom('123456');
  link.stop();
});
