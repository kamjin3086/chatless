# Chatless {{VERSION}} 发布

## 下载

### Windows
- [Chatless Setup (.exe)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_x64-setup.exe)
- [Chatless MSI (.msi)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_x64_en-US.msi)

### macOS
- [Apple Silicon](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_aarch64.dmg)
- [Intel 处理器（通过 Rosetta 2 运行）](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_aarch64.dmg)

> **打不开、提示「已损坏」？** 拖进 Applications 之后，终端运行下面这一行就好（本构建是 ad-hoc 签名，没有做 Apple 公证）：
> `sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app`

### Linux
- [Red Hat/CentOS/Fedora (.rpm)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless-{{VERSION}}-1.x86_64.rpm)
- [Ubuntu/Debian (.deb)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_amd64.deb)
- [通用格式 (.AppImage)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_amd64.AppImage)

---

## 安装说明

### Windows
1. 下载 .exe 文件（推荐）或 .msi 文件
2. 双击运行安装程序
3. 按提示完成安装

### macOS
1. 根据处理器选择版本：
   - Apple Silicon (M1/M2/M3): 下载 aarch64.dmg
   - Intel 处理器: 下载 aarch64.dmg 通过 Rosetta 2 运行
2. 双击打开，拖拽到 Applications 文件夹
3. 从 Applications 启动应用

**注意**: 首次启动可能提示"已损坏"，请：
1. 点击"取消"
2. 打开终端，运行:

   ```bash
   sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app
   ```

3. 重新启动应用

### Linux
1. 根据发行版选择格式：
   - Red Hat/CentOS/Fedora: 下载 .rpm 文件
   - Ubuntu/Debian: 下载 .deb 文件
   - 其他发行版: 下载 .AppImage 文件
2. 使用包管理器安装或直接运行

---

## 常见问题

**Windows 闪退**: 安装 [Visual C++ 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe)

**macOS 无法打开**: 使用终端命令移除隔离属性（见上方说明）

**Linux 权限问题**: 确保给予执行权限 `chmod +x`

---

## 文档

- [安装指南](https://github.com/{{REPOSITORY}}/blob/main/INSTALLATION_INSTRUCTIONS.md)
- [项目主页](https://github.com/{{REPOSITORY}})
- [问题反馈](https://github.com/{{REPOSITORY}}/issues)
