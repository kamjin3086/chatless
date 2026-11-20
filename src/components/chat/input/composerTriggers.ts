export const composerTriggers = {
  skill: '/',
  prompt: '#',
  mention: '@',
} as const;

export type ComposerTrigger =
  (typeof composerTriggers)[keyof typeof composerTriggers];

export interface ComposerQuery {
  trigger: ComposerTrigger;
  start: number;
  end: number;
  query: string;
  hasProseDelimiter?: boolean;
}

const tokenTail: Record<ComposerTrigger, RegExp> = {
  '/': /^[\p{L}\p{N}_-]*/u,
  '@': /^[^\s@]*/u,
  '#': /^[^\s#|｜]*/u,
};

export function findComposerQuery(
  text: string,
  caret: number,
): ComposerQuery | null {
  const before = text.slice(0, caret);
  const token = /(?:^|\s)(\/[\p{L}\p{N}_-]*|@[^\s@]*|#[^\s#|｜]*)$/u.exec(
    before,
  );
  if (token) {
    const trigger = token[1][0];
    if (trigger === '/' || trigger === '@' || trigger === '#') {
      const start = caret - token[1].length;
      const tokenEnd =
        caret + (tokenTail[trigger].exec(text.slice(caret))?.[0].length ?? 0);
      if (trigger === '/' && /^[./\\]/u.test(text.slice(tokenEnd))) return null;
      const delimiter =
        trigger === '#' && tokenEnd > start + 1 && !text.slice(0, start).trim()
          ? /^[ \t]*(?=[|｜])/u.exec(text.slice(tokenEnd))?.[0]
          : undefined;
      return {
        trigger,
        start,
        end: tokenEnd + (delimiter?.length ?? 0),
        query: token[1].slice(1),
        ...(delimiter !== undefined && { hasProseDelimiter: true }),
      };
    }
  }
  const prompt = /^\s*(#([^\s#|｜]+)[ \t][^\n|｜]*)$/u.exec(before);
  if (!prompt) return null;
  const delimiter = /^[ \t]*(?=[|｜])/u.exec(text.slice(caret))?.[0];
  return {
    trigger: '#',
    start: before.length - prompt[1].length,
    end: caret + (delimiter?.length ?? 0),
    query: prompt[1].slice(1),
    ...(delimiter !== undefined && { hasProseDelimiter: true }),
  };
}

export function insertComposerTrigger(
  text: string,
  start: number,
  end: number,
  trigger: ComposerTrigger,
) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const prefix = `${before}${before && !/\s$/u.test(before) ? ' ' : ''}${trigger}`;
  return {
    text: `${prefix}${after && !/^\s/u.test(after) ? ' ' : ''}${after}`,
    caret: prefix.length,
  };
}

export function replaceComposerQuery(
  text: string,
  query: ComposerQuery,
  replacement: string,
) {
  let suffix = text.slice(query.end);
  if (query.hasProseDelimiter && /^[|｜]/u.test(suffix)) {
    suffix = suffix.slice(1).trimStart();
    if (suffix && replacement) suffix = `\n${suffix}`;
  }
  if (replacement.endsWith(' ') && suffix.startsWith(' '))
    suffix = suffix.slice(1);
  const prefix = text.slice(0, query.start) + replacement;
  return { text: prefix + suffix, caret: prefix.length };
}
