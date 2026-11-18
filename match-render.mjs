// 头像撑瓶 · 渲染层（Canvas 2D，零依赖）
// 画面 = 深空背景 + 霓虹玻璃瓶（圆瓶 + 细瓶颈）+ 头像泡泡 + 合成/撑破特效 + 直播 HUD。
// 所有文字走注入的 t()，渲染层不 import i18n；几何用世界坐标，project() 缩放到画布。

import { WORLD } from './match-engine.mjs';

const FONT = '"Microsoft YaHei","PingFang SC",system-ui,sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function fitOf(width, height) {
  // 横屏为主：按高度铺满，左右留出的空位给 HUD；窗口很窄时改为按宽度铺满
  const s = Math.min(width / (WORLD.w * 1.02), height / (WORLD.h * 1.02));
  return { s, ox: (width - WORLD.w * s) / 2, oy: (height - WORLD.h * s) / 2 };
}

export function project(x, y, width, height) {
  const fit = fitOf(width, height);
  return { sx: fit.ox + x * fit.s, sy: fit.oy + y * fit.s, s: fit.s };
}

// 等级配色：越大越暖、越亮
const TIER_COLORS = [
  null,
  ['#8fe9ff', '#3aa8c9'],
  ['#7ee7c7', '#2f9e86'],
  ['#ffd166', '#c98a22'],
  ['#ffb457', '#c96a1e'],
  ['#ff8fab', '#c9456d'],
  ['#ff6b9d', '#a52a5c'],
  ['#c9a7ff', '#6f45c9'],
  ['#9bb8ff', '#3f5cc9'],
  ['#ffe6a8', '#c9a022'],
  ['#ff4d6d', '#8f1230'],
  ['#ff2d55', '#7a0020'],
  ['#ffffff', '#c9a7ff']
];

export function tierOf(tier) {
  const colors = TIER_COLORS[clamp(tier, 1, TIER_COLORS.length - 1)] || TIER_COLORS[1];
  return { ring: colors[0], deep: colors[1] };
}

export function hashHue(text) {
  let h = 0;
  for (let i = 0; i < String(text).length; i++) h = (h * 31 + String(text).charCodeAt(i)) % 360;
  return h;
}

