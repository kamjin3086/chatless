#!/usr/bin/env node
/**
 * Chatless desktop acceptance harness.
 *
 * Drives the packaged app through a WebDriver session (tauri-driver +
 * msedgedriver) against an isolated application identifier, so no user data is
 * touched.  Interactions are real DOM clicks and key events; assertions read
 * the isolated SQLite database, the temporary workspace and the page state.
 *
 * Required environment:
 *   CHATLESS_E2E_APP        path to the debug build (target/debug/chatless.exe)
 *   CHATLESS_E2E_DATA_DIR   config dir of the e2e identifier (seeded here)
 *   CHATLESS_E2E_WORKSPACE  temporary workspace used by the file/shell flows
 * Optional:
 *   CHATLESS_E2E_DRIVER_URL default http://127.0.0.1:4444 (tauri-driver is started here)
 *   CHATLESS_E2E_TAURI_DRIVER / CHATLESS_E2E_NATIVE_DRIVER  driver binaries
 *   CHATLESS_E2E_REPORT     write the JSON report here
 *   CHATLESS_E2E_FLOWS      comma separated flow filter
 *   CHATLESS_QWEN_URL       endpoint used for the seeded provider
 *   CHATLESS_QWEN_MODEL     model id used for the seeded provider
 *
 * Modes: --inspect dumps the DOM surface and exits.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const driverUrl = (process.env.CHATLESS_E2E_DRIVER_URL || 'http://127.0.0.1:4444').replace(/\/$/, '');
// Never default to `target/debug`: that is the developer's own build, and
// running it (or stopping it) would disturb their session. The e2e binary is
// built separately with target-e2e and the e2e identifier.
const appPath = process.env.CHATLESS_E2E_APP
  || path.join(process.cwd(), 'src-tauri', 'target-e2e', 'debug', 'chatless.exe');
if (!fs.existsSync(appPath)) {
  throw new Error(`e2e application not found: ${appPath}. Set CHATLESS_E2E_APP to an isolated build.`);
}
if (appPath.includes(`${path.sep}target${path.sep}`)) {
  throw new Error(`refusing to drive the developer build at ${appPath}; build with --target-dir target-e2e`);
}
const dataDir = process.env.CHATLESS_E2E_DATA_DIR
  || path.join(process.env.APPDATA || os.homedir(), 'com.kamjin.chatless.e2e');
const workspace = process.env.CHATLESS_E2E_WORKSPACE || path.join(os.tmpdir(), 'chatless-e2e-workspace');
const reportPath = process.env.CHATLESS_E2E_REPORT
  || path.join(os.tmpdir(), 'chatless-e2e-report.json');
const endpoint = (process.env.CHATLESS_QWEN_URL || 'http://10.126.126.2:8101').replace(/\/$/, '');
const model = process.env.CHATLESS_QWEN_MODEL || 'Qwen3.8-Flash-Next-medium';
const flowFilter = (process.env.CHATLESS_E2E_FLOWS || '').split(',').map((s) => s.trim()).filter(Boolean);
const inspectOnly = process.argv.includes('--inspect');
const stopTargetMs = 200;
const tauriDriverPath = process.env.CHATLESS_E2E_TAURI_DRIVER
  || path.join(os.homedir(), '.cargo', 'bin', 'tauri-driver.exe');
const nativeDriverPath = process.env.CHATLESS_E2E_NATIVE_DRIVER
  || path.join(os.homedir(), '.chatless-tools', 'edgedriver', 'msedgedriver.exe');

let sessionId = null;
let driverProcess = null;

/** Progress goes to stderr so a piped stdout (the report) stays clean. */
function step(message) {
  process.stderr.write(`[e2e ${new Date().toISOString().slice(11, 19)}] ${message}\n`);
}

async function wd(method, urlPath, body) {
  // Without a timeout a stalled WebView2 call hangs the whole run forever.
  const response = await fetch(`${driverUrl}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${method} ${urlPath} -> ${response.status} ${text.slice(0, 400)}`);
  }
  return payload.value === undefined ? payload : payload.value;
}

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const elementId = (element) => (typeof element === 'string' ? element : element?.[ELEMENT_KEY]);

async function startSession() {
  const value = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        'tauri:options': { application: appPath },
      },
    },
  });
  sessionId = value.sessionId;
  return sessionId;
}

