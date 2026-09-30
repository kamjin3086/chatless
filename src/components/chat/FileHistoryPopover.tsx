"use client";

import { useState } from 'react';
import { Clock, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { withOneShotGrant } from '@/lib/filesystemAllowlist/oneShotGrant';
import { fileHistory, restoreFileVersion, type FileHistoryVersion } from '@/lib/tauri/filesystemCommands';

/**
 * 覆盖/编辑前的版本清单，点一下就能恢复。
 *
 * 历史保存在应用数据目录（不写进用户目录），所以这里只显示时间、大小和来源操作。
 */
/** 后端拒绝读取时，给出可执行的原因而不是一句原始错误。 */
function describeHistoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('forbidden')) {
    return '这个文件当前不在授权范围内。让 Agent 再读一次该文件，或把它所在的目录附加为工作目录后再试。';
  }
  return message;
}

export function FileHistoryPopover({ path, disabled }: { path: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [versions, setVersions] = useState<FileHistoryVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // 用户点了这个文件的历史按钮：给这一次读取一个最小授权，读完立即撤销。
      const result = await withOneShotGrant({ path, scope: 'history', read: true }, () => fileHistory(path));
      setVersions(result?.versions || []);
    } catch (e) {
      setError(describeHistoryError(e));
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  const restore = async (version: FileHistoryVersion) => {
    setRestoring(version.id);
    try {
      await withOneShotGrant(
        { path, scope: 'restore', read: true, write: true },
        () => restoreFileVersion(path, version.id),
      );
      toast.success('已恢复该版本', { description: new Date(version.createdAt).toLocaleString() });
      await load();
    } catch (e) {
      toast.error('恢复失败', { description: describeHistoryError(e) });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="历史版本"
          aria-label="历史版本"
          className="inline-flex items-center rounded px-1 py-0.5 text-slate-400 hover:text-slate-600
            dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Clock className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="px-1 pb-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">历史版本</div>
        {loading && <div className="px-1 py-2 text-[11px] text-slate-400">读取中…</div>}
        {!loading && error && <div className="px-1 py-2 text-[11px] text-red-500">{error}</div>}
        {!loading && !error && versions?.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-slate-400">这个文件还没有被覆盖过。</div>
        )}
        {!loading && !!versions?.length && (
          <div className="max-h-56 overflow-y-auto">
            {versions.map((version) => (
              <div key={version.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-slate-600 dark:text-slate-200">
                    {new Date(version.createdAt).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {version.tool} · {formatBytes(version.bytes)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={restoring === version.id}
                  onClick={() => void restore(version)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]
                    text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700
                    disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />
                  恢复
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="px-1 pt-1.5 text-[10px] text-slate-400">
          应用内写入与编辑会先存一份副本，每个文件最多保留 20 版（总量约 200MB）。
          恢复前也会把当前内容存成历史，所以恢复本身可以再撤销。
          通过终端或外部编辑器做的修改不在此列。
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
