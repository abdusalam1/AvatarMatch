// 头像撑瓶 · 语音播报（浏览器 TTS）
// 只播"大事"：进场、合成大物、大礼物、瓶压告急、撑破、换瓶。
// 绝不逐条念弹幕——既吵，也踩平台"第三方朗读"的归责线。

export const MATCH_LINES = {
  zh: {
    welcome: [
      '欢迎{name}进入直播间，点个赞，你的头像就会掉进瓶子里。',
      '{name}来啦，评论能让头像掉得更多。',
      '欢迎{name}，瓶子快满了，来得正是时候。',
      '{name}进场，看看你的头像能合到多大。'
    ],
    merge: [
      '{name}合成了一个{tier}头像！',
      '{name}的头像变成{tier}了，继续合！',
      '漂亮！{name}合出了{tier}。'
    ],
    gift: ['感谢{name}送出的{gift}！', '谢谢{name}的{gift}，头像马上安排！'],
    pressure: ['瓶子快满了，再来几个人就炸！', '瓶压告急，撑破它！'],
    burst: [
      '{name}撑破了瓶子！第{n}瓶结束。',
      '炸了！{name}把瓶子撑破了，第{n}瓶！',
      '瓶子被{name}撑破，全场重开！'
    ],
    burstNone: ['瓶子被撑破了！新的一瓶开始。'],
    bottle: ['第{n}瓶开始，继续掉头像！', '新瓶子准备好了，第{n}瓶。']
  },
  en: {
    welcome: [
      'Welcome {name}! Like to drop your avatar into the bottle.',
      '{name} is here — comments drop more avatars.',
      'Welcome {name}, the bottle is almost full.',
      '{name} joined. Let us see how big your avatar can get.'
    ],
    merge: [
      '{name} merged a {tier} avatar!',
      '{name} just made a {tier}!',
      'Nice merge by {name} — {tier}!'
    ],
    gift: ['Thanks {name} for the {gift}!', 'Big thanks to {name} for the {gift}!'],
    pressure: ['The bottle is almost full — push it!', 'Pressure critical, pop it!'],
    burst: [
      '{name} popped the bottle! Bottle {n} is done.',
      'POP! {name} broke bottle {n}.',
      '{name} filled the bottle to bursting — bottle {n} over!'
    ],
    burstNone: ['The bottle popped! A new one is ready.'],
    bottle: ['Bottle {n} starts now — keep them coming!', 'New bottle ready, number {n}.']
  }
};

export class MatchSpeech {
  constructor({ lang = 'zh', onStatus = () => {} } = {}) {
    this.lang = lang === 'en' ? 'en' : 'zh';
    this.enabled = true;
    this.volume = 0.9;
    this.rate = 1.06;
    this.onStatus = onStatus;
    this.queue = [];
    this.speaking = false;
    this.previous = -1;
    this.generation = 0;
    this.ready = typeof globalThis.speechSynthesis !== 'undefined';
    this.gates = new Map();
  }

  setLang(lang) { this.lang = lang === 'en' ? 'en' : 'zh'; }

  get lines() { return MATCH_LINES[this.lang] || MATCH_LINES.zh; }

  #pick(list, key) {
    if (!list?.length) return '';
    let i = Math.floor(Math.random() * list.length);
    if (i === this.previous) i = (i + 1) % list.length;
    this.previous = i;
    return String(list[i]).replace(/\{(\w+)\}/g, (m, k) => (key[k] === undefined ? m : String(key[k])));
  }

  #preferredVoice() {
    if (!this.ready) return null;
    const voices = speechSynthesis.getVoices() || [];
    const lang = this.lang === 'en' ? /^en/i : /zh|cmn/i;
    return voices.find((v) => lang.test(v.lang) && /xiaoxiao|xiaoyi|huihui|female|女/i.test(v.name))
      || voices.find((v) => lang.test(v.lang)) || null;
  }

  say(text) {
    if (!this.enabled || !this.ready) return false;
    const clean = String(text || '').replace(/[<>\n\r]/g, '').slice(0, 80);
    if (!clean) return false;
    if (this.queue.length >= 6) this.queue.shift();
    this.queue.push(clean);
    this.pump();
    return true;
  }

  // 播报也限流：热闹的时候别把 CPU 和观众耳朵一起塞满
  #throttled(key, seconds) {
    const now = Date.now();
    if (now - (this.gates.get(key) || 0) < seconds * 1000) return false;
    this.gates.set(key, now);
    return true;
  }

  welcome(name) {
    return this.#throttled('welcome', 2.5) && this.say(this.#pick(this.lines.welcome, { name }));
  }

  merge(name, tierName) {
    return this.say(this.#pick(this.lines.merge, { name, tier: tierName }));
  }

  gift(name, gift) {
    return this.say(this.#pick(this.lines.gift, { name, gift }));
  }

  pressure(pct) {
    return this.#throttled('pressure', 12) && this.say(this.#pick(this.lines.pressure, { pct }));
  }

  burst(name, n) {
    return this.say(this.#pick(name ? this.lines.burst : this.lines.burstNone, { name, n }));
  }

  bottle(n) {
    return this.say(this.#pick(this.lines.bottle, { n }));
  }

  pump() {
    if (!this.ready || !this.enabled || this.speaking || !this.queue.length) return;
    const text = this.queue.shift();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = this.#preferredVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || (this.lang === 'en' ? 'en-US' : 'zh-CN');
    utter.rate = this.rate;
    utter.pitch = 1.04;
    utter.volume = this.volume;
    const token = this.generation;
    this.speaking = true;
    this.onStatus(text);
    utter.onend = () => { if (token !== this.generation) return; this.speaking = false; this.pump(); };
    utter.onerror = () => { if (token !== this.generation) return; this.speaking = false; this.queue = []; };
    try { speechSynthesis.speak(utter); } catch { this.speaking = false; }
  }

  stop() {
    this.generation += 1;
    this.queue = [];
    this.speaking = false;
    if (this.ready) { try { speechSynthesis.cancel(); } catch { /* 忽略 */ } }
  }
}
