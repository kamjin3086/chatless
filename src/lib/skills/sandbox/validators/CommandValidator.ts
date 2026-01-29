/**
 * 命令安全校验器
 * 
 * 检测并阻止危险命令的执行，保护用户系统安全
 */

import type { ValidationResult, SandboxSecurityConfig } from '../types';

/**
 * 危险命令模式定义
 */
interface DangerousPattern {
  /** 模式正则表达式 */
  pattern: RegExp;
  /** 风险描述 */
  description: string;
  /** 风险等级 */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** 适用平台 */
  platforms: Array<'windows' | 'linux' | 'darwin' | 'all'>;
  /** 安全建议 */
  suggestion?: string;
}

/**
 * 命令校验器配置
 */
export interface CommandValidatorConfig {
  /** 是否启用严格模式（更多限制） */
  strictMode?: boolean;
  /** 额外的危险模式 */
  additionalPatterns?: DangerousPattern[];
  /** 允许的命令白名单 */
  allowedCommands?: string[];
  /** 自定义黑名单 */
  customBlocklist?: RegExp[];
  /** 是否允许管道和重定向 */
  allowPipeAndRedirect?: boolean;
  /** 允许的工作目录 */
  allowedWorkingDirs?: string[];
}

/**
 * 危险命令模式列表
 */
const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // ========== 文件删除操作 ==========
  {
    pattern: /\brm\s+(-[rRfFvV]*\s+)*(-r|-R|--recursive|-f|--force)/i,
    description: '递归或强制删除文件',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
    suggestion: '请使用更安全的删除方式，或确认目标路径',
  },
  {
    pattern: /\brm\s+-rf\s+[\/~]/i,
    description: '删除根目录或用户目录',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\bdel\s+\/[sS]/i,
    description: 'Windows 递归删除文件',
    severity: 'critical',
    platforms: ['windows'],
  },
  {
    pattern: /\brmdir\s+\/[sS]/i,
    description: 'Windows 递归删除目录',
    severity: 'critical',
    platforms: ['windows'],
  },
  {
    pattern: /\brd\s+\/[sS]/i,
    description: 'Windows 递归删除目录',
    severity: 'critical',
    platforms: ['windows'],
  },

  // ========== 系统破坏操作 ==========
  {
    pattern: /\bformat\s+[a-zA-Z]:/i,
    description: '格式化磁盘',
    severity: 'critical',
    platforms: ['windows'],
  },
  {
    pattern: /\bmkfs\b/i,
    description: '创建文件系统（格式化）',
    severity: 'critical',
    platforms: ['linux'],
  },
  {
    pattern: /\bdd\s+if=/i,
    description: 'dd 命令写入设备',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\b>\s*\/dev\/(sd[a-z]|nvme|hd[a-z])/i,
    description: '直接写入磁盘设备',
    severity: 'critical',
    platforms: ['linux'],
  },

  // ========== 权限提升 ==========
  {
    pattern: /\bsudo\b/i,
    description: '使用 sudo 提权',
    severity: 'high',
    platforms: ['linux', 'darwin'],
    suggestion: '请避免使用需要管理员权限的命令',
  },
  {
    pattern: /\bsu\s+-?\s*$/i,
    description: '切换到 root 用户',
    severity: 'high',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\brunas\b/i,
    description: 'Windows 提权执行',
    severity: 'high',
    platforms: ['windows'],
  },
  {
    pattern: /\bpowershell\s+.*-ExecutionPolicy\s+Bypass/i,
    description: 'PowerShell 绕过执行策略',
    severity: 'high',
    platforms: ['windows'],
  },

  // ========== 系统控制 ==========
  {
    pattern: /\bshutdown\b/i,
    description: '关闭系统',
    severity: 'critical',
    platforms: ['all'],
  },
  {
    pattern: /\breboot\b/i,
    description: '重启系统',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\bhalt\b/i,
    description: '停止系统',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\binit\s+[06]\b/i,
    description: '系统运行级别切换',
    severity: 'critical',
    platforms: ['linux'],
  },

  // ========== Fork Bomb ==========
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    description: 'Bash Fork Bomb',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /%0\|%0/,
    description: 'Windows Fork Bomb',
    severity: 'critical',
    platforms: ['windows'],
  },

  // ========== 危险的权限修改 ==========
  {
    pattern: /\bchmod\s+(-R\s+)?777\s+\//i,
    description: '递归设置危险权限',
    severity: 'high',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\bchown\s+-R\s+/i,
    description: '递归更改文件所有者',
    severity: 'medium',
    platforms: ['linux', 'darwin'],
  },

  // ========== 网络相关危险操作 ==========
  {
    pattern: /\bcurl\s+.*\|\s*(ba)?sh/i,
    description: '从网络下载并执行脚本',
    severity: 'high',
    platforms: ['all'],
    suggestion: '请先下载脚本并检查内容后再执行',
  },
  {
    pattern: /\bwget\s+.*\|\s*(ba)?sh/i,
    description: '从网络下载并执行脚本',
    severity: 'high',
    platforms: ['linux', 'darwin'],
  },

  // ========== 环境变量破坏 ==========
  {
    pattern: /\bexport\s+PATH\s*=\s*$/i,
    description: '清空 PATH 环境变量',
    severity: 'medium',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: /\bset\s+PATH\s*=\s*$/i,
    description: '清空 PATH 环境变量',
    severity: 'medium',
    platforms: ['windows'],
  },

  // ========== 历史记录清除 ==========
  {
    pattern: /\bhistory\s+-c/i,
    description: '清除命令历史',
    severity: 'low',
    platforms: ['linux', 'darwin'],
  },

  // ========== 危险的覆盖操作 ==========
  {
    pattern: />\s*\/etc\//i,
    description: '覆盖系统配置文件',
    severity: 'critical',
    platforms: ['linux', 'darwin'],
  },
  {
    pattern: />\s*C:\\Windows\\/i,
    description: '覆盖 Windows 系统文件',
    severity: 'critical',
    platforms: ['windows'],
  },
];

