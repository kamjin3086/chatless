import { normalizeToolCallServerAndTool } from '@/lib/mcp/normalizeToolCallName';

export type ToolRepairIssueCode =
  | 'ARGS_JSON_PARSE_FAILED'
  | 'ARGS_NOT_AN_OBJECT'
  | 'MISSING_REQUIRED_ARG'
  | 'UNKNOWN_TOOL';

export type ToolRepairIssue = {
  code: ToolRepairIssueCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ToolRepairResult = {
  ok: boolean;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  repairs: string[];
  issue?: ToolRepairIssue;
  rawArguments?: string;
};

function toLower(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

function stripCodeFences(input: string): string {
  const s = String(input || '').trim();
  // ```json ... ```
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) return String(m[1] || '').trim();
  return s;
}

function fixCommonJsonIssues(input: string): { text: string; repairs: string[] } {
  let s = String(input || '');
  const repairs: string[] = [];

  // Smart quotes
  if (/[“”]/.test(s)) {
    s = s.replace(/[“”]/g, '"');
    repairs.push('replaced smart double quotes');
  }
  if (/[‘’]/.test(s)) {
    s = s.replace(/[‘’]/g, "'");
    repairs.push('replaced smart single quotes');
  }

  // Trailing commas: ,} ,]
  const before = s;
  s = s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  if (s !== before) repairs.push('removed trailing commas');

  // If looks like JSON but wrapped by stray text
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = s.slice(firstBrace, lastBrace + 1);
    if (candidate !== s.trim()) {
      s = candidate;
      repairs.push('trimmed to outermost {...}');
    }
  }

  // Single-quote JSON (best-effort): only if there are no double quotes at all
  if (s.includes("'") && !s.includes('"')) {
    const swapped = s.replace(/'/g, '"');
    if (swapped !== s) {
      s = swapped;
      repairs.push("converted all ' to \" (best-effort)");
    }
  }

  return { text: String(s || '').trim(), repairs };
}

function parseJsonishObject(raw: string): { ok: true; value: any; repairs: string[] } | { ok: false; error: string; repairs: string[] } {
  const repairs: string[] = [];
  let s = stripCodeFences(raw);
  if (s !== String(raw || '').trim()) repairs.push('stripped code fences');

  if (!s) return { ok: true, value: {}, repairs };

  try {
    return { ok: true, value: JSON.parse(s), repairs };
  } catch {
    // continue
  }

  const fixed = fixCommonJsonIssues(s);
  repairs.push(...fixed.repairs);
  s = fixed.text;

  try {
    return { ok: true, value: JSON.parse(s), repairs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON.parse failed: ${msg}`, repairs };
  }
}

function canonicalizeToolName(server: string, tool: string): { tool: string; repairs: string[] } {
  const repairs: string[] = [];
  const srv = toLower(server);
  const tl = toLower(tool);
  let out = tool;

  // Strip duplicated server prefix: filesystem_read_file -> read_file, etc.
  if (srv === 'filesystem' && tl.startsWith('filesystem_')) {
    out = tool.slice('filesystem_'.length);
    repairs.push('stripped filesystem_ prefix');
  }
  if (srv === 'shell_executor' && tl.startsWith('shell_executor_')) {
    out = tool.slice('shell_executor_'.length);
    repairs.push('stripped shell_executor_ prefix');
  }

  const t = toLower(out);

  if (srv === 'filesystem') {
    const mapped: Record<string, string> = {
      list: 'list_directory',
      dir: 'list_directory',
      mkdir: 'create_directory',
      create: 'create_directory',
      read: 'read_file',
      write: 'write_file',
      delete: 'delete_file',
      rename: 'rename_file',
      move: 'rename_file',
    };
    if (mapped[t] && mapped[t] !== out) {
      repairs.push(`mapped tool "${out}" -> "${mapped[t]}"`);
      out = mapped[t];
    }
  }

  if (srv === 'shell_executor') {
    const mapped: Record<string, string> = {
      execute: 'execute_command',
      run: 'execute_command',
      command: 'execute_command',
    };
    if (mapped[t] && mapped[t] !== out) {
      repairs.push(`mapped tool "${out}" -> "${mapped[t]}"`);
      out = mapped[t];
    }
  }

  return { tool: out, repairs };
}

function coerceArgs(server: string, tool: string, args: Record<string, unknown>): { args: Record<string, unknown>; repairs: string[] } {
  const repairs: string[] = [];
  const srv = toLower(server);
  const tl = toLower(tool);
  const a: Record<string, unknown> = { ...(args || {}) };

  if (srv === 'filesystem') {
    // Normalize path key
    if (typeof a.path !== 'string') {
      const candidates = ['filePath', 'filepath', 'directoryPath', 'dirPath', 'targetPath', 'fullPath', 'src', 'dest'];
      for (const k of candidates) {
        if (typeof (a as any)[k] === 'string') {
          a.path = String((a as any)[k]);
          repairs.push(`mapped args.${k} -> args.path`);
          break;
        }
      }
    }

    // rename: normalize oldPath/newPath
    if (tl === 'rename_file' || tl === 'move_file' || tl === 'move' || tl === 'rename') {
      if (typeof a.oldPath !== 'string') {
        for (const k of ['from', 'source', 'src', 'srcPath', 'old', 'old_path']) {
          if (typeof (a as any)[k] === 'string') {
            a.oldPath = String((a as any)[k]);
            repairs.push(`mapped args.${k} -> args.oldPath`);
            break;
          }
        }
      }
      if (typeof a.newPath !== 'string') {
        for (const k of ['to', 'destination', 'dest', 'dst', 'dstPath', 'new', 'new_path']) {
          if (typeof (a as any)[k] === 'string') {
            a.newPath = String((a as any)[k]);
            repairs.push(`mapped args.${k} -> args.newPath`);
            break;
          }
        }
      }
    }

    // read_file: maxLines aliases
    if (tl === 'read_file' || tl === 'read') {
      if (typeof (a as any).maxLines !== 'number') {
        const v = (a as any).limit ?? (a as any).max_lines ?? (a as any).maxLine;
        if (typeof v === 'number') {
          (a as any).maxLines = v;
          repairs.push('mapped args.limit/max_lines -> args.maxLines');
        }
      }
    }
  }

  return { args: a, repairs };
}

function validateRequiredArgs(server: string, tool: string, args: Record<string, unknown>): ToolRepairIssue | undefined {
  const srv = toLower(server);
  const tl = toLower(tool);

  if (srv === 'filesystem') {
    if (tl === 'rename_file' || tl === 'move_file' || tl === 'move' || tl === 'rename') {
      if (typeof (args as any).oldPath !== 'string' || typeof (args as any).newPath !== 'string') {
        return {
          code: 'MISSING_REQUIRED_ARG',
          message: 'filesystem rename/move requires oldPath and newPath',
          details: { required: ['oldPath', 'newPath'] },
        };
      }
      return undefined;
    }

    if (typeof (args as any).path !== 'string' || !String((args as any).path).trim()) {
      return { code: 'MISSING_REQUIRED_ARG', message: 'filesystem requires path (string)', details: { required: ['path'] } };
    }
  }

  if (srv === 'shell_executor') {
    if (typeof (args as any).command !== 'string' || !String((args as any).command).trim()) {
      return { code: 'MISSING_REQUIRED_ARG', message: 'shell_executor requires command (string)', details: { required: ['command'] } };
    }
  }

  return undefined;
}

export function repairToolCall(params: {
  server: string;
  tool: string;
  rawArguments?: string;
  parsedArgs?: Record<string, unknown>;
}): ToolRepairResult {
  const repairs: string[] = [];

  // 1) Normalize server/tool pair (handles "default" and embedded prefixes)
  const normalized = normalizeToolCallServerAndTool({ serverName: params.server, toolName: params.tool });
  const server = normalized.serverName || params.server || '';
  let tool = normalized.toolName || params.tool || '';
  if (server !== params.server || tool !== params.tool) repairs.push('normalized server/tool');

  // 2) Canonicalize tool name per server
  const canon = canonicalizeToolName(server, tool);
  tool = canon.tool;
  repairs.push(...canon.repairs);

  // 3) Parse/repair arguments
  let args: Record<string, unknown> = {};
  let rawArguments: string | undefined = undefined;

  if (params.parsedArgs && typeof params.parsedArgs === 'object') {
    args = { ...(params.parsedArgs || {}) };
  } else if (typeof params.rawArguments === 'string') {
    rawArguments = params.rawArguments;
    const parsed = parseJsonishObject(params.rawArguments);
    repairs.push(...parsed.repairs);
    if (!parsed.ok) {
      return {
        ok: false,
        server,
        tool,
        args: {},
        repairs,
        rawArguments,
        issue: {
          code: 'ARGS_JSON_PARSE_FAILED',
          message: parsed.error,
          details: { rawArguments: params.rawArguments },
        },
      };
    }
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return {
        ok: false,
        server,
        tool,
        args: {},
        repairs,
        rawArguments,
        issue: {
          code: 'ARGS_NOT_AN_OBJECT',
          message: 'tool arguments must be a JSON object',
          details: { parsedType: Array.isArray(parsed.value) ? 'array' : typeof parsed.value },
        },
      };
    }
    args = parsed.value as Record<string, unknown>;
  }

  // 4) Coerce common arg aliases
  const coerced = coerceArgs(server, tool, args);
  args = coerced.args;
  repairs.push(...coerced.repairs);

  // 5) Validate minimal required args
  const issue = validateRequiredArgs(server, tool, args);
  if (issue) {
    return { ok: false, server, tool, args, repairs, rawArguments, issue };
  }

  return { ok: true, server, tool, args, repairs, rawArguments };
}

