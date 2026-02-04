export type FileChangeOp =
  | "write"
  | "create"
  | "delete"
  | "rename"
  | "move"
  | "copy"
  | "unknown";

export interface FileChange {
  op: FileChangeOp;
  /** absolute path preferred; may be alias if that's all we have */
  path: string;
}

function normPath(p: unknown): string | undefined {
  if (typeof p !== "string") return undefined;
  const s = p.trim();
  if (!s) return undefined;
  // normalize slashes
  let out = s.replace(/\\/g, "/");
  // collapse duplicate slashes (keep leading // for UNC as-is)
  if (!out.startsWith("//")) out = out.replace(/\/{2,}/g, "/");
  // strip trailing slashes
  out = out.replace(/\/+$/g, "");
  // normalize windows drive letter casing
  out = out.replace(/^([A-Za-z]):\//, (_, d) => `${String(d).toUpperCase()}:/`);
  return out;
}

function uniqByPath(list: FileChange[]): FileChange[] {
  const seen = new Set<string>();
  const out: FileChange[] = [];
  for (const it of list) {
    const key = String(it.path || "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function classifyTool(tool: string): FileChangeOp | null {
  const t = String(tool || "").toLowerCase();
  // ignore reads/listing
  if (t.includes("read")) return null;
  if (t.includes("list")) return null;
  if (t.includes("stat")) return null;
  if (t.includes("exists")) return null;
  if (t === "ls") return null; // 新的简化名称

  if (t.includes("write") || t === "write") return "write";
  if (t.includes("create_directory") || t.includes("mkdir") || t === "mkdir") return "create";
  if (t.includes("delete") || t.includes("remove") || t.includes("unlink") || t === "rm") return "delete";
  if (t.includes("rename") || t === "mv") return "rename"; // mv 可用于重命名或移动
  if (t.includes("move")) return "move";
  if (t.includes("copy") || t === "cp") return "copy";
  return null; // 改为返回 null 而不是 "unknown"，避免显示无意义的操作
}

function pickPathsFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const candidates: unknown[] = [
    // prefer "new"/"dest" fields first to avoid duplicating rename/move pairs
    (args as any).newPath,
    (args as any).dest,
    (args as any).destination,
    (args as any).dst,
    (args as any).target,
    (args as any).path,
    (args as any).filePath,
    (args as any).dir,
    (args as any).directory,
    // fallbacks (kept but de-duped later)
    (args as any).oldPath,
    (args as any).src,
    (args as any).source,
    (args as any).from,
  ];
  return candidates.map(normPath).filter(Boolean) as string[];
}

function pickPathsFromResultPreview(resultPreview?: string): string[] {
  if (!resultPreview) return [];
  const s = String(resultPreview);

  // 1) try json
  try {
    const obj = JSON.parse(s);
    const candidates: unknown[] = [
      obj?.path,
      obj?.filePath,
      obj?.dir,
      obj?.directory,
      obj?.oldPath,
      obj?.newPath,
      obj?.src,
      obj?.source,
      obj?.from,
      obj?.dst,
      obj?.dest,
      obj?.destination,
      obj?.target,
    ];
    const paths = candidates.map(normPath).filter(Boolean) as string[];
    if (paths.length > 0) return paths;
  } catch {
    // ignore
  }

  // 2) fallback regex for absolute windows paths that appear inside text
  const out: string[] = [];
  const reWin = /[A-Za-z]:[\\/][^\s"'<>]+/g;
  const matches = s.match(reWin) || [];
  for (const m of matches) {
    const p = normPath(m);
    if (p) out.push(p);
  }
  return out;
}

export function extractFileChangesFromToolCards(input: Array<any>): FileChange[] {
  const changes: FileChange[] = [];
  for (const seg of input || []) {
    if (!seg || seg.kind !== "toolCard") continue;
    const server = String(seg.server || "").toLowerCase();
    const tool = String(seg.tool || "").toLowerCase();
    
    // 支持多种 server 名称：fs, filesystem, skill（用于 skill 内的文件操作）
    const isFileSystemServer = server === "fs" || server === "filesystem";
    const isSkillFileOp = server === "skill" && (tool === "write_file" || tool === "read_file");
    const isShellWithFileOutput = server === "shell" || server === "shell_executor";
    
    if (isFileSystemServer) {
      const op = classifyTool(tool);
      if (!op) continue;

      const paths = [
        ...pickPathsFromResultPreview(seg.resultPreview),
        ...pickPathsFromArgs(seg.args),
      ];

      for (const p of paths) {
        changes.push({ op, path: p });
      }
    } else if (isSkillFileOp) {
      // skill 的文件操作也记录
      const op: FileChangeOp = tool === "write_file" ? "write" : "unknown";
      if (op === "unknown") continue;
      
      const paths = [
        ...pickPathsFromResultPreview(seg.resultPreview),
        ...pickPathsFromArgs(seg.args),
      ];

      for (const p of paths) {
        changes.push({ op, path: p });
      }
    } else if (isShellWithFileOutput && seg.status === 'success') {
      // shell 执行成功后，尝试从结果中提取创建的文件路径
      // 只有当命令看起来是创建文件的操作时才提取
      const cmd = String(seg.args?.command || '').toLowerCase();
      const isCreatingFile = 
        cmd.includes('pandoc') || 
        cmd.includes('convert') || 
        cmd.includes('wkhtmlto') ||
        cmd.includes(' > ') ||
        cmd.includes(' >> ');
      
      if (isCreatingFile) {
        const paths = pickPathsFromResultPreview(seg.resultPreview);
        for (const p of paths) {
          // 过滤掉明显不是文件输出的路径
          if (p.endsWith('/') || p.endsWith('\\')) continue;
          // 只保留有文件扩展名的路径
          if (!/\.\w{1,10}$/.test(p)) continue;
          changes.push({ op: "create", path: p });
        }
      }
    }
  }
  return uniqByPath(changes);
}

