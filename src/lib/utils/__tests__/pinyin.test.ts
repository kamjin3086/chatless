import { describe, expect, test } from 'vitest';
import {
  containsChinese,
  toPinyin,
  generateSafeId,
  validateProviderName,
} from '../pinyin';

describe('pinyin utils', () => {
  test('containsChinese detects CJK characters', () => {
    expect(containsChinese('Hello')).toBe(false);
    expect(containsChinese('你好')).toBe(true);
    expect(containsChinese('Hello 世界')).toBe(true);
  });

  test('toPinyin converts Chinese text', () => {
    expect(toPinyin('你好世界')).toContain('ni');
    expect(toPinyin('Hello 世界')).toContain('shi');
    expect(toPinyin('我的提供商')).toContain('wo');
  });

  test('generateSafeId produces stable ASCII ids', () => {
    expect(generateSafeId('我的提供商')).toMatch(/^[a-z0-9-]+$/);
    expect(generateSafeId('My Provider')).toBe('my-provider');
    expect(generateSafeId('测试-API')).toMatch(/^[a-z0-9-]+$/);
  });

  test('validateProviderName enforces basic rules', () => {
    expect(validateProviderName('我的提供商').isValid).toBe(true);
    expect(validateProviderName('MyProvider').isValid).toBe(true);
    expect(validateProviderName('测试@API').isValid).toBe(false);
    expect(validateProviderName('').isValid).toBe(false);
    expect(validateProviderName('a').isValid).toBe(false);
  });
});
