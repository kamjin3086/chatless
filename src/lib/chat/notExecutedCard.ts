/**
 * The card an unreadable look-alike call becomes (#166, part of #161).
 *
 * On the prompt track the parser suppresses markup from the first call marker on.
 * When it also fails to read a call out of that text, suppressing it silently
 * would make the model's attempt disappear - the user sees an answer that stops
 * and no reason. This state says what happened and the one thing to change; the
 * card uses the existing `error` status, so the UI keeps one vocabulary.
 *
 * Pure, so the segment test can assert it the way `toolCardTiming.test.ts` asserts the
 * timing rules: no store, no handler.
 */

export interface NotExecutedCardState {
  /** Best effort from the markup (`knowledge__search`); neutral when it names none. */
  server: string;
  tool: string;
  /**
   * The row's message: `未执行` first, the model's own text, then the remedy. The
   * card collapses this and shows the first line; expanding shows all of it.
   */
  errorMessage: string;
}

export function notExecutedCardState(rawText: string): NotExecutedCardState {
  const text = String(rawText || '');
  const named = /([A-Za-z][\w.-]*)__([\w.-]+)/.exec(text);
  return {
    server: named ? named[1] : '未知服务',
    tool: named ? named[2] : '工具调用',
    errorMessage:
      `未执行：模型把工具调用写成了文字，应用没有执行。\n\n${text}\n\n` +
      '开启该服务的「原生API」，或换一个支持工具调用的模型。',
  };
}