/**
 * Starts tauri-driver for this run and waits for it to answer. A driver left
 * over from a previous run keeps a half-closed WebView2 profile, and the next
 * session then fails with "DevToolsActivePort file doesn't exist".
 */
async function startDriver() {
  const port = new URL(driverUrl).port || '4444';
  driverProcess = spawn(tauriDriverPath, ['--native-driver', nativeDriverPath, '--port', String(port)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  // tauri-driver has no readiness endpoint; give it a moment and let the first
  // session request be the probe.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

function stopDriver() {
  try { driverProcess?.kill(); } catch { /* already gone */ }
  driverProcess = null;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      // ForEach-Object keeps Stop-Process from prompting for -Id when nothing
      // matched, which would block a non-interactive shell forever.
      'Get-Process tauri-driver,msedgedriver -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }',
    ], { stdio: 'ignore' });
  } catch { /* nothing running */ }
}

/** The driver accepts the first session a moment after it starts. */
async function startSessionWithRetry(attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await startSession();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}

async function endSession() {
  if (!sessionId) return;
  try { await wd('DELETE', `/session/${sessionId}`); } catch { /* already gone */ }
  sessionId = null;
}

const el = (value) => ({ [ELEMENT_KEY]: elementId(value) });

async function find(using, value) {
  const found = await wd('POST', `/session/${sessionId}/element`, { using, value });
  return found;
}

async function findByText(tag, text, { exact = false } = {}) {
  const predicate = exact ? `normalize-space(.)='${text}'` : `contains(normalize-space(.), '${text}')`;
  return find('xpath', `//${tag}[${predicate}]`);
}

async function click(element) { return wd('POST', `/session/${sessionId}/element/${elementId(element)}/click`, {}); }

async function sendKeys(element, text) {
  return wd('POST', `/session/${sessionId}/element/${elementId(element)}/value`, { text, value: [...text] });
}

async function getText(element) {
  return wd('GET', `/session/${sessionId}/element/${elementId(element)}/text`);
}

async function execute(script, args = []) {
  return wd('POST', `/session/${sessionId}/execute/sync`, { script, args });
}

async function waitFor(label, probe, { timeout = 60_000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
      last = value;
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`timeout waiting for ${label}: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

/** The composer is a textarea or a contenteditable owned by the chat page. */
async function composerElement() {
  try { return await find('css selector', 'textarea'); } catch { /* fall through */ }
  return find('css selector', '[contenteditable="true"]');
}

async function sendMessage(text) {
  // A floating control sits over the composer, so both a pointer click and the
  // WebDriver "value" command are refused as not interactable. Type the way the
  // page itself would: set the value, then dispatch the events React listens to.
  const typed = await execute(`
    const el = document.querySelector('textarea');
    if (!el) return { ok: false, reason: 'no composer' };
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, arguments[0]);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, value: el.value };
  `, [text]);
  if (!typed?.ok) throw new Error(typed?.reason || 'composer not found');

  const submitted = await execute(`
    const el = document.querySelector('textarea');
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return { value: el.value };
  `);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const after = await execute(`const el = document.querySelector('textarea'); return { value: el ? el.value : null };`);
  if (after.value && after.value.trim()) {
    // Enter was consumed as a newline. The send control is an icon button that a
    // floating overlay covers, so activate it from the page instead of the
    // pointer: a real click event still runs React's handler.
    const clicked = await waitFor('send control', async () => {
      const result = await execute(`
        const button = Array.from(document.querySelectorAll('button')).find((b) => {
          const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).trim();
          return /发送|Send/i.test(label) && !b.disabled;
        });
        if (!button) return { ok: false };
        button.click();
        return { ok: true, label: (button.getAttribute('aria-label') || button.textContent || '').trim() };
      `);
      return result?.ok ? result : false;
    }, { timeout: 10_000 });
    return { submitted: clicked.label };
  }
  return { submitted: submitted.value };
}

/** The picker is opened from the toolbar and lists provider + model entries. */
async function openModelPicker() {
  const button = await waitFor('model button', async () => {
    for (const label of ['选择模型', 'Select model', '切换模型']) {
      try { return await find('xpath', `//button[contains(@aria-label, '${label}') or contains(normalize-space(.), '${label}')]`); } catch { /* next */ }
    }
    throw new Error('model button not found');
  }, { timeout: 30_000 });
  await click(button);
  await new Promise((resolve) => setTimeout(resolve, 800));
  return execute(`
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({ label: (b.getAttribute('aria-label') || '').trim(), text: (b.textContent || '').trim().slice(0, 60) }));
    const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({ placeholder: i.placeholder, value: i.value }));
    return {
      buttons: buttons.filter((b) => b.label || b.text).slice(0, 60),
      inputs,
      modelText: (document.body.textContent || '').includes('请先选择模型'),
      body: (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 800),
    };
  `);
}

