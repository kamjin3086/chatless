import { describe, expect, test } from 'vitest';
import {
  buildSafePhysicalFileName,
  truncateDisplayName,
  validatePathLength,
} from '../safeFileName';

describe('safeFileName', () => {
  test('长文件名会被截断并保留扩展名', () => {
    const longName = 'a'.repeat(300) + '.pdf';
    const physical = buildSafePhysicalFileName(longName, 'test-id');
    expect(physical.endsWith('.pdf')).toBe(true);
    expect(physical.length).toBeLessThan(220);
  });

  test('超长路径返回错误', () => {
    const result = validatePathLength('x'.repeat(300));
    expect(result.ok).toBe(false);
  });

  test('展示名截断保留扩展名', () => {
    const name = 'x'.repeat(80) + '.markdown';
    const shown = truncateDisplayName(name, 40);
    expect(shown).toContain('.markdown');
    expect(shown.length).toBeLessThanOrEqual(40);
  });
});
