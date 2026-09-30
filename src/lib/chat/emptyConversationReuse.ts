/**
 * "新建对话"应该复用空白会话，而不是再堆一个空壳。
 *
 * 现实里用户会连点几次 + ：每次都建一条新会话，它们没有消息、也没有意义，
 * 最后侧边栏被一堆同名空会话占满。规则是：**空白会话有且仅有一个**——
 * 点 + 时如果已经存在，就选中它，并顺手清掉多余的空壳。
 *
 * 这里只做决策，不做副作用，便于单独测试。
 */

export type EmptyConversationPlan = {
  /** 要复用的空会话（最新的那个）；没有可复用的就是 undefined。 */
  reuse?: string;
  /** 复用之后要清理的多余空会话。 */
  remove: string[];
};

export function planEmptyConversationReuse(params: {
  /** 侧边栏顺序：最新的在前。 */
  conversationIds: string[];
  /** 数据库里确实没有任何消息的会话 id。 */
  withoutMessages: Iterable<string>;
  /** 未发送的输入草稿：有草稿的空会话不能删，那里面是用户敲过的内容。 */
  drafts?: Record<string, string | undefined>;
}): EmptyConversationPlan {
  const empty = new Set(params.withoutMessages);
  const candidates = params.conversationIds.filter((id) => empty.has(id));
  if (candidates.length === 0) return { remove: [] };

  const [reuse, ...rest] = candidates;
  const hasDraft = (id: string) => String(params.drafts?.[id] ?? '').trim().length > 0;
  return { reuse, remove: rest.filter((id) => !hasDraft(id)) };
}
