import type { PromptBlock } from '@/lib/mcp/prompt/composition';
import type { SkillInvocationPolicy } from './types';
import { invocableByModel, invocableByUser } from './invocation';

/**
 * 技能索引（Skill index）：模型在本机上能看见的那份 skill 清单。
 *
 * 这是缝的一侧，另一侧是 provider（`SkillManager`，管磁盘、来源与启用态）。这里不读
 * store、不碰文件系统、不 import Tauri：输入是已经加载好的窄视图，输出是要进 system
 * prompt 的两段文本。索引因此可以脱离应用被直接测试——而它一旦不能被直接测试，这条缝
 * 上就已经积累过四条没人走通的路径。
 *
 * 两条正交的事分开判：
 * - 「谁能触发」由 `invocableByModel` 判（来自 frontmatter，见 invocation.ts）；
 * - 「这台机器能不能用」将来由适用性判（平台/能力），目前还没有需求，所以这里不留空转的参数位。
 */

/** 单条描述的上限：再短就切掉 "Use when …"，那正是路由用的半句。 */
export const SKILL_DESCRIPTION_MAX_CHARS = 320;

/** 索引正文的字节预算。超了不是截断，是整份退回常驻行——半份清单会诱导误选。 */
export const SKILL_INDEX_BUDGET_CHARS = 1200;

/** 缝看到的窄视图，不是持久化里的 23 字段记录。 */
export interface SkillIndexEntryView {
  id: string;
  name: string;
  description: string;
  invocation?: SkillInvocationPolicy;
}

export interface SkillIndexFacts {
  /** 本条消息里用户点名的 skill（用户指定只活到它所属的那次发送）。 */
  explicitIds?: string[];
}

export interface SkillIndexView {
  /** 模型可见的那些（已过滤、已排序）。 */
  entries: SkillIndexEntryView[];
  /** 常驻行：有 skill 可用时才有内容。 */
  availabilityLine: string | null;
  /** 索引正文；超出预算时为 null，此时只保留常驻行。 */
  indexText: string | null;
  /** 为什么没有索引正文。 */
  overflowed: boolean;
  /** 用户可点名、但模型不该自动加载的那些 id。 */
  userOnlyIds: string[];
}

function descriptionOf(entry: SkillIndexEntryView): string {
  const raw = String(entry.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '(no description)';
  if (raw.length <= SKILL_DESCRIPTION_MAX_CHARS) return raw;
  return `${raw.slice(0, SKILL_DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`;
}

function lineFor(entry: SkillIndexEntryView, requested: Set<string>): string {
  const name = String(entry.name || entry.id).trim();
  const mark = requested.has(entry.id)
    ? ' [user requested - read this guide first]'
    : '';
  return `- ${name} (\`${entry.id}\`)${mark}: ${descriptionOf(entry)}`;
}

/**
 * 由已启用的 skill 构造模型可见的索引。
 *
 * 排序按 `id`：它稳定、与 locale 无关，所以 system prompt 的缓存前缀不会因为界面换了
 * 语言就整段漂移（`name.localeCompare` 就做不到这一点）。
 */
export function buildSkillIndex(
  skills: readonly SkillIndexEntryView[],
  facts: SkillIndexFacts = {},
): SkillIndexView {
  const requested = new Set(
    (facts.explicitIds || []).map((id) => String(id).trim()).filter(Boolean),
  );
  const byId = new Map<string, SkillIndexEntryView>();
  for (const skill of skills) {
    if (skill?.id) byId.set(skill.id, skill);
  }

  // 用户点名的那些必须到达模型，哪怕它的策略本来不让模型自己加载。
  const visible = (skills || []).filter(
    (skill) =>
      skill?.id &&
      (invocableByModel(skill.invocation) || requested.has(skill.id)),
  );
  const sorted = [...visible].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const userOnlyIds = (skills || [])
    .filter(
      (skill) =>
        skill?.id &&
        !invocableByModel(skill.invocation) &&
        invocableByUser(skill.invocation),
    )
    .map((skill) => skill.id)
    .sort();

  if (sorted.length === 0) {
    return {
      entries: [],
      availabilityLine: null,
      indexText: null,
      overflowed: false,
      userOnlyIds: [],
    };
  }

  const availabilityLines = [
    '[Skills]',
    'Skills are installed on this device. Read one with skill__guide(id) before acting on it:',
    'a guide says how to combine the tools you already have, and it grants nothing - approval works as usual.',
  ];
  if (userOnlyIds.length > 0) {
    availabilityLines.push(
      `User-invoked only, the user names them: ${userOnlyIds.map((id) => `/${id}`).join(', ')}. Do not load one unasked.`,
    );
  }

  const body = [
    '[Skills installed here]',
    'Names only - the instructions are not here.',
    ...sorted.map((entry) => lineFor(entry, requested)),
  ].join('\n');

  const overflowed = body.length > SKILL_INDEX_BUDGET_CHARS;
  if (overflowed) {
    availabilityLines.push(
      `The list is long (${sorted.length} skills): skill__list(query) searches it.`,
    );
    return {
      entries: sorted,
      availabilityLine: availabilityLines.join('\n'),
      indexText: null,
      overflowed: true,
      userOnlyIds,
    };
  }

  return {
    entries: sorted,
    availabilityLine: availabilityLines.join('\n'),
    indexText: body,
    overflowed: false,
    userOnlyIds,
  };
}

/**
 * 索引要变成哪两个 prompt block。
 *
 * 分开两块不是因为它们是两段不同的重要文本，而是为了让 `changedBlockIds` 能说出
 * 是哪部分变了：合成一块后，任何一处改变都只报「这块变了」，而这两块的变化频率本来
 * 就不同（前者只在有无 skill 之间变，后者随清单内容变）。两条都在 conversation 层：
 * 它们与本轮措辞无关，放 turn 层每轮重拼只会白白打断缓存前缀。
 */
export function skillIndexBlocks(view: SkillIndexView): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  if (view.availabilityLine) {
    blocks.push({
      id: 'skill-availability',
      layer: 'conversation',
      order: 75,
      content: view.availabilityLine,
    });
  }
  if (view.indexText) {
    blocks.push({
      id: 'skills-index',
      layer: 'conversation',
      order: 80,
      content: view.indexText,
    });
  }
  return blocks;
}
