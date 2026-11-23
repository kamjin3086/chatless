import { getHtmlLang, translate } from '@/i18n';
import type { Locale } from '@/i18n/types';

export function formatKnowledgeDocumentCount(
  locale: Locale,
  count: number,
): string {
  const key =
    count === 1
      ? 'knowledge.documentCount.one'
      : 'knowledge.documentCount.other';
  return translate(locale, key).replace(
    '{0}',
    count.toLocaleString(getHtmlLang(locale)),
  );
}
