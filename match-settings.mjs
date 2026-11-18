// 头像撑瓶 · 设置（默认值 + 越界校验 + 调参面板）
// 和 AvatarArena 的 arena-settings 同一套思路：纯函数负责"能不能用"，
// DOM 只负责长什么样，页面负责存 localStorage —— 参数被写坏可以在 Node 里单测。

import { t } from './match-i18n.mjs';

export const MATCH_SETTINGS_DEFAULTS = {
  v: 1,
  lang: 'zh',
  voice: true,
  demo: true,
  gravity: 1700,
  bounce: 0.2,
  mergeScale: 1.26,
  burstFill: 0.82,
  spawnPerSec: 12,
  maxPieces: 150,
  likePerDrop: 5,
  giftBoost: 1,
  demoRate: 4.5
};

export const MATCH_RANGES = {
  gravity: [600, 2800],
  bounce: [0, 0.5],
  mergeScale: [1.1, 1.6],
  burstFill: [0.5, 0.95],
  spawnPerSec: [2, 20],
  maxPieces: [30, 220],
  likePerDrop: [1, 30],
  giftBoost: [0.2, 3],
  demoRate: [1, 10]
};

const STEPS = {
  gravity: 50,
  bounce: 0.02,
  mergeScale: 0.01,
  burstFill: 0.01,
  spawnPerSec: 1,
  maxPieces: 5,
  likePerDrop: 1,
  giftBoost: 0.1,
  demoRate: 0.5
};

const clampNumber = (value, [lo, hi], fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// 任何来源（localStorage、手改、旧版本）的数据都被夹到合法区间
export function sanitizeMatchSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...MATCH_SETTINGS_DEFAULTS };
  out.lang = src.lang === 'en' ? 'en' : 'zh';
  out.voice = src.voice !== false;
  out.demo = src.demo !== false;
  for (const [key, range] of Object.entries(MATCH_RANGES)) {
    out[key] = clampNumber(src[key], range, MATCH_SETTINGS_DEFAULTS[key]);
  }
  out.maxPieces = Math.round(out.maxPieces);
  out.spawnPerSec = Math.round(out.spawnPerSec);
  out.likePerDrop = Math.round(out.likePerDrop);
  return out;
}

export function serializeMatchSettings(settings) {
  return JSON.stringify(sanitizeMatchSettings(settings));
}

// 设置 → 引擎（页面启动时调一次，之后滑块改动再调）
export function applyMatchSettings(settings, engine) {
  if (engine?.cfg) {
    engine.cfg.gravity = settings.gravity;
    engine.cfg.bounce = settings.bounce;
    engine.cfg.mergeScale = settings.mergeScale;
    engine.cfg.burstFill = settings.burstFill;
    engine.cfg.spawnPerSec = settings.spawnPerSec;
    engine.cfg.maxPieces = Math.round(settings.maxPieces);
    engine.cfg.likePerDrop = Math.round(settings.likePerDrop);
    engine.cfg.giftBoost = settings.giftBoost;
  }
  return settings;
}

// 面板：滑杆 + 开关，改动即时保存（和 AvatarArena 一致的交互习惯）
export function renderMatchSettings(body, settings, save) {
  if (!body) return;
  const lang = settings.lang || 'zh';
  body.replaceChildren();

  const slider = (field) => {
    const wrap = document.createElement('label');
    wrap.className = 'match-setting-row';
    const head = document.createElement('div');
    head.className = 'match-setting-head';
    const label = document.createElement('span');
    label.textContent = t(lang, 'settings.' + field);
    const value = document.createElement('b');
    value.textContent = formatValue(field, settings[field]);
    const [min, max] = MATCH_RANGES[field];
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(STEPS[field]);
    input.value = String(settings[field]);
    input.dataset.setting = field;
    input.addEventListener('input', () => { value.textContent = formatValue(field, input.value); });
    input.addEventListener('change', () => {
      settings[field] = Number(input.value);
      value.textContent = formatValue(field, settings[field]);
      save();
    });
    head.append(label, value);
    wrap.append(head, input);
    body.append(wrap);
  };

  for (const field of ['gravity', 'bounce', 'mergeScale', 'burstFill', 'spawnPerSec', 'maxPieces', 'likePerDrop', 'giftBoost', 'demoRate']) {
    slider(field);
  }

  const toggle = (field) => {
    const wrap = document.createElement('label');
    wrap.className = 'match-setting-row';
    const head = document.createElement('div');
    head.className = 'match-setting-head';
    const label = document.createElement('span');
    label.textContent = t(lang, 'settings.' + field);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!settings[field];
    input.dataset.toggle = field;
    input.addEventListener('change', () => {
      settings[field] = input.checked;
      save();
    });
    head.append(label, input);
    wrap.append(head);
    body.append(wrap);
  };
  toggle('voice');
  toggle('demo');

  const note = document.createElement('p');
  note.className = 'match-setting-note';
  note.textContent = t(lang, 'settings.note');
  body.append(note);
}

function formatValue(field, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (['mergeScale', 'bounce', 'giftBoost'].includes(field)) return n.toFixed(2);
  if (field === 'burstFill') return Math.round(n * 100) + '%';
  return String(Math.round(n));
}
