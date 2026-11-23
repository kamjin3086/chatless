# Chatless {{VERSION}} Release

## Download

### Windows
- [Chatless Setup (.exe)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_x64-setup.exe)
- [Chatless MSI (.msi)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_x64_en-US.msi)

### macOS
- [Apple Silicon](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_aarch64.dmg)
- [Intel Processor (run with Rosetta 2)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_aarch64.dmg)

> **Won't open, or a "damaged" message?** After dropping it into Applications, run this one line in Terminal (builds are ad-hoc signed, not Apple-notarized):
> `sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app`

### Linux
- [Red Hat/CentOS/Fedora (.rpm)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless-{{VERSION}}-1.x86_64.rpm)
- [Ubuntu/Debian (.deb)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_amd64.deb)
- [Universal (.AppImage)](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/Chatless_{{VERSION}}_amd64.AppImage)

---

## Installation

### Windows
1. Download .exe file (recommended) or .msi file
2. Double-click to run installer
3. Follow prompts to complete installation

### macOS
1. Choose version based on processor:
   - Apple Silicon (M1/M2/M3): Download aarch64.dmg
   - Intel Processor: Download aarch64.dmg (run with Rosetta 2)
2. Double-click to open, drag to Applications folder
3. Launch from Applications

**Note**: First launch may show "damaged" message, please:
1. Click "Cancel"
2. Open Terminal, run:

   ```bash
   sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app
   ```

3. Restart application

### Linux
1. Choose format based on distribution:
   - Red Hat/CentOS/Fedora: Download .rpm file
   - Ubuntu/Debian: Download .deb file
   - Other distributions: Download .AppImage file
2. Install using package manager or run directly

---

## Common Issues

**Windows crash**: Install [Visual C++ Runtime](https://aka.ms/vs/17/release/vc_redist.x64.exe)

**macOS won't open**: run `sudo xattr -r -d com.apple.quarantine /Applications/Chatless.app` in Terminal, then launch again

**Linux permission**: Ensure execute permission with `chmod +x`

---

## Documentation

- [Installation Guide](https://github.com/{{REPOSITORY}}/blob/main/INSTALLATION_INSTRUCTIONS_EN.md)
- [Project Homepage](https://github.com/{{REPOSITORY}})
- [Report Issues](https://github.com/{{REPOSITORY}}/issues)
