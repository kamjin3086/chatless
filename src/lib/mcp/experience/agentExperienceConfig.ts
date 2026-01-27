import StorageUtil from '@/lib/storage';

/**
 * Agent 体验策略（可调整、可持久化）
 *
 * 这些偏好来自用户主观选择，因此不要散落在 if/else 里；
 * 统一收敛到配置中，后续可接 Settings 页做可视化调整。
 */
export type RuntimeInstallStrategyWindows = 'auto' | 'winget' | 'choco' | 'installer';
export type PathUpdateStrategy = 'sessionOnly' | 'userThenSystem' | 'systemOnly';
export type ShellWorkingDirPolicy = 'optional_best_effort' | 'must_for_package_managers' | 'always_required';
export type StopScope = 'soft_stop' | 'soft_plus_best_effort_cancel' | 'soft_plus_cancel_with_confirm_for_risky';
export type ApprovalUiBehavior = 'auto' | 'switch_to_running_immediately' | 'show_approved_then_run';
export type AutoFixFailurePolicy = 'auto_retry_then_checklist' | 'checklist_only' | 'auto_retry_only';

export interface AgentExperienceConfig {
  windowsRuntimeInstallStrategy: RuntimeInstallStrategyWindows;
  pathUpdateStrategy: PathUpdateStrategy;
  shellWorkingDirPolicy: ShellWorkingDirPolicy;
  stopScope: StopScope;
  approvalUiBehavior: ApprovalUiBehavior;
  autoFixFailurePolicy: AutoFixFailurePolicy;
  /**
   * 工具失败自动重试次数（不含首次尝试）
   * 例如 2 表示最多 1 + 2 = 3 次尝试
   */
  maxToolRetries: number;
}

const CONFIG_FILE = 'mcp-settings.json';
const CONFIG_KEY = 'agent_experience_config';

const DEFAULT_CONFIG: AgentExperienceConfig = {
  // 1) D：agent 自己选最稳的
  windowsRuntimeInstallStrategy: 'auto',
  // 2) D：先用户级 PATH，不行再系统级（通常需要管理员）
  pathUpdateStrategy: 'userThenSystem',
  // 3) C：可选，但 agent 尽量填写
  shellWorkingDirPolicy: 'optional_best_effort',
  // 4) C：A+B，但对“高风险/可能破坏状态”的中止要二次确认（此处先收敛为策略位，后续接 UI/实现）
  stopScope: 'soft_plus_cancel_with_confirm_for_risky',
  // 5) C：按最清晰的做
  approvalUiBehavior: 'auto',
  // 6) C：自动尝试 2-3 条路线，仍失败就给清单
  autoFixFailurePolicy: 'auto_retry_then_checklist',
  // 工具失败自动重试 2 次（共 3 次）
  maxToolRetries: 2,
};

export async function getAgentExperienceConfig(): Promise<AgentExperienceConfig> {
  try {
    const cfg = await StorageUtil.getItem<AgentExperienceConfig>(CONFIG_KEY, DEFAULT_CONFIG, CONFIG_FILE);
    return cfg || DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setAgentExperienceConfig(next: Partial<AgentExperienceConfig>): Promise<void> {
  const cfg = await getAgentExperienceConfig();
  await StorageUtil.setItem(CONFIG_KEY, { ...cfg, ...next }, CONFIG_FILE);
}

export function buildWindowsNodeInstallHint(strategy: RuntimeInstallStrategyWindows): string {
  const lines: string[] = [];
  lines.push('建议修复：安装 Node.js（Windows）');

  // D/auto：把最稳的路线放前面，但同时给出备选
  if (strategy === 'winget' || strategy === 'auto') {
    lines.push('- 首选（winget）: `winget install -e --id OpenJS.NodeJS.LTS`');
  }
  if (strategy === 'choco' || strategy === 'auto') {
    lines.push('- 备选（choco）: `choco install nodejs-lts -y`');
  }
  if (strategy === 'installer' || strategy === 'auto') {
    lines.push('- 备选（官方安装包）: 打开 `https://nodejs.org/` 下载 LTS 安装');
  }
  lines.push('- 安装后验证: `node -v`（必要时重启应用/终端会话）');

  return lines.join('\n');
}

