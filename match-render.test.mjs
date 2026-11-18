// 头像撑瓶 · 渲染层单测（假 canvas：只验行为与不崩，不验像素）
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitOf, project, tierOf, MatchRender } from './match-render.mjs';
import { MatchEngine, WORLD, makeRng } from './match-engine.mjs';
import { t } from './match-i18n.mjs';

const METHODS = [
  'clearRect', 'save', 'restore', 'setTransform', 'translate', 'scale', 'rotate',
  'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'ellipse',
  'closePath', 'fill', 'stroke', 'clip', 'drawImage', 'fillText', 'strokeText',
  'rect', 'quadraticCurveTo', 'bezierCurveTo', 'setLineDash'
];

function stubCanvas() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'measureText') return (text) => ({ width: String(text).length * 7 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (METHODS.includes(prop)) return (...args) => { calls.push([prop, args]); };
      return undefined;
    },
    set() { return true; }
  });
  return { canvas: { width: 0, height: 0, style: {}, getContext: () => ctx }, calls };
}

const tr = (key, vars) => t('zh', key, vars);

function makeRender() {
  const { canvas, calls } = stubCanvas();
  const render = new MatchRender(canvas, { t: tr });
  render.resize(1280, 800, 2);
  return { render, canvas, calls };
}

test('布局：等比缩放并居中，世界不越界', () => {
  for (const [w, h] of [[1600, 900], [1280, 800], [1920, 1080], [900, 1200]]) {
    const fit = fitOf(w, h);
    assert.ok(WORLD.w * fit.s <= w + 0.01, `${w}x${h} 宽度越界`);
    assert.ok(WORLD.h * fit.s <= h + 0.01, `${w}x${h} 高度越界`);
    assert.ok(Math.abs(fit.ox * 2 + WORLD.w * fit.s - w) < 1e-6, '没有水平居中');
    assert.ok(Math.abs(fit.oy * 2 + WORLD.h * fit.s - h) < 1e-6, '没有垂直居中');
  }
});

test('project 与 fitOf 一致（世界中心落在画布中心）', () => {
  const p = project(WORLD.w / 2, WORLD.h / 2, 1600, 900);
  assert.ok(Math.abs(p.sx - 800) < 0.01);
  assert.ok(Math.abs(p.sy - 450) < 0.01);
  assert.ok(p.s > 0);
});

test('尺寸档位有独立配色，等级越高越亮', () => {
  assert.notEqual(tierOf(1).ring, tierOf(6).ring);
  assert.notEqual(tierOf(6).ring, tierOf(10).ring);
  assert.ok(tierOf(12).ring);
});

test('resize 按 DPR 放大画布，并在需要时写 style', () => {
  const { canvas } = stubCanvas();
  const render = new MatchRender(canvas, { t: tr });
  render.resize(640, 400, 2, true);
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 800);
  assert.equal(canvas.style.width, '640px');
  render.resize(300, 200, 5, false);   // dpr 上限 2，且不写 style
  assert.equal(canvas.width, 600);
  assert.equal(canvas.height, 400);
  render.resize(300, 200, 1, false);
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 200);
});

test('空场渲染：画出空瓶引导，不抛错', () => {
  const { render, calls } = makeRender();
  const engine = new MatchEngine({ rng: makeRng(1) });
  render.frame(1 / 60, engine, { board: [], feed: [] });
  assert.ok(calls.length > 100);
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1][0]);
  assert.ok(texts.some((x) => String(x).includes('空')), '空场应该有引导文案');
});

test('满场渲染 120 帧：合成、撑破、粒子都不崩', () => {
  const { render, calls } = makeRender();
  const engine = new MatchEngine({ rng: makeRng(7), cfg: { spawnPerSec: 20 } });
  const names = ['小鱼干', '橘子汽水', '早八人', '阿莫', '柠檬不酸', '夜猫子'];
  for (let i = 0; i < 120; i++) engine.feed({ type: i % 4 ? 'like' : 'comment', name: names[i % names.length], count: 6 });
  for (let i = 0; i < 120; i++) {
    engine.step(1 / 60);
    const events = engine.drainEvents();
    render.spawnEffects(events);
    render.frame(1 / 60, engine, { board: [{ name: '小明', count: 3 }], feed: [{ text: '测试播报', color: '#fff' }] });
  }
  assert.ok(calls.length > 5000, `绘制调用太少: ${calls.length}`);
  assert.ok(calls.some((c) => c[0] === 'drawImage') === false);  // 无头像 URL 时不画图
  assert.ok(calls.some((c) => c[0] === 'arc'));
  render.toast('撑破啦', 'burst', 2);
  render.frame(1 / 60, engine, { board: [], feed: [] });
  assert.ok(calls.some((c) => c[0] === 'fillText' && String(c[1][0]).includes('撑破')));
});

test('撑破状态渲染：瓶身淡出 + 大字', () => {
  const { render, calls } = makeRender();
  const engine = new MatchEngine({ rng: makeRng(3), cfg: { spawnPerSec: 30 } });
  for (let i = 0; i < 60; i++) engine.feed({ type: 'follow', name: 'U' + (i % 5) });
  for (let i = 0; i < 60; i++) engine.step(1 / 60);
  engine.forceBurst('test');
  for (let i = 0; i < 20; i++) {
    render.frame(1 / 60, engine, { board: [], feed: [] });
    engine.step(1 / 60);
  }
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1][0]));
  assert.ok(texts.some((x) => x.includes('撑破')), '要有撑破大字');
  assert.ok(texts.some((x) => x.startsWith('U')), '要念出撑破的人');
  assert.equal(engine.state, 'bursting');
});

test('中英切换后标题跟着变', () => {
  const { render, calls } = makeRender();
  render.setLang('en');
  render.t = (key, vars) => t('en', key, vars);
  const engine = new MatchEngine({ rng: makeRng(1) });
  render.frame(1 / 60, engine, { board: [], feed: [] });
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1][0]));
  assert.ok(texts.some((x) => /AvatarMatch|PRESSURE/.test(x)));
});
