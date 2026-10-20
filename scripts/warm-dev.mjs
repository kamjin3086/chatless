// `pnpm dev` 包装器：启动 next dev，并在服务就绪后立即预热入口路由。
// turbopack 按需编译，实测 / 首轮编译 ~11s；提前触发可与 cargo 编译重叠，
// Tauri 窗口弹出时页面已编译完成，避免白屏等待。
import { spawn } from 'node:child_process';

const PORT = process.env.PORT || 3000;
const WARM_ROUTES = ['/', '/chat'];

const child = spawn('pnpm exec next dev --turbopack', [], {
  stdio: 'inherit',
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

let warmed = false;
let inflight = false;
async function tryWarm() {
  if (warmed || inflight) return;
  inflight = true;
  try {
    // 请求 / 会触发该路由编译，响应返回即编译完成；同一时刻只允许一个预热请求在途，
    // 避免并发重复编译互相争抢 CPU
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(120000) });
    if (res.ok) {
      warmed = true;
      clearInterval(iv);
      console.log('[warm-dev] / 预热完成');
      for (const route of WARM_ROUTES.slice(1)) {
        // 串行预热，前一个编译完再下一个
        await fetch(`http://127.0.0.1:${PORT}${route}`, { signal: AbortSignal.timeout(120000) }).catch(() => {});
        console.log(`[warm-dev] ${route} 预热完成`);
      }
    }
  } catch {
    // dev server 尚未监听或编译失败，稍后重试
  } finally {
    inflight = false;
  }
}
const iv = setInterval(() => {
  tryWarm();
  if (child.exitCode !== null) {
    clearInterval(iv);
    process.exit(child.exitCode);
  }
}, 300);
