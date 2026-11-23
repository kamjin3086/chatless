import { translate } from '@/i18n';
import type { Locale } from '@/i18n/types';
import type { DocumentFileParseFailure } from '@/lib/documentParser';

export function documentAttachmentSizeLimit(
  locale: Locale,
  maxBytes: number,
): string {
  const size = Math.round(maxBytes / 1024 / 1024);
  return translate(locale, 'chatAttachment.documentSizeLimit').replace(
    '{size}',
    String(size),
  );
}

export function documentAttachmentErrorDescription(
  locale: Locale,
  failure: DocumentFileParseFailure,
): string {
  switch (failure.code) {
    case 'missing-file':
      return translate(locale, 'chatAttachment.documentMissing');
    case 'file-too-large':
      return documentAttachmentSizeLimit(locale, failure.maxBytes);
    case 'unsupported-file-type':
      return translate(
        locale,
        'chatAttachment.documentUnsupportedType',
      ).replace('{type}', () => failure.fileType);
    case 'timeout':
      return translate(locale, 'chatAttachment.documentParseTimeout');
    case 'parse-failed':
      return failure.diagnostic || translate(locale, 'error.unknown');
  }
}