/**
 * 敏感路径模式
 */
const SENSITIVE_PATHS: Array<{ pattern: RegExp; description: string; platforms: string[] }> = [
  // Linux/macOS
  { pattern: /^\/etc\b/i, description: '系统配置目录', platforms: ['linux', 'darwin'] },
  { pattern: /^\/boot\b/i, description: '启动目录', platforms: ['linux'] },
  { pattern: /^\/root\b/i, description: 'root 用户目录', platforms: ['linux'] },
  { pattern: /^\/sys\b/i, description: '系统文件系统', platforms: ['linux'] },
  { pattern: /^\/proc\b/i, description: '进程文件系统', platforms: ['linux'] },
  { pattern: /^\/dev\b/i, description: '设备目录', platforms: ['linux', 'darwin'] },
  { pattern: /^\/var\/log\b/i, description: '系统日志目录', platforms: ['linux'] },
  
  // Windows
  { pattern: /^C:\\Windows\b/i, description: 'Windows 系统目录', platforms: ['windows'] },
  { pattern: /^C:\\Program Files\b/i, description: '程序安装目录', platforms: ['windows'] },
  { pattern: /^C:\\ProgramData\b/i, description: '程序数据目录', platforms: ['windows'] },
  { pattern: /^%SystemRoot%/i, description: 'Windows 系统目录', platforms: ['windows'] },
  { pattern: /^%WinDir%/i, description: 'Windows 目录', platforms: ['windows'] },
];

/**
 * 命令安全校验器
 */
export class CommandValidator {
  private config: CommandValidatorConfig;
  private platform: 'windows' | 'linux' | 'darwin';
  private allPatterns: DangerousPattern[];

  constructor(config: CommandValidatorConfig = {}) {
    this.config = {
      strictMode: false,
      allowPipeAndRedirect: true,
      ...config,
    };

    // 检测运行平台
    this.platform = this.detectPlatform();

    // 合并内置模式和自定义模式
    this.allPatterns = [
      ...DANGEROUS_PATTERNS,
      ...(config.additionalPatterns || []),
    ];
  }

