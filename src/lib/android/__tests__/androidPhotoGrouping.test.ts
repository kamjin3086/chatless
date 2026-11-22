import { describe, expect, it } from 'vitest';
import type { AndroidPhotoBatchItem } from '../androidPhotoBatch';
import {
  ANDROID_PHOTO_BATCH_LIMIT,
  groupAndroidPhotoBatch,
} from '../androidPhotoGrouping';

function photo(
  handle: string,
  name: string,
  contentDigest: string | null = `digest-${handle}`,
): AndroidPhotoBatchItem {
  return {
    handle,
    name,
    mimeType: 'image/jpeg',
    sizeBytes: 2400,
    contentDigest,
  };
}

function batch(items: AndroidPhotoBatchItem[]) {
  return {
    status: 'ready' as const,
    count: items.length,
    items,
    omissions: [],
  };
}

describe('Android photo batch grouping', () => {
  it('groups only photos whose bytes are identical and keeps same-size different photos apart', () => {
    const copy = photo('copy', 'IMG_4021 (1).jpg', 'same-bytes');
    const original = photo('original', 'IMG_4021.jpg', 'same-bytes');
    const other = photo('other', 'IMG_4022.jpg', 'different-bytes');
    expect(
      groupAndroidPhotoBatch(batch([original, other, copy])),
    ).toMatchObject({
      count: 3,
      groups: [
        {
          signal: 'duplicate',
          items: [
            { handle: 'original', name: 'IMG_4021.jpg' },
            { handle: 'copy', name: 'IMG_4021 (1).jpg' },
          ],
        },
      ],
      ungrouped: [{ handle: 'other', name: 'IMG_4022.jpg' }],
      omissions: [],
    });
  });

  it('recognises screenshot file names from Android vendors without matching ordinary names', () => {
    const screenshots = [
      photo('pixel', 'Screenshot_20260101-120000.png'),
      photo('samsung', 'Screenshot_20260101-120000_Chrome.jpg'),
      photo('copy', 'Screenshot (1).png'),
      photo('xiaomi', '截屏_2026-01-01-12-00-00.png'),
      photo('jp', 'スクリーンショット_2026.png'),
    ];
    const ordinary = [
      photo('camera', 'IMG_20260101_120000.jpg'),
      photo('design', 'my-screen-design.png'),
      photo('holiday', 'Holiday.png'),
    ];
    const grouping = groupAndroidPhotoBatch(
      batch([...screenshots, ...ordinary]),
    );
    expect(
      grouping.groups.map(({ signal, items }) => ({
        signal,
        handles: items.map((item) => item.handle),
      })),
    ).toEqual([
      {
        signal: 'screenshot',
        handles: ['pixel', 'samsung', 'copy', 'xiaomi', 'jp'],
      },
    ]);
    expect(grouping.ungrouped.map((item) => item.handle)).toEqual([
      'camera',
      'design',
      'holiday',
    ]);
  });

  it('states what it could not compare instead of guessing duplicates', () => {
    const unread = photo('unread', 'IMG_5000.jpg', null);
    const grouping = groupAndroidPhotoBatch({
      ...batch([unread]),
      count: 3,
      omissions: [{ reason: 'unreadable' }],
    });
    expect(grouping.groups).toEqual([]);
    expect(grouping.ungrouped).toEqual([
      { handle: 'unread', name: 'IMG_5000.jpg' },
    ]);
    expect(grouping.omissions).toEqual([
      { reason: 'unreadable' },
      { reason: 'duplicate_check_skipped', name: 'IMG_5000.jpg' },
    ]);
  });

  it('bounds the reported batch and says it truncated a larger selection', () => {
    const items = Array.from(
      { length: ANDROID_PHOTO_BATCH_LIMIT + 2 },
      (_, i) => photo(`photo-${i}`, `IMG_${i}.jpg`),
    );
    const grouping = groupAndroidPhotoBatch(batch(items));
    expect(grouping.count).toBe(ANDROID_PHOTO_BATCH_LIMIT + 2);
    expect(grouping.ungrouped).toHaveLength(ANDROID_PHOTO_BATCH_LIMIT);
    expect(grouping.omissions).toEqual([{ reason: 'item_limit' }]);
  });
});
