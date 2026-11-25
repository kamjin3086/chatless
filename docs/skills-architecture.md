# Skills：现状与边界

> 状态（2026-11-25 按 `main` 重写）。上一版有 940 行，其中大半是设计期蓝图——执行器、事件总线、
> 独立的 FS 权限模型、五种执行模式、Hooks 生命周期、那份数据库表——它们**从来没有实现过**，
> 并行的那套执行引擎也在 2026-11 被删（#237、#244）。今天的 Skills 是「一套资产 + 一条缝」。
> 想读当年的设计意图，去 git 历史；不要再往本文里补设计。

## 一句话

Skills 是用户装在本机的 `SKILL.md` 资产。运行期只有一条接线：把这些资产的**索引**注入模型
上下文，再用一组 `skill__*` 工具让模型自己去读。**没有第二个执行引擎**——技能不产生自己的
运行、审批、事件或预算，全部复用 Agent Loop 与 ToolPolicy（
[ADR-0001](adr/0001-tool-policy-is-pure-pipeline-owns-side-effects.md)、
[ADR-0003](adr/0003-one-tool-risk-table-two-predicates.md)、
[ADR-0004](adr/0004-rust-allowlist-is-the-filesystem-enforcement-point.md)）。术语以 `GLOSSARY.md`
为准（技能索引、触发方式、`rung` 三档都在那里）。

## 数据怎么走

| 环节 | 在哪 |
|---|---|
| 取资产 | `src/lib/skills/SkillManager.ts`：本机技能目录（`getSkillsBasePath`，`appDataDir()` 下的 `skills/`）、zip 导入（`importFromZip`）、git clone / 更新（`cloneFromGit`、`updateSkillFromGit`）、远程下载（`RemoteSkillLoader.ts`、`LocalSkillLoader.ts`） |
| 记账，不是门禁 | `integrity.ts` 记来源种类（official / third_party / local / unknown）与内容哈希；`SkillValidator.ts` 校验 SKILL.md 格式，但**今天没有安装路径调用它**；`dependencyChecker.ts` 只在界面里给安装建议（`src/components/skills/DependencyInstallGuide.tsx`）。别把这一列当成"装之前都会过一遍"——它不是 |
| 解析 | `SkillMdParser.ts` 读 frontmatter。它真正读的键是固定的（`READ_KEYS`：`name`、`description`、`version`、`author`、`dependencies`、`tags`、`category`、`hooks`、`triggers`、`actions` 加三个触发键），**大小写敏感**（`Allowed-Tools` 不认），写了不认识的键会给告警，而 `types.ts` 里的 `parameters` 根本不在读取名单里。`allowed-tools` 既吃空格分隔字符串也吃 YAML 列表 |
| 用户点名某个技能 | `src/components/chat/skillsSlash.ts` 列出可被用户点名的技能并往输入框插 `/<id> `；消息带着 `explicitSkillIds` 下去，`skillIndex.ts` 把它单独收成 `skills-requested` 提示块（order 15），由 `src/lib/mcp/injection/promptBuilder.ts` 拼进 system prompt（拼装走 `src/lib/mcp/agentLoop/buildAgentPromptEnvelope.ts`） |
| 模型自己读技能 | 发现类：`skill__list` / `skill__guide` / `skill__list_resources` / `skill__get_template` / `skill__check_deps`；管理类：`skill__install` / `uninstall` / `enable` / `disable` / `update` / `edit_resource`。定义在 `src/lib/mcp/nativeTools/skillUnifiedTools.ts`，执行在 `src/lib/mcp/pipeline/adapters/SkillUnifiedAdapter.ts` 与 `src/lib/skills/skillFileOperations.ts` |
| 谁能启动一个技能 | frontmatter 的 `disable-model-invocation` / `user-invocable`（`src/lib/skills/invocation.ts`）——这是权威 |
| 权限 | `ToolPolicy` 加 Rust 的文件系统允许名单（ADR-0004）。`SKILL.md` 里的 `allowed-tools` **不授予任何东西**：`SkillMdParser` 解析它，没有任何谓词读它，界面今天也不展示它。它是作者的愿望，不是权限 |

顺带一个同名陷阱：`src/lib/skills/sandbox/`（`ProcessSandbox`、`validators/CommandValidator`）还活着，
但它服务的是 `shell__run`（`ShellExecutorAdapter.ts`），不是技能执行——技能那一半已经没了。

## 那条缝：渐进式披露

只有一个入口，`src/lib/skills/skillIndex.ts`。别处不要再拼第二份技能列表进 prompt（历史上正是
第二份答案在漂移）。

