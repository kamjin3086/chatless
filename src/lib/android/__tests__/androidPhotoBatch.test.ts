import { expect, it, vi } from 'vitest';
import {
  forgetAndroidPhotoBatch,
  getAndroidPhotoBatchSelection,
  inventoryAndroidPhotoBatch,
  pickAndroidPhotoBatch,
} from '../androidPhotoBatch';

it('opens one picker for the current chat and reports the selected count', async () => {
  const native = vi.fn().mockResolvedValue({ status: 'ready', count: 3 });
  await expect(pickAndroidPhotoBatch('chat-a', native)).resolves.toEqual({
    status: 'ready',
    count: 3,
  });
  expect(native).toHaveBeenCalledExactlyOnceWith('pick_android_photo_batch', {
    conversationId: 'chat-a',
  });
});

it('keeps selection, inventory and forgetting as separate native commands', async () => {
  const native = vi
    .fn()
    .mockResolvedValueOnce({ status: 'none' })
    .mockResolvedValueOnce({
      status: 'ready',
      count: 1,
      items: [],
      omissions: [],
    })
    .mockResolvedValueOnce({ status: 'none' });

  await getAndroidPhotoBatchSelection('chat-a', native);
  await inventoryAndroidPhotoBatch('chat-a', native);
  await forgetAndroidPhotoBatch('chat-a', native);
  expect(native.mock.calls).toEqual([
    ['android_photo_batch_selection', { conversationId: 'chat-a' }],
    ['inventory_android_photo_batch', { conversationId: 'chat-a' }],
    ['forget_android_photo_batch', { conversationId: 'chat-a' }],
  ]);
});
