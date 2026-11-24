# Chatless

本地优先的桌面 AI 聊天应用。核心域是"模型能自主动手做多少事"：一次工具调用要经过解析、策略判定、用户审批，然后才被执行。

> 标注：括号里的代码名以 `main` 为准。只有两个名字来自尚未合并的实现——`FilesystemCallResolution` 与 `ToolRisk`（在 PR #85 的 `pipeline/policy/` 里），合并之前它们在 `main` 上搜不到。

## Language

### 授权与审批

**审批回答 (ApprovalDecision)**:
用户对一次工具调用的三种回答之一：`once`（仅本次）、`always`（以后同类不必再问）、`unrestricted`（免问该范围）。它的含义随作用域变化，见下三条。
_Avoid_: 授权结果、批准级别

**记住目录**:
`always` 在文件系统作用域下的实际效果——把该目录连同日常权限写入允许名单，此后同目录内的操作不再询问。删除操作永远拿不到这个待遇。
_Avoid_: 文件系统自动授权、永久授权

**全局免问**:
`always` 在 shell 作用域下的实际效果——持久化地关掉 shell 审批，影响所有会话，不只当前这个。
_Avoid_: 永久授权

**会话免问**:
`unrestricted` 的效果——只在本会话内不再询问该作用域，进程结束即失效。文件系统和 shell 各自独立持有。
_Avoid_: 临时授权、会话信任

**调用级授予 (CallScopedGrant)**:
允许名单没覆盖、但用户刚批准了的那次调用所需的**一次性**路径权限。调用结束即回收，不会让一次批准活到下一次调用。
_Avoid_: 临时权限、路径授权

**策略快照 (Policy snapshot)**:
一次工具调用开始前读齐的判定输入（各作用域的免问状态、自动授权配置、允许名单目录）。由 pipeline 一次读好后作为普通参数传进去，策略判定不回头去读 store——这是个调用约定，不是一个类型。
_Avoid_: 权限缓存

### 路径与别名

**别名 (Alias)**:
模型可以引用的目录短名，形如 `@WorkDir`。每个别名背后必须有一个已授权目录，否则不解析。
_Avoid_: 路径变量、短路径

**@WorkDir**:
指向会话工作区的别名。当用户自己挂载了目录时，它指向那个目录；否则指向会话自带的工作文件夹——后者在模型真正要落盘时才创建。
_Avoid_: 工作目录（易与 shell cwd 混）

**挂载目录**:
用户在会话里主动挂上来的自己的目录。存在时，`@WorkDir` 让位给它，不再额外生成会话工作文件夹。
_Avoid_: 绑定目录

**未解析别名 (findUnresolvedAlias 检出)**:
参数或命令里仍带着 `@别名` 但背后没有已授权目录的状态。这是要被拒绝的——放过去就会造出一个字面量叫 `@WorkDir` 的文件夹。
_Avoid_: 无效路径

### 工具调用

**调用 (ToolInvocation)**:
模型请求的一次工具执行：哪个 server、哪个 tool、什么参数。
_Avoid_: 请求、任务

**解析后的调用 (FilesystemCallResolution)**:
把别名落成真实路径之后的调用，附带关于它的 facts：主路径、命中的目录、文件操作种类、有没有未解析别名。能被 adapter 执行的那份调用从这里取。
_Avoid_: ResolvedInvocation（与 ToolInvocation 太近）

**工具风险 (ToolRisk)**:
一个 server + tool 组合的读写性质：读、写、创建、删除。计划模式是否放行、以及失败后能否安全重放，都从这一张表派生——它俩今天恰好同判，但不是同一件事。
_Avoid_: 只读工具列表、危险工具

**可重放 (Retryable)**:
失败后可以照原样再跑一次的调用。判据是"重跑不会多造副作用"，所以只有读操作够格；写完之后的超时不算，因为无从得知副作用是否已发生。
_Avoid_: 幂等重试

**工具策略 (ToolPolicy)**:
决定一次调用能不能跑的模块。`decideFilesystemCall` / `decideServerCall` 回答放行或要问，`planFilesystemPromotion` / `planShellPromotion` 把一个审批回答翻译成状态增量；按作用域分开命名，因为同一个回答在文件系统与 shell 下含义不同。
_Avoid_: 权限检查、鉴权层

**决策 (Decision)**:
`decide*` 的产出：放行、拒绝（带机器可读原因），或者要问（带审批要转出去的载荷和批准后该授予的调用级授予）。
_Avoid_: 授权结果

**提权 (Promotion)**:
一个审批回答落到策略上的状态增量。它和"把增量写进 store / 数据库"是两件事：前者可测，后者是执行。
_Avoid_: 自动授权

**思考等级 (ThinkingLevel)**:
用户就"回答前该想多少"表的一次态：`auto | off | minimal | low | medium | high | xhigh | max`。`auto` 是独立一档，含义是"什么都不下发，由模型决定"，不是被藏起来的默认值——它恰好等于有等级概念之前的行为。未收录的模型只能显示为未验证并什么都不发，绝不把用户选的等级悄悄换成邻近的另一档。
_Avoid_: 推理开关、深度思考档位