  /**
   * 检测运行平台
   */
  private detectPlatform(): 'windows' | 'linux' | 'darwin' {
    if (typeof process !== 'undefined' && process.platform) {
      return process.platform as 'windows' | 'linux' | 'darwin';
    }
    // 在浏览器环境中，尝试从 navigator 检测
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('win')) return 'windows';
      if (ua.includes('mac')) return 'darwin';
      return 'linux';
    }
    return 'linux'; // 默认假设 Linux
  }

  /**
   * 校验命令安全性
   * 
   * @param command - 要校验的命令
   * @returns 校验结果
   */
  validate(command: string): ValidationResult {
    // 空命令检查
    if (!command || command.trim().length === 0) {
      return {
        valid: false,
        reason: '命令不能为空',
      };
    }

    const normalizedCommand = command.trim();

    // 检查白名单
    if (this.config.allowedCommands && this.config.allowedCommands.length > 0) {
      const baseCommand = this.extractBaseCommand(normalizedCommand);
      if (!this.config.allowedCommands.includes(baseCommand)) {
        return {
          valid: false,
          reason: `命令 "${baseCommand}" 不在允许列表中`,
        };
      }
    }

    // 检查自定义黑名单
    if (this.config.customBlocklist) {
      for (const pattern of this.config.customBlocklist) {
        if (pattern.test(normalizedCommand)) {
          return {
            valid: false,
            reason: '命令被自定义规则阻止',
            matchedPattern: pattern.source,
          };
        }
      }
    }

    // 检查危险模式
    for (const dangerousPattern of this.allPatterns) {
      // 检查平台兼容性
      if (!this.isPlatformMatch(dangerousPattern.platforms)) {
        continue;
      }

      if (dangerousPattern.pattern.test(normalizedCommand)) {
        return {
          valid: false,
          reason: dangerousPattern.description,
          matchedPattern: dangerousPattern.pattern.source,
          suggestion: dangerousPattern.suggestion,
        };
      }
    }

    // 严格模式下的额外检查
    if (this.config.strictMode) {
      const strictResult = this.strictModeCheck(normalizedCommand);
      if (!strictResult.valid) {
        return strictResult;
      }
    }

    // 检查管道和重定向
    if (!this.config.allowPipeAndRedirect) {
      if (/[|><]/.test(normalizedCommand)) {
        return {
          valid: false,
          reason: '不允许使用管道和重定向操作符',
          suggestion: '请使用单一命令',
        };
      }
    }

    return { valid: true };
  }

  /**
   * 校验路径安全性
   * 
   * @param path - 要校验的路径
   * @returns 校验结果
   */
  validatePath(path: string): ValidationResult {
    if (!path || path.trim().length === 0) {
      return { valid: true }; // 空路径由其他逻辑处理
    }

    const normalizedPath = this.normalizePathForCompare(path.trim());

    // 检查敏感路径
    for (const sensitive of SENSITIVE_PATHS) {
      if (!sensitive.platforms.includes(this.platform) && !sensitive.platforms.includes('all')) {
        continue;
      }

      if (sensitive.pattern.test(normalizedPath)) {
        return {
          valid: false,
          reason: `禁止访问 ${sensitive.description}: ${normalizedPath}`,
          matchedPattern: sensitive.pattern.source,
        };
      }
    }

    // 检查路径遍历攻击
    if (/\.\.[\\/]/.test(normalizedPath)) {
      return {
        valid: false,
        reason: '检测到路径遍历尝试',
        matchedPattern: '../',
      };
    }

    // 检查允许的工作目录
    if (this.config.allowedWorkingDirs && this.config.allowedWorkingDirs.length > 0) {
      const isAllowed = this.config.allowedWorkingDirs.some(dir => {
        const allowed = this.normalizePathForCompare(String(dir || ''));
        if (!allowed) return false;
        // allow exact match or prefix-with-separator
        const p = normalizedPath.toLowerCase();
        const a = allowed.toLowerCase();
        if (p === a) return true;
        const prefix = a.endsWith('/') ? a : `${a}/`;
        return p.startsWith(prefix);
      });
      if (!isAllowed) {
        return {
          valid: false,
          reason: '路径不在允许的目录范围内',
          suggestion: `允许的目录: ${this.config.allowedWorkingDirs.join(', ')}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * 将路径统一为可比较形式：
   * - 统一分隔符为 '/'
   * - 去掉末尾多余 '/'
   * - Windows 盘符路径大小写不敏感（比较时统一 lower）
   */
  private normalizePathForCompare(p: string): string {
    const s = String(p || '').trim();
    if (!s) return '';
    let out = s.replace(/\\/g, '/');
    // collapse duplicate slashes (keep leading // for UNC)
    if (!out.startsWith('//')) out = out.replace(/\/{2,}/g, '/');
    // trim trailing slashes (keep root)
    if (out !== '/' && !/^[A-Za-z]:\/$/.test(out)) out = out.replace(/\/+$/g, '');
    // normalize drive letter casing
    out = out.replace(/^([A-Za-z]):\//, (_, d) => `${String(d).toUpperCase()}:/`);
    return out;
  }

  /**
   * 校验命令和路径的组合
   */
  validateCommandWithPath(command: string, workingDir?: string): ValidationResult {
    // 先校验命令
    const commandResult = this.validate(command);
    if (!commandResult.valid) {
      return commandResult;
    }

    // 再校验路径
    if (workingDir) {
      const pathResult = this.validatePath(workingDir);
      if (!pathResult.valid) {
        return pathResult;
      }
    }

    return { valid: true };
  }

  /**
   * 提取基础命令（不含参数）
   */
  private extractBaseCommand(command: string): string {
    const parts = command.trim().split(/\s+/);
    return parts[0] || '';
  }

  /**
   * 检查平台是否匹配
   */
  private isPlatformMatch(platforms: Array<'windows' | 'linux' | 'darwin' | 'all'>): boolean {
    return platforms.includes('all') || platforms.includes(this.platform);
  }

  /**
   * 严格模式检查
   */
  private strictModeCheck(command: string): ValidationResult {
    // 检查是否使用了变量替换
    if (/\$\(|`/.test(command)) {
      return {
        valid: false,
        reason: '严格模式下不允许命令替换',
        matchedPattern: '$() or ``',
      };
    }

    // 检查是否使用了通配符在危险位置
    if (/\brm\s+.*\*/i.test(command)) {
      return {
        valid: false,
        reason: '严格模式下 rm 命令不允许使用通配符',
        matchedPattern: 'rm *',
      };
    }

    return { valid: true };
  }

  /**
   * 获取当前配置
   */
  getConfig(): CommandValidatorConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CommandValidatorConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.additionalPatterns) {
      this.allPatterns = [
        ...DANGEROUS_PATTERNS,
        ...config.additionalPatterns,
      ];
    }
  }

  /**
   * 获取所有危险模式（用于调试）
   */
  getDangerousPatterns(): DangerousPattern[] {
    return [...this.allPatterns];
  }

  /**
   * 获取当前平台
   */
  getPlatform(): string {
    return this.platform;
  }
}

