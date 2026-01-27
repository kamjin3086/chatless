export type FileOp = 'read' | 'write' | 'create' | 'delete';

export type AllowlistSource = 'manual' | 'skills' | 'workdir' | 'attachment' | 'unknown';

export type AllowlistPermissions = Record<FileOp, boolean>;

export interface AllowlistDirectory {
  id: string;
  /** 绝对路径（目录） */
  path: string;
  /** 可选别名：@Alias/... */
  alias?: string;
  /** 权限（rwcd） */
  permissions: AllowlistPermissions;
  /** 来源（用于展示/审计） */
  source: AllowlistSource;
  createdAt: number;
  updatedAt: number;
}

export type ResolvedAllowlistPath = {
  /** 归一化后的绝对路径（统一使用 / 分隔符） */
  absolutePath: string;
  /** 命中的白名单目录（若有） */
  directory?: AllowlistDirectory;
  /** 相对于 directory.path 的相对路径（若 directory 存在） */
  relativePath?: string;
  /** 是否来自 @Alias 解析 */
  viaAlias?: boolean;
};

