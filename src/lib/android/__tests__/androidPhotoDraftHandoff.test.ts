import { expect, it, vi } from 'vitest';
import {
  createAndroidPhotoDraftHandoff,
  submitAndroidPhotoDraft,
} from '@/lib/android/androidPhotoDraftHandoff';
import { AndroidPhotoSendRejection } from '@/lib/android/androidPhotoSend';

it('retains the first photo and question in the created chat after rejection for retry', async () => {
  const handoff = createAndroidPhotoDraftHandoff();
  const photo = { dataUrl: 'data:image/jpeg;base64,YWJj' };
  const snapshot = { photo, textRevision: {} };
  const text = 'What is this?';
  const recipient = {
    providerName: 'Compatible',
    modelId: 'gpt-4o',
    route: 'openai-compatible',
  } as const;
  const clearOldComposer = vi.fn();

  await expect(
    submitAndroidPhotoDraft({
      submitted: snapshot,
      content: text,
      recipient,
      readCurrent: () => ({ snapshot, text }),
      handoff,
      acknowledge: clearOldComposer,
      send: async (_message, options) => {
        options.onAndroidPhotoConversationCreated?.('created');
        throw new AndroidPhotoSendRejection('not_accepted');
      },
    }),
  ).resolves.toBe('not_accepted');

  const retained = handoff.read('created');
  expect(retained).toMatchObject({
    photo,
    text,
    accepted: false,
    sending: false,
    feedback: 'not_accepted',
  });
  expect(handoff.read('other')).toBeNull();
  expect(clearOldComposer).not.toHaveBeenCalled();
  if (!retained) throw new Error('Expected retained photo draft');
  expect(handoff.claim(retained)).toBe(true);
  expect(handoff.claim(retained)).toBe(false);

  const retry = { photo: retained.photo, textRevision: {} };
  await expect(
    submitAndroidPhotoDraft({
      submitted: retry,
      content: retained.text,
      recipient,
      readCurrent: () => ({ snapshot: retry, text: retained.text }),
      acknowledge: (id) => {
        expect(id).toBe('created');
        handoff.remove(retained);
      },
      send: async (message, options) => {
        expect(message).toBe('What is this?');
        expect(options.images).toEqual(['data:image/jpeg;base64,YWJj']);
        options.onAndroidPhotoAccepted?.('created');
      },
    }),
  ).resolves.toBeUndefined();
  expect(handoff.read('created')).toBeNull();
});

it('ignores acknowledgements after the photo was removed or replaced', () => {
  const handoff = createAndroidPhotoDraftHandoff();
  const photo = { dataUrl: 'data:image/jpeg;base64,YWJj' };
  const old = handoff.offer('created', { photo, text: 'Old question' });
  handoff.remove(old);
  const newer = handoff.offer('created', { photo, text: 'New question' });

  handoff.acknowledge(old);
  expect(handoff.read('created')).toEqual(newer);
});
