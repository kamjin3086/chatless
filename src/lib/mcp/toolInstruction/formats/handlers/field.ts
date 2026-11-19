/**
 * The three text-call shapes seen in the field (#156, collected in #165).
 *
 * These are not OpenAI's JSON or the MCP XML the other handlers cover; they are
 * what aggregator endpoints and specific models actually emit when the request
 * carries no `tools`:
 *
 * - `[[calling knowledge__search with query: 卡布奇诺 温度]]` — the bracketed form
 *   an aggregator-side prompt produced.
 * - `<|tool_call>call:knowledge__list{}<tool_call|>` — Gemma-style opener.
 * - `<｜DSML｜tool_calls><｜DSML｜invoke name="knowledge__list">…` — DeepSeek's
 *   full-width tags.
 *
 * All three name the tool as `server__tool`, which is the name the prompt track
 * advertises, so the split is here and nowhere else.
 */

import type {
  CleanOptions,
  FormatHandler,
  ParsedToolCall,
  ProcessResult,
  ToolCallFormat,
} from '../types';

/** `knowledge__search` -> `{ server: 'knowledge', tool: 'search' }`. */
function splitToolName(name: string): { server: string; tool: string } | null {
  const separator = name.indexOf('__');
  if (separator <= 0 || separator === name.length - 2) return null;
  return { server: name.slice(0, separator), tool: name.slice(separator + 2) };
}

export class BracketCallingHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'bracket_calling';
  readonly description = 'Bracketed [[calling server__tool with query: …]] form';
  readonly priority = 7;

  private static readonly pattern =
    /\[\[\s*calling\s+([A-Za-z0-9_.-]+)\s*(?:with\s+([^\]]*?))?\s*\]\]/gi;

  mightContain(text: string): boolean {
    return /\[\[\s*calling/i.test(text);
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(BracketCallingHandler.pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const named = splitToolName(match[1]);
      if (!named) continue;
      results.push({
        server: named.server,
        tool: named.tool,
        args: parseWithClause(match[2]),
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'bracket_calling',
        confidence: 0.9,
      });
    }
    return results;
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }
    const removedFragments: string[] = [];
    const cleaned = text.replace(
      new RegExp(BracketCallingHandler.pattern.source, 'gi'),
      (match) => {
        removedFragments.push(match);
        return '';
      },
    );
    return {
      text: cleaned.trim(),
      toolCalls: this.parse(text),
      processed: removedFragments.length > 0,
      removedFragments,
    };
  }
}

/**
 * `with query: 卡布奇诺 温度` -> `{ query: '卡布奇诺 温度' }`.
 *
 * A clause without a key is still the thing the user asked for, and these
 * endpoints write `query` when they write a key at all, so it becomes the query
 * rather than an empty call the loop would reject.
 */
function parseWithClause(clause: string | undefined): Record<string, unknown> | undefined {
  const value = String(clause ?? '').trim();
  if (!value) return undefined;
  const pair = /^([A-Za-z_][\w.-]*)\s*:\s*([\s\S]*)$/.exec(value);
  if (pair) return { [pair[1]]: pair[2].trim() };
  return { query: value };
}

export class GemmaToolCallHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'gemma_tool_call';
  readonly description = 'Gemma-style <|tool_call>call:server__tool{…}<tool_call|>';
  readonly priority = 8;

  private static readonly pattern = /<\|tool_call>([\s\S]*?)<tool_call\|>/gi;
  private static readonly looseTag = /<\/?\|?tool_call\|?>/gi;

  mightContain(text: string): boolean {
    return text.includes('<|tool_call>');
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(GemmaToolCallHandler.pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const body = match[1].trim();
      const call = /^call:\s*([A-Za-z0-9_.-]+)\s*([\s\S]*)$/i.exec(body);
      if (!call) continue;
      const named = splitToolName(call[1]);
      if (!named) continue;
      results.push({
        server: named.server,
        tool: named.tool,
        args: parseJsonObject(call[2]),
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'gemma_tool_call',
        confidence: 0.9,
      });
    }
    return results;
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }
    const removedFragments: string[] = [];
    let cleaned = text.replace(
      new RegExp(GemmaToolCallHandler.pattern.source, 'gi'),
      (match) => {
        removedFragments.push(match);
        return '';
      },
    );
    // The opener or the closer can survive a truncated answer; neither is prose.
    cleaned = cleaned.replace(GemmaToolCallHandler.looseTag, (match) => {
      removedFragments.push(match);
      return '';
    });
    return {
      text: cleaned.trim(),
      toolCalls: this.parse(text),
      processed: removedFragments.length > 0,
      removedFragments,
    };
  }
}

export class DeepSeekDsmlHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'deepseek_dsml';
  readonly description = 'DeepSeek full-width <｜DSML｜> invoke/parameter tags';
  readonly priority = 9;

  private static readonly invokePattern =
    /<｜DSML｜invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/｜DSML｜invoke>/gi;
  private static readonly parameterPattern =
    /<｜DSML｜parameter\s+name=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/｜DSML｜parameter>/gi;
  private static readonly envelopePattern =
    /<\/?｜DSML｜(?:tool_calls|tool_calls_end|function_calls)>/gi;

  mightContain(text: string): boolean {
    return text.includes('｜DSML｜');
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(DeepSeekDsmlHandler.invokePattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const named = splitToolName(match[1].trim());
      if (!named) continue;
      results.push({
        server: named.server,
        tool: named.tool,
        args: parseParameters(match[2]),
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'deepseek_dsml',
        confidence: 0.92,
      });
    }
    return results;
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }
    const removedFragments: string[] = [];
    let cleaned = text.replace(
      new RegExp(DeepSeekDsmlHandler.invokePattern.source, 'gi'),
      (match) => {
        removedFragments.push(match);
        return '';
      },
    );
    cleaned = cleaned.replace(DeepSeekDsmlHandler.envelopePattern, (match) => {
      removedFragments.push(match);
      return '';
    });
    return {
      text: cleaned.trim(),
      toolCalls: this.parse(text),
      processed: removedFragments.length > 0,
      removedFragments,
    };
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const value = String(raw ?? '').trim();
  if (!value) return undefined;
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(value.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `<｜DSML｜parameter name="query" string="true">卡布奇诺 温度</｜DSML｜parameter>`
 *
 * `string="true"` says the value is text; without it the value is JSON when it
 * parses and text otherwise, which is what the model meant for `1` or `true`.
 */
function parseParameters(body: string): Record<string, unknown> | undefined {
  const args: Record<string, unknown> = {};
  const pattern = new RegExp(DeepSeekDsmlHandler['parameterPattern'].source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const [, name, attributes, rawValue] = match;
    const value = rawValue.trim();
    const isString = /string=["']true["']/i.test(attributes);
    if (isString) {
      args[name] = value;
      continue;
    }
    try {
      args[name] = JSON.parse(value);
    } catch {
      args[name] = value;
    }
  }
  return Object.keys(args).length > 0 ? args : undefined;
}