- **预算**：单条描述截到 `SKILL_DESCRIPTION_MAX_CHARS`（320）；整块索引正文预算
  `SKILL_INDEX_BUDGET_CHARS`（1200）。计数单位是 UTF-16 码元而不是字节，中文因此比英文贵得多——
  索引是给模型读的，不是为了让数字好看。
- **降级阶梯**（`SkillIndexRung`）：`full`（带描述）→ `names`（只列名字，附一句先用
  `skill__guide(id)` 读）→ `none`（整块不注入）。走到哪一档由预算决定；技能列表为空时也直接是
  `none`。
- **可用性**：`skillIndexUsable(track, hasIndex)`——native 轨与 prompt 轨都能注入索引，
  `track === 'disabled'` 时整块不注入。但 `skill__*` 那组工具只在 native 请求里出现，prompt 轨
  只拿到索引文本。
- **只能用户点名的技能**不进模型的条目列表，但它们的 id 会出现在常驻那行的
  "User-invoked only, the user names them: /xxx" 里——模型知道有这些东西、且被明令不许自己加载。
- **排序按 id**：同一批技能每次发出同样的字节，system prompt 的前缀缓存不会因为界面语言或插入
  顺序漂掉。
- **纯函数**：`skillIndex.ts` 不碰 store、文件系统和时间，`skillIndexPurity.test.ts` 钉着这条，
  所以它能表驱动测试。要看阶梯的行为，先跑那个测试而不是读实现。

## 已知边界（都被测试或实现钉着，别当 bug 重报）

- `skill__list_resources` 过滤掉目录，所以 `references/` 这种子目录列不出来（只能按文件路径读）。
- `skill__guide` 一次最多返回 200 000 字符的正文。
- Hooks（`pre_execute` 之类）能被解析，**没有执行者**——写进 SKILL.md 不会有作用。
- 装依赖不靠模型：`skill__check_deps` 只是把 frontmatter 里写的依赖清单回显出来，真正给安装指引
  的是界面上的 `DependencyInstallGuide`。

## 改 Skills 之前

1. 想给技能单独一套审批 / 权限 / 预算，就是重开已经关掉的门。为什么关着写在
   ADR-0004 的 2026-11 修订（「技能包自己的文字不授予任何东西」）和 ADR-0003 的 skill 别名修订里。
2. 加一个 `skill__*` 只读工具要**同时**动 `src/lib/mcp/pipeline/policy/toolRisk.ts`（它同时决定
   planning 模式放行与免审批）和 `SkillUnifiedAdapter.ts` 的路由；`skill` 不在
   `REPLAYABLE_SERVERS` 里，新增读工具不改变重试语义。
3. 想往索引里多塞正文，先量预算再动常量。调大常量不叫解决，叫把问题挪给别人。
4. `SKILL.md` 模板在 `src/lib/skills/SKILL_TEMPLATE.md`（上一版把它链接成 docs/ 同目录下的文件，
   那是条断链）。
5. 子系统之间的接缝看 `docs/agents/subsystems.md`，本文只讲 Skills 自己。

## 被删掉的并行执行引擎（别再照旧文档找它）

`src/lib/skills/skillTools.ts`、`SkillExecutor.ts`、`SkillOrchestrator.ts`、`ActionRouter.ts`、
那套执行 UI（`SkillExecutionPlanPanel`、`SkillApprovalPanel`、`SkillActionCard`、
`SkillInvocationCard`、`SkillParameterForm`、`ExecutionConfirmDialog`）和它们的 store 都已随
#237 / #244 删除。今天要在代码里复核：

```bash
grep -rn "executeSkillTool" src    # 空
grep -rn "SkillOrchestrator" src   # 空
grep -rn "list_available_skills" src   # 只剩展示表、测试与历史注释
```

## 测试在哪

`src/lib/skills/__tests__/`：`skillIndex.test.ts`（阶梯与预算）、`skillIndexPurity.test.ts`
（那条缝的纯函数约束）、`skillMdParser.test.ts`（frontmatter 边界，含 `allowed-tools` 的两种写法）、
`invocation.test.ts`（谁能启动）、`skillFileOperations.test.ts`（工具名与边界）。策略侧在
`src/lib/mcp/pipeline/policy/__tests__/`；退役工具名不再被路由、也不进风险表，由
`src/lib/mcp/pipeline/__tests__/retiredSkillToolRouting.test.ts` 钉，展示层由
`src/components/chat/__tests__/toolCardPresentation.test.ts` 钉。跑法就是 `pnpm test`。

## 外部参考

`SKILL.md` 的字段形态沿用 Anthropic 的 Agent Skills 约定：
[anthropics/skills](https://github.com/anthropics/skills)。权限与审批不在这份约定里，那部分是
本仓库的决定，见上面的 ADR。
