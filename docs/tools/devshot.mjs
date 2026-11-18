// 开发用：无头 Chrome/Edge + CDP，抓控制台报错并截图（零依赖，Node 22+）。
// 用法：node docs/tools/devshot.mjs <url> <out.png> [waitMs] [width] [height] [evalExpr]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , url, out, waitMsArg, widthArg, heightArg, evalExprArg] = process.argv;
if (!url || !out) {
  console.error('用法: node docs/tools/devshot.mjs <url> <out.png> [waitMs] [width] [height] [evalExpr]');
  process.exit(2);
}
const waitMs = Number(waitMsArg || 6000);
const width = Number(widthArg || 1600);
const height = Number(heightArg || 940);
const evalExpr = process.env.MATCH_SHOT_EVAL || evalExprArg || '';
const port = 9333 + Math.floor(Math.random() * 200);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome/Edge');

const profile = mkdtempSync(join(tmpdir(), 'match-shot-'));
const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  `--window-size=${width},${height}`, 'about:blank'
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* 还没起来 */ }
    await sleep(120);
  }
  throw new Error('CDP 未就绪');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const problems = [];
const logs = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push('EXCEPTION: ' + (d.exception?.description || d.text) + ' @' + (d.url || '') + ':' + (d.lineNumber ?? ''));
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    logs.push(msg.params.type.toUpperCase() + ': ' + text);
    if (msg.params.type === 'error') problems.push('CONSOLE ERROR: ' + text);
  }
  if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    logs.push('LOG[' + e.level + ']: ' + e.text);
    if (e.level === 'error') problems.push('LOG ERROR: ' + e.text + ' ' + (e.url || ''));
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

if (evalExpr) {
  const r = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true });
  console.log('EVAL', JSON.stringify(r.result?.value ?? r.exceptionDetails?.text ?? null));
  await sleep(600);
}

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify((()=>{
    const c = document.querySelector('canvas');
    const m = globalThis.__match;
    const s = m?.snapshot?.();
    return {
      url: location.href,
      canvas: c ? { w: c.width, h: c.height, css: c.style.width } : null,
      app: document.title,
      pieces: s?.pieces ?? null,
      pressure: s?.pressure ?? null,
      state: s?.state ?? null,
      bottleNo: s?.bottleNo ?? null,
      queue: m?.engine?.queue?.length ?? null,
      boardRows: m?.board?.top?.(5)?.length ?? null,
      top: s?.stats ? { drops: s.stats.drops, merges: s.stats.merges, bursts: s.stats.bursts } : null,
      feedRows: document.getElementById('events')?.children.length ?? null,
      hasMatch: !!m
    };
  })())`,
  returnByValue: true
});

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));

console.log('PROBE', probe.result?.value);
console.log('PROBLEMS', problems.length ? '\n- ' + problems.slice(0, 12).join('\n- ') : 'none');
console.log('LOGS', logs.length ? '\n- ' + logs.slice(0, 12).join('\n- ') : 'none');
console.log('WROTE', out);

try { await send('Browser.close'); } catch { /* 已关闭 */ }
ws.close();
child.kill();
process.exit(problems.length ? 1 : 0);
