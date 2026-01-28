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

  if (t.includes("write")) return "write";
  if (t.includes("create_directory") || t.includes("mkdir")) return "create";
  if (t.includes("delete") || t.includes("remove") || t.includes("unlink")) return "delete";
  if (t.includes("rename")) return "rename";
  if (t.includes("move")) return "move";
  if (t.includes("copy")) return "copy";
  return "unknown";
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
    if (server !== "filesystem") continue;

    const op = classifyTool(String(seg.tool || ""));
    if (!op) continue;

    const paths = [
      ...pickPathsFromResultPreview(seg.resultPreview),
      ...pickPathsFromArgs(seg.args),
    ];

    for (const p of paths) {
      changes.push({ op, path: p });
    }
  }
  return uniqByPath(changes);
}

