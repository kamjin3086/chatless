# Chatless Installation Guide

[中文](INSTALLATION_INSTRUCTIONS.md) | English

## Quick Install

Choose your operating system and click the corresponding link to download the latest version:

### Windows
- **Recommended**: [Chatless-x.x.x_x64-setup.exe](https://github.com/kamjin3086/chatless/releases/latest) - Standard installer
- **Alternative**: [Chatless-x.x.x_x64_en-US.msi](https://github.com/kamjin3086/chatless/releases/latest) - MSI package

### macOS
- **Apple Silicon (M-series)**: [Chatless-x.x.x_aarch64.dmg](https://github.com/kamjin3086/chatless/releases/latest)
- **Intel Processor**: [Chatless-x.x.x_x64.dmg](https://github.com/kamjin3086/chatless/releases/latest)

### Linux
- **Red Hat/CentOS/Fedora**: [Chatless-x.x.x-1.x86_64.rpm](https://github.com/kamjin3086/chatless/releases/latest)
- **Ubuntu/Debian**: [Chatless_x.x.x_amd64.deb](https://github.com/kamjin3086/chatless/releases/latest)
- **Universal**: [Chatless-x.x.x-x86_64.AppImage](https://github.com/kamjin3086/chatless/releases/latest)

---

## Installation Steps

### Windows
1. Download .exe file
2. Double-click to run installer
3. Follow prompts to complete installation

### macOS
1. Download .dmg file
2. Double-click to open, drag to Applications folder
3. Launch from Applications

**Note**: First launch may show "damaged" message, please:
1. Click "Cancel"
2. Open Terminal, run: `sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app`
3. Restart application

### Linux
1. Download package in corresponding format
2. Install using package manager:
   - RPM: `sudo dnf install Chatless-*.rpm`
   - DEB: `sudo dpkg -i Chatless_*.deb`
   - AppImage: `chmod +x Chatless-*.AppImage` then double-click to run

---

## Common Issues

**Windows crash**: Install [Visual C++ Runtime](https://aka.ms/vs/17/release/vc_redist.x64.exe)

**macOS won't open**: Use terminal command to remove quarantine (see above)

**Linux permission**: Ensure execute permission with `chmod +x`

---

## Get Help

- [View all versions](https://github.com/kamjin3086/chatless/releases)
- [Report an issue](https://github.com/kamjin3086/chatless/issues) (see the [Contributing Guide](CONTRIBUTING_EN.md) for what to include)
- [Project homepage](README_EN.md)
