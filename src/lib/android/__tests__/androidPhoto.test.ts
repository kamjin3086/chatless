import { expect, it, vi } from 'vitest';
import { acquireAndroidPhoto } from '../androidPhoto';

it('opens the requested system surface and returns only a local preview', async () => {
  const native = vi
    .fn()
    .mockResolvedValue({ status: 'selected', jpegBase64: 'YWJj' });

  await expect(acquireAndroidPhoto('pick', native)).resolves.toEqual({
    status: 'selected',
    photo: { dataUrl: 'data:image/jpeg;base64,YWJj' },
  });
  expect(native).toHaveBeenCalledExactlyOnceWith('pick');
});

it('keeps a camera cancellation distinct from failures and actionable local outcomes', async () => {
  const native = vi
    .fn()
    .mockResolvedValueOnce({ status: 'cancelled' })
    .mockResolvedValueOnce({ status: 'unavailable' })
    .mockResolvedValueOnce({ status: 'too_large' })
    .mockResolvedValueOnce({ status: 'busy' })
    .mockRejectedValueOnce(new Error('provider went away'));

  for (const status of [
    'cancelled',
    'unavailable',
    'too_large',
    'busy',
    'unreadable',
  ]) {
    await expect(acquireAndroidPhoto('capture', native)).resolves.toEqual({
      status,
    });
  }
  expect(native.mock.calls).toEqual(
    Array.from({ length: 5 }, () => ['capture']),
  );
});