/** Chooses the seeded provider's model, if the composer still has no model. */
async function ensureModelSelected() {
  const state = await execute(`return { text: (document.body.textContent || '').slice(0, 2000) };`);
  if (!/请先选择模型|正在初始化模型服务|选择模型/.test(state.text)) return 'model already selected';
  const dump = await openModelPicker();
  const target = dump.buttons.find((b) => (b.text || '').includes(model) || (b.label || '').includes(model))
    || dump.buttons.find((b) => /homelab/i.test(`${b.label} ${b.text}`));
  if (!target) {
    return `picker had no ${model} entry: ${JSON.stringify(dump.buttons.slice(0, 20))}`;
  }
  const xpath = target.label
    ? `//button[@aria-label='${target.label}']`
    : `//button[contains(normalize-space(.), '${target.text}')]`;
  await click(await find('xpath', xpath));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return `selected ${target.label || target.text}`;
}

/** Reads the conversation state the UI renders, via the live page. */
async function domSummary() {
  return execute(`
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean);
    const testIds = Array.from(document.querySelectorAll('[data-testid]')).map((n) => n.getAttribute('data-testid'));
    return {
      title: document.title,
      url: location.href,
      buttons: buttons.slice(0, 40),
      testIds: testIds.slice(0, 40),
      hasTextarea: !!document.querySelector('textarea'),
      hasEditable: !!document.querySelector('[contenteditable="true"]'),
      // innerText is empty while the webview is not composited; textContent
      // reports what React actually rendered.
      bodyText: (document.body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 600),
    };
  `);
}

function seedProviderConfig() {
  fs.mkdirSync(dataDir, { recursive: true });
  const provider = {
    name: 'homelab',
    displayName: 'homelab',
    url: `${endpoint}/v1`,
    requiresKey: false,
    status: 'UNKNOWN',
    lastChecked: 0,
    apiKey: null,
    isUserAdded: true,
    isVisible: true,
    strategy: 'openai-compatible',
  };
  fs.writeFileSync(path.join(dataDir, 'providers-config.json'), `${JSON.stringify({ providers: [provider], userProviderOrder: ['homelab'] }, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'provider-models.json'), `${JSON.stringify({ homelab_models: [model] }, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'model-usage.json'), `${JSON.stringify({ lastSelectedModelPair: { provider: 'homelab', modelId: model } }, null, 2)}\n`);
}

/** The app stores the SQLite database in the same config directory. */
function databasePath() {
  return path.join(dataDir, 'mychat.db');
}

function queryDatabase(sql) {
  const script = `
import json, sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
connection.row_factory = sqlite3.Row
try:
    rows = [dict(row) for row in connection.execute(sys.argv[2]).fetchall()]
finally:
    connection.close()
print(json.dumps(rows, ensure_ascii=False))
`;
  const output = execFileSync('python', ['-c', script, databasePath(), sql], { encoding: 'utf8' });
  return JSON.parse(output);
}

function seedWorkspace() {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'notes.txt'), [
    '会议纪要', '项目代号：HYDRA-77', '负责人：王工程师', '下一步：9 月完成线缆整改',
  ].join('\n'));
  fs.writeFileSync(path.join(workspace, 'docs', 'readme.md'), '# 运维手册\n\n备份窗口为每周日 02:00 到 04:00。\n');
  const lines = Array.from({ length: 400 }, (_, index) => `line-${index + 1}${index === 149 ? ' MARKER-150' : ''}`);
  fs.writeFileSync(path.join(workspace, 'long.txt'), `${lines.join('\n')}\n`);
}

/**
 * A previous run can leave its own instance behind, and two instances fight
 * over the WebView2 profile (the next session then fails with
 * "DevToolsActivePort file doesn't exist"). Only processes running this exact
 * binary are stopped, so a developer's own build is untouched.
 */
