// 开发用：无头 Chrome/Edge + CDP，按固定步长推进游戏并逐帧抓 CANVAS 区域，生成 GIF 素材。
// 用法：node docs/tools/capture-frames.mjs <url> <outDir> [frames] [stepMs] [burstAt]
//   burstAt：第几帧后手动炸一瓶（默认 24，传 0 表示不炸）
// 零依赖：Node 22+ 自带 WebSocket / fetch；最终用 make-gif.py（Pillow）合成。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , url, outDir, framesArg, stepArg, burstArg] = process.argv;
if (!url || !outDir) {
  console.error('用法: node docs/tools/capture-frames.mjs <url> <outDir> [frames] [stepMs] [burstAt]');
  process.exit(2);
}
const total = Math.max(4, Number(framesArg || 44));
const stepMs = Math.max(20, Number(stepArg || 70));
const burstAt = Number(burstArg ?? 24);
const port = 9550 + Math.floor(Math.random() * 200);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome/Edge');

const profile = mkdtempSync(join(tmpdir(), 'match-frames-'));
const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--window-size=1920,1080', 'about:blank'
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* 还没起来 */ }
    await sleep(120);
  }
  throw new Error('CDP 未就绪');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(4500);

mkdirSync(outDir, { recursive: true });
for (const name of existsSync(outDir) ? readdirSync(outDir) : []) {
  if (/^frame-\d+\.png$/.test(name)) rmSync(join(outDir, name));
}

await send('Runtime.evaluate', { expression: 'globalThis.__match && __match.pause(); "ok"', returnByValue: true });
const rectProbe = await send('Runtime.evaluate', {
  expression: `JSON.stringify((()=>{const c=document.querySelector('canvas');const r=c.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};})())`,
  returnByValue: true
});
const clip = { ...JSON.parse(rectProbe.result.value), scale: 1 };
console.log('CLIP', JSON.stringify(clip));

for (let i = 0; i < total; i++) {
  if (burstAt > 0 && i === burstAt) {
    await send('Runtime.evaluate', { expression: '__match.burst()', returnByValue: true });
  } else {
    await send('Runtime.evaluate', {
      expression: `__match.advance(${stepMs / 1000})`,
      returnByValue: true
    });
  }
  await sleep(45);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(join(outDir, `frame-${String(i).padStart(3, '0')}.png`), Buffer.from(shot.data, 'base64'));
  if (i % 10 === 0) console.log('frame', i);
}

console.log('WROTE', outDir, total, 'frames');
try { await send('Browser.close'); } catch { /* 已关闭 */ }
ws.close();
child.kill();
process.exit(0);