**思考作用域 (ThinkingScope)**:
一条思考等级可以声明在三个地方：该模型的默认值、本会话、仅下一条消息。优先级是消息 > 会话 > 模型默认，界面上必须同时说出"当前是哪一级"和"这句话是谁说的"，因为后者才告诉用户去哪里改。选 `auto` 的含义是"这一层不再表态"，而不是存下一个叫 auto 的值；消息级只活到它所属的那次发送。
_Avoid_: 全局思考开关（不存在一个地方存着所有答案）

**思考载体 (ThinkingCarrier)**:
某个 provider 表达思考等级的方式：`reasoning_effort` / `thinking_level` / `thinking_budget` / `ollama_think` / `model_alias` / `unsupported`。等级是用户的话，载体是网关的话；两者分开，加一家 provider 就是往映射表里加一行数据，而不是多一个分支。
_Avoid_: provider 特判、reasoning_effort（那只是其中一种载体）

### Provider 与密钥

**目录 (catalogue)**:
应用内置的 provider 清单。判断"这是不是用户自己的端点"，唯一依据是它在不在目录里。
_Avoid_: 用 `isUserAdded` 判断自建（见下）

**isUserAdded**:
只说明"用户启用了这个 provider"。从目录里启用 Azure OpenAI、OpenRouter、Groq、New API 时它同样是 `true`。
_Avoid_: 自建标记、用户添加的端点——它区分不了目录内与目录外，曾经因此让所有托管服务静默变成免密（徽标消失、发送门打开、请求吃 401）

**requiresKey**:
"要不要催用户填密钥"，由 `resolveRequiresKey({catalog, strategy, url})` 一处得出：先看本地证据（回环地址、`*.localhost`、`10.`/`192.168.`/`172.16-31.` 私网段、方括号 IPv6、ollama 策略），再看目录答案，都不认识就按"用户自己的、免密"处理。
_Avoid_: 在启动流程里另行按目录重算一遍（那正是自建端点每次重启都被改回"未配置密钥"的原因）

**密钥存在即使用**:
`requiresKey` 决定的是要不要提示用户填，不是要不要发 `Authorization`。只要存着密钥就发出去，否则一个"免密但用户填了密钥"的端点会静默 401。

**免密端点 (keyless)**:
判定为不需要密钥的端点，不发 `Authorization` 头。
_Avoid_: 占位密钥（`nopass` 之类写进代码的假凭据）——它毁掉了"已配置"与"未配置"的区别，"未配置密钥"徽标会退化成一次裸 401；服务端真要求非空 token 时，由用户自己在该 provider 的密钥栏里填哨兵值

### 参数袋与补丁

**参数袋 (parameter bag)**:
一个范围（模型、会话、下一条消息）存下来的那组可调参数。它**允许不完整**：缺席本身携带语义——`auto`、「本范围没意见」、「什么都没存」都靠缺键表示。
_Avoid_: 读取时用默认值补齐（会抹掉「用户选过」与「从没选过」的区别；迁移故意删掉的退休字段也会复活）

**参数补丁 (parameter patch) / `ModelParameterPatch`**:
一个范围真正存下的东西：只有用户碰过的键。与 `ModelParameters` 不可互换，未清洗的补丁当完整对象读就是 `undefined is not an object` 到达用户的路径（#137）。
_Avoid_: `as ModelParameters`——存储不能担保完整性，它只担保"有键则已清洗"

**清洗而非补齐 (sanitize, not complete)**:
存储边界的职责：类型不对的值丢掉（等于没选过）、数字夹进界面允许的区间、未知字段不转发；缺席照原样保留。
_Avoid_: 在别处再判一次类型（边界已做过），或在写入路径上悄悄改写用户手改的值

### Skills

**技能索引 (Skill index)**:
模型在这一轮里能看见的那份 skill 清单（`buildSkillIndex` → `skill-availability` + `skills-index` 两个 block）。索引只给 id、名字和描述，**描述就是路由面**——模型靠"Use when …"决定要不要用它，所以宁可整份退回常驻行，也不给半份清单或截掉半句描述。读指南正文的入口是 `skill__guide(id)`；`skill__get_template` 读的是包内文件，作者把 `SKILL.md` 当资源指名时拿到的也是同一份正文，但它的职责是模板不是路由。索引里的名字不算读过，正文也不会因为被点名就自动注入。
_Avoid_: skill catalogue（"目录"已被 provider 清单和 `tools__search` 的目录占用）、技能列表、按关键词预加载正文

**触发方式 (skill invocation policy)**:
谁能启动一个 skill，由 SKILL.md 决定而不是用户偏好：默认双方都可；`disable-model-invocation: true` → 仅用户（模型侧索引里根本不出现，因此无从自动加载，但仍在对话的 `/` 面板里可选）；`user-invocable: false` → 仅模型（从 `/` 面板隐藏）。两个开关同时成立时按"仅用户"解，因为让模型自动加载是更该否掉的一侧。界面上只读显示，不提供覆盖——否则内容与偏好会各说一套，而同步出去的另一台设备内容还可能不一样。
_Avoid_: 调用控制（本词汇表里"调用"已经是 ToolInvocation）、`triggers`/关键词匹配（已删，路由是描述的职责）、`allowed-tools`（规范里意味着免审批，Chatless 不从中授予任何东西，见 ADR-0004）
