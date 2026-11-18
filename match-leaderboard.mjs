// 头像撑瓶 · 撑破榜（localStorage，持久化，脏数据全部兜底）
// 记录"谁把瓶子撑破过几次"，是这游戏唯一的长期荣誉。
// 存储能力靠注入 {read, write}，模块本身不碰 localStorage，方便单测。

export const BOARD_DEFAULTS = { max: 20, boardMax: 60 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function sanitizeBoard(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const people = Array.isArray(src.people) ? src.people : [];
  const clean = [];
  const seen = new Map();
  for (const row of people) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name || '').trim().slice(0, 24);
    if (!name) continue;
    const count = clamp(Math.round(Number(row.count) || 0), 0, 9999);
    const lastAt = Math.max(0, Number(row.lastAt) || 0);
    const exist = seen.get(name);
    if (exist) {
      // 同名重复条目：取更大的次数，别直接丢掉一条
      if (count > exist.count) exist.count = count;
      exist.lastAt = Math.max(exist.lastAt, lastAt);
      if (!exist.avatar && typeof row.avatar === 'string') exist.avatar = row.avatar;
      continue;
    }
    const item = { name, avatar: typeof row.avatar === 'string' ? row.avatar : '', count, lastAt };
    seen.set(name, item);
    clean.push(item);
  }
  clean.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  return {
    total: clamp(Math.round(Number(src.total) || clean.reduce((n, p) => n + p.count, 0)), 0, 1e9),
    people: clean.slice(0, BOARD_DEFAULTS.boardMax)
  };
}

export class BurstBoard {
  constructor({ storage = null, max = BOARD_DEFAULTS.max } = {}) {
    this.storage = storage;
    this.max = Math.max(1, Math.round(max));
    this.state = sanitizeBoard(this.#read());
  }

  #read() {
    try {
      const raw = this.storage?.read?.();
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch {
      return null;   // 隐私模式/坏 JSON：当作空榜，不要让页面白屏
    }
  }

  #save() {
    try {
      this.storage?.write?.(JSON.stringify(this.state));
    } catch { /* 存不进去也不影响本场 */ }
  }

  record({ name, avatar = '', at = Date.now() } = {}) {
    const person = String(name || '').trim().slice(0, 24);
    if (!person) return null;
    this.state.total += 1;
    const row = this.state.people.find((p) => p.name === person);
    if (row) {
      row.count += 1;
      row.lastAt = at;
      if (avatar) row.avatar = avatar;
    } else {
      this.state.people.push({ name: person, avatar, count: 1, lastAt: at });
    }
    this.state.people.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    this.state.people = this.state.people.slice(0, Math.max(this.max, BOARD_DEFAULTS.boardMax));
    this.#save();
    return this.state.people.find((p) => p.name === person) || null;
  }

  top(n = this.max) {
    return this.state.people.slice(0, Math.max(0, Math.round(n)));
  }

  countOf(name) {
    return this.state.people.find((p) => p.name === name)?.count || 0;
  }

  get total() { return this.state.total; }

  clear() {
    this.state = { total: 0, people: [] };
    this.#save();
  }
}
