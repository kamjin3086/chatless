export type InlineThinkingMode = 'think_tag' | 'reasoning_tag' | 'gpt_oss_channel';

export type InlineThinkingEvent =
  | { type: 'text'; text: string }
  | { type: 'think_start'; mode: InlineThinkingMode }
  | { type: 'think_token'; text: string }
  | { type: 'think_end'; mode: InlineThinkingMode };

export interface InlineThinkingParser {
  /**
   * 推入一段“可见正文”chunk（已通过工具指令抑制阀后的文本）。
   * 返回需要派发到 FSM 的事件序列：text / think_start / think_token / think_end。
   */
  push(chunk: string): InlineThinkingEvent[];
  /**
   * 冲刷尾部（在 onComplete/onError 时使用），返回剩余可见 text 或未闭合 thinking 的尾部内容。
   * 默认策略：若 thinking 未闭合，则把剩余内容当作 think_token（并可选择自动补 think_end）。
   */
  flush(): InlineThinkingEvent[];
}




