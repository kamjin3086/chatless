# 贡献指南

中文 | [English](CONTRIBUTING_EN.md)

感谢您对 chatless 项目的关注！我们欢迎所有形式的贡献。安装和使用说明请查看[项目主页](README.md)。

## 🌐 协作语言（English by default）

为了让项目对所有贡献者开放，**由维护侧写下的追踪记录一律用英文**：

- Pull Request 的标题、正文与 review 意见
- Commit message（英文的 Conventional Commits）、分支名、新增的代码注释
- 维护者或 agent 自己新建的 issue、分诊结论、验收报告

**报告 Bug 或提需求时，请使用最能准确描述问题的语言，中文完全可以。** 维护者会在分诊时把标题、复现步骤与结论整理成英文，并保留你的原文。回复仍使用该 Issue 的语言。完整规则见[协作语言说明](docs/agents/language.md)。

这条规则**是阅读偏好，不是质量门槛**：中英混排不会让任何人（包括 AI agent）的维护变难，它只是让人类读者翻提交记录、PR 列表、分诊结论时更顺一点。所以：不会有人为了语言去回改已有内容，也不会因为措辞语言而拒绝一个真实贡献。

界面文案、i18n 资源、`README`／`INSTALLATION_INSTRUCTIONS` 双语文档、`CHANGELOG.md` 与发布说明面向最终用户，保持现状。

## 🤖 AI agent 代提交的 Issue / PR

本项目**接受由 AI agent 维护和提交**的 issue 与 PR：分诊、补复现、写实现、跑验收都可以交给 agent。前提只有一个：**不给仓库持有者增加额外维护负担。**

判断标准就一句：如果持有者还需要追问、rebase、重跑 CI，或者读一遍纯格式化的 diff，那这笔提交就是成本而不是贡献。因此请注意：

- 推之前先本地跑 `pnpm verify`（lint、应用和测试的类型检查、测试、构建），CI 红了再来解释不算证据
- PR 正文必须有 **Evidence**：真实命令与真实输出、before/after、明确写出哪些未验证
- 一个 PR 只包含一个逻辑变更，不夹带无关重构、不顺手重排格式
- 先搜再开：`gh issue list --state all --search "..."`；“我来帮忙”、“有进展吗”这类空评论不要发
- 不把闸门调松来变绿（`continue-on-error`、skip 测试、提高 `--max-warnings`）
- release / tag / 签名 / 默认权限变更一律先问，agent 不自行操作

由 agent 撰写的 Issue、PR 和评论须以对应语言的固定引用声明开头，见[协作语言说明](docs/agents/language.md)。请在 PR 模板里**勾选 “Written by an AI agent (or heavily agent-assisted)”**。

以下情况会被直接关闭：无复现的猜测式修复、重复 issue/PR、批量格式化 PR、把已有中文文档机器翻译。完整的 agent 操作规范（`gh` 命令、标签、验证矩阵、哪些必须问）在 [docs/agents/maintenance.md](docs/agents/maintenance.md)。

## 🚀 快速开始

### 环境要求
- Node.js 22（见 [`.node-version`](.node-version)）
- pnpm 9.15.4（见 [`package.json`](package.json) 中的 `packageManager`）
- 开发桌面应用还需要稳定版 Rust 和当前系统的 [Tauri 2 开发依赖](https://v2.tauri.app/zh-cn/start/prerequisites/)

### 本地开发设置

```bash
git clone https://github.com/kamjin3086/chatless.git
cd chatless
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm tauri dev` 会启动 Next.js 开发服务器和桌面应用。只需要前端开发服务器时，用 `pnpm dev`。

### 维护界面翻译

增删界面文案时，请同步更新 [`TranslationKey`](src/i18n/types.ts) 和[中英文词典](src/i18n/locales)。可以调整 `{0}`、`{count}` 等插值占位符的位置，但不要改名或改变出现次数；`{{变量}}` 是提示词语法示例，不是界面插值占位符。

运行 `pnpm test src/i18n/__tests__/index.test.ts` 检查两套词典的键和占位符是否一致。`pnpm verify` 也会运行这些检查。

## 📝 贡献类型

### 🐛 Bug 报告
如果您发现了 Bug，请先搜索现有的 [GitHub Issues](https://github.com/kamjin3086/chatless/issues)，再通过[模板选择页](https://github.com/kamjin3086/chatless/issues/new/choose)选用 **Bug report** 模板，包含：

- 简要描述与准确的复现步骤
- 预期行为与实际行为
- Chatless 版本、操作系统版本与架构
- 已尝试的排查步骤；可附上删除了密钥和个人信息的日志或截图

### 💡 功能请求
请先搜索已有 Issue 和讨论，再通过[模板选择页](https://github.com/kamjin3086/chatless/issues/new/choose)选用 **Feature request** 模板。说明要解决的问题、建议的功能、目标平台和具体使用场景。

### 安全漏洞
不要通过公开的 Issue 或讨论报告漏洞。请按[安全政策](SECURITY.md)中的方式私下联系维护者。

### 🔧 代码贡献
如果您想贡献代码：

#### 1. Fork 项目
1. 在 GitHub 上 fork 本项目
2. 克隆您的 fork 到本地

#### 2. 创建分支
```bash
git checkout -b feature/your-feature-name
# 或
git checkout -b fix/your-bug-fix
```

#### 3. 开发
- 遵循现有的代码风格
- 添加必要的测试
- 确保所有测试通过
- 更新相关文档

#### 4. 提交代码
```bash
git add path/to/changed-file
git commit -m "feat: add new feature description"
```

#### 5. 推送并创建 Pull Request
```bash
git push origin feature/your-feature-name
```

PR 标题请使用英文和 ASCII 的 `type(scope): description` 格式，正文请说明改动与验证结果。

## 📋 开发规范

### 代码风格
- 遵循现有 TypeScript 或 Rust 代码风格
- 遵循 ESLint 和 Biome 规则；用 `pnpm fmt <file…>` 格式化指定文件
- 组件使用 PascalCase 命名
- 函数使用 camelCase 命名

### 提交信息规范
使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式，**描述用英文**：

```
type(scope): description

[optional body]

[optional footer]
```

类型包括：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

### 测试
- 为新功能添加单元测试
- 确保现有测试通过
- 运行 `pnpm test` 验证；推送前运行 `pnpm verify`

## 🏗️ 项目结构

```
src/
├── app/                 # Next.js 页面
├── components/          # React 组件
├── lib/                 # 核心库文件
├── store/               # 状态管理
├── types/               # TypeScript 类型定义
└── styles/              # 样式文件
```

## 🤝 社区

### 讨论
- 使用 [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions) 进行讨论
- 提出想法、分享经验、寻求帮助

### 问题反馈
- 使用 [GitHub Issues](https://github.com/kamjin3086/chatless/issues) 报告问题
- 提供详细的信息和重现步骤

## 📄 许可证

通过贡献代码，您同意您的贡献将在 MIT 许可证下发布。

## 🙏 致谢

感谢所有为 chatless 项目做出贡献的开发者！

---

如有任何问题，请随时在 [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions) 中提问。 