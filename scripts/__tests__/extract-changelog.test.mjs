import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const extractor = fileURLToPath(
  new URL('../extract-changelog.mjs', import.meta.url),
);
const localizedNotes = `## zh-CN

#### 修复
- 工作区恢复后会显示正确的名称。

## en-US

#### Fixes
- Restored workspaces show the correct name.
`;
const bilingualEntry = `### en-US

#### Fixes
- Restored workspaces show the correct name.

### zh-CN

#### 修复
- 工作区恢复后会显示正确的名称。`;
const legacyEntry = '### 修复\n- 原有发布说明。';
const validChangelog = `# 更新日志\n\n## [0.8.3] - 2026-11-21\n\n${bilingualEntry}\n\n## [0.8.2]\n\n${legacyEntry}\n`;
let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'chatless-release-notes-'));
  writeFileSync(join(cwd, 'CHANGELOG.md'), validChangelog);
});

afterEach(() => rmSync(cwd, { force: true, recursive: true }));

function run(version, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [extractor, '--version', version, ...args],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        VERSION: '',
        GITHUB_REPOSITORY: 'fixture/chatless',
        ...env,
      },
    },
  );
}

function expectFailure(result, message) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(message);
}

describe('extract-changelog managed versions', () => {
  it('extracts only the exact matching release, handles CRLF, and emits stable locale headings', () => {
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      validChangelog.replaceAll('\n', '\r\n'),
    );
    const result = run('v0.8.3');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(localizedNotes);
  });

  it('requires bilingual notes for a prerelease above the cutoff and matches the full version', () => {
    expectFailure(run('0.8.3-rc.1'), 'Missing release heading ## [0.8.3-rc.1]');
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      validChangelog.replace('[0.8.3]', '[0.8.3-rc.1+test.2]'),
    );
    expect(run('0.8.3-rc.1+test.2').stdout).toBe(localizedNotes);
  });

  it.each([
    ['missing locale', '### zh-CN\n中文', 'Missing ### en-US section'],
    [
      'empty locale',
      '### zh-CN\n中文\n### en-US\n\n <!-- draft -->',
      'Empty ### en-US section',
    ],
    [
      'duplicate locale',
      `${bilingualEntry}\n### en-US\nAgain`,
      'Duplicate ### en-US section',
    ],
    [
      'unsupported locale',
      `${bilingualEntry}\n### fr-FR\nFrançais`,
      'Unexpected heading: ### fr-FR',
    ],
    [
      'wrong heading level',
      '## zh-CN\n中文\n### en-US\nEnglish',
      'Unexpected heading: ## zh-CN',
    ],
    [
      'unscoped notes',
      `Unscoped notes\n${bilingualEntry}`,
      'Release notes must begin with a locale heading',
    ],
    [
      'unclosed code fence',
      `${bilingualEntry}\n\`\`\`md`,
      'Unclosed code fence',
    ],
    ['unclosed comment', `${bilingualEntry}\n<!--`, 'Unclosed HTML comment'],
  ])('fails closed for %s, even with a fallback', (_name, content, error) => {
    writeFileSync(join(cwd, 'CHANGELOG.md'), `## [0.8.3]\n${content}\n`);
    expectFailure(run('0.8.3', ['--fallback', 'must not be used']), error);
  });

  it('rejects duplicate matching release entries', () => {
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      `${validChangelog}\n## [0.8.3]\n${bilingualEntry}`,
    );
    expectFailure(run('0.8.3'), 'Duplicate release heading ## [0.8.3]');
  });

  it('rejects a missing changelog file rather than publishing a generic note', () => {
    expectFailure(run('0.8.3', ['--path', 'missing.md']), 'missing.md');
  });

  it('preserves code blocks without treating Markdown examples as sections', () => {
    const code = '```markdown\n## [0.8.3]\n### zh-CN\n```';
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      `## [0.8.3]\n### zh-CN\n    Indented code\n${code}\n### en-US\nEnglish\n`,
    );
    const result = run('0.8.3');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `## zh-CN\n\n    Indented code\n${code}\n\n## en-US\n\nEnglish\n`,
    );
  });
});

