// Timestamped launcher for `pnpm tauri dev` (or any command).
// Prefixes each stdout/stderr line with elapsed ms, polls the app window,
// and optionally waits for a URL to answer.
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [cmd, ...args] = process.argv.slice(2);
const settleMs = Number(process.env.SETTLE_MS ?? 120000);
const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(7, ' ');
const out = [];
function emit(line) {
  const l = `${ts()}| ${line}`;
  out.push(l);
  console.log(l);
}

const child = spawn(cmd, args, { shell: true, cwd: process.cwd() });
let buf = '';
function onData(d) {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, '');
    buf = buf.slice(i + 1);
    if (line.trim()) emit(line.trim().slice(0, 200));
  }
}
child.stdout.on('data', onData);
child.stderr.on('data', onData);

// window + URL pollers
const seen = new Set();
const poller = setInterval(() => {
  try {
    const r = execSync(
      'powershell -NoProfile -Command "$p=Get-Process chatless -ErrorAction SilentlyContinue; if($p){$p.MainWindowHandle.ToString()}"',
    ).toString().trim();
    if (r && r !== '0' && !seen.has('hwnd')) { seen.add('hwnd'); emit(`>>> WINDOW created (hwnd=${r})`); }
  } catch {}
  fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(700) })
    .then((res) => { if (!seen.has('next')) { seen.add('next'); emit(`>>> NEXT dev server answering (HTTP ${res.status})`); } })
    .catch(() => {});
}, 150);

const start = Date.now();
const iv = setInterval(() => {
  if (Date.now() - start > settleMs) {
    clearInterval(iv); clearInterval(poller);
    emit('=== settle reached, killing tree ===');
    try { execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch {}
    try { execSync('taskkill /F /IM chatless.exe /T', { stdio: 'ignore' }); } catch {}
    process.exit(0);
  }
}, 500);
