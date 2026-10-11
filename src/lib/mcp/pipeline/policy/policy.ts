import type { ApprovalDecision } from '@/store/authorizationStore';
import type { AllowlistDirectory } from '@/lib/filesystemAllowlist';
import { dirnameOf } from './resolveCall';
import { isFilesystemServer, isShellServer, normalizeServerName } from '@/lib/mcp/toolNaming';

/**
 * 决定一次调用能不能跑：`decide` 回答放行 / 要问，`planPromotion` 把一个审批回答
 * 翻译成状态增量。两者都是纯函数——读 store、等用户、落盘都留在调用方。
 *
 * 之所以拆成两半：审批要等人，而等之前算出的判定和等之后产生的信任，是同一套规则的
 * 前后两段。放一个模块里是为了让"问不问"和"答完变成什么"能被同一张表穷举测试。
 */

export type FilesystemDecision =
  /** 允许名单已经覆盖这次操作，或者该作用域已免问。 */
  | { kind: 'allow'; needsCallGrant: boolean }
  /** 要问。`approvableDirectory` 为空时卡片不该给出"以后都允许"这个选项。 */
  | {
      kind: 'ask';
      /** 本次调用是否需要临时授予路径。 */
      needsCallGrant: boolean;
      /** 可以用来"记住"的目录；删除没有可记住的目录。 */
      approvableDirectory?: string;
    };

/**
 * 文件系统调用要不要问。
 *
 * 判定所需的三件事都在解析产物里：操作种类、主路径、命中的允许名单目录。
 * 免问状态下不问，但后端仍然逐次校验路径——这是既有的分工。
 */
export function decideFilesystemCall(params: {
  op: 'read' | 'write' | 'create' | 'delete';
  primaryPath: string;
  directory?: AllowlistDirectory;
  unrestricted: boolean;
}): FilesystemDecision {
  const isDelete = params.op === 'delete';
  const hasDir = !!params.directory;
  const hasPerm = hasDir ? !!params.directory?.permissions?.[params.op] : false;
  const needsCallGrant = !hasPerm || isDelete;

  // 没有主路径就无从判定，交给下游按原样执行；这与抽取前的判定一致。
  const mustAsk = !params.unrestricted && !!params.primaryPath
    && (isDelete || !hasDir || !hasPerm);
  if (!mustAsk) return { kind: 'allow', needsCallGrant };

  // "以后都允许"只对能授予的目录有意义：删除报出父目录，但永远不提出这个选项。
  const approvableDirectory = params.directory?.path || dirnameOf(params.primaryPath);
  return { kind: 'ask', needsCallGrant, approvableDirectory: approvableDirectory || undefined };
}

/**
 * 一个审批回答落策略上的增量。执行它的是调用方，这里只说"该发生什么"。
 *
 * 三个回答在两个作用域下含义不同，必须穷举，不能让默认分支兜底：
 *
 * | 回答 | fs | shell |
 * | --- | --- | --- |
 * | once | 什么都不变 | 什么都不变 |
 * | always | 记住该目录（删除不记） | 关掉全局 shell 审批 |
 * | unrestricted | 本会话免问 | 本会话免问 |
 */
export type Promotion = {
  /** 要写进持久允许名单的目录；undefined 表示不记。 */
  rememberDirectory?: string;
  /** 本会话内不再询问该作用域。 */
  conversationUnrestricted: boolean;
  /** 持久地关掉该作用域的审批。 */
  globalUnrestricted: boolean;
};

export function planFilesystemPromotion(params: {
  answer: ApprovalDecision;
  approvableDirectory?: string;
  isDelete: boolean;
}): Promotion {
  const remember = params.answer === 'always' && !!params.approvableDirectory && !params.isDelete;
  return {
    rememberDirectory: remember ? params.approvableDirectory : undefined,
    conversationUnrestricted: params.answer === 'unrestricted',
    globalUnrestricted: false,
  };
}

export function planShellPromotion(params: { answer: ApprovalDecision }): Promotion {
  return {
    rememberDirectory: undefined,
    conversationUnrestricted: params.answer === 'unrestricted',
    globalUnrestricted: params.answer === 'always',
  };
}

/**
 * 非文件系统作用域要不要问。shell 另有例外：读取自己起进程的输出、列出它们、
 * 停掉它们都不算新的副作用。
 */
export function decideServerCall(params: {
  server: string;
  tool: string;
  autoAuthorize: boolean;
}): 'allow' | 'ask' {
  // 先归一：main 上的原实现就是拿 normalizeServerName 做比对的，
  // 不归一则 'System' / 'User_FS' 这类写法会落到兵头分枝，把原本不问的变成问。
  const srv = normalizeServerName(params.server);
  const tl = String(params.tool || '').toLowerCase();

  if (isShellServer(srv)) {
    if (/^(logs|list|stop)$/.test(tl)) return 'allow';
    return params.autoAuthorize ? 'allow' : 'ask';
  }

  // user_fs：只有写入要确认，读与 list 属于已授权目录内的低风险操作。
  if (srv === 'user_fs') {
    return tl === 'write_user_file' && !params.autoAuthorize ? 'ask' : 'allow';
  }

  // 技能的安装与修改会改动本地执行环境，只有查看免审批。
  if (srv === 'skills_fs') {
    return /^(read_skill_resource|list_skill_resources|list_files)$/.test(tl) ? 'allow' : 'ask';
  }
  if (srv === 'skills' || srv === 'skill') {
    return /^(list|guide|read_file|list_files|check_deps|use)$/.test(tl) ? 'allow' : 'ask';
  }

  if (srv === 'tools') return 'allow';

  // system 的读取是安全的，prompt 与技能的行政管理不是。
  if (srv === 'system') {
    return /^(list_prompts|get_prompt|list_skills)$/.test(tl) ? 'allow' : 'ask';
  }

  // 文件系统由允许名单门禁单独管，这里不参与，免得全局自动授权绕过它。
  if (isFilesystemServer(srv)) return 'allow';

  return params.autoAuthorize ? 'allow' : 'ask';
}
