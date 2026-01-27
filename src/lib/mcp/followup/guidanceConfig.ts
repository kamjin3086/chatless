import type { GuidanceRule } from './types';

/**
 * 规则集：用于“工具结果→下一步动作”的统一指引。
 *
 * 设计原则：
 * - 规则必须可组合、可替换（避免在 orchestrator 里写 if/else 补丁）
 * - 指引必须“动作化”：要么继续调用具体工具，要么直接给出最终答复
 * - 不在这里硬编码 OS 路径/环境（交给 user_fs / skills_fs 的工具约束去表达）
 */
export const DEFAULT_GUIDANCE_RULES: GuidanceRule[] = [
  // skills_fs：skillId 伪造/误用纠错（资源名被当成 skillId）
  {
    id: 'skills_fs_invalid_skill_id_fix',
    priority: 950,
    match: { server: 'skills_fs', kind: 'tool_error', resultIncludes: ['Invalid skillId'] },
    guidance: () =>
      [
        'skills_fs 调用失败：skillId 不合法（很可能把资源文件名当成了 skillId）。',
        '规则：skillId 必须严格来自 skills.list_available_skills 的返回 id（例如 docx）。',
        '下一步：调用 skills.list_available_skills 获取合法 id，然后用同一个 resourcePath 重试 skills_fs.read_skill_resource（skillId 换成合法的）。',
      ].join('\n'),
  },

  // 连接问题：允许直接重试同一工具
  {
    id: 'generic_connection_error_retry',
    priority: 1000,
    match: { kind: 'connection_error' },
    guidance: () =>
      '上述调用因连接/传输问题失败。请直接重试同一工具调用（参数不变即可），不要输出自然语言解释。',
  },

  // 工具失败：要求基于错误纠错后重试或换工具
  {
    id: 'generic_tool_error_fix_or_switch',
    priority: 900,
    match: { kind: 'tool_error' },
    guidance: () =>
      '上述调用失败。请根据错误信息纠正参数后重试，或选择更合适的工具；仅输出必要的工具调用。',
  },

  // 空结果：要求调整参数/范围再试
  {
    id: 'generic_empty_result_adjust',
    priority: 800,
    match: { kind: 'empty' },
    guidance: () =>
      '上述调用返回空结果。请调整参数（更换路径/关键词/范围）后重试，或改用其他工具补齐信息。',
  },

  // skills：列出可用技能后，必须继续拉取说明
  {
    id: 'skills_list_then_get_instructions',
    priority: 700,
    match: { server: 'skills', tool: 'list_available_skills', kind: 'success' },
    guidance: () =>
      '已获取技能列表。下一步：调用 skills.get_skill_instructions({ skillId: "技能ID" }) 获取使用指南。',
  },

  // skills：拿到使用指南后，下一步应列出 actions（若有）或读取资源并执行
  {
    id: 'skills_get_instructions_next',
    priority: 650,
    match: { server: 'skills', tool: 'get_skill_instructions', kind: 'success' },
    guidance: (ctx) => {
      const resultStr = typeof ctx.result === 'string' ? ctx.result : JSON.stringify(ctx.result);
      const looksInstructionOnly =
        resultStr.includes('无可执行actions') || resultStr.includes('自学习和自主执行模式');
      if (looksInstructionOnly) {
        return [
          '已获取技能使用指南（instruction-only，无预定义 actions）。',
          '下一步：使用 skills_fs.list_skill_resources / skills_fs.read_skill_resource（如需示例/模板），然后使用 user_fs.* 在用户授权目录内创建/修改文件，必要时用 shell_executor 执行命令。',
          '禁止：不要重复调用 list_available_skills / get_skill_instructions。',
        ].join('\n');
      }
      return '已获取技能使用指南。下一步：调用 skills.list_skill_actions({ skillId }) 并按需执行 actions。';
    },
  },

  // skills：run_all_skill_actions instruction-only guard
  {
    id: 'skills_run_all_instruction_only_guard',
    priority: 640,
    match: { server: 'skills', tool: 'run_all_skill_actions', kind: 'success', resultIncludes: ['"actionId":"instruction"'] },
    guidance: () =>
      'skill 返回的是“仅指南（未执行）”。禁止声称已创建文件/已运行命令。请按指南逐步调用 skills_fs/user_fs/shell_executor 完成真实操作。',
  },

  // filesystem（MCP fs）：写入成功后，应该直接收敛回答
  {
    id: 'mcp_filesystem_write_success_finish',
    priority: 600,
    match: { server: 'filesystem', tool: 'write_file', kind: 'success', resultIncludes: ['File written successfully'] },
    guidance: () =>
      '文件写入成功。现在请直接向用户说明已完成（包含文件路径/下一步建议），不要再调用任何工具。',
  },

  // 默认：成功则让模型基于结果回答，必要时补齐
  {
    id: 'generic_success_answer_or_continue',
    priority: 0,
    match: { kind: 'success' },
    guidance: () =>
      '上述调用已返回结果。若信息已足够：直接给出最终答案；若仍不足：继续调用最相关的工具补齐缺口（避免无意义探索）。',
  },
];

