import { beforeEach, expect, it, vi } from 'vitest';
import { exists } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { toast } from '@/components/ui/sonner';
import { openCheckedPath } from '@/lib/filesystemAllowlist/openCheckedPath';
import { FileOpener } from '../fileOpener';

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));
vi.mock('@/components/ui/sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/filesystemAllowlist/displayPathAliases', () => ({ resolveAliasPath: ({ path }: { path: string }) => path }));
vi.mock('@/lib/filesystemAllowlist/openCheckedPath', () => ({ openCheckedPath: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it('localizes an existing file open while passing the same normalized path to both openers', async () => {
  vi.mocked(exists).mockResolvedValue(true);
  vi.mocked(openCheckedPath).mockResolvedValue(false);
  const name = '报告$&.pdf';
  expect(await FileOpener.openFile(`C:/files/${name}`, name, 'en')).toBe(true);
  const normalized = `C:\\files\\${name}`;
  expect(exists).toHaveBeenCalledWith(normalized);
  expect(openCheckedPath).toHaveBeenCalledWith(normalized);
  expect(openPath).toHaveBeenCalledWith(normalized);
  expect(toast.success).toHaveBeenCalledWith('Document opened', {
    description: `Opened with the default app: ${name}`,
  });
});

it('localizes missing-file feedback without changing the filename or attempting an open', async () => {
  vi.mocked(exists).mockResolvedValue(false);
  const name = '缺失$&.md';
  expect(await FileOpener.openFile(`C:/files/${name}`, name, 'en')).toBe(false);
  expect(openCheckedPath).not.toHaveBeenCalled();
  expect(openPath).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('File not found', {
    description: `Couldn't find file: ${name}`,
  });
});

it('keeps the existing default locale for callers outside Resources', async () => {
  expect(await FileOpener.openFile('')).toBe(false);
  expect(exists).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('打开文件失败', { description: '路径为空' });
});
