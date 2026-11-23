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
import {
  AndroidAttachmentSheetContent,
  AndroidAttachmentSheetSurface,
} from '../AndroidAttachmentSheet';
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
    roots: [],
    rootsWorking: false,
    toggleRootAgent: noop,
    revokeRoot: noop,
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

describe('the Android attachment sheet as one surface', () => {
  const documentRow = {
    label: '附加文档',
    description: '含文字的 PDF 或纯文本（UTF-8）',
    attached: false,
    onPick: noop,
  };

  function renderSheet(overrides: Partial<AndroidAttachmentSelections> = {}) {
    return render(AndroidAttachmentSheetSurface, {
      heading: '附加内容',
      children: createElement(AndroidAttachmentSheetContent, {
        selections: selections(overrides),
        document: documentRow,
        onCapturePhoto: noop,
        onPickPhoto: noop,
        onAction: (action: () => void) => action(),
      }),
    });
  }

  /** Everything the pane shows after its fixed header. Nothing may follow it. */
  function scrollArea(html: string): string {
    const at = html.indexOf('data-slot="android-attachment-sheet-scroll"');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at);
  }

  it('is a bottom-anchored pane of at most 85dvh with rounded top corners', () => {
    const html = renderSheet();
    expect(html).toContain('data-slot="android-attachment-sheet"');
    expect(html).toContain('max-h-[85dvh]');
    expect(html).toContain('rounded-t-2xl');
  });

  it('scrolls its own content and ends with the disclosures inside that scroll area', () => {
    const html = renderSheet();
    const scroll = scrollArea(html);
    expect(scroll).toContain('overflow-y-auto');
    for (const label of [
      zh('androidPhoto.capture'),
      zh('androidPhoto.pick'),
      zh('androidPhotos.batchPick'),
      zh('androidDirectory.choose'),
      documentRow.label,
    ]) {
      expect(scroll).toContain(label);
    }
    // Both sentences live at the end of the sheet's content, not over the composer.
    expect(scroll).toContain(zh('androidPhotos.disclosure'));
    expect(scroll).toContain(zh('androidDirectory.disclosure'));
    expect(scroll.indexOf(zh('androidDirectory.disclosure'))).toBeGreaterThan(
      scroll.indexOf(zh('androidDirectory.choose')),
    );
  });

  it('offers no entry this build cannot run on Android', () => {
    const html = renderSheet();
    expect(html).not.toContain(zh('chatComposer.skills'));
    expect(html).not.toContain(zh('chatComposer.prompts'));
    expect(html).not.toContain(zh('chatComposer.mentions'));
    expect(html).not.toContain('知识库');
  });

  it('gives every row 48dp and a divider between rows', () => {
    const html = renderSheet();
    const rows = html.match(/<button/gu) ?? [];
    expect(rows).toHaveLength(5);
    expect(html.match(/min-h-12/gu) ?? []).toHaveLength(rows.length);
    expect(scrollArea(html)).toContain('divide-y');
  });

  it('adds separated forget rows once a batch and a folder are picked', () => {
    const html = renderSheet({
      photoBatch: { count: 3, working: false, failed: false },
      directory: {
        folderName: 'Camera',
        working: false,
        failed: false,
        revoked: false,
      },
    });
    const rows = html.match(/<button/gu) ?? [];
    expect(rows).toHaveLength(7);
    expect(html.match(/min-h-12/gu) ?? []).toHaveLength(rows.length);
    expect(scrollArea(html)).toContain(zh('androidPhotos.forget'));
    expect(scrollArea(html)).toContain(zh('androidDirectory.forget'));
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

/**
 * The folders Android still holds a grant for, listed where the user already goes to attach
 * something: the switch is what the Agent may read, the revoke is the system grant itself.
 */
describe('authorized folder list', () => {
  const folders = [
    {
      uri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2F整理测试',
      name: '整理测试',
      agentEnabled: true,
    },
    {
      uri: 'content://com.android.externalstorage.documents/tree/primary%3ADocuments',
      name: 'Documents',
      agentEnabled: false,
    },
  ];

  function sheet(withRoots: boolean) {
    return render(AndroidAttachmentActions, {
      selections: selections(withRoots ? { roots: folders } : {}),
      onPickPhoto: noop,
      onAction: (action: () => void) => action(),
    });
  }

  it('names each folder with its switch and a revoke', () => {
    const html = sheet(true);
    expect(html).toContain(zh('androidDirectory.rootsTitle'));
    expect(html).toContain('整理测试');
    expect(html).toContain('Documents');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(
      html.match(new RegExp(zh('androidDirectory.revokeRoot'), 'g')),
    ).toHaveLength(2);
  });

  it('says nothing before a folder has been authorized', () => {
    expect(sheet(false)).not.toContain(zh('androidDirectory.rootsTitle'));
  });
});
