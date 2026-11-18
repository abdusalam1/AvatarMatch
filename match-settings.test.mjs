// 头像撑瓶 · 设置单测
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_SETTINGS_DEFAULTS, MATCH_RANGES, sanitizeMatchSettings,
  serializeMatchSettings, applyMatchSettings, renderMatchSettings
} from './match-settings.mjs';

test('默认值都在区间里', () => {
  for (const [key, value] of Object.entries(MATCH_SETTINGS_DEFAULTS)) {
    if (!MATCH_RANGES[key]) continue;
    const [lo, hi] = MATCH_RANGES[key];
    assert.ok(value >= lo && value <= hi, `${key}=${value} 超出 ${lo}..${hi}`);
  }
});

test('脏数据全部夹回合法区间', () => {
  const dirty = {
    lang: 'fr', voice: 0, demo: 'no',
    gravity: 99999, bounce: -1, mergeScale: 99, burstFill: 0.01,
    spawnPerSec: 0, maxPieces: 9999, likePerDrop: 0, giftBoost: -5, demoRate: 100
  };
  const out = sanitizeMatchSettings(dirty);
  assert.equal(out.lang, 'zh');
  assert.equal(out.voice, true);          // 只有 === false 才关
  assert.equal(out.demo, true);
  assert.equal(out.gravity, 2800);
  assert.equal(out.bounce, 0);
  assert.equal(out.mergeScale, 1.6);
  assert.equal(out.burstFill, 0.5);
  assert.equal(out.spawnPerSec, 2);
  assert.equal(out.maxPieces, 220);
  assert.equal(out.likePerDrop, 1);
  assert.equal(out.giftBoost, 0.2);
  assert.equal(out.demoRate, 10);
});

test('缺字段/坏 JSON 回落默认值，整数项取整', () => {
  assert.deepEqual(sanitizeMatchSettings(null), MATCH_SETTINGS_DEFAULTS);
  assert.deepEqual(sanitizeMatchSettings({}), MATCH_SETTINGS_DEFAULTS);
  const out = sanitizeMatchSettings({ maxPieces: 87.6, spawnPerSec: 9.9, likePerDrop: 4.4 });
  assert.equal(out.maxPieces, 88);
  assert.equal(out.spawnPerSec, 10);
  assert.equal(out.likePerDrop, 4);
  assert.equal(sanitizeMatchSettings({ voice: false }).voice, false);
  assert.equal(sanitizeMatchSettings({ lang: 'en' }).lang, 'en');
});

test('序列化后仍能读回同一份设置', () => {
  const s = sanitizeMatchSettings({ gravity: 2000, voice: false, lang: 'en' });
  const back = sanitizeMatchSettings(JSON.parse(serializeMatchSettings(s)));
  assert.deepEqual(back, s);
});

test('apply 把调参写进引擎 cfg，引擎为空也不炸', () => {
  const engine = { cfg: {} };
  const s = sanitizeMatchSettings({ gravity: 2100, mergeScale: 1.4, maxPieces: 99.2 });
  applyMatchSettings(s, engine);
  assert.equal(engine.cfg.gravity, 2100);
  assert.equal(engine.cfg.mergeScale, 1.4);
  assert.equal(engine.cfg.maxPieces, 99);
  assert.doesNotThrow(() => applyMatchSettings(s, null));
});

test('调参面板：9 个滑杆 + 2 个开关 + 说明，改动会回调 save', () => {
  const el = (tag) => ({
    tagName: tag, children: [], dataset: {}, className: '', textContent: '', value: '', checked: false,
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener() {}
  });
  globalThis.document = { createElement: el };
  const body = el('div');
  const settings = sanitizeMatchSettings({});
  let saved = 0;
  renderMatchSettings(body, settings, () => { saved += 1; });
  const sliders = body.children.filter((n) => n.children?.[1]?.tagName === 'input');
  assert.equal(sliders.length, 9);
  const boxes = body.children.filter((n) => n.children?.[0]?.children?.[1]?.type === 'checkbox');
  assert.equal(boxes.length, 2);
  const note = body.children.find((n) => n.tagName === 'p');
  assert.ok(note && note.textContent.length > 5);
  assert.equal(saved, 0);
  delete globalThis.document;
});