function killStrayInstances() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      // ForEach-Object keeps Stop-Process from prompting for -Id when there is
      // nothing to stop, which would block a non-interactive shell forever.
      `Get-Process chatless -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${appPath}' } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }`,
    ], { stdio: 'ignore' });
  } catch { /* nothing to clean up */ }
}

const flows = [];

/**
 * Answers with the assistant text the UI rendered, which is what the user sees.
 * The composer placeholder is the only stable "no model chosen" signal.
 */
async function pageState() {
  return execute(`
    const composer = document.querySelector('textarea');
    const messages = Array.from(document.querySelectorAll('[data-message-role], .message, [class*="message"]'))
      .map((n) => (n.textContent || '').trim())
      .filter(Boolean);
    return {
      url: location.href,
      composerPlaceholder: composer ? composer.placeholder : null,
      hasModel: !!(document.body.textContent || '').includes('选择模型'),
      body: (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 4000),
      messages: messages.slice(-6),
      stopped: /已停止|已取消/.test(document.body.textContent || ''),
    };
  `);
}

/** Waits until the page text contains every pattern. */
function waitForText(patterns, timeout = 120_000) {
  return waitFor(`text ${patterns.join('/')}`, async () => {
    const state = await pageState();
    const missed = patterns.filter((pattern) => !new RegExp(pattern).test(state.body));
    return missed.length ? false : state;
  }, { timeout, interval: 500 });
}

async function runFlow(name, body) {
  if (flowFilter.length && !flowFilter.includes(name)) return;
  const started = Date.now();
  const entry = { name, passed: false, ms: 0 };
  try {
    const detail = await body();
    entry.passed = true;
    if (detail) entry.detail = detail;
  } catch (error) {
    entry.failure = error instanceof Error ? error.message : String(error);
  }
  entry.ms = Date.now() - started;
  flows.push(entry);
  // eslint-disable-next-line no-console
  console.log(`${entry.passed ? 'PASS' : 'FAIL'} ${name} (${entry.ms}ms)${entry.failure ? ` - ${entry.failure}` : ''}`);
}

