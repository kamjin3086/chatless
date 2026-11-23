import { formatDistanceToNow } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import type { Locale } from '@/i18n/types';

export function formatResourceReferenceTime(createdAt: string, locale: Locale): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;

  return formatDistanceToNow(date, { addSuffix: true, locale: locale === 'en' ? enUS : zhCN });
}
