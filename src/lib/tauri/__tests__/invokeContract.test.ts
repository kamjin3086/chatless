/**
 * Tauri matches command arguments by name: a Rust parameter `execution_id`
 * must arrive as `executionId`. Nothing checks that at compile time, and a
 * mismatch only shows up when the real app runs - which is exactly how
 * `stop_shell_process` and `read_shell_process` shipped broken while their
 * mocked tests passed.
 *
 * This test reads the Rust command signatures and the TypeScript call sites and
 * refuses any `invoke` that omits a required argument.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const tsRoot = path.join(repoRoot, 'src');
const rustRoot = path.join(repoRoot, 'src-tauri', 'src');

/**
 * Parameters Tauri injects itself rather than reading from the JS payload.
 * Matched by type because the parameter name is whatever the author chose.
 */
const INJECTED_TYPE = /^\s*(State\s*<|AppHandle|Window\b|Webview\b|tauri::)/;

function walk(dir: string, extensions: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target') continue;
      walk(full, extensions, out);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

function matchingIndex(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

type RustCommand = { command: string; required: string[]; payloadStruct?: string };

function rustCommands(): Map<string, RustCommand> {
  const commands = new Map<string, RustCommand>();
  for (const file of walk(rustRoot, ['.rs'])) {
    const text = fs.readFileSync(file, 'utf8');
    const marker = /#\[tauri::command\]/g;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(text)) !== null) {
      const after = text.slice(match.index);
      const signature = /pub\s+(?:async\s+)?fn\s+(\w+)\s*\(/.exec(after);
      if (!signature) continue;
      const name = signature[1];
      const paramsStart = match.index + signature.index + signature[0].length - 1;
      const paramsEnd = matchingIndex(text, paramsStart, '(', ')');
      if (paramsEnd < 0) continue;
      const params = text.slice(paramsStart + 1, paramsEnd);
      const required: string[] = [];
      let payloadStruct: string | undefined;
      for (const raw of splitTopLevel(params)) {
        const parsed = /^\s*(\w+)\s*:\s*([\s\S]+)$/.exec(raw);
        if (!parsed) continue;
        const [, paramName, paramType] = parsed;
        if (INJECTED_TYPE.test(paramType)) continue;
        if (/^\s*Option\s*</.test(paramType)) continue;
        required.push(paramName);
        if (paramName === 'payload') {
          // `payload: WriteFilePayload` - the fields live in that struct, and a
          // call site through the payload helper never spells `payload` itself.
          const name = paramType.trim().split('::').pop() ?? '';
          if (/^\w+$/.test(name)) payloadStruct = name;
        }
      }
      commands.set(name, { command: name, required, payloadStruct });
    }
  }
  return commands;
}

type RustPayloadStruct = { fields: string[] };

/**
 * Fields a payload struct requires from the renderer. `Option<..>`, `#[serde(default)]`
 * and `#[serde(skip_serializing_if=..)]` fields are optional and are not listed.
 */
function rustPayloadStructs(): Map<string, RustPayloadStruct> {
  const structs = new Map<string, RustPayloadStruct>();
  for (const file of walk(rustRoot, ['.rs'])) {
    const text = fs.readFileSync(file, 'utf8');
    const structPattern = /pub\s+struct\s+(\w+)\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = structPattern.exec(text)) !== null) {
      const [, name, body] = match;
      const fields: string[] = [];
      let optional = false;
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#[serde(')) {
          if (/default|skip_serializing_if/.test(trimmed)) optional = true;
          continue;
        }
        const field = /^(?:pub\s+)?(\w+)\s*:\s*(.+?),?$/.exec(trimmed);
        if (!field) continue;
        const [, fieldName, fieldType] = field;
        if (!optional && !/^Option\s*</.test(fieldType.trim())) fields.push(fieldName);
        optional = false;
      }
      structs.set(name, { fields });
    }
  }
  return structs;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if ('<([{'.includes(char)) depth += 1;
    if ('>)]}'.includes(char)) depth -= 1;
    if (char === ',' && depth <= 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Top-level keys of an object literal starting at `text[start] === '{'`. */
function objectLiteralKeys(text: string, start: number): { keys: string[]; hasSpread: boolean } {
  const end = matchingIndex(text, start, '{', '}');
  if (end < 0) return { keys: [], hasSpread: true };
  const body = text.slice(start + 1, end);
  const keys: string[] = [];
  let hasSpread = false;
  let depth = 0;
  let quote: string | null = null;
  let token = '';
  const flush = () => {
    const trimmed = token.trim();
    token = '';
    if (!trimmed) return;
    if (trimmed.startsWith('...')) {
      hasSpread = true;
      return;
    }
    const key = /^(['"`]?)([\w$]+)\1\s*:/.exec(trimmed);
    if (key) keys.push(key[2]);
    else if (/^[\w$]+$/.test(trimmed)) keys.push(trimmed);
  };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      token += char;
      if (char === quote && body[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      token += char;
      continue;
    }
    if ('<([{'.includes(char)) depth += 1;
    if ('>)]}'.includes(char)) depth -= 1;
    if (char === ',' && depth <= 0) {
      flush();
      continue;
    }
    token += char;
  }
  flush();
  return { keys, hasSpread };
}

type CallSite = {
  file: string;
  line: number;
  command: string;
  keys: string[];
  hasSpread: boolean;
  /** True for `invokeBackend`, which builds the `payload` wrapper itself. */
  wrapped: boolean;
};

function invokeCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of walk(tsRoot, ['.ts', '.tsx'])) {
    if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // `invokeBackend` is the shared payload/casing helper; both spellings reach a
    // Rust command, so both have to satisfy the contract.
    const pattern = /(?<![\w.$])(invokeBackend|invoke)\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const wrapped = match[1] === 'invokeBackend';
      let cursor = match.index + match[0].length;
      if (text[cursor] === '<') {
        const genericsEnd = matchingIndex(text, cursor, '<', '>');
        if (genericsEnd < 0) continue;
        cursor = genericsEnd + 1;
      }
      while (/\s/.test(text[cursor] ?? '')) cursor += 1;
      if (text[cursor] !== '(') continue;
      const argsEnd = matchingIndex(text, cursor, '(', ')');
      if (argsEnd < 0) continue;
      const args = text.slice(cursor + 1, argsEnd);
      const commandMatch = /^\s*(['"])([\w-]+)\1/.exec(args);
      if (!commandMatch) continue;
      const command = commandMatch[2];
      const rest = args.slice(commandMatch[0].length);
      const line = text.slice(0, match.index).split('\n').length;
      if (!/^\s*,/.test(rest)) {
        sites.push({ file, line, command, keys: [], hasSpread: false, wrapped });
        continue;
      }
      const braceIndex = args.indexOf('{', args.indexOf(commandMatch[0]) + commandMatch[0].length);
      if (braceIndex < 0) {
        sites.push({ file, line, command, keys: [], hasSpread: true, wrapped });
        continue;
      }
      const { keys, hasSpread } = objectLiteralKeys(args, braceIndex);
      sites.push({ file, line, command, keys, hasSpread, wrapped });
    }
  }
  return sites;
}

const toCamelCase = (name: string) => name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

describe('Tauri invoke argument contract', () => {
  const commands = rustCommands();
  const payloadStructs = rustPayloadStructs();
  const sites = invokeCallSites();

  it('finds both sides of the contract', () => {
    expect(commands.size).toBeGreaterThan(50);
    expect(sites.length).toBeGreaterThan(30);
  });

  it('passes every required Rust argument at every call site', () => {
    const problems: string[] = [];
    for (const site of sites) {
      const spec = commands.get(site.command);
      if (!spec) continue;
      if (site.hasSpread) continue;
      const relative = path.relative(repoRoot, site.file).replace(/\\/g, '/');
      if (site.wrapped) {
        // The helper wraps these keys in `payload`, so what matters is that they
        // cover the fields the Rust payload struct actually requires.
        const struct = spec.payloadStruct ? payloadStructs.get(spec.payloadStruct) : undefined;
        if (!struct) continue;
        for (const field of struct.fields) {
          if (!site.keys.includes(toCamelCase(field))) {
            problems.push(`${relative}:${site.line} invoke('${site.command}') is missing '${toCamelCase(field)}'`);
          }
        }
        continue;
      }
      for (const param of spec.required) {
        if (!site.keys.includes(toCamelCase(param))) {
          problems.push(`${relative}:${site.line} invoke('${site.command}') is missing '${toCamelCase(param)}'`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('covers the shared payload helper, so new commands cannot skip the check', () => {
    expect(sites.some((site) => site.wrapped)).toBe(true);
    expect(payloadStructs.size).toBeGreaterThan(5);
  });
});
