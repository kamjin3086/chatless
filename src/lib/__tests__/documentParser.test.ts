import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentParser } from '@/lib/documentParser';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const documentBytes = [32, 65, 10];
const file = new File([Uint8Array.from(documentBytes)], '原始资料.TXT');
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce(['txt']);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DocumentParser.parseFileObject', () => {
  it('leaves the Tauri command, payload, and parsed content unchanged', async () => {
    invokeMock.mockResolvedValueOnce(' 保留原始文本\n');
    await expect(DocumentParser.parseFileObject(file)).resolves.toEqual({
      success: true,
      content: ' 保留原始文本\n',
      fileName: file.name,
      fileSize: file.size,
      fileType: 'txt',
    });
    expect(invokeMock.mock.calls).toEqual([
      ['get_supported_file_types'],
      [
        'parse_document_from_binary',
        { fileName: file.name, fileContent: documentBytes },
      ],
    ]);
  });

  it('returns size and unsupported type errors as data', async () => {
    await expect(
      DocumentParser.parseFileObject(file, { maxFileSize: 2 }),
    ).resolves.toEqual({
      success: false,
      failure: { code: 'file-too-large', maxBytes: 2 },
    });
    await expect(
      DocumentParser.parseFileObject(new File(['text'], 'notes.rtf')),
    ).resolves.toEqual({
      success: false,
      failure: { code: 'unsupported-file-type', fileType: 'rtf' },
    });
    expect(invokeMock.mock.calls).toEqual([['get_supported_file_types']]);
  });

  it('reports a timeout without relying on the exception message', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    invokeMock.mockImplementationOnce(() => new Promise(() => {}));
    const result = DocumentParser.parseFileObject(file, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual({
      success: false,
      failure: { code: 'timeout' },
    });
  });

  it('passes through the diagnostic from an opaque exception unchanged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const diagnostic = 'Unrecognized byte sequence at block 12';
    invokeMock.mockRejectedValueOnce(new Error(diagnostic));
    await expect(DocumentParser.parseFileObject(file)).resolves.toEqual({
      success: false,
      failure: { code: 'parse-failed', diagnostic },
    });
  });
});
