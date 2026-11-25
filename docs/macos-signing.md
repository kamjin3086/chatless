# macOS 发布签名

macOS 构建通过 `tauri.macos.conf.json` 的 `signingIdentity: "-"` 使用
ad-hoc 签名，不需要付费 Apple Developer 证书。签名由 Tauri 在生成安装包
和更新包之前完成，避免修改打包完成的应用后破坏更新签名。

Tauri 默认启用 hardened runtime（`bundle.macOS.hardenedRuntime` 默认 `true`），
而随包分发的 `libonnxruntime.dylib` 只有上游的 linker ad-hoc 签名、没有
TeamIdentifier。hardened runtime 的 library validation 会拒绝加载它：

```
dlopen(...libonnxruntime.dylib): code signature ... not valid for use in process:
  mapping process and mapped file (non-platform) have different Team IDs
```

后果不在启动：`ort::init_from(...)` 的错误只被 `src-tauri/src/lib.rs` 用 `eprintln!`
记成一行 `[WARN] ORT background init failed: …`，不 panic、不改退出码，应用照常起来，
本地嵌入（知识库语义检索）静默失效。所以验收要 grep 这一行，只看“进程还活着”不够。
因此 `Entitlements.plist` 声明了 `com.apple.security.cs.disable-library-validation`，
并在 `tauri.macos.conf.json` 里通过 `bundle.macOS.entitlements` 引用，
既保留 hardened runtime，又允许加载随包的 dylib。

Tag Release 在上传产物之前执行 `codesign --verify --deep --strict --verbose=2`，对象是
`bundle/macos/Chatless.app`（不是 dmg），而且 Build 那步是 `continue-on-error: true`，拦住
上传的是这一步的 `test -d` 与校验退出码。应用缺失或签名校验失败会阻止该任务上传产物。
注意该命令只验证签名本身，**不能**发现 library validation 导致的 dylib 加载失败：没有
entitlement 的构建同样能通过 `codesign --verify --deep --strict`。修改签名相关配置后，
必须在 macOS 上跑一次 `pnpm tauri build` 并从终端启动主程序，确认
`[ORT] Background init succeeded`（或 `ort` crate 自己打的
`[INFO][ort] Loaded ONNX Runtime dylib with version '…'`）。

这不是 Developer ID 签名或 Apple 公证，不能保证下载后直接通过 Gatekeeper。
如果 macOS 拦截打开，请先确认安装包来自本项目官方 Release，再按系统的
“隐私与安全性”提示允许打开。若仍提示损坏，请在 issue 中提供 macOS 版本、
下载的文件名，以及以下只读诊断命令的输出：

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Chatless.app
codesign --display --verbose=2 /Applications/Chatless.app
```

v0.6.4 及更早的 macOS 安装包是在这次签名配置变更之前构建的：`signingIdentity: "-"` 与
`Entitlements.plist` 在 2026-09-30 提交（`6bb2ce0`、`c6d04fd`），2026-10-04 随 PR #76 进入
`main`，首次随 v0.7.0 发布。老安装升级后会拿到新版本，但这项配置改不动已经装好的那个
二进制；自 v0.7.0 起的构建才带这套签名（撰写本文时最新发布为 v0.8.2）。Windows
本地检查不能替代 macOS 签名与实际启动验证。

Tauri 更新包签名用于验证更新来源，与 Apple 代码签名是两套独立机制。

参考：[Tauri macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)。
