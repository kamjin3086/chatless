# Contributing to Chatless

[中文](CONTRIBUTING.md) | English

For installation and usage, see the [project README](README_EN.md).

## Collaboration language

Write bug reports and feature requests in whichever language lets you describe the issue accurately. Chinese is welcome. Maintainers summarize the title, reproduction steps, and triage outcome in English while preserving your original wording. Replies stay in the issue thread's language.

Write pull request titles and bodies, review comments, Conventional Commit messages, branch names, and new code comments in English. Maintainers also write their own issues and triage records in English. This is a reading preference, not a reason to rewrite existing material or reject a contribution. See the [collaboration language policy](docs/agents/language.md) for details.

## Reporting bugs and requesting features

Search [GitHub Issues](https://github.com/kamjin3086/chatless/issues) before filing, then choose a template on the [new issue page](https://github.com/kamjin3086/chatless/issues/new/choose):

- **Bug report**: Include a brief description, exact steps to reproduce, expected and actual behavior, your Chatless version, OS version and architecture, and what you already tried. Remove API keys and personal information from logs or screenshots before posting them.
- **Feature request**: Check [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions) for related conversations. Explain the problem, the proposed feature, the platforms it would affect, and a concrete use case.

Use [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions) for questions and general discussion.

### Reporting a security vulnerability

Do not post vulnerabilities in public issues or discussions. Follow the [Security Policy (in Chinese)](SECURITY.md): email [kamjindev@gmail.com](mailto:kamjindev@gmail.com) with `[SECURITY] chatless 安全漏洞报告` in the subject.

## Local development

- Node.js 22 (see [`.node-version`](.node-version))
- pnpm 9.15.4 (see `packageManager` in [`package.json`](package.json))
- For desktop development, stable Rust and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

```bash
git clone https://github.com/kamjin3086/chatless.git
cd chatless
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm tauri dev` launches the Next.js development server and the desktop app. Use `pnpm dev` if you only need the frontend development server.

### Maintaining UI translations

When adding or removing UI copy, update [`TranslationKey`](src/i18n/types.ts) and both [locale catalogs](src/i18n/locales) together. You can reorder interpolation placeholders such as `{0}` and `{count}`, but keep their names and occurrence counts. Double-brace examples such as `{{variable}}` illustrate prompt syntax and are not UI interpolation placeholders.

Run `pnpm test src/i18n/__tests__/index.test.ts` to check key and placeholder parity. `pnpm verify` runs these checks too.

## Submitting changes

1. Fork the repository, clone your fork, and create a branch such as `feature/your-feature-name` or `fix/your-bug-fix`.
2. Keep the change focused. Follow the existing TypeScript or Rust style and update the relevant tests and docs. For formatting specific files, use `pnpm fmt <file…>`.
3. Run `pnpm test`. Before pushing, run `pnpm verify` (lint, application and test type checks, tests, and build).
4. Stage only the intended files and commit using [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add a new setting`.
5. Push your branch to your fork and open a pull request. Use an English, ASCII title in `type(scope): description` format. Explain what changed and how you checked it.

### Agent-authored issues and pull requests

Agent-authored work is welcome when it saves the maintainer time. Search for duplicates before filing, keep each PR to one logical change, and do not loosen checks to make them pass. Release, tag, signing, and default-permission changes require approval first.

Every agent-authored issue, PR, or comment must open with the fixed disclosure blockquote in the thread's language; see the [collaboration language policy](docs/agents/language.md) for the exact wording. In the PR template, select **Written by an AI agent (or heavily agent-assisted)** and include **Evidence**: the commands and their actual output, what changed, and what you did not verify. See the [agent maintenance guide](docs/agents/maintenance.md) for the full rules.

## License

By contributing code, you agree that your contribution will be published under the [MIT license](LICENSE).
