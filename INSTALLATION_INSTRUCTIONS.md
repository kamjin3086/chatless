# Chatless 安装指南

中文 | [English](INSTALLATION_INSTRUCTIONS_EN.md)

## 快速安装

选择您的操作系统，点击对应链接下载最新版本：

### Windows
- **推荐**: [Chatless-x.x.x_x64-setup.exe](https://github.com/kamjin3086/chatless/releases/latest) - 标准安装包
- **替代**: [Chatless-x.x.x_x64_en-US.msi](https://github.com/kamjin3086/chatless/releases/latest) - MSI安装包

### macOS
- **Apple Silicon (M系列)**: [Chatless-x.x.x_aarch64.dmg](https://github.com/kamjin3086/chatless/releases/latest)
- **Intel 处理器**: [Chatless-x.x.x_x64.dmg](https://github.com/kamjin3086/chatless/releases/latest)

### Linux
- **Red Hat/CentOS/Fedora**: [Chatless-x.x.x-1.x86_64.rpm](https://github.com/kamjin3086/chatless/releases/latest)
- **Ubuntu/Debian**: [Chatless_x.x.x_amd64.deb](https://github.com/kamjin3086/chatless/releases/latest)
- **通用**: [Chatless-x.x.x-x86_64.AppImage](https://github.com/kamjin3086/chatless/releases/latest)

---

## 安装步骤

### Windows
1. 下载 .exe 文件
2. 双击运行安装程序
3. 按提示完成安装

### macOS
1. 下载 .dmg 文件
2. 双击打开，拖拽到 Applications 文件夹
3. 从 Applications 启动应用

**注意**: 首次启动可能提示"已损坏"，请：
1. 点击"取消"
2. 打开终端，运行: `sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app`
3. 重新启动应用

### Linux
1. 下载对应格式的安装包
2. 使用包管理器安装：
   - RPM: `sudo dnf install Chatless-*.rpm`
   - DEB: `sudo dpkg -i Chatless_*.deb`
   - AppImage: `chmod +x Chatless-*.AppImage` 然后双击运行

---

## 常见问题

**Windows 闪退**: 安装 [Visual C++ 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe)

**macOS 无法打开**: 使用终端命令移除隔离属性（见上方说明）

**Linux 权限问题**: 确保给予执行权限 `chmod +x`

---

## 获取帮助

- [查看所有版本](https://github.com/kamjin3086/chatless/releases)
- [报告问题](https://github.com/kamjin3086/chatless/issues)（可用中文填写，见[贡献指南](CONTRIBUTING.md)）
- [项目主页](README.md)
