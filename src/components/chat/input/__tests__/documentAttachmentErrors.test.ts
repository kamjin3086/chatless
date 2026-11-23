import { describe, expect, it } from 'vitest';
import {
  documentAttachmentErrorDescription,
  documentAttachmentSizeLimit,
} from '../documentAttachmentErrors';

const limit = 20 * 1024 * 1024;

describe('document attachment error copy', () => {
  it('localizes first-party failures and preserves dynamic values in both locales', () => {
    expect(documentAttachmentSizeLimit('en', limit)).toBe(
      'The limit is 20 MB. Split the document and try again.',
    );
    expect(documentAttachmentSizeLimit('zh', limit)).toBe(
      '当前限制为 20MB，请拆分后再试',
    );
    expect(
      documentAttachmentErrorDescription('en', {
        code: 'file-too-large',
        maxBytes: limit,
      }),
    ).toBe(documentAttachmentSizeLimit('en', limit));
    expect(
      documentAttachmentErrorDescription('en', {
        code: 'unsupported-file-type',
        fileType: 'rtf',
      }),
    ).toBe('Unsupported file type: rtf');
    expect(
      documentAttachmentErrorDescription('zh', {
        code: 'unsupported-file-type',
        fileType: 'rtf',
      }),
    ).toBe('不支持的文件类型：rtf');
    expect(documentAttachmentErrorDescription('en', { code: 'timeout' })).toBe(
      'Document parsing timed out. Try again.',
    );
    expect(documentAttachmentErrorDescription('zh', { code: 'timeout' })).toBe(
      '解析文档超时，请稍后重试',
    );
  });

  it('does not translate diagnostic text and localizes the missing diagnostic fallback', () => {
    const diagnostic = '输入文件损坏 or wrong format';
    for (const locale of ['en', 'zh'] as const) {
      expect(
        documentAttachmentErrorDescription(locale, {
          code: 'parse-failed',
          diagnostic,
        }),
      ).toBe(diagnostic);
    }
    expect(
      documentAttachmentErrorDescription('en', { code: 'parse-failed' }),
    ).toBe('Unknown error');
    expect(
      documentAttachmentErrorDescription('zh', { code: 'parse-failed' }),
    ).toBe('未知错误');
  });
});
