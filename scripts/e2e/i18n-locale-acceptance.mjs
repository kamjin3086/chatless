#!/usr/bin/env node
/**
 * Interface-language acceptance run.
 *
 * Drives a packaged desktop build through WebDriver and checks the parts of the
 * bilingual interface a unit test cannot reach: the live switch, the document
 * language, every reachable route and settings tab after the switch, and the
 * choice surviving a restart.
 *
 * Required environment:
 *   CHATLESS_E2E_APP          absolute path to an isolated build (never target/debug of a
 *                             developer build; this script only reads it)
 * Optional:
 *   CHATLESS_E2E_DRIVER_URL   default http://127.0.0.1:4444 (tauri-driver)
 *   CHATLESS_E2E_REPORT       JSON report path, default $TMPDIR/i18n-locale-report.json
 *   CHATLESS_E2E_SHOTS        directory for screenshots, default $TMPDIR/i18n-locale-shots
 *
 * On Linux run it under a display the test owns, with an isolated profile:
 *   Xvfb :98 -screen 0 1440x900x24 &
 *   DISPLAY=:98 XDG_DATA_HOME=/tmp/i18n-accept/profile tauri-driver --port 4444 &
 *   CHATLESS_E2E_APP=/tmp/i18n-accept/runtime/target/debug/chatless node scripts/e2e/i18n-locale-acceptance.mjs
 *
 * Two mechanics are deliberate and are not weaknesses of the app:
 *   - The language control is a native <select>. A GTK popup cannot be driven by
 *     W3C WebDriver, so the change event is dispatched with the native value
 *     setter, which is what a real selection produces.
 *   - Chinese seen inside a knowledge base is seeded sample data (user content)
 *     and model names are identifiers, so they are reported but not failures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appPath = process.env.CHATLESS_E2E_APP;
if (!appPath || !fs.existsSync(appPath)) {
  throw new Error('CHATLESS_E2E_APP must point at an existing isolated build');
}
const driverUrl = (
  process.env.CHATLESS_E2E_DRIVER_URL || 'http://127.0.0.1:4444'
).replace(/\/$/, '');
const reportPath =
  process.env.CHATLESS_E2E_REPORT ||
  path.join(os.tmpdir(), 'i18n-locale-report.json');
const shotsDir =
  process.env.CHATLESS_E2E_SHOTS || path.join(os.tmpdir(), 'i18n-locale-shots');

const ROUTES = [
  '/chat',
  '/prompts',
  '/knowledge',
  '/extensions',
  '/analytics',
  '/settings',
  '/resources',
  '/history',
  '/skills',
];
const TABS = [
  'General',
  'AI Models',
  'Knowledge Base',
  'Sync',
  'Web Search',
  'Security',
  'Advanced',
  'About',
];
/** Identifiers, not interface copy: a model name keeps its own characters. */
const ALLOWED_CJK = new Set(['中文']);
const CJK = /[\u4e00-\u9fff]+/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`,
  );
}

async function wd(method, endpoint, body) {
  const res = await fetch(driverUrl + endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.value?.error) {
    throw new Error(
      `${method} ${endpoint} -> ${JSON.stringify(json.value?.error || res.statusText)}`,
    );
  }
  return json.value;
}

const evaluate = (session, script) =>
  wd('POST', `/session/${session}/execute/sync`, { script, args: [] });

/**
 * Visible copy of the page, without the update toast: that toast renders a
 * published release body, which is data rather than interface text.
 */
const pageText = (session) =>
  evaluate(
    session,
    `
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('[data-sonner-toast], [data-sonner-toaster], .sonner-toaster').forEach((n) => n.remove());
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px';
  holder.appendChild(clone);
  document.documentElement.appendChild(holder);
  const text = clone.innerText || '';
  holder.remove();
  return text;
