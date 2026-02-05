<div align="center">
  <img src="public/logo.svg" alt="chatless logo" />
</div>

<h1 align="center">chatless</h1>

<p align="center">
  A local-first AI chat client built with Tauri 2.0 and Next.js
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
  English | <a href="README.md">中文</a>
</p>

---

## About

chatless is a desktop AI chat client that supports multiple cloud-based AI services (OpenAI, Anthropic, DeepSeek, etc.) and local models (Ollama, LM Studio). All data is stored locally with support for document parsing and vector retrieval (RAG).

**Key Features:**

- Multi-AI Provider Support - Cloud services and local models
- Document Parsing - PDF, Word, Markdown formats
- Image Analysis - Vision model support for image understanding
- Local RAG Knowledge Base - Vector retrieval for improved accuracy
- MCP Protocol Integration - Extend with third-party tools
- Prompt Management - Quick access to commonly used prompts
- WebDAV Sync (Prompts) - Multi-device prompt sync (JSON-Chunk)
- Local Data Storage - Privacy protection

## Preview

<div align="center">
  <img src="docs/assets/screenshot-main1.png" alt="chatless main interface" width="960" />
</div>

For more feature demonstrations, visit the [complete documentation](https://kamjin3086.github.io/chatless/docs)

## Quick Start

### Download & Install

Download the installation package for your system from [GitHub Releases](https://github.com/kamjin3086/chatless/releases/latest):

- **Windows** - `.exe` or `.msi` installer
- **macOS** - Choose `aarch64` (Apple Silicon) or `x64` (Intel) version
- **Linux** - `.deb`, `.rpm`, or `.AppImage` format

> For detailed installation steps, refer to the [Installation Guide](INSTALLATION_INSTRUCTIONS_EN.md)

### Configuration

1. Open the app and go to Settings
2. Add API keys for AI providers
3. (Optional) Configure Ollama for local models
4. Start chatting

### WebDAV Sync (Prompts)

Configure WebDAV in `Settings → Sync`:

- Remote structure: `{basePath}/prompts/data/{id}.json` and `.../metadata.json`
- Deletion: remote files are not deleted; `deleted_at` tombstones are synced

> For complete usage instructions, visit the [User Documentation](https://kamjin3086.github.io/chatless/docs)

## Development

```bash
# Clone repository
git clone https://github.com/kamjin3086/chatless.git
cd chatless

# Install dependencies
pnpm install

# Start development server
pnpm tauri dev

# Build application
pnpm tauri build
```

**Tech Stack:** Tauri 2.0, Next.js 15, TypeScript, Rust, SQLite

For more development information, see [Contributing Guide](CONTRIBUTING.md)

## Documentation

| Documentation | Link |
| --- | --- |
| User Guide | [View Docs](https://kamjin3086.github.io/chatless/docs) |
| Quick Start | [Quick Start](https://kamjin3086.github.io/chatless/docs/getting-started) |
| Features | [Feature Details](https://kamjin3086.github.io/chatless/docs/features) |
| FAQ | [FAQ](https://kamjin3086.github.io/chatless/docs/faq) |
| Roadmap | [Roadmap](https://github.com/users/kamjin3086/projects/1) |

## FAQ

**Q: App crashes immediately on Windows startup?**

Some Windows environments require Microsoft Visual C++ runtime. Download and install:
- [VC++ 2015-2022 Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe)

For more solutions, see [FAQ Documentation](https://kamjin3086.github.io/chatless/docs/faq)

## Feedback & Support

- **Bug Reports** - [GitHub Issues](https://github.com/kamjin3086/chatless/issues)
- **Feature Discussions** - [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions)
- **In-app Feedback** - Settings → Feedback

## Contributing

Issues and Pull Requests are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before contributing.

## License

[MIT License](LICENSE) © 2025 chatless

## Acknowledgments

Thanks to the following open source projects:

- [Tauri](https://tauri.app/) - Cross-platform desktop application framework
- [Next.js](https://nextjs.org/) - React full-stack framework
- [Ollama](https://ollama.ai/) - Local large language model runtime
- [ort](https://ort.pyke.io/) - ONNX Runtime Rust binding

Thanks to community contributors @ukhack, @duokebei for testing and feedback.

---

<div align="center">

If this project helps you, please give it a Star ⭐

</div> 
