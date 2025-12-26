/**
 * Markdown 渲染前预处理（安全/稳定）
 *
 * 目标：
 * - 禁止 raw HTML 被当作真实 DOM 渲染（否则会污染聊天 UI 布局）
 * - 保持代码围栏/行内代码内容原样（用户希望通过代码块展示代码）
 *
 * 策略：
 * 1) 若检测到“完整 HTML 文档”且未处于代码围栏中：自动包裹为 ```html ... ```
 * 2) 否则：在非代码区域将 `<`/`>` 转义为 `&lt;`/`&gt;`，避免被当作 HTML 注入
 */

type PreprocessOptions = {
  /** 当文本看起来像完整 HTML 文档时，自动包裹为 ```html 代码块 */
  wrapFullHtmlDocument?: boolean;
};

export function preprocessMarkdownForSafeRender(
  input: string,
  opts?: PreprocessOptions
): string {
  const raw = String(input || '');
  if (!raw) return '';

  const wrapDoc = opts?.wrapFullHtmlDocument !== false;
  if (wrapDoc && looksLikeStandaloneHtmlDocument(raw) && !hasAnyFencedCodeBlock(raw)) {
    return ['```html', raw.trimEnd(), '```'].join('\n');
  }

  // 关键稳定性：修复“围栏不在行首 / 围栏头部后没有换行”导致的代码块断裂
  // 例如："</think>```html<!DOCTYPE ..." → "</think>\n```html\n<!DOCTYPE ..."
  const normalized = normalizeFencesOutsideCode(raw);
  return escapeHtmlOutsideCode(normalized);
}

function looksLikeStandaloneHtmlDocument(s: string): boolean {
  const t = s.trimStart();
  // 必须“很像一个完整 HTML 文件”，避免误把普通回答中的零星标签包成代码块
  const startsLikeHtml = /^<!doctype\s+html\b/i.test(t) || /^<html\b/i.test(t);
  if (!startsLikeHtml) return false;

  // 更强约束：包含 head/body 任一或 html 闭合
  const hasStructure = /<head\b/i.test(t) || /<body\b/i.test(t) || /<\/html>/i.test(t);
  return hasStructure;
}

function hasAnyFencedCodeBlock(s: string): boolean {
  return /```/.test(s);
}

/**
 * 规范化 fenced code：
 * - 打开围栏 ``` 必须从行首开始（或前面是换行）
 * - 打开围栏行（```lang）后必须紧跟换行
 *
 * 注意：只在“非代码区域”处理，避免改坏用户代码内容。
 */
function normalizeFencesOutsideCode(input: string): string {
  let out = '';
  let i = 0;
  let inFence = false;
  let inInline = false;

  while (i < input.length) {
    // fenced code 切换（仅在非 inline 中生效）
    if (!inInline && input.startsWith('```', i)) {
      if (!inFence) {
        // 进入 fence：确保 ``` 在行首
        if (out.length > 0) {
          const prev = out[out.length - 1];
          if (prev !== '\n') out += '\n';
        }
        out += '```';
        i += 3;

        // 仅复制“语言标记”本身（字母/数字/_/-），避免把代码正文误并入 ```lang 行
        const rest = input.slice(i);
        const mLang = rest.match(/^([a-zA-Z0-9_-]+)/);
        if (mLang && mLang[1]) {
          out += mLang[1];
          i += mLang[1].length;
        }

        // 确保围栏头部行后紧跟换行：若原文不是换行，插入一个换行，但不吞掉后续正文
        if (i < input.length) {
          if (input[i] === '\r') {
            // 将 CRLF/CR 统一为 \n
            out += '\n';
            i += 1;
            if (i < input.length && input[i] === '\n') i += 1;
          } else if (input[i] === '\n') {
            out += '\n';
            i += 1;
          } else {
            out += '\n';
          }
        } else {
          out += '\n';
        }

        inFence = true;
        continue;
      } else {
        // 退出 fence：保持原样输出围栏
        out += '```';
        i += 3;
        inFence = false;
        continue;
      }
    }

    // inline code 切换（仅在非 fence 中生效）
    const ch = input[i];
    if (!inFence && ch === '`') {
      inInline = !inInline;
      out += '`';
      i += 1;
      continue;
    }

    // fence 内完全原样
    out += ch;
    i += 1;
  }

  return out;
}

/**
 * 在“代码围栏/行内代码”之外转义 < >
 *
 * - fenced code: ``` ... ```
 * - inline code: `...`
 */
function escapeHtmlOutsideCode(input: string): string {
  let out = '';
  let i = 0;
  let inFence = false;
  let inInline = false;

  while (i < input.length) {
    // fenced code 切换（仅在非 inline 中生效）
    if (!inInline && input.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 3;
      continue;
    }

    // inline code 切换（仅在非 fence 中生效）
    const ch = input[i];
    if (!inFence && ch === '`') {
      inInline = !inInline;
      out += '`';
      i += 1;
      continue;
    }

    if (!inFence && !inInline) {
      if (ch === '<') out += '&lt;';
      else if (ch === '>') out += '&gt;';
      else out += ch;
    } else {
      out += ch;
    }
    i += 1;
  }

  return out;
}


