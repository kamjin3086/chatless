/**
 * 脚本执行器 - 脚本优先策略
 * 
 * 设计理念：
 * - AI 生成 Python/JavaScript 代码比 shell 命令更可靠
 * - 利用语言内置的跨平台能力（os、shutil、fs）
 * - 消除转义问题（代码中的字符串不需要多层转义）
 * - 复杂逻辑（循环、条件）用代码比 shell 更自然
 * 
 * 工作流程：
 * 1. AI 生成脚本代码（不是命令字符串）
 * 2. 系统写入临时文件
 * 3. 执行脚本
 * 4. 返回结果并清理
 */

import { writeFile, remove, mkdir, exists } from '@tauri-apps/plugin-fs';
import { join, tempDir } from '@tauri-apps/api/path';
import { getProcessSandbox } from '@/lib/skills/sandbox';

export type ScriptLanguage = 'python' | 'node' | 'powershell' | 'bash';

export interface ScriptRequest {
  /** 脚本语言 */
  language: ScriptLanguage;
  /** 脚本代码 */
  code: string;
  /** 工作目录 */
  workingDir?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

export interface ScriptResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  error?: string;
  /** 执行的脚本路径（调试用） */
  scriptPath?: string;
}

/** 语言到命令的映射 */
const LANGUAGE_CONFIG: Record<ScriptLanguage, {
  command: string;
  extension: string;
  /** Windows 上可能需要的备用命令 */
  windowsAlt?: string;
}> = {
  python: { command: 'python', extension: '.py', windowsAlt: 'python3' },
  node: { command: 'node', extension: '.js' },
  powershell: { command: 'powershell', extension: '.ps1' },
  bash: { command: 'bash', extension: '.sh' },
};

/** 生成唯一的脚本文件名 */
function generateScriptName(ext: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `agent_script_${timestamp}_${random}${ext}`;
}

/** 添加 Python 脚本的通用 header（编码声明等） */
function wrapPythonScript(code: string): string {
  // 如果代码已经有编码声明，不添加
  if (code.startsWith('# -*- coding') || code.startsWith('#!/')) {
    return code;
  }
  return `# -*- coding: utf-8 -*-
import sys
import os

# 设置 stdout 编码
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# 用户脚本开始
${code}
`;
}

/** 添加 Node 脚本的通用 header */
function wrapNodeScript(code: string): string {
  // 如果已经有 'use strict' 或 import，不添加
  if (code.startsWith("'use strict'") || code.startsWith('import ') || code.startsWith('const ')) {
    return code;
  }
  return `'use strict';
// Agent 生成的脚本

${code}
`;
}

/** 包装脚本代码 */
function wrapScript(code: string, language: ScriptLanguage): string {
  switch (language) {
    case 'python':
      return wrapPythonScript(code);
    case 'node':
      return wrapNodeScript(code);
    default:
      return code;
  }
}

/**
 * 执行脚本
 * 
 * @param request 脚本请求
 * @returns 执行结果
 */
export async function executeScript(request: ScriptRequest): Promise<ScriptResult> {
  const { language, code, workingDir, timeoutMs = 60000 } = request;
  
  const config = LANGUAGE_CONFIG[language];
  if (!config) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: `不支持的脚本语言: ${language}`,
      duration: 0,
      error: `Unsupported language: ${language}`,
    };
  }
  
  const sandbox = getProcessSandbox();
  const isAvailable = await sandbox.isAvailable();
  if (!isAvailable) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: 'Shell executor 不可用',
      duration: 0,
      error: 'Shell executor is not available',
    };
  }
  
  // 获取临时目录
  let scriptDir: string;
  try {
    scriptDir = await tempDir();
    // 创建 agent_scripts 子目录
    const agentScriptsDir = await join(scriptDir, 'agent_scripts');
    if (!(await exists(agentScriptsDir))) {
      await mkdir(agentScriptsDir, { recursive: true });
    }
    scriptDir = agentScriptsDir;
  } catch {
    scriptDir = workingDir || '.';
  }
  
  // 生成脚本文件路径
  const scriptName = generateScriptName(config.extension);
  const scriptPath = await join(scriptDir, scriptName);
  
  // 包装脚本代码
  const wrappedCode = wrapScript(code, language);
  
  const startTime = Date.now();
  
  try {
    // 写入脚本文件
    const encoder = new TextEncoder();
    await writeFile(scriptPath, encoder.encode(wrappedCode));
    
    // 执行脚本
    const result = await sandbox.execute({
      command: config.command,
      args: [scriptPath],
      workingDir,
      timeoutMs,
    }, {
      executionId: `script:${language}:${scriptName}`,
      startTime,
      conversationId: '',
    });
    
    return {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: Date.now() - startTime,
      error: result.error,
      scriptPath,
    };
  } catch (err) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: String(err),
      duration: Date.now() - startTime,
      error: String(err),
      scriptPath,
    };
  } finally {
    // 清理脚本文件（异步，不阻塞返回）
    remove(scriptPath).catch(() => {
      // 忽略清理失败
    });
  }
}

/**
 * 从 AI 输出中检测是否是脚本模式
 * 
 * 支持的格式：
 * 1. 代码块格式：```python\ncode\n```
 * 2. JSON 格式：{ "language": "python", "code": "..." }
 */
