import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkExitPaths,
  findAbruptExits,
  findMissingShutdownSteps,
} from '../check-exit-path.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** The shape lib.rs actually has today, in miniature. */
const SHUTDOWN_OK = `
match event {
    tauri::RunEvent::Exit => {}
    tauri::RunEvent::ExitRequested { code, .. } => {
        if code == Some(tauri::RESTART_EXIT_CODE) { RESTARTING.store(1, Ordering::SeqCst); }
    }
    _ => {}
}
if RESTARTING.load(Ordering::SeqCst) { return; }
app_handle.cleanup_before_exit();
unsafe { libc::_exit(EXIT_CODE.load(Ordering::Relaxed)) };
`;

describe('findAbruptExits', () => {
  it('flags the call that aborts in ONNX Runtime teardown', () => {
    const findings = findAbruptExits(
      '#[tauri::command]\nfn exit(app: AppHandle) {\n    std::process::exit(0);\n}\n',
      'src-tauri/src/lib.rs',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('src-tauri/src/lib.rs:3');
    expect(findings[0]).toContain('std::process::exit(0)');
  });

  it('flags abort, and the use-imported short form', () => {
    expect(findAbruptExits('    std::process::abort()\n', 'f.rs')).toHaveLength(
      1,
    );
    expect(findAbruptExits('use std::process::exit;\n', 'f.rs')).toHaveLength(
      1,
    );
  });

  it('leaves the sanctioned exit and unrelated names alone', () => {
    expect(
      findAbruptExits(
        '    unsafe { libc::_exit(code) };\n    store.write()?.exit();\n',
        'f.rs',
      ),
    ).toEqual([]);
  });

  it('reads a comment as prose, not as a call', () => {
    expect(
      findAbruptExits(
        '  // Not `std::process::exit(0)`, that aborts.\n',
        'f.rs',
      ),
    ).toEqual([]);
  });

  it('keeps code that follows a url in a string', () => {
    expect(
      findAbruptExits('    open("http://x"); std::process::exit(0);\n', 'f.rs'),
    ).toHaveLength(1);
  });
});

describe('findMissingShutdownSteps', () => {
  it('accepts a shutdown that waits, flushes and leaves via _exit', () => {
    expect(
      findMissingShutdownSteps(SHUTDOWN_OK, 'src-tauri/src/lib.rs'),
    ).toEqual([]);
  });

  it('names the half that went missing, and why it is needed', () => {
    const withoutExit = SHUTDOWN_OK.replace(
      /unsafe \{ libc::_exit\(.*\) \};/,
      'std::mem::forget(());',
    );
    const findings = findMissingShutdownSteps(withoutExit, 'lib.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('_exit');
    expect(findings[0]).toContain('__cxa_finalize');
  });

  it('does not let cleanup_before_exit() stand in for the _exit call', () => {
    // `cleanup_before_exit(` ends in `_exit(`, which is how this rule first passed a shutdown
    // that returned from main.
    const returnsInstead =
      'tauri::RunEvent::Exit => {}\napp.cleanup_before_exit();\n';
    const findings = findMissingShutdownSteps(returnsInstead, 'lib.rs');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('_exit');
  });

  it('does not let a comment satisfy the rule', () => {
    const commented =
      '// RunEvent::Exit calls cleanup_before_exit() and libc::_exit(0).\n';
    expect(findMissingShutdownSteps(commented, 'lib.rs')).toHaveLength(3);
  });
});

describe('checkExitPaths against the tree', () => {
  it('finds nothing in the Rust sources as they stand', () => {
    const { findings, scanned } = checkExitPaths([
      path.join(repoRoot, 'src-tauri/src'),
    ]);
    expect(scanned).toBeGreaterThan(30);
    expect(findings).toEqual([]);
  });
});
