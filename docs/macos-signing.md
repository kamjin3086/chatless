# macOS 发布签名

macOS 构建通过 `tauri.macos.conf.json` 的 `signingIdentity: "-"` 使用
ad-hoc 签名，不需要付费 Apple Developer 证书。签名由 Tauri 在生成安装包
和更新包之前完成，避免修改打包完成的应用后破坏更新签名。

Tag Release 在上传产物之前执行 `codesign --verify --deep --strict`。
应用缺失或签名校验失败会阻止该任务上传产物。

这不是 Developer ID 签名或 Apple 公证，不能保证下载后直接通过 Gatekeeper。
如果 macOS 拦截打开，请先确认安装包来自本项目官方 Release，再按系统的
“隐私与安全性”提示允许打开。若仍提示损坏，请在 issue 中提供 macOS 版本、
下载的文件名，以及以下只读诊断命令的输出：

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Chatless.app
codesign --display --verbose=2 /Applications/Chatless.app
```

现有 v0.6.4 安装包不会因为此配置修改而自动更新。新配置需在下一次 macOS
构建中验证；Windows 本地检查不能替代 macOS 签名与实际启动验证。

Tauri 更新包签名用于验证更新来源，与 Apple 代码签名是两套独立机制。

参考：[Tauri macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)。