export function parseScriptRequest(input: string): ScriptRequest | null {
  const trimmed = input.trim();
  
  // 尝试 JSON 格式
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.language && obj.code) {
        return {
          language: obj.language as ScriptLanguage,
          code: obj.code,
          workingDir: obj.workingDir,
          timeoutMs: obj.timeoutMs,
        };
      }
    } catch {
      // 忽略 JSON 解析错误
    }
  }
  
  // 尝试代码块格式
  const codeBlockMatch = trimmed.match(/^```(python|javascript|js|node|powershell|bash)\n([\s\S]*?)\n```$/);
  if (codeBlockMatch) {
    let lang = codeBlockMatch[1].toLowerCase();
    if (lang === 'javascript' || lang === 'js') lang = 'node';
    
    return {
      language: lang as ScriptLanguage,
      code: codeBlockMatch[2],
    };
  }
  
  return null;
}

/**
 * 检测命令是否应该使用脚本模式执行
 * 
 * 规则：
 * - 包含代码块标记
 * - JSON 格式的脚本请求
 * - 多行 Python/JS 代码
 */
export function shouldUseScriptMode(command: string): boolean {
  const trimmed = command.trim();
  
  // 代码块格式
  if (/^```(python|javascript|js|node|powershell|bash)\n/i.test(trimmed)) {
    return true;
  }
  
  // JSON 格式
  if (trimmed.startsWith('{') && trimmed.includes('"language"') && trimmed.includes('"code"')) {
    return true;
  }
  
  return false;
}

/**
 * 生成常用操作的 Python 代码片段
 * 这些片段可以被 AI 直接使用或组合
 */
export const PYTHON_SNIPPETS = {
  createDir: (path: string) => `
import os
os.makedirs(${JSON.stringify(path)}, exist_ok=True)
print(f"目录已创建: ${path}")
`,
  
  removeDir: (path: string) => `
import shutil
import os
if os.path.exists(${JSON.stringify(path)}):
    shutil.rmtree(${JSON.stringify(path)})
    print(f"目录已删除: ${path}")
else:
    print(f"目录不存在: ${path}")
`,
  
  copyFile: (src: string, dst: string) => `
import shutil
shutil.copy2(${JSON.stringify(src)}, ${JSON.stringify(dst)})
print(f"文件已复制: ${src} -> ${dst}")
`,
  
  moveFile: (src: string, dst: string) => `
import shutil
shutil.move(${JSON.stringify(src)}, ${JSON.stringify(dst)})
print(f"文件已移动: ${src} -> ${dst}")
`,
  
  downloadFile: (url: string, savePath: string) => `
import urllib.request
import os
os.makedirs(os.path.dirname(${JSON.stringify(savePath)}), exist_ok=True)
urllib.request.urlretrieve(${JSON.stringify(url)}, ${JSON.stringify(savePath)})
print(f"文件已下载: ${savePath}")
`,
  
  listDir: (path: string) => `
import os
for item in os.listdir(${JSON.stringify(path)}):
    full_path = os.path.join(${JSON.stringify(path)}, item)
    if os.path.isdir(full_path):
        print(f"[DIR]  {item}")
    else:
        size = os.path.getsize(full_path)
        print(f"[FILE] {item} ({size} bytes)")
`,
  
  readFile: (path: string) => `
with open(${JSON.stringify(path)}, 'r', encoding='utf-8') as f:
    print(f.read())
`,
  
  writeFile: (path: string, content: string) => `
import os
os.makedirs(os.path.dirname(${JSON.stringify(path)}), exist_ok=True)
with open(${JSON.stringify(path)}, 'w', encoding='utf-8') as f:
    f.write(${JSON.stringify(content)})
print(f"文件已写入: ${path}")
`,
};

/**
 * 生成常用操作的 Node.js 代码片段
 */
export const NODE_SNIPPETS = {
  createDir: (path: string) => `
const fs = require('fs');
fs.mkdirSync(${JSON.stringify(path)}, { recursive: true });
console.log('目录已创建:', ${JSON.stringify(path)});
`,
  
  removeDir: (path: string) => `
const fs = require('fs');
if (fs.existsSync(${JSON.stringify(path)})) {
  fs.rmSync(${JSON.stringify(path)}, { recursive: true, force: true });
  console.log('目录已删除:', ${JSON.stringify(path)});
} else {
  console.log('目录不存在:', ${JSON.stringify(path)});
}
`,
  
  copyFile: (src: string, dst: string) => `
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.dirname(${JSON.stringify(dst)}), { recursive: true });
fs.copyFileSync(${JSON.stringify(src)}, ${JSON.stringify(dst)});
console.log('文件已复制:', ${JSON.stringify(src)}, '->', ${JSON.stringify(dst)});
`,
  
  downloadFile: (url: string, savePath: string) => `
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.dirname(${JSON.stringify(savePath)}), { recursive: true });
const file = fs.createWriteStream(${JSON.stringify(savePath)});
const protocol = ${JSON.stringify(url)}.startsWith('https') ? https : http;

protocol.get(${JSON.stringify(url)}, (response) => {
  response.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('文件已下载:', ${JSON.stringify(savePath)});
  });
}).on('error', (err) => {
  fs.unlink(${JSON.stringify(savePath)}, () => {});
  console.error('下载失败:', err.message);
});
`,
};