describe('extract-changelog legacy versions', () => {
  it('keeps single-language notes and existing heading variants', () => {
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      `## v0.8.2\n${legacyEntry}\n## [0.7.4]\nOther notes\n`,
    );
    expect(run('0.8.2').stdout).toBe(`${legacyEntry}\n`);
  });

  it.each(['0.8.1', '0.8.2-rc.1', '0.8.2+metadata'])(
    'keeps the legacy fallback for %s',
    (version) => {
      const result = run(version, ['--fallback', 'legacy fallback']);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('legacy fallback\n');
    },
  );
});

describe('GitHub Release bodies', () => {
  it('ends the tagged release body with both locale sections after the download and installation material', () => {
    const result = run('ignored', ['--format', 'tag'], { VERSION: 'v0.8.3' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'https://github.com/fixture/chatless/releases/download/v0.8.3/Chatless_0.8.3_x64-setup.exe',
    );
    expect(result.stdout).toContain('## 安装说明');
    expect(result.stdout).toContain('## Installation');
    expect(result.stdout).toContain('```bash\n   sudo xattr');
    expect(result.stdout.match(/^## (zh-CN|en-US)$/gm)).toEqual([
      '## zh-CN',
      '## en-US',
    ]);
    expect(result.stdout.endsWith(localizedNotes)).toBe(true);
  });

  it('keeps the tagged release body in the legacy single-language shape at the cutoff', () => {
    const result = run('v0.8.2', ['--format', 'tag']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('## 安装说明');
    expect(result.stdout).not.toContain('## Installation');
    expect(result.stdout.endsWith(`## 更新内容\n\n${legacyEntry}\n`)).toBe(
      true,
    );
  });

  it('requires structured notes for manual releases and retains install guidance for selected platforms', () => {
    const env = {
      LEGACY_RELEASE_NOTES:
        'Freeform input must not override a managed release.',
    };
    expectFailure(
      run('0.8.4', ['--format', 'manual'], env),
      'Missing release heading ## [0.8.4]',
    );
    const result = run('0.8.3', ['--format', 'manual'], env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Assets below');
    expect(result.stdout).toContain('/blob/main/INSTALLATION_INSTRUCTIONS.md');
    expect(result.stdout).toContain(
      '/blob/main/INSTALLATION_INSTRUCTIONS_EN.md',
    );
    expect(result.stdout).not.toContain('/releases/download/');
    expect(result.stdout).not.toContain(env.LEGACY_RELEASE_NOTES);
    expect(result.stdout.endsWith(localizedNotes)).toBe(true);
  });

  it('passes through the historical manual input without consulting the changelog', () => {
    const legacyNotes = 'Custom legacy notes\n\n- Markdown with `code`.';
    const result = run(
      '0.8.2',
      ['--format', 'manual', '--path', 'missing.md'],
      { LEGACY_RELEASE_NOTES: legacyNotes },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(legacyNotes);
  });

  it('aborts the local release command before touching version files when managed notes are invalid', () => {
    const scripts = join(cwd, 'scripts');
    mkdirSync(scripts);
    copyFileSync(extractor, join(scripts, 'extract-changelog.mjs'));
    copyFileSync(
      new URL('../release.mjs', import.meta.url),
      join(scripts, 'release.mjs'),
    );
    writeFileSync(
      join(scripts, 'set-version.mjs'),
      "import { writeFileSync } from 'node:fs'; writeFileSync('unexpected-write', 'version'); process.exit(1);",
    );
    const result = spawnSync(
      process.execPath,
      ['scripts/release.mjs', '0.8.4'],
      { cwd, encoding: 'utf8' },
    );
    expectFailure(result, 'Missing release heading ## [0.8.4]');
    expect(existsSync(join(cwd, 'unexpected-write'))).toBe(false);
  });
});
