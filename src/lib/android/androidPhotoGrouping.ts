import type {
  AndroidPhotoBatchInventory,
  AndroidPhotoBatchOmission,
} from './androidPhotoBatch';

/** Reported groups stay readable in chat even if a selection is larger. */
export const ANDROID_PHOTO_BATCH_LIMIT = 20;

// Android vendors name screenshots differently, and the user may pick any of
// them. A bare "screen" is ordinary photo naming, so it is not a signal.
const SCREENSHOT_NAME =
  /(?:^|[^a-z])(?:screenshot|screen[ _-]?shot|screen[ _-]?capture)|截屏|截图|截圖|スクリーンショット|스크린샷|bildschirmfoto/i;

export type AndroidPhotoSignal = 'duplicate' | 'screenshot';

export type AndroidPhotoGroupItem = { handle: string; name: string };

export type AndroidPhotoSignalGroup = {
  signal: AndroidPhotoSignal;
  label: string;
  items: AndroidPhotoGroupItem[];
};

export type AndroidPhotoGrouping = {
  count: number;
  groups: AndroidPhotoSignalGroup[];
  ungrouped: AndroidPhotoGroupItem[];
  omissions: AndroidPhotoBatchOmission[];
};

type ReadyBatch = Extract<AndroidPhotoBatchInventory, { status: 'ready' }>;

function groupItem(item: ReadyBatch['items'][number]): AndroidPhotoGroupItem {
  return { handle: item.handle, name: item.name };
}

/**
 * Local grouping for the photos the user selected in this chat. Identical
 * content is the only duplicate claim made; a file name is the only screenshot
 * claim made. Everything else is reported as ungrouped or as an omission.
 */
export function groupAndroidPhotoBatch(
  batch: ReadyBatch,
): AndroidPhotoGrouping {
  const items = batch.items.slice(0, ANDROID_PHOTO_BATCH_LIMIT);
  const omissions: AndroidPhotoBatchOmission[] = [...batch.omissions];
  if (batch.items.length > items.length) {
    omissions.push({ reason: 'item_limit' });
  }

  const byDigest = new Map<string, AndroidPhotoGroupItem[]>();
  const screenshots: AndroidPhotoGroupItem[] = [];
  for (const item of items) {
    if (item.contentDigest) {
      const group = byDigest.get(item.contentDigest);
      if (group) group.push(groupItem(item));
      else byDigest.set(item.contentDigest, [groupItem(item)]);
    } else {
      omissions.push({ reason: 'duplicate_check_skipped', name: item.name });
    }
    if (SCREENSHOT_NAME.test(item.name)) screenshots.push(groupItem(item));
  }

  const duplicates = [...byDigest.values()].filter((group) => group.length > 1);
  const groups: AndroidPhotoSignalGroup[] = [
    ...duplicates.map((group) => ({
      signal: 'duplicate' as const,
      label: 'Identical content',
      items: group,
    })),
    ...(screenshots.length
      ? [
          {
            signal: 'screenshot' as const,
            label: 'Screenshot-like file name',
            items: screenshots,
          },
        ]
      : []),
  ];

  const groupedHandles = new Set(
    groups.flatMap((group) => group.items.map((item) => item.handle)),
  );
  return {
    count: batch.count,
    groups,
    ungrouped: items
      .filter((item) => !groupedHandles.has(item.handle))
      .map(groupItem),
    omissions,
  };
}
