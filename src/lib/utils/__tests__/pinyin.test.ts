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

  test('validateProviderName localizes errors without changing name or ID rules', () => {
    expect(validateProviderName('')).toEqual({
      isValid: false,
      error: '名称不能为空',
    });
    expect(validateProviderName('a', 'en')).toEqual({
      isValid: false,
      error: 'The name is too short',
      suggestion: 'Use at least 2 characters',
    });
    expect(validateProviderName('a'.repeat(25), 'en')).toMatchObject({
      isValid: false,
      error: 'The name is too long',
    });
    expect(validateProviderName('My Provider', 'en')).toMatchObject({
      isValid: false,
      error: 'The name contains unsupported characters',
    });
    expect(validateProviderName('我的提供商', 'en')).toEqual({ isValid: true });
    expect(generateSafeId('我的提供商')).toBe('wo-de-ti-gong-shang');
  });

  test('validateProviderName enforces basic rules', () => {
    expect(validateProviderName('我的提供商').isValid).toBe(true);
    expect(validateProviderName('MyProvider').isValid).toBe(true);
    expect(validateProviderName('测试@API').isValid).toBe(false);
    expect(validateProviderName('').isValid).toBe(false);
    expect(validateProviderName('a').isValid).toBe(false);
  });
});
