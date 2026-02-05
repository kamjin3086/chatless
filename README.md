<div align="center">
  <img src="public/logo.svg" alt="chatless logo" />
</div>

<h1 align="center">chatless</h1>

<p align="center">
  基于 Tauri 2.0 与 Next.js 的本地优先 AI 聊天客户端
</p>

<p align="center">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/kamjin3086/chatless?style=flat&logo=github&color=brightgreen&labelColor=2d333b" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-orange.svg?style=flat&labelColor=2d333b" />
  <img alt="Downloads" src="https://img.shields.io/github/downloads/kamjin3086/chatless/total?style=flat&logo=download&color=blue&labelColor=2d333b" />
  <img alt="Stars" src="https://img.shields.io/github/stars/kamjin3086/chatless?style=flat&logo=github&color=yellow&labelColor=2d333b" />
  <br/>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-purple?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJBMTAgMTAgMCAwIDAgMiAxMmMwIDQuNDIgMi44NyA4LjE3IDYuODQgOS41LjUuMDguNjYtLjIzLjY2LS41di0xLjY5Yy0yLjc3LjYtMy4zNi0xLjM0LTMuMzYtMS4zNEMxMC4xNSAxNyA5LjUgMTYuNzEgOS41IDE2LjcxYy0uOTEtLjYyLjA3LS42LjA3LS42IDEgLjA3IDEuNTMgMS4wMyAxLjUzIDEuMDMuODcgMS41MiAyLjM0IDEuMDcgMi45MS44My4wOS0uNjUuMzUtMS4wNy42NC0xLjMxLTIuMjItLjI1LTQuNTUtMS4xMS00LjU1LTQuOTIgMC0xLjExLjM4LTIgMS4wMy0yLjcxLS4xLS4yNS0uNDUtMS4yOS4xLTIuNjQgMCAwIC44NC0uMjcgMi43NSAxLjAyLjc5LS4yMiAxLjY1LS4zMyAyLjUtLjMzLjg1IDAgMS43MS4xMSAyLjUuMzMgMS45MS0xLjI5IDIuNzUtMS4wMiAyLjc1LTEuMDIuNTUgMS4zNS4yIDIuMzkuMSAyLjY0LjY1LjcxIDEuMDMgMS42IDEuMDMgMi43MSAwIDMuODItMi4zNCA0LjY2LTQuNTcgNC45MS4zNi4zMS42OSAxLjIuNjkgMi40NXYzLjU0YzAgLjI3LjE2LjU5LjY3LjVBMTAuMDAxIDEwLjAwMSAwIDAgMCAyMiAxMkExMCAxMCAwIDAgMCAxMiAyIi8+PC9zdmc+&labelColor=2d333b" />
</p>


<p align="center">
  <a href="README_EN.md">English</a> | 中文
</p>

---

## 项目简介

chatless 是一个桌面 AI 聊天客户端，支持接入多种云端 AI 服务（OpenAI、Anthropic、DeepSeek 等）或本地模型（Ollama、LM Studio）。数据完全存储在本地，支持文档解析与向量检索（RAG）。

**主要特性：**

- 多 AI 提供商支持 - 云端服务与本地模型
- 文档解析 - 支持 PDF、Word、Markdown 格式
- 图片分析 - 支持 Vision 模型进行图像理解
- 本地 RAG 知识库 - 向量检索提升回答准确性
- MCP 协议集成 - 扩展第三方工具能力
- Prompt 管理 - 快速复用常用提示词
- WebDAV 同步（Prompts）- 多设备同步提示词（JSON-Chunk）
- 数据本地存储 - 保护用户隐私

## 界面预览

<div align="center">
  <img src="docs/assets/screenshot-main1.png" alt="chatless 主界面" width="960" />
</div>

更多功能演示请访问 [完整文档](https://kamjin3086.github.io/chatless/docs)

## 快速开始

### 下载安装

从 [GitHub Releases](https://github.com/kamjin3086/chatless/releases/latest) 下载适合您系统的安装包：

- **Windows** - `.exe` 或 `.msi` 安装包
- **macOS** - 根据处理器选择 `aarch64`（Apple Silicon）或 `x64`（Intel）版本
- **Linux** - `.deb`、`.rpm` 或 `.AppImage` 格式

> 详细安装步骤请参考 [安装指南](INSTALLATION_INSTRUCTIONS.md)

### 配置使用

1. 打开应用，进入设置页面
2. 添加 AI 提供商的 API 密钥
3. （可选）配置 Ollama 使用本地模型
4. 开始对话

### WebDAV 同步（Prompts）

在 `设置 → 同步` 中配置 WebDAV：

- 远端目录结构：`{basePath}/prompts/data/{id}.json` 与 `.../metadata.json`
- 删除策略：不直接删除远端文件，使用 `deleted_at` tombstone 同步

> 完整使用说明请访问 [使用文档](https://kamjin3086.github.io/chatless/docs)

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/kamjin3086/chatless.git
cd chatless

# 安装依赖
pnpm install

# 启动开发服务器
pnpm tauri dev

# 构建应用
pnpm tauri build
```

**技术栈：** Tauri 2.0、Next.js 15、TypeScript、Rust、SQLite

更多开发信息请查看 [贡献指南](CONTRIBUTING.md)

## 功能文档

| 文档 | 链接 |
| --- | --- |
| 使用文档 | [查看文档](https://kamjin3086.github.io/chatless/docs) |
| 快速开始 | [快速开始](https://kamjin3086.github.io/chatless/docs/getting-started) |
| 功能介绍 | [功能详情](https://kamjin3086.github.io/chatless/docs/features) |
| 常见问题 | [FAQ](https://kamjin3086.github.io/chatless/docs/faq) |
| 开发计划 | [Roadmap](https://github.com/users/kamjin3086/projects/1) |

## 常见问题

**Q: Windows 下启动后立即退出/闪退？**

部分 Windows 环境需要安装 Microsoft Visual C++ 运行库。请下载并安装：
- [VC++ 2015-2022 Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe)

更多问题解决方案请查看 [FAQ 文档](https://kamjin3086.github.io/chatless/docs/faq)

## 反馈与支持

- **问题反馈** - [GitHub Issues](https://github.com/kamjin3086/chatless/issues)
- **功能讨论** - [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions)
- **应用内反馈** - 设置 → 反馈

## 贡献

欢迎提交 Issue 和 Pull Request。请在贡献前阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT License](LICENSE) © 2025 chatless

## 致谢

感谢以下开源项目：

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Next.js](https://nextjs.org/) - React 全栈框架
- [Ollama](https://ollama.ai/) - 本地大语言模型运行时
- [ort](https://ort.pyke.io/) - ONNX Runtime Rust 绑定

感谢社区贡献者 @ukhack、@duokebei 等提供的测试与反馈。

---

<div align="center">

如果这个项目对你有帮助，欢迎 Star ⭐

</div> 
