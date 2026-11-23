import { getHtmlLang, translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import type { SyncDataType } from '@/lib/sync/core/types';
import type { SyncHistoryEntry } from '@/store/webDavSyncStore';

export function formatWebDavSyncText(
  locale: Locale,
  key: TranslationKey,
  values: Record<string, string>,
): string {
  return translate(locale, key).replace(
    /\{(\w+)\}/g,
    (token, name) => values[name] ?? token,
  );
}

export function formatWebDavSyncDataTypes(
  locale: Locale,
  types: SyncDataType[],
): string {
  const labels = types.map((type) => {
    const key = `settings.sync.dataTypes.${type}` as const;
    const label = translate(locale, key);
    return label === key ? type : label;
  });
  return new Intl.ListFormat(getHtmlLang(locale), { style: 'narrow' }).format(
    labels,
  );
}

export function formatWebDavSyncSummary(
  locale: Locale,
  entry: SyncHistoryEntry,
): string {
  if (entry.error) {
    return formatWebDavSyncText(locale, 'settings.sync.summary.failed', {
      detail: entry.error,
    });
  }
  // Older entries may have only a summary. Do not parse or rewrite persisted diagnostics.
  if (
    !Array.isArray(entry.dataTypes) ||
    !Number.isFinite(entry.pushed) ||
    !Number.isFinite(entry.pulled)
  ) {
    return entry.summary;
  }
  const numberFormat = new Intl.NumberFormat(getHtmlLang(locale));
  const key = entry.dataTypes.length
    ? 'settings.sync.summary.completeWithTypes'
    : 'settings.sync.summary.complete';
  return formatWebDavSyncText(locale, key, {
    types: formatWebDavSyncDataTypes(locale, entry.dataTypes),
    pushed: numberFormat.format(entry.pushed),
    pulled: numberFormat.format(entry.pulled),
  });
}

export function formatWebDavSyncTime(
  locale: Locale,
  timestamp: number,
): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return translate(locale, 'settings.sync.justNow');

  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const lang = getHtmlLang(locale);
  if (days < 7) {
    const relativeTime = new Intl.RelativeTimeFormat(lang);
    if (hours < 1) return relativeTime.format(-minutes, 'minute');
    if (days < 1) return relativeTime.format(-hours, 'hour');
    return relativeTime.format(-days, 'day');
  }
  return new Date(timestamp).toLocaleDateString(lang);
}
