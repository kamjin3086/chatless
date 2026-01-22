# Skills 系统架构设计文档

> **最后更新**: 2026-01-20  
> **版本**: 3.0  
> **参考来源**:
> - [Claude Cowork 架构拆解](https://claudecn.com/blog/claude-cowork-architecture/)
> - [Claude Skills 架构拆解：渐进披露、运行时与安全沙箱](https://claudecn.com/blog/)
> - [Claude Agent Skills 落地指南](https://claudecn.com/blog/)
> - [Cowork 安全架构深度解析](https://claudecn.com/en/blog/claude-cowork-security-architecture/)
> - [Agent Skills 官方文档](https://code.claude.com/docs/zh-CN/skills)
> - [Claude Code Hooks 参考](https://docs.anthropic.com/zh-CN/docs/claude-code/hooks)

---

## 目录

1. [概述](#概述)
2. [核心范式：从 Oracle 到 Agentic](#核心范式从-oracle-到-agentic)
3. [架构设计](#架构设计)
4. [Skills 三层结构](#skills-三层结构)
5. [核心组件](#核心组件)
6. [安全治理架构](#安全治理架构)
7. [Hooks 生命周期管理](#hooks-生命周期管理)
8. [渐进式披露机制](#渐进式披露机制)
9. [执行流程](#执行流程)
10. [与 Claude Cowork 的对比](#与-claude-cowork-的对比)
11. [技术选型决策矩阵](#技术选型决策矩阵)
12. [未来演进路线](#未来演进路线)
13. [开发指南](#开发指南)

---

## 概述

### 什么是 Skills

Skills 是 AI Agent 能力的**模块化封装**，每个 Skill 定义了 AI 可以执行的特定任务或操作。本项目的 Skills 系统基于 [Anthropic Skills 协议](https://github.com/anthropics/skills)，并针对桌面应用场景进行了扩展。

> **核心理念**：Skill 不仅仅是"工具调用"，而是一个具备意图理解、环境感知、执行反馈的完整能力单元。

### 设计目标

| 目标 | 描述 |
|------|------|
| **模块化** | 每个 Skill 独立封装，可单独启用/禁用 |
| **语义触发** | 通过用户意图自动匹配，无需显式调用 |
| **安全优先** | 多层防护，敏感操作强制确认 |
| **环境友好** | 自动检测依赖，提供安装引导 |
| **可追踪** | 执行进度可视化，支持审计日志 |

---

## 核心范式：从 Oracle 到 Agentic

Claude Cowork 的设计核心在于将 AI 从 **Oracle 模式（被动问答）** 转向 **Agentic 模式（主动协作）**。

### 两种模式对比

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Oracle 模式 (传统)                            │
│  ┌──────────┐    问题    ┌──────────┐    答案    ┌──────────┐       │
│  │   用户   │ ─────────▶ │    AI    │ ─────────▶ │   用户   │       │
│  └──────────┘            └──────────┘            └──────────┘       │
│                                                                      │
│  特点：单轮问答，AI 只生成文本，不执行动作                           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Agentic 模式 (协作)                           │
│                                                                      │
│  ┌──────────┐   目标    ┌──────────────────────────────────────────┐│
│  │   用户   │ ────────▶ │           Agentic Loop                    ││
│  └──────────┘           │  ┌────────┐  ┌────────┐  ┌────────────┐  ││
│       ▲                 │  │ 感知   │─▶│ 规划   │─▶│    行动    │  ││
│       │                 │  │Observe │  │ Plan   │  │   Action   │  ││
│       │                 │  └────────┘  └────────┘  └──────┬─────┘  ││
│       │                 │       ▲                         │        ││
│  成果物                 │       └─────────────────────────┘        ││
│                         │               反思 Reflect                ││
│                         └──────────────────────────────────────────┘│
│                                                                      │
│  特点：多轮闭环，AI 通过工具直接操作环境，交付成果物                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 本项目的实现

我们采用 **Agentic Loop** 模式，通过 `SkillExecutor` 实现：

```
感知 (Observe)   ──▶  检测环境依赖、读取上下文
    │
    ▼
规划 (Plan)      ──▶  生成 ExecutionPlan，分解为多个步骤
    │
    ▼
行动 (Action)    ──▶  通过 ProcessSandbox 安全执行
    │
    ▼
反思 (Reflect)   ──▶  验证结果，失败则重试或请求人工介入
```

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React/Next.js)                      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │   Skills    │  │ Execution        │  │ UI Components         │  │
│  │   Panel     │──│ Confirm Dialog   │──│ - DependencyGuide     │  │
│  │             │  │ (Human-in-loop)  │  │ - ProgressTracker     │  │
│  │             │  │                  │  │ - ArtifactViewer      │  │
│  └──────┬──────┘  └────────┬─────────┘  └─────────┬─────────────┘  │
│         │                   │                      │                │
├─────────┼───────────────────┼──────────────────────┼────────────────┤
│         ▼                   ▼                      ▼                │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │                    Skills Core Layer                            ││
│  ├────────────────────────────────────────────────────────────────┤│
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ ││
│  │  │ SkillManager│  │SkillExecutor│  │ DependencyChecker       │ ││
│  │  │ - load      │  │ - execute   │  │ - checkPython           │ ││
│  │  │ - install   │  │ - plan      │  │ - checkNode             │ ││
│  │  │ - enable    │  │ - verify    │  │ - installGuide          │ ││
│  │  │ - match     │  │ - reflect   │  │ - autoFix               │ ││
│  │  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘ ││
│  │         │                │                       │              ││
│  │         ▼                ▼                       ▼              ││
│  │  ┌────────────────────────────────────────────────────────────┐││
│  │  │                   Sandbox Layer                             │││
│  │  ├────────────────────────────────────────────────────────────┤││
│  │  │ ┌─────────────┐ ┌───────────────┐ ┌──────────────────────┐│││
│  │  │ │ProcessSandbox│ │ConfirmManager │ │ExecutionPlanManager ││││
│  │  │ │ - validate  │ │ - request     │ │ - steps              ││││
│  │  │ │ - execute   │ │ - remember    │ │ - progress           ││││
│  │  │ │ - timeout   │ │ - policy      │ │ - retry              ││││
│  │  │ │ - isolate   │ │ - audit       │ │ - rollback (future)  ││││
│  │  │ └──────┬──────┘ └───────────────┘ └──────────────────────┘│││
│  │  └────────┼───────────────────────────────────────────────────┘││
│  └───────────┼────────────────────────────────────────────────────┘│
│              │                                                      │
└──────────────┼──────────────────────────────────────────────────────┘
               │
               ▼ Tauri IPC
┌──────────────────────────────────────────────────────────────────────┐
│                        Backend (Rust/Tauri)                           │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────┐ │
│  │ Sandbox Module  │  │ MCP Integration │  │ Runtime Checker       │ │
│  │ - run_safe_shell│  │ - server_manager│  │ - check_python        │ │
│  │ - validate_cmd  │  │ - tool_registry │  │ - check_node          │ │
│  │ - check_path    │  │ - call_tool     │  │ - install_hint        │ │
│  │ - kill_process  │  │ - resources     │  │ - version_compare     │ │
│  └─────────────────┘  └─────────────────┘  └───────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    OS Process Isolation                          │ │
│  │  - 工作目录限制 (App Data Dir / Temp Dir)                        │ │
│  │  - 超时控制 (30s default, configurable)                          │ │
│  │  - 输出大小限制 (1MB)                                            │ │
│  │  - 环境变量隔离 (HOME/USERPROFILE 重定向)                        │ │
│  │  - 禁止交互式输入 (stdin null)                                   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/lib/skills/
├── index.ts                 # 模块导出
├── types.ts                 # 类型定义
├── SkillManager.ts          # 技能管理器
├── SkillExecutor.ts         # 技能执行器 (Agentic Loop)
├── SkillMdParser.ts         # SKILL.md 解析器
├── LocalSkillLoader.ts      # 本地技能加载器
├── RemoteSkillLoader.ts     # 远程技能加载器
├── dependencyChecker.ts     # 依赖检测器
└── sandbox/
    ├── index.ts             # 沙箱模块导出
    ├── types.ts             # 沙箱类型定义
    ├── ISandboxExecutor.ts  # 执行器接口
    ├── ProcessSandbox.ts    # 进程沙箱实现
    ├── ConfirmationManager.ts    # 确认管理器 (HITL)
    ├── ExecutionPlanManager.ts   # 执行计划管理器
    └── validators/
        └── CommandValidator.ts   # 命令校验器

src/components/skills/
├── DependencyInstallGuide.tsx   # 依赖安装引导组件
└── ExecutionConfirmDialog.tsx   # 执行确认对话框

src-tauri/src/sandbox/
├── mod.rs                   # 模块声明
├── commands.rs              # Tauri 命令
└── validator.rs             # Rust 端校验器
```

---

## Skills 三层结构

参考 [Claude Skills 架构拆解](https://claudecn.com/blog/)，Skills 采用三层结构设计：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 1: 定义层 (Definition)                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  SKILL.md                                                  │  │
│  │  - name: 唯一标识                                          │  │
│  │  - description: 触发描述（语义匹配关键）                   │  │
│  │  - triggers: 触发关键词列表                                │  │
│  │  - dependencies: 环境依赖                                  │  │
│  │  - allowed_tools: 可使用的工具白名单                       │  │
│  │  - risk_level: 风险等级                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 2: 指令层 (Instructions)                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  SKILL.md Body                                             │  │
│  │  - 详细的执行说明                                          │  │
│  │  - 步骤分解                                                │  │
│  │  - 注意事项                                                │  │
│  │  - 示例输入/输出                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 3: 执行层 (Runtime)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Hooks & Sandbox                                           │  │
│  │  - pre_execute: 执行前钩子                                 │  │
│  │  - post_execute: 执行后钩子                                │  │
│  │  - verify: 结果验证钩子                                    │  │
│  │  - on_error: 错误处理钩子                                  │  │
│  │  - ProcessSandbox: 安全执行环境                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心组件

### 1. SkillManager

技能管理的核心类，负责：

- 加载本地和远程技能
- 技能的启用/禁用
- **语义匹配**：根据用户意图自动触发
- 技能索引生成（用于 System Prompt）

```typescript
const manager = getSkillManager();

// 加载所有技能
await manager.loadSkills();

// 语义匹配：根据用户输入找到匹配的技能
const matchedSkills = manager.matchSkillsByIntent("帮我审查这个 PR");

// 获取启用的技能索引（用于 System Prompt）
const index = manager.getEnabledSkillsIndex();

// 获取完整技能指令（渐进式披露）
const instructions = await manager.getSkillInstructions('pr-reviewer');
```

### 2. SkillExecutor

技能执行引擎，实现完整的 **Agentic Loop**：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agentic Loop                              │
│                                                                  │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│   │Pre-Hook │───▶│  Main   │───▶│ Verify  │───▶│Post-Hook│     │
│   └─────────┘    │  Logic  │    │  Hook   │    └─────────┘     │
│                  └────┬────┘    └────┬────┘          │          │
│                       │              │               │          │
│                       │         ┌────┴────┐          │          │
│                       │         │  Pass?  │          │          │
│                       │         └────┬────┘          │          │
│                       │              │               │          │
│                       │     ┌────────┴────────┐      │          │
│                       │     ▼                 ▼      │          │
│                       │   [Yes]             [No]     │          │
│                       │     │                 │      │          │
│                       │     ▼                 ▼      │          │
│                       │  Complete    ┌──────────────┐│          │
│                       │              │ Retry < Max? ││          │
│                       │              └──────┬───────┘│          │
│                       │                     │        │          │
│                       │          ┌──────────┴──────┐ │          │
│                       │          ▼                 ▼ │          │
│                       │        [Yes]              [No]          │
│                       │          │                 │ │          │
│                       │          ▼                 ▼ │          │
│                       └────▶ Retry (Reflect)  Human │          │
│                                                Intervention     │
└─────────────────────────────────────────────────────────────────┘
```

核心特性：

| 特性 | 描述 |
|------|------|
| **执行计划** | 复杂任务分解为多个步骤，支持依赖关系 |
| **进度追踪** | 实时报告执行进度，预估剩余时间 |
| **重试机制** | 可配置的失败重试，支持自我修正 |
| **Hook 支持** | pre_execute, post_execute, verify, on_error |
| **风险评估** | 自动评估命令风险等级 |
| **确认集成** | 高风险操作触发 Human-in-the-loop |

```typescript
const executor = getSkillExecutor({
  maxRetries: 3,
  timeout: 30000,
  requirePlanForComplexTasks: true,
  complexityThreshold: 5,
});

// 添加进度监听器
executor.addProgressListener({
  onPlanStart: (plan) => console.log(`开始执行: ${plan.name}`),
  onProgress: (event) => updateProgressBar(event.progress),
  onStepComplete: (step) => console.log(`完成: ${step.name}`),
  onPlanComplete: (plan) => showSuccessToast(),
});

// 执行技能
const result = await executor.execute(skillId, context);
```

### 3. ProcessSandbox

安全的命令执行环境：

| 安全措施 | 实现 |
|----------|------|
| 命令校验 | 阻止危险命令（rm -rf, sudo 等） |
| 路径限制 | 仅允许访问 App Data 和 Temp 目录 |
| 超时控制 | 默认 30 秒，可配置 |
| 输出限制 | 最大 1MB，防止内存溢出 |
| 环境隔离 | HOME/USERPROFILE 重定向 |
| 禁止输入 | stdin 设为 null |

```typescript
const sandbox = getProcessSandbox();

const result = await sandbox.execute({
  command: 'git',
  args: ['status'],
  workingDir: '/path/to/project',
  timeoutMs: 10000,
  env: { CUSTOM_VAR: 'value' },
});
```

### 4. ConfirmationManager

Human-in-the-loop 确认机制，参考 [Claude Code Hooks](https://docs.anthropic.com/zh-CN/docs/claude-code/hooks)：

| 配置项 | 描述 |
|--------|------|
| requireConfirmationFor | 哪些风险级别需要确认 |
| rememberChoices | 是否记住"始终允许"选择 |
| choiceExpiryMs | 选择记忆有效期 |
| confirmationTimeoutMs | 确认超时时间 |

```typescript
const manager = getConfirmationManager();

// 注册 UI 确认处理器
manager.setHandler(new DialogConfirmHandler());

// 更新确认策略
manager.updatePolicy({
  requireConfirmationFor: ['high', 'critical'],
  rememberChoices: true,
  choiceExpiryMs: 30 * 60 * 1000, // 30分钟
});
```

### 5. DependencyChecker

环境依赖检测与引导：

```typescript
// 检测所有常用依赖
const results = await checkAllCommonDependencies();

// 获取环境摘要
const summary = await getEnvironmentSummary();

// 一键打开下载链接
await openDownloadUrl('https://www.python.org/downloads/');

// 版本比较
const meets = meetsVersionRequirement('3.9.1', '>=3.8.0'); // true
```

---

## 安全治理架构

参考 [Cowork 安全架构深度解析](https://claudecn.com/en/blog/claude-cowork-security-architecture/)，采用**四层防御**架构：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 1: 静态校验 (Static Validation)            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  CommandValidator                                              │  │
│  │  - 危险命令黑名单 (rm -rf, sudo, format...)                   │  │
│  │  - 敏感路径检测 (/etc, /boot, C:\Windows...)                  │  │
│  │  - 路径遍历攻击检测 (../)                                     │  │
│  │  - 管道/重定向控制                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                    Layer 2: 风险评估 (Risk Assessment)              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  RiskLevel Evaluation                                          │  │
│  │  - safe: 读取类操作 (ls, cat, git status)                     │  │
│  │  - low: 查询类操作 (grep, find)                               │  │
│  │  - medium: 文件修改 (echo >, pip install)                     │  │
│  │  - high: 权限提升、系统配置 (sudo, npm -g)                    │  │
│  │  - critical: 不可逆操作 (rm -rf, format)                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                    Layer 3: 用户确认 (Human-in-the-Loop)            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ConfirmationManager                                           │  │
│  │  - 高风险操作强制确认                                          │  │
│  │  - 可记忆的"始终允许"选项                                     │  │
│  │  - 确认超时自动拒绝                                           │  │
│  │  - 用户反馈记录                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                    Layer 4: 运行时隔离 (Runtime Isolation)          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ProcessSandbox + Rust Backend                                 │  │
│  │  - 工作目录强制限制 (App Data / Temp)                         │  │
│  │  - 进程级别隔离                                               │  │
│  │  - 超时终止机制                                               │  │
│  │  - 输出大小限制                                               │  │
│  │  - 环境变量隔离                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 危险命令分类

| 类别 | 示例 | 风险等级 | 处理方式 |
|------|------|----------|----------|
| 递归删除 | `rm -rf`, `del /s` | Critical | 完全阻止 |
| 系统格式化 | `format`, `mkfs` | Critical | 完全阻止 |
| 权限提升 | `sudo`, `runas` | High | 强制确认 |
| 系统控制 | `shutdown`, `reboot` | Critical | 完全阻止 |
| 危险下载 | `curl \| sh` | High | 强制确认 |
| Fork Bomb | `:(){ :\|:& };:` | Critical | 完全阻止 |

### 最小权限原则

```typescript
// Skill 只能访问指定的工具
interface SkillFrontmatter {
  allowed_tools?: string[];  // 工具白名单
  blocked_tools?: string[];  // 工具黑名单
}

// 运行时强制执行
if (skill.allowed_tools && !skill.allowed_tools.includes(tool)) {
  throw new Error(`Skill "${skill.name}" is not allowed to use tool "${tool}"`);
}
```

---

## Hooks 生命周期管理

参考 [Claude Code Hooks 参考](https://docs.anthropic.com/zh-CN/docs/claude-code/hooks)，实现完整的钩子系统：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Skill Execution Lifecycle                     │
│                                                                      │
│  ┌─────────────┐                                                    │
│  │ User Intent │                                                    │
│  └──────┬──────┘                                                    │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────┐    ┌─────────────────────────────────────────────┐ │
│  │  Skill      │───▶│  PreToolUse Hook                            │ │
│  │  Matched    │    │  - 权限检查                                  │ │
│  └─────────────┘    │  - 参数验证                                  │ │
│                     │  - 上下文注入                                │ │
│                     └──────────────────┬──────────────────────────┘ │
│                                        │                            │
│                                        ▼                            │
│                     ┌─────────────────────────────────────────────┐ │
│                     │  PermissionRequest (if high risk)           │ │
│                     │  - 显示确认对话框                            │ │
│                     │  - 等待用户响应                              │ │
│                     └──────────────────┬──────────────────────────┘ │
│                                        │                            │
│                                        ▼                            │
│                     ┌─────────────────────────────────────────────┐ │
│                     │  Tool Execution                             │ │
│                     │  - ProcessSandbox.execute()                 │ │
│                     └──────────────────┬──────────────────────────┘ │
│                                        │                            │
│                             ┌──────────┴──────────┐                 │
│                             ▼                     ▼                 │
│                     ┌─────────────┐       ┌─────────────┐          │
│                     │   Success   │       │   Failure   │          │
│                     └──────┬──────┘       └──────┬──────┘          │
│                            │                      │                 │
│                            ▼                      ▼                 │
│                     ┌─────────────┐       ┌─────────────┐          │
│                     │ PostToolUse │       │  OnError    │          │
│                     │  - 格式化   │       │  - 日志记录 │          │
│                     │  - 清理     │       │  - 重试决策 │          │
│                     └─────────────┘       └─────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Hook 类型定义

```typescript
interface SkillHooks {
  /** 执行前运行 - 用于权限检查、参数验证 */
  pre_execute?: string;
  
  /** 执行后运行 - 用于格式化输出、触发后续操作 */
  post_execute?: string;
  
  /** 验证命令 - 检查执行结果是否符合预期 */
  verify?: string;
  
  /** 错误时运行 - 用于清理、日志记录 */
  on_error?: string;
}
```

### 使用示例

```yaml
---
name: code-formatter
description: 格式化代码文件
hooks:
  pre_execute: "git stash"           # 保存未提交的更改
  post_execute: "prettier --write ." # 执行格式化
  verify: "git diff --quiet"         # 验证是否有变更
  on_error: "git stash pop"          # 恢复保存的更改
---
```

---

## 渐进式披露机制

参考 [Claude Skills 架构拆解](https://claudecn.com/blog/)，实现**渐进式披露 (Progressive Disclosure)**，优化 Token 消耗：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Progressive Disclosure                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Stage 1: Index Loading (启动时)                            │    │
│  │  ┌─────────────────────────────────────────────────────────┐│    │
│  │  │ System Prompt 中仅包含技能索引:                         ││    │
│  │  │                                                         ││    │
│  │  │ Available Skills:                                       ││    │
│  │  │ - pr-reviewer: 根据公司标准审查代码提交                 ││    │
│  │  │ - code-formatter: 格式化代码文件                        ││    │
│  │  │ - test-runner: 运行单元测试                             ││    │
│  │  │                                                         ││    │
│  │  │ 约 100-200 tokens / skill                               ││    │
│  │  └─────────────────────────────────────────────────────────┘│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Stage 2: Intent Matching (用户输入时)                      │    │
│  │  ┌─────────────────────────────────────────────────────────┐│    │
│  │  │ 用户: "帮我检查一下这个 PR 是否符合规范"                ││    │
│  │  │                                                         ││    │
│  │  │ 匹配算法:                                               ││    │
│  │  │ - 关键词匹配: "检查", "PR", "规范"                      ││    │
│  │  │ - 触发词匹配: triggers: ["review", "PR", "code check"]  ││    │
│  │  │ - 语义相似度: description 与用户输入的相似度            ││    │
│  │  │                                                         ││    │
│  │  │ 结果: 匹配到 "pr-reviewer"                              ││    │
│  │  └─────────────────────────────────────────────────────────┘│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Stage 3: Full Loading (按需加载)                           │    │
│  │  ┌─────────────────────────────────────────────────────────┐│    │
│  │  │ 将完整的 SKILL.md 内容注入上下文:                       ││    │
│  │  │                                                         ││    │
│  │  │ # PR Reviewer Skill                                     ││    │
│  │  │                                                         ││    │
│  │  │ ## 审查准则                                             ││    │
│  │  │ 1. 检查是否存在硬编码凭证                               ││    │
│  │  │ 2. 确保符合 TypeScript 严谨模式                         ││    │
│  │  │ 3. 验证测试覆盖率...                                    ││    │
│  │  │                                                         ││    │
│  │  │ 约 500-2000 tokens / skill                              ││    │
│  │  └─────────────────────────────────────────────────────────┘│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  优势:                                                               │
│  - 减少 System Prompt 体积 (10个技能: ~1000 tokens vs ~15000)       │
│  - 提高响应速度                                                      │
│  - 降低 API 成本                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 实现代码

```typescript
// SkillManager.ts

/**
 * 获取技能索引（用于 System Prompt）
 * 仅包含名称和简短描述
 */
getEnabledSkillsIndex(): SkillIndexEntry[] {
  return this.skills
    .filter(s => s.enabled)
    .map(s => ({
      id: s.id,
      name: s.name,
      description: s.description.slice(0, 200), // 截断至 200 字符
      triggers: s.triggers || [],
    }));
}

/**
 * 根据用户意图匹配技能
 */
matchSkillsByIntent(userInput: string): Skill[] {
  const input = userInput.toLowerCase();
  
  return this.skills.filter(skill => {
    // 触发词匹配
    if (skill.triggers?.some(t => input.includes(t.toLowerCase()))) {
      return true;
    }
    
    // 描述关键词匹配
    const keywords = skill.description.toLowerCase().split(/\s+/);
    if (keywords.some(k => input.includes(k) && k.length > 3)) {
      return true;
    }
    
    return false;
  });
}

/**
 * 获取完整技能指令（按需加载）
 */
async getSkillInstructions(skillId: string): Promise<string | null> {
  const skill = this.skills.find(s => s.id === skillId);
  if (!skill) return null;
  
  // 此时才加载完整的 SKILL.md 内容
  return skill.skillMdContent || null;
}
```

---

## 执行流程

### 完整时序图

```
User        UI             SkillManager    SkillExecutor   ConfirmManager   Sandbox       Backend
  │          │                  │               │                │             │             │
  ├─ Input ─▶│                  │               │                │             │             │
  │          ├─ matchSkills() ─▶│               │                │             │             │
  │          │◀── matched ──────┤               │                │             │             │
  │          │                  │               │                │             │             │
  │          ├─ getInstructions() ────────────▶│                │             │             │
  │          │◀── full SKILL.md ──────────────┤                │             │             │
  │          │                  │               │                │             │             │
  │          │  [Inject instructions into context]              │             │             │
  │          │                  │               │                │             │             │
  │          ├──────────────────┼─ execute() ──▶│                │             │             │
  │          │                  │               │                │             │             │
  │          │                  │               ├─ checkDeps() ──┼────────────▶│             │
  │          │                  │               │◀── deps ok ────┼─────────────┤             │
  │          │                  │               │                │             │             │
  │          │                  │               ├─ createPlan() ─┤             │             │
  │          │                  │               │                │             │             │
  │          │                  │               │   [For each step]            │             │
  │          │                  │               │                │             │             │
  │          │                  │               ├─ evaluateRisk()│             │             │
  │          │                  │               │                │             │             │
  │          │                  │               │  [If risk >= high]           │             │
  │          │                  │               ├────────────────▶│             │             │
  │◀─────────┼── Confirm? ──────┼───────────────┼─────────────────┤             │             │
  ├─ Yes ────┼──────────────────┼───────────────┼────────────────▶│             │             │
  │          │                  │               │◀── confirmed ──┤             │             │
  │          │                  │               │                │             │             │
  │          │                  │               ├─ execute() ────┼────────────▶│             │
  │          │                  │               │                │             ├─ validate() │
  │          │                  │               │                │             ├─ spawn() ──▶│
  │          │                  │               │                │             │◀── result ──┤
  │          │                  │               │◀── result ─────┼─────────────┤             │
  │          │                  │               │                │             │             │
  │          │                  │               ├─ runVerify() ──┤             │             │
  │          │                  │               │                │             │             │
  │          │                  │               │  [If failed && retries < max]│             │
  │          │                  │               ├─ reflect & retry             │             │
  │          │                  │               │                │             │             │
  │          │◀── progress ─────┼───────────────┤                │             │             │
  │          │                  │               │                │             │             │
  │◀─────────┼── Result ────────┼───────────────┤                │             │             │
  │          │                  │               │                │             │             │
```

---

## 与 Claude Cowork 的对比

参考 [Claude Cowork 架构拆解](https://claudecn.com/blog/claude-cowork-architecture/)：

### 架构对比

| 特性 | Claude Cowork | 本项目 | 差距分析 |
|------|---------------|--------|----------|
| **隔离级别** | VM (Apple VZVirtualMachine) | 进程级别 | 计划支持 Docker/WASM |
| **Human-in-the-loop** | ✅ 核心机制 | ✅ ConfirmationManager | 已对齐 |
| **渐进式披露** | ✅ 三阶段加载 | ✅ Index + Full Load | 已对齐 |
| **环境检测** | ✅ 自动检测 | ✅ DependencyChecker | 已对齐 |
| **进度追踪** | ✅ 实时展示 | ✅ ExecutionPlanManager | 已对齐 |
| **可回滚** | ✅ 快照恢复 | ❌ 无 | 计划支持 |
| **成果物交付** | ✅ Artifacts | ⚠️ 部分 | 计划增强 |
| **多 Agent** | ✅ Sub-agents | ❌ 无 | 未来规划 |

### 借鉴的设计理念

1. **"数字同事"理念**
   - AI 不仅是工具，而是协作伙伴
   - 重要操作需要用户确认
   - 提供清晰的执行进度反馈

2. **任务中心而非对话中心**
   - 用户交付的是"目标（Outcome）"
   - Agent 负责将目标拆解为执行计划
   - 结果是"成果物"而非单纯的文本回复

3. **确定性控制**
   - 通过 Hooks 机制注入确定性逻辑
   - 减少 LLM 的非确定性影响
   - 保证关键操作的可预测性

---

## 技术选型决策矩阵

参考 [Claude Agent Skills 落地指南](https://claudecn.com/blog/)：

### Skills vs 其他扩展方式

| 组件类型 | 触发方式 | 适用场景 | Token 成本 | 确定性 |
|----------|----------|----------|------------|--------|
| **Skills** | 语义自动匹配 | 领域专业知识、工作流标准 | 按需加载 | 中 |
| **CLAUDE.md** | 默认加载 | 项目级规范、全局约束 | 固定 | 高 |
| **Slash Commands** | 用户显式输入 (`/`) | 固定、高频操作 | 最低 | 最高 |
| **MCP Servers** | 工具路由调用 | 外部数据、API 集成 | 动态 | 高 |

### 选型建议

```
┌─────────────────────────────────────────────────────────────────┐
│                         选型决策树                               │
│                                                                  │
│                    ┌─────────────────┐                          │
│                    │ 需要执行什么？  │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│           ┌─────────────────┼─────────────────┐                 │
│           ▼                 ▼                 ▼                 │
│   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐        │
│   │ 固定/高频操作 │ │ 领域专业知识 │ │ 外部数据接入 │        │
│   └───────┬───────┘ └───────┬───────┘ └───────┬───────┘        │
│           │                 │                 │                 │
│           ▼                 ▼                 ▼                 │
│   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐        │
│   │ Slash Command │ │    Skill      │ │  MCP Server   │        │
│   │  /deploy      │ │  pr-reviewer  │ │  database     │        │
│   └───────────────┘ └───────────────┘ └───────────────┘        │
│                                                                  │
│   全局约束？  ─────────────▶  CLAUDE.md                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 未来演进路线

### Phase 1: 基础完善 ✅ (已完成)

- [x] ProcessSandbox 进程级隔离
- [x] CommandValidator 命令校验
- [x] Human-in-the-loop 确认机制
- [x] ExecutionPlanManager 进度追踪
- [x] DependencyInstallGuide 安装引导
- [x] 渐进式披露机制
- [x] Hook 生命周期支持

### Phase 2: 增强安全 (计划中)

- [ ] **WASM 沙箱执行器**
  - 使用 Pyodide 运行 Python
  - 使用 QuickJS 运行 JavaScript
  - 完全隔离的执行环境

- [ ] **文件系统快照与回滚**
  - 执行前自动创建快照
  - 支持一键回滚到快照状态
  - 类似 `git stash` 的操作体验

- [ ] **网络访问控制**
  - 域名白名单
  - 出站流量监控
  - 敏感数据检测

- [ ] **资源使用限制**
  - CPU 时间限制
  - 内存使用限制
  - 磁盘 IO 限制

### Phase 3: 成果物管线 (计划中)

- [ ] **Artifacts Pipeline**
  - 支持生成结构化文件（Excel, PPT, PDF）
  - 自动保存到用户授权目录
  - 版本管理与历史记录

- [ ] **审计日志**
  - 完整的操作追踪
  - 支持合规审计
  - 可导出日志报告

### Phase 4: 高级功能 (未来)

- [ ] **Docker 容器沙箱**
  - 参考 Cowork 的 VM 隔离
  - 更强的安全边界

- [ ] **多 Agent 协作**
  - Sub-agents 调度
  - 任务并行化
  - 上下文隔离

- [ ] **技能市场**
  - 社区共享 Skills
  - 版本管理与更新
  - 安全审核机制

---

## 开发指南

### 添加新的 Skill

参考 [SKILL.md 模板](./SKILL_TEMPLATE.md)：

```markdown
---
name: my-skill
description: |
  我的自定义技能。当用户提到"关键词A"或"关键词B"时触发。
version: 1.0.0
author: your-name
triggers:
  - 关键词A
  - 关键词B
  - keyword-c
dependencies:
  - python: ">=3.8"
  - node: ">=18"
  - binary: "git"
allowed_tools:
  - read_file
  - write_file
  - list_files
risk_level: medium
hooks:
  pre_execute: "echo 'Starting...'"
  verify: "python -c 'print(1)'"
---

# 技能使用说明

## 概述
这里是 AI 将看到的完整技能指令...

## 使用步骤
1. 第一步...
2. 第二步...

## 注意事项
- 注意事项 1
- 注意事项 2

## 示例
输入: xxx
输出: yyy
```

### 实现新的沙箱执行器

```typescript
import { BaseSandboxExecutor } from './ISandboxExecutor';
import type { ExecuteOptions, ExecuteResult } from './types';

class WasmSandbox extends BaseSandboxExecutor {
  readonly type = 'wasm' as const;
  readonly name = 'WASM Sandbox';

  async isAvailable(): Promise<boolean> {
    // 检查 WASM 运行时是否可用
    return typeof WebAssembly !== 'undefined';
  }

  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    // 在 WASM 环境中执行命令
    const pyodide = await loadPyodide();
    const result = await pyodide.runPythonAsync(options.command);
    
    return {
      success: true,
      exitCode: 0,
      stdout: String(result),
      stderr: '',
      duration: Date.now() - startTime,
      status: 'completed',
    };
  }
}
```

### 自定义确认 UI

```typescript
import type { IConfirmationHandler, ConfirmationRequest, ConfirmationResult } from '@/lib/skills/sandbox';

class DialogConfirmHandler implements IConfirmationHandler {
  async requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationResult> {
    // 显示自定义确认对话框
    const userChoice = await showCustomDialog({
      title: '执行确认',
      command: request.command,
      riskLevel: request.riskLevel,
      impacts: request.impact,
    });
    
    return {
      confirmed: userChoice.action !== 'deny',
      action: userChoice.action,
      feedback: userChoice.feedback,
    };
  }

  cancelConfirmation(requestId: string): void {
    closeDialog(requestId);
  }
}

// 注册处理器
getConfirmationManager().setHandler(new DialogConfirmHandler());
```

---

## 参考资料

### Claude 官方文档
- [Agent Skills 官方文档](https://code.claude.com/docs/zh-CN/skills)
- [Claude Code Hooks 参考](https://docs.anthropic.com/zh-CN/docs/claude-code/hooks)
- [MCP (Model Context Protocol)](https://docs.anthropic.com/zh-CN/docs/agents-and-tools/mcp)

### 架构分析
- [Claude Cowork 架构拆解：VM 隔离、MCP 与 Agentic 循环](https://claudecn.com/blog/claude-cowork-architecture/)
- [Claude Skills 架构拆解：渐进披露、运行时与安全沙箱](https://claudecn.com/blog/)
- [Cowork 安全架构深度解析](https://claudecn.com/en/blog/claude-cowork-security-architecture/)
- [Claude Agent Skills 落地指南](https://claudecn.com/blog/)

### 技术资源
- [Anthropic Skills 协议](https://github.com/anthropics/skills)
- [Tauri 安全最佳实践](https://v2.tauri.app/security/)
- [Tauri 进程隔离](https://v2.tauri.app/zh-cn/concept/inter-process-communication/isolation)

---

*本文档持续更新中，欢迎提出改进建议。*