function writeReport(extra = {}) {
  const report = {
    generatedAt: new Date().toISOString(),
    app: appPath,
    dataDir,
    workspace,
    endpoint,
    model,
    flows,
    ...extra,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  // A watchdog, so a wedged driver still produces a report instead of hanging a
  // terminal for an hour.
  const watchdog = setTimeout(() => {
    console.error('watchdog: acceptance run exceeded its budget; writing a partial report');
    try { writeReport({ watchdog: true }); } catch { /* best effort */ }
    stopDriver();
    process.exit(1);
  }, Number(process.env.CHATLESS_E2E_BUDGET_MS || 20 * 60 * 1000));
  watchdog.unref?.();

  killStrayInstances();
  step('stray instances cleared');
  seedWorkspace();
  seedProviderConfig();
  step('workspace and provider config seeded');
  stopDriver();
  step('previous drivers stopped');
  await startDriver();
  step('tauri-driver started');
  await startSessionWithRetry();
  step('webdriver session created');
  try {
    // The session is created before the webview navigates, so the first state is
    // an empty about:blank page, and the server-rendered payload is present
    // before React mounts. Wait until the app actually rendered controls.
    const ready = await waitFor('webview content', async () => {
      const state = await execute(`
        const controls = document.querySelectorAll('button, textarea, [contenteditable="true"]').length;
        return {
          readyState: document.readyState,
          url: location.href,
          title: document.title,
          controls,
          hasComposer: !!document.querySelector('textarea, [contenteditable="true"]'),
        };
      `);
      const loaded = state && state.url && !state.url.startsWith('about:blank');
      // The composer is the app being ready for the user; the title bar buttons
      // arrive first and mean nothing on their own.
      return loaded && state.hasComposer ? state : false;
    }, { timeout: 120_000 });
    // eslint-disable-next-line no-console
    console.log(`webview ready: ${JSON.stringify(ready)}`);

    if (inspectOnly) {
      const summary = await domSummary();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await runFlow('model-selection', async () => ensureModelSelected());

    await runFlow('chat-send', async () => {
      const before = queryDatabase("SELECT COUNT(*) AS n FROM messages");
      await sendMessage('用一句话回答：2 加 2 等于几？不要调用工具。');
      // The answer must come from the assistant row the app stored, not from
      // whatever text happens to be on the page.
      const reply = await waitFor('assistant reply', async () => {
        const rows = queryDatabase(`SELECT id, role, status, content FROM messages
          WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1`);
        return rows.length && rows[0].content && /4/.test(rows[0].content) ? rows[0] : false;
      }, { timeout: 180_000, interval: 1000 });
      const userRows = queryDatabase("SELECT COUNT(*) AS n FROM messages WHERE role = 'user'");
      const duplicates = userRows[0].n - before[0].n;
      // "The current input is delivered exactly once" is a deterministic rule.
      if (duplicates !== 1) throw new Error(`the user message was stored ${duplicates} times`);
      return { replyStatus: reply.status, storedUserMessages: duplicates };
    });

    await runFlow('agent-writes-file', async () => {
      const target = path.join(workspace, 'e2e-note.txt');
      fs.rmSync(target, { force: true });
      await sendMessage(`在当前工作目录创建 e2e-note.txt，内容为 E2E-OK。`);
      await waitFor('file written', async () => (fs.existsSync(target) && fs.readFileSync(target, 'utf8').includes('E2E-OK') ? true : false), { timeout: 240_000, interval: 1000 });
      return { path: target };
    });

    await runFlow('agent-runs-shell', async () => {
      const before = queryDatabase("SELECT COUNT(*) AS n FROM agent_run_events WHERE event_type = 'tool_call_started'");
      await sendMessage('执行命令 echo e2e-shell-check，并告诉我输出。');
      const reply = await waitFor('shell answer', async () => {
        const rows = queryDatabase(`SELECT content, status FROM messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1`);
        return rows.length && /e2e-shell-check/.test(rows[0].content || '') ? rows[0] : false;
      }, { timeout: 240_000, interval: 1000 });
      const after = queryDatabase("SELECT COUNT(*) AS n FROM agent_run_events WHERE event_type = 'tool_call_started'");
      const events = queryDatabase("SELECT event_type, payload FROM agent_run_events ORDER BY seq DESC LIMIT 5");
      if (after[0].n <= before[0].n) throw new Error('no tool call was recorded for the shell task');
      return { replyStatus: reply.status, recordedToolStarts: after[0].n, recentEvents: events.map((e) => e.event_type) };
    });

    await runFlow('stop-a-running-task', async () => {
      await sendMessage('用 shell 运行一条会持续 30 秒的命令（例如 ping -n 30 127.0.0.1），把输出给我。');
      // Wait until the run is actually executing, then stop it.
      const run = await waitFor('running agent run', async () => {
        const rows = queryDatabase("SELECT id, status FROM agent_runs WHERE status IN ('running','waiting_approval') ORDER BY started_at DESC LIMIT 1");
        return rows.length ? rows[0] : false;
      }, { timeout: 120_000 });
      const stop = await waitFor('stop button', async () => {
        for (const label of ['停止', 'Stop']) {
          try { return await find('xpath', `//button[contains(@aria-label, '${label}') or contains(normalize-space(.), '${label}')]`); } catch { /* next */ }
        }
        throw new Error('no stop control');
      }, { timeout: 60_000 });
      const started = Date.now();
      await click(stop);
      const settled = await waitFor('run stopped', async () => {
        const rows = queryDatabase(`SELECT status, metadata FROM agent_runs WHERE id = '${run.id}'`);
        return rows.length && rows[0].status !== 'running' && rows[0].status !== 'waiting_approval' ? rows[0] : false;
      }, { timeout: 15_000, interval: 100 });
      const feedbackMs = Date.now() - started;
      if (feedbackMs > stopTargetMs * 10) throw new Error(`stop feedback took ${feedbackMs}ms`);
      if (/waiting_approval/.test(settled.status)) throw new Error('the run is still waiting');
      return { runId: run.id, settled, feedbackMs };
    });

    await runFlow('settings-shell-trust', async () => {
      const state = await pageState();
      // The activity record must exist for the shell calls above, which proves
      // the call really went through the app rather than the harness.
      const events = queryDatabase("SELECT COUNT(*) AS n FROM agent_run_events WHERE event_type = 'tool_call_started'");
      return { recordedToolStarts: events[0]?.n ?? 0, hasActivityUi: /运行命令|工具/.test(state.body) };
    });
  } finally {
    await endSession();
    stopDriver();
    killStrayInstances();
    writeReport();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  writeReport({ error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
