# Windows 免安装 ZIP

发布流水线在 Windows x64 构建后生成 `Chatless_<版本>_windows_x64_portable.zip`
和 SHA-256 校验文件。解压整个 ZIP，再运行 `Chatless.exe`，不要单独移动 EXE。
系统需已安装 Microsoft Edge WebView2 Runtime。

这是免安装分发方式，数据仍写入现有 Windows 用户数据目录，与安装版共享。
应用内更新仍使用原有安装程序；希望保持免安装方式时，请手动下载下一版 ZIP。
不新增单独的数据目录、迁移机制或更新通道。

打包脚本 `scripts/package-windows-portable.ps1` 从 Windows Tauri 配置读取资源，
同时包含构建目录中的 DLL。资源缺失、路径越界或不支持的资源映射会终止打包。
配置改为资源通配符或映射对象时，需要相应更新脚本。

“设置 → 通用 → 界面显示”新增关闭到托盘选项，默认关闭。启用后点击窗口关闭
按钮仅隐藏窗口，后台任务继续运行；从托盘菜单退出应用。托盘不可用时保持正常
关闭行为，避免窗口隐藏后无法找回。
