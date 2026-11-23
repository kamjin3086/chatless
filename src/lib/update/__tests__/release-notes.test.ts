import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { selectReleaseNotes } from '../release-notes';

function releaseBody(format: 'tag' | 'manual', version: string): string {
  return execFileSync(
    process.execPath,
    [
      'scripts/extract-changelog.mjs',
      '--version',
      version,
      '--path',
      'src/lib/update/__tests__/fixtures/CHANGELOG.md',
      '--format',
      format,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        VERSION: '',
        GITHUB_REPOSITORY: 'kamjin3086/chatless',
      },
    },
  );
}

const localizedBody = '## zh-CN\n\n中文\n\n## en-US\n\nEnglish\n';

describe('selectReleaseNotes', () => {
  it.each(['tag', 'manual'] as const)(
    'selects only the matching notes from the producer %s body',
    (format) => {
      const body = releaseBody(format, '0.8.3');
      expect(body).toContain('INSTALLATION_INSTRUCTIONS');
      expect(selectReleaseNotes(body, 'zh')).toBe(
        '#### 修复\n\n- 修复了工作区恢复问题。\n- 保留窗口大小。',
      );
      expect(selectReleaseNotes(body, 'en')).toBe(
        '#### Fixes\n\n- Fixed workspace recovery.\n- Kept the window size.',
      );
    },
  );

  it('preserves a producer legacy release body for both locales', () => {
    const body = releaseBody('tag', '0.8.2');
    expect(body).toContain('保留旧版发布说明。');
    expect(selectReleaseNotes(body, 'zh')).toBe(body);
    expect(selectReleaseNotes(body, 'en')).toBe(body);
  });

  it('accepts CRLF and ignores headings inside fenced examples', () => {
    const example = '~~~markdown\r\n## Not a section\r\n~~~';
    const body = `## zh-CN\r\n\r\n中文\r\n\r\n## en-US\r\n\r\nEnglish\r\n\r\n${example}\r\n`;
    expect(selectReleaseNotes(body, 'zh')).toBe('中文');
    expect(selectReleaseNotes(body, 'en')).toBe(`English\r\n\r\n${example}`);
  });

  it.each([
    ['missing locale', '  Legacy notes\r\n## zh-CN\r\n中文\r\n'],
    ['reversed locales', '## en-US\nEnglish\n\n## zh-CN\n中文\n'],
    ['duplicate locale', `## en-US\nFirst English block\n\n${localizedBody}`],
    ['empty locale', '## zh-CN\n\n## en-US\nEnglish\n'],
    ['comment-only locale', '## zh-CN\n中文\n\n## en-US\n<!-- draft -->\n'],
    ['non-exact heading', '## zh-cn\n中文\n\n## en-US\nEnglish\n'],
    [
      'heading after locale pair',
      `${localizedBody}\n## Downloads\nDownload the installer`,
    ],
    [
      'example, not headings',
      `Legacy notes\n\n\`\`\`markdown\n${localizedBody}\`\`\`\n`,
    ],
    ['commented-out headings', `Legacy notes\n\n<!--\n${localizedBody}-->\n`],
    ['unclosed fence', `${localizedBody}\n~~~markdown\n`],
    ['empty body', ''],
  ])('returns the complete original body for %s', (_label, body) => {
    expect(selectReleaseNotes(body, 'zh')).toBe(body);
    expect(selectReleaseNotes(body, 'en')).toBe(body);
  });
});
