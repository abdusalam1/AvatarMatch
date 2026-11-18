// 头像撑瓶 · 文案单测（中英 key 必须一一对应）
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from './match-i18n.mjs';

test('中文和英文的 key 集合完全一致', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.zh).sort());
});

test('常用文案两边都不为空', () => {
  for (const lang of ['zh', 'en']) {
    for (const key of ['app.title', 'hud.pressure', 'hud.burstBoard', 'toast.burst', 'help.merge', 'panel.live']) {
      assert.ok(String(STRINGS[lang][key] || '').trim().length > 0, `${lang} ${key} 是空的`);
    }
  }
});

test('t() 替换变量；变量缺失时保留占位符而不是 undefined', () => {
  assert.equal(t('zh', 'toast.burst', { name: '小明', n: 3 }), '小明 撑破了第 3 个瓶子！');
  assert.match(t('en', 'toast.join', { name: 'Ann' }), /Ann/);
  assert.equal(t('zh', 'toast.join', {}), '欢迎 {name} 进入直播间');
});

test('未知 key 原样返回，未知语言回落中文', () => {
  assert.equal(t('zh', 'no.such.key'), 'no.such.key');
  assert.equal(t('fr', 'app.title'), STRINGS.zh['app.title']);
});

test('12 个尺寸档位都有名字', () => {
  for (let i = 1; i <= 12; i++) {
    assert.ok(STRINGS.zh['tier.' + i]);
    assert.ok(STRINGS.en['tier.' + i]);
  }
});
