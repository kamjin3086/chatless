'use client';

import { selectReleaseNotes } from '@/lib/update/release-notes';
import { useLocaleStore } from '@/store/localeStore';

const MAX_PREVIEW_LENGTH = 400;

export function UpdateNotesPreview({ body }: { body?: string }) {
  const locale = useLocaleStore((state) => state.locale);
  const notes = body ? selectReleaseNotes(body, locale).trim() : '';
  if (!notes) return null;

  const preview =
    notes.length > MAX_PREVIEW_LENGTH
      ? `${notes
          .slice(0, MAX_PREVIEW_LENGTH)
          .replace(/[\uD800-\uDBFF]$/, '')
          .trimEnd()}…`
      : notes;
  return (
    <div className="mt-1 line-clamp-4 whitespace-pre-line text-[11px] [overflow-wrap:anywhere]">
      {preview}
    </div>
  );
}
