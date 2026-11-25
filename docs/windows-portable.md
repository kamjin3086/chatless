# Windows 免安装 ZIP

发布流水线在 Windows x64 构建后生成 `Chatless_<版本>_windows_x64_portable.zip`
和 SHA-256 校验文件。解压整个 ZIP，再运行 `Chatless.exe`，不要单独移动 EXE：脚本只把 `Chatless.exe`、配置里声明的
`onnxruntime.dll`、构建目录里的全部 `*.dll`（WebView2Loader 就在其中）和一个 `README.txt` 放进包里，
少一样就跑不起来。

系统需已安装 Microsoft Edge [WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703)。
本仓库没有配 `webviewInstallMode`，所以走 Tauri 的默认值：NSIS 那个 `setup.exe` 会引导安装它，MSI 不引导，
免安装 ZIP 更是什么都不带（打包脚本的清单里没有引导）。缺运行库时表现就是双击没反应或一闪退出。

这是免安装分发方式，数据仍写入与安装版相同的位置（数据库在 `%APPDATA%\com.kamjin.chatless\`，
日志在 `%LOCALAPPDATA%\com.kamjin.chatless\logs\logs.log`；三平台的完整对照见
`docs/llm-troubleshooting.md`）。应用内更新走的仍是安装程序那一套，它不会原地更新免安装目录；希望
保持免安装方式，就手动下载下一版 ZIP。不新增单独的数据目录、迁移机制或更新通道。

打包脚本 `scripts/package-windows-portable.ps1` 从 Windows Tauri 配置读取资源，
同时包含构建目录中的 DLL。资源缺失、路径越界或不支持的资源映射会终止打包。
配置改为资源通配符或映射对象时，需要相应更新脚本。

「设置 → 通用 → 界面显示」有一个关闭到托盘开关（`settings.general.closeToTray`，默认关闭）。
启用后点窗口关闭按钮只隐藏窗口，后台任务继续跑，退出要用托盘菜单。判定在
`src/lib/services/appCleanup.ts`：只有 `trayManager.isReady()` 才拦下关闭——托盘初始化失败时保持
正常关闭，免得窗口藏起来却找不回。