`,
  );

/** Closes notifications only: the action button would start an update install. */
async function dismissToasts(session) {
  await evaluate(
    session,
    `
    document.querySelectorAll('[data-sonner-toast] [data-close-button], [data-sonner-toast] button[aria-label*="Close"], [data-sonner-toast] button[aria-label*="关闭"]')
      .forEach((button) => button.click());
    return true;
  `,
  );
  await sleep(400);
}

/** The startup update prompt is modal, so it has to be closed before any click. */
async function dismissUpdateDialog(session) {
  const closed = await evaluate(
    session,
    `
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return 'none';
    const button = Array.from(dialog.querySelectorAll('button'))
      .find((el) => /Skip this version|跳过此版本|^×$|Close|关闭/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()));
    if (!button) return 'no-button';
    button.click();
    return 'closed';
  `,
  ).catch(() => 'error');
  await sleep(700);
  return closed;
}

async function newSession() {
  const value = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: { 'tauri:options': { application: appPath } },
    },
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      value.sessionId,
      'return document.querySelectorAll("a[href]").length > 0',
    ).catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  await dismissToasts(value.sessionId);
  await dismissUpdateDialog(value.sessionId);
  return value.sessionId;
}

const documentLang = (session) =>
  evaluate(session, 'return document.documentElement.lang');

async function navigate(session, route) {
  await evaluate(
    session,
    `document.querySelector('a[href="${route}"]')?.click(); return true;`,
  );
  await sleep(1600);
}

async function clickLabel(session, label) {
  return evaluate(
    session,
    `
    const target = Array.from(document.querySelectorAll('button,[role="tab"],a'))
      .find((el) => (el.innerText || '').trim() === ${JSON.stringify(label)}
        || (el.innerText || '').trim().startsWith(${JSON.stringify(label)}));
    if (!target) return false;
    target.click();
    return true;
  `,
  );
}

/** Waits until the settings route has rendered, so a slow first paint after a restart
 * does not turn into a missing-label failure. */
async function openSettings(session) {
  await dismissUpdateDialog(session);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      session,
      `
      const link = document.querySelector('a[href="/settings"]');
      if (!link) return false;
      if (!document.querySelector('select')) link.click();
      return !!document.querySelector('select');
    `,
    ).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

async function switchLanguage(session, value) {
  // Retries: right after a restart the settings route can still be hydrating.
  const deadline = Date.now() + 20_000;
  let applied = 'not-found';
  while (Date.now() < deadline) {
    await openSettings(session);
    // The app remembers the last settings tab, and only General holds the language row.
    await clickLabel(session, 'General');
    await clickLabel(session, '常规');
    await sleep(900);
    applied = await evaluate(
      session,
      `
      const labels = Array.from(document.querySelectorAll('label'))
        .filter((label) => /界面语言|language/i.test((label.innerText || '').trim()));
      if (!labels.length) return 'no-language-label';
      let select = document.getElementById(labels[0].getAttribute('for'));
      if (!select) {
        const card = labels[0].closest('div[class*="space-y"]')?.parentElement || labels[0].parentElement;
        select = card?.querySelector('select');
      }
      if (!select) return 'no-select';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    `,
    );
    if (applied === value) break;
    await sleep(700);
  }
  await sleep(900);
  return applied;
}

/**
 * Names of the documents the user stored, read from the isolated profile. The
 * knowledge list renders these verbatim, so Chinese in them is data, not copy.
 */
function storedFileNames() {
  const dataHome =
    process.env.CHATLESS_E2E_DATA_DIR || process.env.XDG_DATA_HOME;
  if (!dataHome) return [];
  const file = path.join(dataHome, 'com.kamjin.chatless', 'unified-files.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
    return items
      .filter((item) => item && typeof item === 'object')
      .map((item) => String(item.name ?? item.fileName ?? item.filePath ?? ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function chineseIn(body) {
  return [...new Set(body.match(CJK) || [])].filter(
    (run) => !ALLOWED_CJK.has(run),
  );
}

async function screenshot(session, name) {
  fs.mkdirSync(shotsDir, { recursive: true });
  const data = await wd('GET', `/session/${session}/screenshot`);
  fs.writeFileSync(
    path.join(shotsDir, `${name}.png`),
    Buffer.from(data, 'base64'),
  );
}

async function main() {
  const sweep = [];
  let session = await newSession();

  check(
    'fresh install starts in Chinese',
    (await documentLang(session)) === 'zh-CN',
    `lang=${await documentLang(session)}`,
  );

  const applied = await switchLanguage(session, 'en');
  check(
    'language switch applies without a reload',
    (await documentLang(session)) === 'en-US',
    `select=${applied} lang=${await documentLang(session)}`,
  );
  const settings = await pageText(session);
  check(
    'open settings page updates in place',
    /Basic options|Interface language/i.test(settings) &&
      !/基础选项|界面语言/.test(settings),
  );
  await screenshot(session, 'settings-en');

  // Stored document names keep whatever the user saved, so the knowledge list is
  // compared against the stored file list instead of against "no Chinese at all".
  const storedNames = storedFileNames();
  for (const route of ROUTES) {
    await navigate(session, route);
    const chinese = chineseIn(await pageText(session));
    const storedData =
      route === '/knowledge'
        ? chinese.filter((run) =>
            storedNames.some(
              (name) => name.includes(run) || run.includes(name),
            ),
          )
        : [];
    const interfaceCopy = chinese.filter((run) => !storedData.includes(run));
    sweep.push({ scope: route, chinese, storedData });
    check(
      route === '/knowledge'
        ? 'knowledge list shows only stored document names in Chinese'
        : `route ${route} has no Chinese interface copy`,
      interfaceCopy.length === 0,
      interfaceCopy.length
        ? interfaceCopy.slice(0, 6).join(' | ')
        : `${storedData.length} stored names`,
    );
  }

  await navigate(session, '/settings');
  for (const tab of TABS) {
    if (!(await clickLabel(session, tab))) {
      check(`settings tab "${tab}" reachable`, false, 'no sidebar entry');
      continue;
    }
    await sleep(1600);
    const chinese = chineseIn(await pageText(session));
    sweep.push({ scope: `settings:${tab}`, chinese });
    check(
      `settings tab "${tab}" has no Chinese interface copy`,
      chinese.length === 0,
      chinese.slice(0, 6).join(' | '),
    );
  }
  await screenshot(session, 'settings-tab-en');

  check(
    'language choice still applied after visiting every page',
    (await documentLang(session)) === 'en-US',
  );

  await wd('DELETE', `/session/${session}`).catch(() => {});
  await sleep(1500);
  session = await newSession();
  check(
    'restart keeps the chosen language',
    (await documentLang(session)) === 'en-US',
    `lang=${await documentLang(session)}`,
  );

  const back = await switchLanguage(session, 'zh');
  check(
    'switching back to Chinese applies',
    (await documentLang(session)) === 'zh-CN',
    `select=${back} lang=${await documentLang(session)}`,
  );
  await wd('DELETE', `/session/${session}`).catch(() => {});

  const failed = results.filter((result) => !result.passed);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        app: appPath,
        driver: driverUrl,
        results,
        sweep,
        screenshots: shotsDir,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed — report ${reportPath}`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('acceptance run failed:', error.message);
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify({ error: error.message, results }, null, 2)}\n`,
  );
  process.exit(1);
});
