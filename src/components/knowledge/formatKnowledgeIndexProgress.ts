import { getHtmlLang, translate } from '@/i18n';
import type { Locale } from '@/i18n/types';
import type { KnowledgeIndexProgress } from '@/lib/knowledgeService';

export function formatKnowledgeChunkCount(locale: Locale, count: number): string {
  const key = count === 1 ? 'knowledge.resource.chunkCount.one' : 'knowledge.resource.chunkCount.other';
  return translate(locale, key).replace('{0}', count.toLocaleString(getHtmlLang(locale)));
}

export function formatKnowledgeIndexProgress(locale: Locale, update: KnowledgeIndexProgress): string {
  const label = translate(locale, `knowledge.index.${update.stage}`);
  switch (update.stage) {
    case 'complete':
      return label.replace('{0}', formatKnowledgeChunkCount(locale, update.chunks));
    case 'preparingRebuild':
      return label
        .replace('{current}', update.current.toLocaleString(getHtmlLang(locale)))
        .replace('{total}', update.total.toLocaleString(getHtmlLang(locale)));
    default:
      return label;
  }
}
