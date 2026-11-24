import { readAndroidDocumentAttachment } from '@/lib/documents/android/androidDocumentAttachment';
import {
  ANDROID_DOCUMENT_MAX_EXCERPT_LINES,
  ANDROID_DOCUMENT_SERVER,
  isAndroidDocumentTool,
} from '@/lib/mcp/nativeTools/androidDocument';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

const MAX_QUERY = 120;
const MAX_MATCHES = 3;
const MAX_MATCH_CHARS = 240;
const MAX_EXCERPT_CHARS = 1200;

type Source = { page: number } | { lineStart: number; lineEnd: number };

function failure(code: string, message: string) {
  return { ok: false, error: { code, message } };
}

function sectionsFor(format: 'pdf' | 'text', sections: string[]): string[] {
  return format === 'pdf' ? sections : sections[0].split(/\r\n|\n|\r/);
}

function boundedSlice(text: string, start: number, limit: number): string {
  return text
    .slice(start, start + limit)
    .replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '');
}

function isSourcePosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export class AndroidDocumentAdapter implements ToolAdapter {
  readonly server = ANDROID_DOCUMENT_SERVER;

  canHandle(invocation: ToolInvocation): boolean {
    return (
      isAndroidTauri() &&
      isAndroidDocumentTool(invocation.server, invocation.tool)
    );
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const { args, conversationId, tool } = invocation;
    if (tool === 'search') {
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      if (!query || query.length > MAX_QUERY) {
        return failure(
          'INVALID_DOCUMENT_QUERY',
          `Search requires a term of 1 to ${MAX_QUERY} characters.`,
        );
      }
      const document = await readAndroidDocumentAttachment(conversationId);
      if (!document)
        return failure(
          'DOCUMENT_UNAVAILABLE',
          'No document is attached to this conversation.',
        );
      const { name, handle, format } = document;
      const pattern = new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'iu',
      );
      const sections = sectionsFor(format, document.sections);
      const matches: { source: Source; text: string; truncated: boolean }[] =
        [];
      let truncated = false;
      for (const [index, section] of sections.entries()) {
        const text = section.trim();
        const found = text.search(pattern);
        if (found < 0) continue;
        if (matches.length === MAX_MATCHES) {
          truncated = true;
          break;
        }
        const start = Math.min(
          Math.max(0, found - 60),
          Math.max(0, text.length - MAX_MATCH_CHARS),
        );
        matches.push({
          source:
            format === 'pdf'
              ? { page: index + 1 }
              : { lineStart: index + 1, lineEnd: index + 1 },
          text: boundedSlice(text, start, MAX_MATCH_CHARS),
          truncated: text.length > MAX_MATCH_CHARS,
        });
      }
      return { ok: true, name, handle, matches, truncated };
    }

    const { handle, start } = args ?? {};
    const end = args?.end === undefined ? start : args.end;
    if (typeof handle !== 'string' || !handle || handle.length > 36) {
      return failure(
        'INVALID_DOCUMENT_HANDLE',
        'Use the current document handle returned by search.',
      );
    }
    if (
      !isSourcePosition(start) ||
      !isSourcePosition(end) ||
      end < start ||
      end - start >= ANDROID_DOCUMENT_MAX_EXCERPT_LINES
    ) {
      return failure(
        'INVALID_DOCUMENT_RANGE',
        `Request one page or up to ${ANDROID_DOCUMENT_MAX_EXCERPT_LINES} consecutive lines.`,
      );
    }
    const document = await readAndroidDocumentAttachment(
      conversationId,
      handle,
    );
    if (!document)
      return failure(
        'DOCUMENT_UNAVAILABLE',
        'This document is no longer in scope. Search the current attachment again.',
      );

    const { name, format } = document;
    const sections = sectionsFor(format, document.sections);
    if (end > sections.length || (format === 'pdf' && end !== start)) {
      return failure(
        'INVALID_DOCUMENT_RANGE',
        'The requested page or line range is not available.',
      );
    }
    const raw = sections.slice(start - 1, end).join('\n');
    const text = boundedSlice(raw, 0, MAX_EXCERPT_CHARS);
    const source: Source =
      format === 'pdf'
        ? { page: start }
        : { lineStart: start, lineEnd: start + text.split('\n').length - 1 };
    return {
      ok: true,
      name,
      source,
      text,
      truncated: text.length < raw.length,
    };
  }
}