function font(size, weight = '600') {
  return `${weight} ${Math.max(9, Math.round(size))}px ${FONT}`;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class MatchRender {
  constructor(canvas, { t = (k) => k, lang = 'zh' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d') || null;
    this.t = t;
    this.lang = lang === 'en' ? 'en' : 'zh';
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.particles = [];
    this.toasts = [];
    this.images = new Map();
    this.faces = new Map();
    this.time = 0;
    this.shake = 0;
    this.flash = 0;
    this.crackSeed = 0;
    this.crackBottle = -1;
    this.lastPressure = 0;
    this.stars = Array.from({ length: 90 }, (_, i) => ({
      x: ((i * 733) % 1000) / 1000,
      y: ((i * 1439) % 1000) / 1000,
      r: 0.5 + ((i * 97) % 100) / 100,
      a: 0.18 + ((i * 53) % 100) / 260,
      v: 0.4 + ((i * 29) % 100) / 60
    }));
  }

  setLang(lang) { this.lang = lang === 'en' ? 'en' : 'zh'; }

  resize(w, h, dpr = 1, commitStyle = true) {
    const width = Math.max(200, Math.round(w));
    const height = Math.max(200, Math.round(h));
    const ratio = clamp(dpr || 1, 1, 2);
    if (this.canvas) {
      if (this.canvas.width !== Math.round(width * ratio)) this.canvas.width = Math.round(width * ratio);
      if (this.canvas.height !== Math.round(height * ratio)) this.canvas.height = Math.round(height * ratio);
      if (commitStyle && this.canvas.style) {
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
      }
    }
    this.w = width;
    this.h = height;
    this.dpr = ratio;
  }

  avatar(name, url) {
    if (!url || typeof Image === 'undefined') return null;
    let entry = this.images.get(url);
    if (!entry) {
      entry = { img: new Image(), ready: false, failed: false };
      entry.img.onload = () => { entry.ready = true; };
      entry.img.onerror = () => { entry.failed = true; };
      entry.img.src = url;
      this.images.set(url, entry);
    }
    return entry.ready ? entry.img : null;
  }

  toast(text, kind = 'info', seconds = 4) {
    const msg = String(text || '').trim();
    if (!msg) return;
    this.toasts.push({ text: msg.slice(0, 80), kind, t: 0, life: seconds });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  // 引擎事件 → 粒子/震屏/闪白。每帧调一次（页面把 drainEvents() 传进来）。
  spawnEffects(events = []) {
    for (const ev of events) {
      if (!ev) continue;
      if (ev.kind === 'merge') {
        this.#ring(ev.x, ev.y, 12, ev.tier >= 4 ? 140 : 80, ev.tier >= 4 ? 0.7 : 0.45);
        this.#sparks(ev.x, ev.y, ev.tier >= 4 ? 16 : 8, '#ffe6a8');
        if (ev.tier >= 4) this.toast(this.t('toast.merge', { name: ev.name, tier: this.#tierName(ev.tier) }), 'merge', 3.5);
      } else if (ev.kind === 'burst') {
        this.flash = 0.9;
        this.shake = 16;
        for (let i = 0; i < 44; i++) {
          const a = Math.random() * TAU;
          const sp = 160 + Math.random() * 420;
          this.particles.push({
            kind: 'shard', x: ev.breaker ? WORLD.cx : WORLD.cx, y: WORLD.cy,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140,
            t: 0, life: 0.9 + Math.random() * 0.6, rot: Math.random() * TAU,
            vr: (Math.random() - 0.5) * 12, size: 6 + Math.random() * 14,
            color: ['#ff4d6d', '#ffd166', '#7ee7c7', '#9bb8ff'][i % 4]
          });
        }
        this.crackSeed = Math.floor(Math.random() * 1e6);
        this.crackBottle = -1;
      } else if (ev.kind === 'drop') {
        this.#sparks(WORLD.cx, WORLD.spawnY, 2, '#8fe9ff');
      }
    }
  }

  #ring(x, y, r0, r1, life) {
    this.particles.push({ kind: 'ring', x, y, r0, r1, t: 0, life, color: '#ffe6a8' });
  }

  #sparks(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = 60 + Math.random() * 220;
      this.particles.push({
        kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        t: 0, life: 0.4 + Math.random() * 0.5, color, size: 2 + Math.random() * 3
      });
    }
  }

  #tierName(tier) { return this.t('tier.' + clamp(Math.round(tier) || 1, 1, 12)); }

  frame(dt, engine, extra = {}) {
    if (!this.ctx) return;
    const d = clamp(Number(dt) || 0, 0, 0.06);
    this.time += d;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const shake = this.shake;
    ctx.save();
    if (shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      this.shake *= Math.pow(0.001, d);
    }

    this.#drawBackground();
    const fit = fitOf(this.w, this.h);
    this.#drawBottleBack(fit, engine);
    this.#drawParticles('under', fit);
    this.#drawPieces(fit, engine);
    this.#drawBottleFront(fit, engine);
    this.#drawParticles('over', fit);
    for (const toast of this.toasts) toast.t += d;
    this.toasts = this.toasts.filter((x) => x.t < x.life);
    this.#drawHud(fit, engine, extra);
    ctx.restore();

    // 闪白 + 屏幕暗角
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255,245,230,${this.flash * 0.55})`;
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash *= Math.pow(0.02, d);
    }
    this.#updateParticles(d);
  }

  // ---------- 背景 ----------

  #drawBackground() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#06080f');
    g.addColorStop(0.55, '#0a1020');
    g.addColorStop(1, '#05060b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    const glow = ctx.createRadialGradient(this.w * 0.5, this.h * 0.52, 10, this.w * 0.5, this.h * 0.52, this.h * 0.62);
    glow.addColorStop(0, 'rgba(64,120,255,0.16)');
    glow.addColorStop(0.5, 'rgba(140,40,180,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    for (const star of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(this.time * star.v + star.x * 20);
      ctx.globalAlpha = star.a * tw;
      ctx.fillStyle = '#cfe4ff';
      ctx.fillRect(star.x * this.w, star.y * this.h, star.r, star.r);
    }
    ctx.restore();
  }

  // ---------- 瓶子 ----------

  #bottlePath(fit) {
    const ctx = this.ctx;
    const cx = fit.ox + WORLD.cx * fit.s;
    const cy = fit.oy + WORLD.cy * fit.s;
    const R = WORLD.R * fit.s;
    const nh = WORLD.neckHalf * fit.s;
    const sh = WORLD.shoulderHalf * fit.s;
    const yNeck = fit.oy + 240 * fit.s;
    const yShoulder = fit.oy + WORLD.shoulderY * fit.s;
    const top = -10;
    const a1 = Math.atan2(yShoulder - cy, sh);
    const a2 = Math.atan2(yShoulder - cy, -sh) + TAU;
    ctx.beginPath();
    ctx.moveTo(cx + nh, top);
    ctx.lineTo(cx + nh, yNeck);
    ctx.lineTo(cx + sh, yShoulder);
    ctx.arc(cx, cy, R, a1, a2, false);
    ctx.lineTo(cx - nh, yNeck);
    ctx.lineTo(cx - nh, top);
    ctx.closePath();
    return { cx, cy, R, nh, sh, yNeck, yShoulder };
  }

  #drawBottleBack(fit, engine) {
    const ctx = this.ctx;
    const geo = this.#bottlePath(fit);
    const fade = engine?.state === 'bursting' ? clamp(1 - (engine.burstT || 0) / 0.5, 0, 1) : 1;
    if (fade <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = fade;
    const pressure = clamp(Number(engine?.pressure) || 0, 0, 1.2);

    // 瓶内玻璃：越接近撑破越泛红
    const inner = ctx.createLinearGradient(0, geo.cy - geo.R, 0, geo.cy + geo.R);
    inner.addColorStop(0, 'rgba(120,200,255,0.05)');
    inner.addColorStop(0.6, `rgba(${Math.round(90 + 140 * pressure)},${Math.round(160 - 90 * pressure)},255,0.06)`);
    inner.addColorStop(1, 'rgba(255,110,150,0.05)');
    ctx.fillStyle = inner;
    ctx.fill();

    // 瓶底"液体"辉光
    const base = ctx.createRadialGradient(geo.cx, geo.cy + geo.R * 0.55, 4, geo.cx, geo.cy + geo.R * 0.55, geo.R * 0.9);
    base.addColorStop(0, `rgba(126,231,199,${0.10 + pressure * 0.12})`);
    base.addColorStop(1, 'rgba(126,231,199,0)');
    ctx.fillStyle = base;
    ctx.fill();

    // 内圈刻度（每 20% 一格）
    ctx.save();
    ctx.strokeStyle = 'rgba(160,200,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = geo.yShoulder + ((geo.cy + geo.R - geo.yShoulder) * i) / 5;
      const w = Math.sqrt(Math.max(0, geo.R * geo.R - (y - geo.cy) * (y - geo.cy)));
      ctx.beginPath();
      ctx.moveTo(geo.cx - w * 0.82, y);
      ctx.lineTo(geo.cx - w * 0.7, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  #drawBottleFront(fit, engine) {
    const ctx = this.ctx;
    const geo = this.#bottlePath(fit);
    const burstT = Number(engine?.burstT) || 0;
    const fade = engine?.state === 'bursting' ? clamp(1 - burstT / 0.45, 0, 1) : 1;
    const pressure = clamp(Number(engine?.pressure) || 0, 0, 1.2);
    if (fade > 0.01) {
    ctx.save();
    ctx.globalAlpha = fade;

    // 霓虹瓶沿：品红 → 青 → 柠檬绿
    const rim = ctx.createLinearGradient(geo.cx - geo.R, geo.cy - geo.R, geo.cx + geo.R, geo.cy + geo.R);
    rim.addColorStop(0, '#ff3ea5');
    rim.addColorStop(0.35, '#8b5cf6');
    rim.addColorStop(0.62, '#22d3ee');
    rim.addColorStop(1, '#a3e635');
    ctx.save();
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(2, 3 * fit.s);
    ctx.shadowColor = pressure > 0.7 ? 'rgba(255,80,110,0.95)' : 'rgba(120,120,255,0.8)';
    ctx.shadowBlur = (14 + pressure * 30) * fit.s;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // 瓶颈内的两道高光
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1, 1.4 * fit.s);
    ctx.beginPath();
    ctx.moveTo(geo.cx - geo.nh * 0.55, 0);
    ctx.lineTo(geo.cx - geo.nh * 0.55, geo.yNeck);
    ctx.lineTo(geo.cx - geo.sh * 0.72, geo.yShoulder - 6);
    ctx.moveTo(geo.cx + geo.nh * 0.5, 0);
    ctx.lineTo(geo.cx + geo.nh * 0.5, geo.yNeck * 0.9);
    ctx.stroke();
    ctx.restore();

    // 玻璃反光：左上一条弧
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = Math.max(2, 4 * fit.s);
    ctx.beginPath();
    ctx.arc(geo.cx, geo.cy, geo.R * 0.86, Math.PI * 1.08, Math.PI * 1.38);
    ctx.stroke();
    ctx.restore();

    // 瓶内压力光：底部一圈脉冲
    if (pressure > 0.55) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      ctx.save();
      ctx.strokeStyle = `rgba(255,70,100,${(pressure - 0.55) * 0.55 * (0.6 + 0.4 * pulse)})`;
      ctx.lineWidth = Math.max(2, 5 * fit.s);
      ctx.beginPath();
      ctx.arc(geo.cx, geo.cy, geo.R * 0.985, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.restore();
    }

    // 裂缝：瓶压越高越明显
    if (pressure > 0.62) {
      if (this.crackBottle !== (engine?.bottleNo || 0) || this.crackSeed === 0) {
        this.crackSeed = Math.floor(Math.random() * 1e6);
        this.crackBottle = engine?.bottleNo || 0;
      }
      this.#drawCracks(geo, (pressure - 0.62) / 0.38, fit.s);
    }
    ctx.restore();
    }

    // 撑破瞬间：一圈冲击波
    if (engine?.state === 'bursting' && burstT < 0.6) {
      const k = clamp(burstT / 0.6, 0, 1);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = (10 * (1 - k) + 1) * fit.s;
      ctx.beginPath();
      ctx.arc(geo.cx, geo.cy, geo.R * (0.6 + k * 0.9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #drawCracks(geo, strength, scale) {
    const ctx = this.ctx;
    const rnd = (i) => {
      let x = Math.sin(this.crackSeed * 12.9898 + i * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    ctx.save();
    ctx.strokeStyle = `rgba(255,220,235,${0.10 + 0.45 * clamp(strength, 0, 1)})`;
    ctx.lineWidth = Math.max(1, 1.6 * scale);
    for (let c = 0; c < 7; c++) {
      const angle = Math.PI * (0.1 + rnd(c) * 0.8) + (c > 4 ? Math.PI : 0);
      let x = geo.cx + Math.cos(angle) * geo.R * 0.99;
      let y = geo.cy + Math.sin(angle) * geo.R * 0.99;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let dir = angle + Math.PI;
      for (let k = 0; k < 5; k++) {
        dir += (rnd(c * 10 + k) - 0.5) * 0.9;
        const len = (10 + rnd(c * 7 + k) * 26) * (0.6 + strength);
        x += Math.cos(dir) * len;
        y += Math.sin(dir) * len;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- 头像 ----------

  #drawPieces(fit, engine) {
    const pieces = Array.isArray(engine?.pieces) ? engine.pieces : [];
    for (const p of pieces) {
      const sx = fit.ox + p.x * fit.s;
      const sy = fit.oy + p.y * fit.s;
      this.#drawAvatar(sx, sy, p.r * fit.s, p, engine?.time || 0);
    }
    // 合成后的大头像名字牌画在最上层，避免被压住
    for (const p of pieces) {
      if (p.tier < 4) continue;
      const sx = fit.ox + p.x * fit.s;
      const sy = fit.oy + p.y * fit.s;
      this.#nameTag(sx, sy + p.r * fit.s + 6 * fit.s, p.name, fit.s);
    }
  }

  #drawAvatar(x, y, r, p, now = 0) {
    const ctx = this.ctx;
    if (r < 0.5) return;
    const tier = tierOf(p.tier);
    const flash = p.mergedAt >= 0 && now - p.mergedAt < 0.22 && now >= p.mergedAt;

    if (p.tier >= 4) {
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
      glow.addColorStop(0, tier.ring);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalAlpha = Math.min(0.4, 0.16 + p.tier * 0.03);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.5 + p.tier * 0.05), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    const img = this.avatar(p.name, p.avatar);
    if (img) {
      const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      ctx.drawImage(img, x - iw / 2, y - ih / 2, iw, ih);
    } else {
      const hue = hashHue(p.name);
      const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      g.addColorStop(0, `hsl(${hue} 74% 60%)`);
      g.addColorStop(1, `hsl(${(hue + 46) % 360} 70% 38%)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // 没有真实头像时的兜底形象：一张简单的笑脸（比单个字母更像"人"）
      const eyeY = y - r * 0.12;
      const eyeDX = r * 0.32;
      const eyeR = Math.max(1, r * 0.1);
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.beginPath(); ctx.arc(x - eyeDX, eyeY, eyeR, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + eyeDX, eyeY, eyeR, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.88)';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y + r * 0.06, r * 0.36, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
      // 顶部一层微弱高光，避免整张脸太平
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.55, r * 0.7, r * 0.32, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 玻璃高光
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.strokeStyle = tier.ring;
    ctx.lineWidth = Math.max(1.5, r * 0.075 + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - r * 0.22, y - r * 0.26, r * 0.62, Math.PI * 1.05, Math.PI * 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.stroke();
    if (flash) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }
    ctx.restore();
  }

  #nameTag(x, y, name, s) {
    const ctx = this.ctx;
    const label = truncate(name, 8);
    ctx.save();
    ctx.font = font(clamp(11 * s, 10, 16), '600');
    const w = ctx.measureText(label).width + 12 * s;
    const h = clamp(17 * s, 14, 22);
    roundRect(ctx, x - w / 2, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(6,9,16,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,102,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffe6a8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + h / 2 + 0.5);
    ctx.restore();
  }

  // ---------- 粒子 ----------

  #updateParticles(dt) {
    const alive = [];
    for (const p of this.particles) {
      p.t += dt;
      if (p.t >= p.life) continue;
      if (p.kind === 'ring') { alive.push(p); continue; }
      p.vy += 140 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'shard') p.rot += p.vr * dt;
      alive.push(p);
    }
    this.particles = alive.slice(-320);
  }

  #drawParticles(layer, fit) {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const isRing = p.kind === 'ring';
      if ((layer === 'under') !== isRing) continue;
      const k = p.t / p.life;
      const sx = isRing ? fit.ox + p.x * fit.s : fit.ox + p.x * fit.s;
      const sy = isRing ? fit.oy + p.y * fit.s : fit.oy + p.y * fit.s;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      if (isRing) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.5, 3 * fit.s * (1 - k));
        ctx.beginPath();
        ctx.arc(sx, sy, (p.r0 + (p.r1 - p.r0) * k) * fit.s, 0, TAU);
        ctx.stroke();
      } else if (p.kind === 'shard') {
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * fit.s / 2, -p.size * fit.s / 4, p.size * fit.s, p.size * fit.s / 2);
      } else {
        ctx.fillStyle = p.color;
        const size = p.size * fit.s;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
      ctx.restore();
    }
  }

  // ---------- HUD ----------

  #drawHud(fit, engine, extra) {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    const s = clamp(Math.min(w / 1440, h / 900), 0.72, 1.55);
    const pad = 16 * s;
    const pressure = clamp(Number(engine?.pressure) || 0, 0, 1.2);
    const stats = engine?.stats || { drops: 0, merges: 0, bursts: 0 };
    const bottleNo = engine?.bottleNo || 1;
    const top = (engine?.topAvatars?.(5) || []);
    const board = extra?.board || [];
    const pieces = Array.isArray(engine?.pieces) ? engine.pieces.length : 0;
    const queued = engine?.queue?.length || 0;

    // 瓶口到左右 HUD 的安全距离
    const bottleLeft = fit.ox + (WORLD.cx - WORLD.R) * fit.s;
    const bottleRight = fit.ox + (WORLD.cx + WORLD.R) * fit.s;
    const leftW = clamp(bottleLeft - pad * 2, 110 * s, 320 * s);
    const rightW = clamp(w - bottleRight - pad * 2, 120 * s, 320 * s);

    // 左上：品牌
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleG = ctx.createLinearGradient(pad, 0, pad + 260 * s, 0);
    titleG.addColorStop(0, '#ffffff');
    titleG.addColorStop(0.6, '#ffd166');
    titleG.addColorStop(1, '#ff8fab');
    ctx.font = font(28 * s, '800');
    ctx.fillStyle = titleG;
    ctx.fillText(this.t('app.title'), pad, pad * 0.7);
    ctx.font = font(11 * s, '600');
    ctx.fillStyle = 'rgba(180,205,235,0.72)';
    ctx.fillText(this.t('app.subtitle'), pad, pad * 0.7 + 32 * s);
    ctx.restore();

    // 左上第二块：瓶号 + 统计 + 排队
    const metaY = pad * 0.7 + 54 * s;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = font(12 * s, '800');
    ctx.fillStyle = '#7ee7c7';
    ctx.fillText(this.t('hud.bottle', { n: bottleNo }), pad, metaY);
    ctx.font = font(10.5 * s, '500');
    ctx.fillStyle = 'rgba(200,214,236,0.72)';
    ctx.fillText(this.t('hud.stats', { drops: stats.drops || 0, merges: stats.merges || 0, bursts: stats.bursts || 0 }), pad, metaY + 17 * s);
    ctx.restore();

    // 右上：瓶压
    const barW = clamp(rightW, 150 * s, 260 * s);
    const barX = w - pad - barW;
    const barY = pad * 0.8;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = font(10.5 * s, '800');
    ctx.fillStyle = 'rgba(200,214,236,0.75)';
    ctx.fillText(this.t('hud.pressure'), w - pad, barY);
    ctx.font = font(22 * s, '800');
    ctx.fillStyle = pressure > 0.85 ? '#ff4d6d' : pressure > 0.6 ? '#ffd166' : '#7ee7c7';
    ctx.fillText(Math.round(Math.min(1, pressure) * 100) + '%', w - pad, barY + 13 * s);
    ctx.restore();

    const trackY = barY + 42 * s;
    ctx.save();
    roundRect(ctx, barX, trackY, barW, 8 * s, 4 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    const fillW = Math.max(2, barW * Math.min(1, pressure));
    const pg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    pg.addColorStop(0, '#7ee7c7');
    pg.addColorStop(0.6, '#ffd166');
    pg.addColorStop(1, '#ff4d6d');
    roundRect(ctx, barX, trackY, fillW, 8 * s, 4 * s);
    ctx.fillStyle = pg;
    ctx.fill();
    if (pressure > 0.8) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 7);
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 1.5;
      roundRect(ctx, barX, trackY, barW, 8 * s, 4 * s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 瓶压告警
    if (pressure > 0.82) {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.font = font(11 * s, '800');
      ctx.fillStyle = 'rgba(255,' + (queued > 60 ? '120,150' : '180,90') + ',' + (0.65 + 0.35 * Math.sin(this.time * 8)).toFixed(2) + ')';
      ctx.fillText(queued > 60 ? this.t('hud.jam') : this.t('hud.breakSoon'), w - pad, trackY + 20 * s);
      ctx.restore();
    }

    // 右上：撑破榜
    let boardY = trackY + 34 * s;
    if (board.length) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = font(10.5 * s, '800');
      ctx.fillStyle = '#ffd166';
      ctx.fillText(this.t('hud.burstBoard'), barX, boardY);
      ctx.restore();
      boardY += 17 * s;
      for (let i = 0; i < Math.min(5, board.length); i++) {
        const row = board[i];
        const y = boardY + i * 18 * s;
        ctx.save();
        ctx.textAlign = 'left';
        ctx.font = font(11 * s, i === 0 ? '800' : '600');
        ctx.fillStyle = i === 0 ? '#ffe6a8' : 'rgba(214,224,240,0.85)';
        ctx.fillText((i + 1) + '.', barX, y);
        ctx.fillText(truncate(row.name, 6), barX + 15 * s, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = i === 0 ? '#ffd166' : '#ffb457';
        ctx.fillText('×' + row.count, barX + barW, y);
        ctx.restore();
      }
      boardY += Math.min(5, board.length) * 18 * s + 8 * s;
    }

    // 左下：最大头像
    let leftY = metaY + 56 * s;
    if (top.length) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = font(10.5 * s, '800');
      ctx.fillStyle = '#8fe9ff';
      ctx.fillText(this.t('hud.biggest'), pad, leftY);
      ctx.restore();
      leftY += 17 * s;
      for (let i = 0; i < Math.min(5, top.length); i++) {
        const row = top[i];
        const y = leftY + i * 19 * s;
        ctx.save();
        ctx.textAlign = 'left';
        ctx.font = font(11 * s, i === 0 ? '800' : '600');
        ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(214,224,240,0.85)';
        ctx.fillText(truncate(row.name, 7), pad, y);
        ctx.textAlign = 'right';
        ctx.font = font(10 * s, '700');
        ctx.fillStyle = tierOf(row.tier).ring;
        ctx.fillText('Lv' + row.tier, pad + leftW, y);
        ctx.restore();
      }
      leftY += Math.min(5, top.length) * 19 * s + 10 * s;
    }

    // 左下：吐司播报（放在瓶口左侧的空白区，不挡掉落）
    leftY = this.#drawToasts(leftY, leftW, s);

    // 底部：跑马灯 + 合规标识
    const bottomPad = h - pad;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = font(10 * s, '500');
    ctx.fillStyle = 'rgba(150,170,198,0.5)';
    ctx.fillText(this.t('hud.compliance'), pad, bottomPad - 10 * s);
    ctx.restore();

    const feed = extra?.feed || [];
    if (feed.length) {
      const lineH = 16 * s;
      const startY = bottomPad - 10 * s - feed.length * lineH - 8 * s;
      ctx.save();
      ctx.textAlign = 'left';
      for (let i = 0; i < feed.length; i++) {
        const item = feed[i];
        const y = startY + i * lineH;
        ctx.font = font(11 * s, '600');
        ctx.fillStyle = item.color || 'rgba(200,214,236,0.8)';
        ctx.fillText(truncate(item.text, 30), pad, y);
      }
      ctx.restore();
    }

    // 空瓶引导（只在真的一个都没掉过时出现）
    if (pieces === 0 && (stats.drops || 0) === 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = font(22 * s, '800');
      ctx.fillStyle = 'rgba(240,246,255,0.92)';
      ctx.fillText(this.t('hud.empty.title'), w / 2, h * 0.42);
      ctx.font = font(13 * s, '500');
      ctx.fillStyle = 'rgba(160,200,255,0.8)';
      ctx.fillText(this.t('hud.empty.hint'), w / 2, h * 0.42 + 30 * s);
      ctx.restore();
    }

    // 撑破大字
    if (engine?.state === 'bursting') {
      const k = clamp((engine.burstT || 0) / 1.2, 0, 1);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1 - k * 0.7;
      ctx.font = font((48 + 26 * Math.sin(k * Math.PI)) * s, '900');
      ctx.fillStyle = '#ffd166';
      ctx.shadowColor = '#ff4d6d';
      ctx.shadowBlur = 30 * s;
      ctx.fillText(this.t('hud.bursting'), w / 2, h * 0.34);
      ctx.shadowBlur = 0;
      const breaker = engine.lastBurst?.breaker;
      if (breaker) {
        const label = truncate(breaker.name, 12);
        ctx.font = font(16 * s, '700');
        const tw = ctx.measureText(label).width;
        const py = h * 0.34 + 28 * s;
        roundRect(ctx, w / 2 - tw / 2 - 14 * s, py, tw + 28 * s, 30 * s, 15 * s);
        ctx.fillStyle = 'rgba(10,8,14,0.72)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,214,102,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ffe6a8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, py + 15 * s);
      }
      ctx.restore();
    }
  }

  #drawToasts(y0, maxWidth, s) {
    const ctx = this.ctx;
    const visible = this.toasts.filter((x) => x.t < x.life).slice(-2);
    let y = y0;
    for (const item of visible) {
      const k = item.t / item.life;
      const alpha = k < 0.12 ? k / 0.12 : k > 0.82 ? (1 - k) / 0.18 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.font = font(12 * s, '700');
      let text = String(item.text);
      while (text.length > 2 && ctx.measureText(text).width > maxWidth - 22 * s) text = text.slice(0, -2) + '…';
      const tw = ctx.measureText(text).width;
      const pw = Math.min(maxWidth, tw + 22 * s);
      const ph = 26 * s;
      const accent = item.kind === 'burst' ? '#ff4d6d' : item.kind === 'merge' ? '#ffd166' : item.kind === 'gift' ? '#c9a7ff' : '#7ee7c7';
      roundRect(ctx, 14 * s, y, pw, ph, 8 * s);
      ctx.fillStyle = 'rgba(8,11,18,0.78)';
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha *= 0.55;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = accent;
      ctx.fillRect(14 * s, y + 5 * s, 3 * s, ph - 10 * s);
      ctx.fillStyle = '#e8f0ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 22 * s, y + ph / 2 + 0.5);
      ctx.restore();
      y += ph + 6 * s;
    }
    return y + 4 * s;
  }
}
