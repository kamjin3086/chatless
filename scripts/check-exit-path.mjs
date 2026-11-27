#!/usr/bin/env node
/**
 * Refuse a Rust exit path that walks back into the ONNX Runtime teardown.
 *
 * `std::process::exit` inside a Tauri command kills the process from the command's thread, so the
 * event loop's own exit never runs; and returning from `main` runs the C++ static destructors of
 * the dynamically loaded ONNX Runtime while its own threads are still locking what those
 * destructors destroy. The libc++ `system_error` that follows cannot cross Rust frames, so a
 * normal quit ended in SIGABRT and macOS reported "Chatless quit unexpectedly" - every single
 * time, with data already saved, which is what made it survive a release. `docs/macos-exit-crash.md`
 * carries the mechanism; `RunEvent::Exit` plus `libc::_exit` is what replaced it.
 *
 * Two claims, because banning the call alone would let the sanctioned path rot:
 *
 *   1. no `std::process::exit` / `std::process::abort` in the Rust sources;
 *   2. the shutdown in `src-tauri/src/lib.rs` still waits for `RunEvent::Exit`, still calls
 *      `cleanup_before_exit()`, and still leaves through `_exit`.
 *
 * Nothing else would catch either one: both regressions compile on every platform, and the crash
 * only exists on a macOS build.
 *
 * Usage:  node scripts/check-exit-path.mjs [path…]   default: src-tauri/src, src-tauri/examples
 * Exit 0 clean, 1 a finding (the author's to fix), 2 the check could not run.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TARGETS = ['src-tauri/src', 'src-tauri/examples'];
const LIB_RS = 'src-tauri/src/lib.rs';

/** `std::process::exit(..)`, `std::process::abort()`, and the `use`-imported short forms. */
const FORBIDDEN =
  /\bstd::process::(exit|abort)\s*\(|^\s*use\s+std::process::(exit|abort)\b/;

/** What the sanctioned shutdown in lib.rs has to keep doing, and why each half matters. */
const SHUTDOWN_REQUIREMENTS = [
  {
    pattern: /RunEvent::Exit\b/,
    why: 'the only exit event that fires for every way out (last window, dock Quit, AppHandle::exit)',
  },
  {
    pattern: /cleanup_before_exit\s*\(\s*\)/,
    why: 'flushes the settings stores and drops the tray icon on the event loop thread',
  },
  {
    // Not preceded by an identifier character: `cleanup_before_exit(` ends in `_exit(` too,
    // and a gate that counted it would pass a shutdown that returns from main instead of leaving.
    pattern: /(?<![A-Za-z0-9_])_exit\s*\(/,
    why: 'leaves without __cxa_finalize, which is what keeps ONNX Runtime destructors off the path',
  },
];

/** @param {string} dir directory to walk for `.rs` files */
function listRustFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRustFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.rs')) out.push(full);
  }
  return out;
}

/**
 * Drop `//` comment tails without touching quoted strings.
 *
 * Prose about the API is where a mention of `std::process::exit` lives these days - lib.rs explains
 * in a comment why it does not call it - and a comment is not a call. Quote-aware so
 * `"http://x"` does not eat the code after it.
 *
 * @param {string} line @returns {string}
 */
function stripLineComments(line) {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * Lines that leave the process abruptly.
 *
 * @param {string} text file content
 * @param {string} file path to report
 * @returns {string[]} findings, empty when the file is clean
 */
export function findAbruptExits(text, file) {
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: stripLineComments(line) }))
    .filter(({ text: t }) => FORBIDDEN.test(t))
    .map(({ line, text: t }) => `${file}:${line}: ${t.trim()}`);
}

/**
 * What the sanctioned shutdown must still contain.
 *
 * @param {string} text content of `src-tauri/src/lib.rs`
 * @param {string} file path to report
 * @returns {string[]} findings, empty when the shutdown path is intact
 */
export function findMissingShutdownSteps(text, file) {
  const stripped = text.replace(/^\s*\/\/\/?.*$/gm, '');
  return SHUTDOWN_REQUIREMENTS.filter(
    ({ pattern }) => !pattern.test(stripped),
  ).map(({ pattern, why }) => `${file}: missing ${String(pattern)} (${why})`);
}

/** @param {string[]} targets files and directories to check @returns {{findings: string[], scanned: number}} */
export function checkExitPaths(targets) {
  const findings = [];
  let scanned = 0;
  for (const target of targets) {
    const stat = fs.statSync(target);
    const files = stat.isDirectory() ? listRustFiles(target) : [target];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      scanned += 1;
      findings.push(...findAbruptExits(text, file));
      if (path.resolve(file) === path.resolve(LIB_RS)) {
        findings.push(...findMissingShutdownSteps(text, file));
      }
    }
  }
  return { findings, scanned };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const targets =
    process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TARGETS;
  const missing = targets.filter((t) => !fs.existsSync(t));
  if (missing.length > 0) {
    console.error(
      `check-exit-path: cannot run, no such path: ${missing.join(', ')}`,
    );
    process.exit(2);
  }
  try {
    const { findings, scanned } = checkExitPaths(targets);
    if (findings.length > 0) {
      console.error(
        `check-exit-path: ${findings.length} problem(s) in ${scanned} file(s):\n  ` +
          findings.join('\n  ') +
          '\nLeave through RunEvent::Exit and libc::_exit instead; see docs/macos-exit-crash.md.',
      );
      process.exit(1);
    }
    console.log(
      `check-exit-path: ${scanned} file(s) clean - no std::process::exit, shutdown intact`,
    );
  } catch (error) {
    console.error(`check-exit-path: could not run: ${error.message}`);
    process.exit(2);
  }
}
