/**
 * The Android attachment surface: one chip row of state above the composer, and every
 * pick/reselect/forget plus the disclosure sentences inside the attachment sheet.
 */
import React, { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import {
  AndroidAttachmentActions,
  AndroidAttachmentDisclosures,
} from '../AndroidAttachmentActions';
import { AndroidAttachmentChips } from '../AndroidAttachmentChips';
import type { AndroidAttachmentSelections } from '../androidAttachmentSelection';
import {
  directoryState,
  photoBatchCountLabel,
  photoBatchState,
} from '../androidAttachmentSelection';

beforeAll(() => vi.stubGlobal('React', React));

const noop = () => {};
const zh = (key: Parameters<typeof translate>[1]) => translate('zh', key);

function selections(
  overrides: Partial<AndroidAttachmentSelections> = {},
): AndroidAttachmentSelections {
  return {
    photoBatch: { count: null, working: false, failed: false },
    directory: {
      folderName: null,
      working: false,
      failed: false,
      revoked: false,
    },
    pickPhotoBatch: noop,
    forgetPhotoBatch: noop,
    pickDirectory: noop,
    forgetDirectory: noop,
    ...overrides,
  };
}

function render<P>(component: FunctionComponent<P>, props: P): string {
  return renderToStaticMarkup(
    createElement(component as FunctionComponent<object>, props as object),
  );
}

describe('native answers reaching the attachment surface', () => {
  it('turns a ready batch into the count the chip and the sheet show', () => {
    expect(photoBatchState({ status: 'ready', count: 3 })).toEqual({
      count: 3,
      working: false,
      failed: false,
    });
    expect(photoBatchState({ status: 'unavailable' })).toEqual({
      count: null,
      working: false,
      failed: true,
    });
  });

  it('keeps a revoked folder forgettable', () => {
    expect(directoryState({ status: 'revoked' })).toEqual({
      folderName: null,
      working: false,
      failed: false,
      revoked: true,
    });
    expect(
      directoryState({
        status: 'ready',
        folder: { handle: 'h', name: 'Camera' },
      }),
    ).toEqual({
      folderName: 'Camera',
      working: false,
      failed: false,
      revoked: false,
    });
  });

  it('reads a count as photos in both languages', () => {
    expect(photoBatchCountLabel(3, (key) => translate('zh', key))).toBe(
      '3 张照片',
    );
    expect(photoBatchCountLabel(1, (key) => translate('en', key))).toBe(
      '1 photo',
    );
    expect(photoBatchCountLabel(3, (key) => translate('en', key))).toBe(
      '3 photos',
    );
  });
});

describe('attachment sheet on Android', () => {
  it('offers the four pickers with distinct labels', () => {
    const html = render(AndroidAttachmentActions, {
      selections: selections(),
      onCapturePhoto: noop,
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
    expect(html).toContain(zh('androidPhoto.capture'));
    expect(html).toContain(zh('androidPhoto.pick'));
    expect(html).toContain(zh('androidPhotos.batchPick'));
    expect(html).toContain(zh('androidDirectory.choose'));
  });

  it('keeps the disclosure sentences out of the action rows', () => {
    const html = render(AndroidAttachmentActions, {
      selections: selections(),
      onCapturePhoto: noop,
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
    expect(html).not.toContain(zh('androidPhotos.disclosure'));
    expect(html).not.toContain(zh('androidDirectory.disclosure'));
  });

  it('states the current batch and folder on their own rows', () => {
    const html = render(AndroidAttachmentActions, {
      selections: selections({
        photoBatch: { count: 3, working: false, failed: false },
        directory: {
          folderName: 'Camera',
          working: false,
          failed: false,
          revoked: false,
        },
      }),
      onCapturePhoto: noop,
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
    expect(html).toContain('3 张照片');
    expect(html).toContain('Camera');
    expect(html).toContain(zh('androidPhotos.forget'));
    expect(html).toContain(zh('androidDirectory.forget'));
  });

  it('offers no forget action before anything is picked', () => {
    const html = render(AndroidAttachmentActions, {
      selections: selections(),
      onCapturePhoto: noop,
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
    expect(html).not.toContain(zh('androidPhotos.forget'));
    expect(html).not.toContain(zh('androidDirectory.forget'));
  });

  it('keeps the folder forget action when the grant was revoked', () => {
    const html = render(AndroidAttachmentActions, {
      selections: selections({
        directory: {
          folderName: null,
          working: false,
          failed: false,
          revoked: true,
        },
      }),
      onCapturePhoto: noop,
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
    expect(html).toContain(zh('androidDirectory.revoked'));
    expect(html).toContain(zh('androidDirectory.forget'));
  });

  it('carries both privacy sentences and 48px rows in the sheet', () => {
    const actions = render(AndroidAttachmentActions, {
      selections: selections(),
      onCapturePhoto: noop,
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
    expect(actions).toContain('min-h-12');
    const disclosures = render(AndroidAttachmentDisclosures, {});
    expect(disclosures).toContain(zh('androidPhotos.disclosure'));
    expect(disclosures).toContain(zh('androidDirectory.disclosure'));
  });
});

describe('composer chips on Android', () => {
  it('shows the picked count and folder as chips', () => {
    const html = render(AndroidAttachmentChips, {
      photoBatch: { count: 3, working: false, failed: false },
      directory: {
        folderName: 'Camera',
        working: false,
        failed: false,
        revoked: false,
      },
    });
    expect(html).toContain('3 张照片');
    expect(html).toContain('文件夹：Camera');
    // The disclosure belongs to the sheet, not to permanent body text.
    expect(html).not.toContain(zh('androidPhotos.disclosure'));
    expect(html).not.toContain(zh('androidDirectory.disclosure'));
  });

  it('renders nothing while the chat has no attachment selection', () => {
    expect(
      render(AndroidAttachmentChips, {
        photoBatch: { count: null, working: false, failed: false },
        directory: {
          folderName: null,
          working: false,
          failed: false,
          revoked: false,
        },
      }),
    ).toBe('');
  });

  it('says when the folder grant is gone', () => {
    const html = render(AndroidAttachmentChips, {
      photoBatch: { count: null, working: false, failed: false },
      directory: {
        folderName: null,
        working: false,
        failed: false,
        revoked: true,
      },
    });
    expect(html).toContain(zh('androidDirectory.revoked'));
  });
});
