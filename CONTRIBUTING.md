# 贡献指南

感谢您对 chatless 项目的关注！我们欢迎所有形式的贡献。

## 🌐 协作语言（English by default）

为了让项目对所有贡献者开放，**由维护侧写下的追踪记录一律用英文**：

- Pull Request 的标题、正文与 review 意见
- Commit message（英文的 Conventional Commits）、分支名、新增的代码注释
- 维护者或 agent 自己新建的 issue、分诊结论、验收报告

**报告 bug / 提需求时请用你最精确的语言，中文完全可以。**维护者会在分诊时把标题、复现步骤与结论改写成英文，并保留你的原文。完整规则（含入口归一化做法）见 [docs/agents/language.md](docs/agents/language.md)。

这条规则**是阅读偏好，不是质量门槛**：中英混排不会让任何人（包括 AI agent）的维护变难，它只是让人类读者翻提交记录、PR 列表、分诊结论时更顺一点。所以：不会有人为了语言去回改已有内容，也不会因为措辞语言而拒绝一个真实贡献。

界面文案、i18n 资源、`README`／`INSTALLATION_INSTRUCTIONS` 双语文档、`CHANGELOG.md` 与发布说明面向最终用户，保持现状。

## 🤖 AI agent 代提交的 Issue / PR

本项目**接受由 AI agent 维护和提交**的 issue 与 PR：分诊、补复现、写实现、跑验收都可以交给 agent。前提只有一个：**不给仓库持有者增加额外维护负担。**

判断标准就一句：如果持有者还需要追问、rebase、重跑 CI，或者读一遍纯格式化的 diff，那这笔提交就是成本而不是贡献。因此请注意：

- 推之前先本地跑 `pnpm verify`（lint + typecheck + build），CI 红了再来解释不算证据
- PR 正文必须有 **Evidence**：真实命令与真实输出、before/after、明确写出哪些未验证
- 一个 PR 只于一个逻辑变更，不夹带无关重构、不顺手重排格式
- 先搜再开：`gh issue list --state all --search "..."`；“我来帮忙”、“有进展吗”这类空评论不要发
- 不把闸门调松来变绿（`continue-on-error`、skip 测试、提高 `--max-warnings`）
- release / tag / 签名 / 默认权限变更一律先问，agent 不自已做

请在 PR 模板里**勾上“由 AI agent 编写”**。声明了，review 就是核证据；没声明，持有者只能当不可信代码把整个 diff 重读一遍——那才是真的增负担。

以下情况会被直接关闭：无复现的猜测式修复、重复 issue/PR、批量格式化 PR、把已有中文文档机器翻译。完整的 agent 操作规范（`gh` 命令、标签、验证矩阵、哪些必须问）在 [docs/agents/maintenance.md](docs/agents/maintenance.md)。

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Rust 1.70+
- pnpm (推荐) 或 npm

### 本地开发设置
```bash
# 克隆仓库
git clone https://github.com/kamjin3086/chatless.git
cd chatless

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

## 📝 贡献类型

### 🐛 Bug 报告
如果您发现了 bug，请：
1. 检查是否已有相关 issue
2. 创建新的 issue，包含：
   - 详细的 bug 描述
   - 重现步骤
   - 预期行为 vs 实际行为
   - 环境信息（操作系统、版本等）

### 💡 功能请求
如果您有新功能想法，请：
1. 检查是否已有相关讨论
2. 创建 issue 描述您的想法
3. 说明为什么需要这个功能
4. 提供使用场景示例

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
git add .
git commit -m "feat: add new feature description"
```

#### 5. 推送并创建 Pull Request
```bash
git push origin feature/your-feature-name
```

## 📋 开发规范

### 代码风格
- 使用 TypeScript
- 遵循 ESLint 和 Biome 规则
- 使用 Prettier 格式化代码
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
- 运行 `pnpm test` 验证

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