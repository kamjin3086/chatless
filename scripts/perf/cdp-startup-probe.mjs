// WebView2 CDP startup probe.
// Launches the app with a remote debugging port, records console messages
// (wall-clock ms since launch) and page performance timings.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const exe = process.argv[2];
const settleMs = Number(process.argv[3] ?? 15000);
const port = 9223;

const proc = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'ignore',
});
const t0 = Date.now();
const events = [];

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

// wait for devtools endpoint
let targets = null;
for (let i = 0; i < 100; i++) {
  await sleep(150);
  try { targets = await getJson(`http://127.0.0.1:${port}/json`); if (targets?.length) break; } catch {}
}
if (!targets) { console.error('CDP endpoint never came up'); proc.kill(); process.exit(1); }
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('no page target', targets.map(t => t.type)); proc.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    events.push({ t: Date.now() - t0, kind: 'console', text: String(text).slice(0, 160) });
  }
  if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) {
    events.push({ t: Date.now() - t0, kind: 'nav', text: msg.params.frame.url });
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Page.enable');

await sleep(settleMs);

const evalRes = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    now: performance.now(),
    nav: performance.getEntriesByType('navigation')[0] && {
      domContentLoaded: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
      load: Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd),
    },
    paints: performance.getEntriesByType('paint').map(p => ({ name: p.name, t: Math.round(p.startTime) })),
    fcp: (performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint') || {}).startTime,
    resourcesTop: performance.getEntriesByType('resource').sort((a,b)=>b.duration-a.duration).slice(0,12).map(r => ({ n: r.name.split('/').pop().slice(0,48), d: Math.round(r.duration), s: Math.round(r.startTime) })),
    resourceCount: performance.getEntriesByType('resource').length,
  })`,
  returnByValue: true,
});
let pageMetrics = null;
try { pageMetrics = JSON.parse(evalRes.result.value); } catch { pageMetrics = evalRes; }

// wall-clock offset: how long ago (ms) was page timeOrigin, relative to our t0
const offsetRes = await send('Runtime.evaluate', {
  expression: 'Date.now() - performance.timeOrigin',
  returnByValue: true,
});

console.log(JSON.stringify({
  processToPageMs: Math.round(offsetRes.result?.value ?? NaN), // page timeOrigin vs our launch
  page: pageMetrics,
  events,
}, null, 2));

try { ws.close(); } catch {}
proc.kill();
process.exit(0);
