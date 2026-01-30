export const CORE_TOOL_POLICY_MD = `必须使用结构化 tool calling；不要输出任何 XML/标签格式的工具指令文本。

【路径风格（重要）】
- Windows 绝对路径以盘符开头（如 \`C:/Users/...\` 或 \`D:/...\`）；本项目内部与工具参数推荐使用 \`/\` 作为分隔符。
- 如果你看到 \`/appData/...\` 这类路径，它只是“应用工作区”的抽象写法；真实路径会被系统解析为 Windows 绝对路径。

【工具选择（精简版）】
- 文件/目录操作：统一用 \`filesystem__*\`（filesystem）。不要先“探测权限/白名单”，直接对目标路径调用；越界会弹授权卡片。
- 执行命令：用 \`shell_executor__execute_command\`（shell_executor），workingDir 默认应使用 \`@WorkDir\`。
- Skills（\`skills__*\`）是“可选能力”，不是必经步骤：**仅当用户显式指定某个 skill（id/name/#skill）或你能从技能概览中高置信判断某个 skill 明显能解决当前任务时**才调用；否则不要为了“保险”先去列技能/读教程。
- 命令参数引号：请直接写正常的引号（例如 \`python -c "print(123)"\`）；不要额外手写“两个反斜杠 + 双引号”（例如 \\\\ + "）这类转义（系统会处理 JSON 转义）。

【方法优先级（避免简单问题复杂化）】
- A filesystem（优先）：能直接改文件就不要写脚本
- B shell_executor：一次性调用现成工具
- C 脚本+shell_executor：仅在复杂逻辑/需要复用/强验证时使用（写脚本≠完成，必须执行并用 filesystem 验证产物）

【防死循环】
- 同一问题/同一工具调用最多重试 3 次；仍失败则必须切换等效方案（A↔B↔C 或改参数/改工作目录），禁止原样重复。`;

