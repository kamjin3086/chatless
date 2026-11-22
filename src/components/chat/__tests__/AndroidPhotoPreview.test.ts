import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/store/localeStore';
import { AndroidPhotoPreview } from '../input/AndroidPhotoPreview';

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

it('shows the existing local photo, precise recipient, unsupported feedback and an accessible remove action', () => {
  const t = useLocaleStore.getState().t;
  const html = renderToStaticMarkup(
    createElement(AndroidPhotoPreview, {
      photo: { dataUrl: 'data:image/jpeg;base64,YWJj' },
      modelId: 'gpt-4o',
      providerName: 'OpenAI',
      status: 'unsupported',
      disabled: false,
      onRemove: () => {},
    }),
  );
  expect(html).toContain('src="data:image/jpeg;base64,YWJj"');
  expect(html).toContain('<strong>gpt-4o</strong> (OpenAI)');
  expect(html).toContain(t('androidPhoto.unsupported'));
  expect(html).toContain(`aria-label="${t('androidPhoto.remove')}"`);
});
