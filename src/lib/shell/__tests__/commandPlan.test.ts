import { describe, expect, it, vi } from 'vitest';
import { planCommand } from '../commandPlan';

describe('planCommand', () => {
  it('keeps a Windows command line intact for the interpreter', () => {
    const result = planCommand({
      command:
        '"C:\\Program Files\\node\\node.exe" "C:\\site with space\\server.js"',
      platform: 'windows',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.file).toBe('cmd.exe');
    // One argument, byte for byte: a backslash path must not be rewritten.
    expect(result.plan.args).toEqual([
      '/d',
      '/s',
      '/c',
      '"C:\\Program Files\\node\\node.exe" "C:\\site with space\\server.js"',
    ]);
    expect(result.plan.shell).toBe('cmd');
    expect(result.plan.autoSelected).toBe(true);
    // cmd must receive the line as one unescaped argument, or it hands the
    // program literal backslashes in place of quotes.
    expect(result.plan.verbatimLastArg).toBe(true);
  });

  it('runs the whole line through the explicitly requested interpreter', () => {
    const powershell = planCommand({
      command: 'Write-Output ready',
      shell: 'powershell',
      platform: 'windows',
    });
    expect(powershell.ok).toBe(true);
    if (powershell.ok) {
      expect(powershell.plan.file).toBe('powershell.exe');
      expect(powershell.plan.args).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Write-Output ready',
      ]);
      expect(powershell.plan.autoSelected).toBe(false);
      // PowerShell parses its own command line and handles escaped quotes, so it
      // must keep the default escaping.
      expect(powershell.plan.verbatimLastArg).toBeUndefined();
    }

    const bash = planCommand({
      command: 'echo ready',
      shell: 'bash',
      platform: 'linux',
    });
    expect(bash.ok).toBe(true);
    if (bash.ok) expect(bash.plan.args).toEqual(['-lc', 'echo ready']);
  });

  it('defaults to bash off Windows', () => {
    const result = planCommand({ command: 'npm run build', platform: 'linux' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.shell).toBe('bash');
  });

  it('reports an unusable shell as a structured failure', () => {
    const invalid = planCommand({ command: 'echo hi', shell: 'node' });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('SHELL_INVALID');

    const wrongPlatform = planCommand({
      command: 'echo hi',
      shell: 'bash',
      platform: 'windows',
    });
    expect(wrongPlatform.ok).toBe(false);
    if (!wrongPlatform.ok) expect(wrongPlatform.code).toBe('SHELL_UNSUPPORTED');

    const empty = planCommand({ command: '   ', platform: 'linux' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('INVALID_ARGUMENTS');
  });
});

describe('where the platform comes from', () => {
  it('does not let a user agent outrank the machine that will spawn the process', () => {
    // The acceptance harness announced a Windows user agent while running on Linux,
    // the plan picked cmd.exe, every shell task failed to start - and two of three runs
    // still "passed" because their check only looked at the answer text.
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0',
    });
    try {
      const result = planCommand({ command: 'echo hi' });
      expect(result.ok && result.plan.file).toBe(
        process.platform === 'win32' ? 'cmd.exe' : 'bash',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names only the platform in hand when a shell is missing there', () => {
    const linux = planCommand({
      command: 'echo hi',
      shell: 'cmd',
      platform: 'linux',
    });
    expect(linux.ok).toBe(false);
    if (linux.ok) return;
    expect(linux.message).toContain('Linux');
    expect(linux.message).not.toContain('Windows');
    expect(linux.message).toContain('"bash"');

    const windows = planCommand({
      command: 'dir',
      shell: 'bash',
      platform: 'windows',
    });
    expect(windows.ok).toBe(false);
    if (windows.ok) return;
    expect(windows.message).toContain('Windows');
    expect(windows.message).not.toMatch(/Linux|macOS/);
  });
});
