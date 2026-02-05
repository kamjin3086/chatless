/**
 * 通用同步框架 - 传输层接口
 * 
 * 定义了与远端存储交互的抽象接口，
 * 使同步逻辑与具体的传输协议解耦。
 */

import type { SyncMetadataFile } from './types';
import type { SyncDoc } from './SyncAdapter';

/** 元数据读取结果 */
export interface MetadataResult {
  /** 元数据内容，不存在时为 null */
  data: SyncMetadataFile | null;
  /** ETag 用于乐观锁 */
  etag?: string;
}

/** 数据项读取结果 */
export interface ItemResult<D extends SyncDoc = SyncDoc> {
  /** 数据内容，不存在时为 null */
  data: D | null;
  /** ETag 用于乐观锁 */
  etag?: string;
}

/**
 * 传输层接口
 * 
 * 实现此接口以支持不同的远端存储后端，
 * 如 WebDAV、S3、本地文件系统等。
 */
export interface SyncTransport {
  /** 传输类型标识（如 'webdav', 's3', 'local'） */
  readonly type: string;
  
  /** 传输层显示名称 */
  readonly displayName: string;

  // ========== 连接管理 ==========
  
  /**
   * 检查远端连接是否正常
   * @returns 连接成功返回 true，否则返回 false
   */
  checkConnection(): Promise<boolean>;

  // ========== 目录操作 ==========
  
  /**
   * 确保指定目录存在
   * 如果目录不存在，则创建它（包括所有父目录）
   */
  ensureDirectory(path: string): Promise<void>;

  // ========== 元数据操作 ==========
  
  /**
   * 获取元数据文件
   * @param path 相对路径（如 'prompts/data/metadata.json'）
   */
  getMetadata(path: string): Promise<MetadataResult>;
  
  /**
   * 保存元数据文件
   * @param path 相对路径
   * @param data 元数据内容
   * @param etag 可选的 ETag，用于条件更新
   */
  putMetadata(path: string, data: SyncMetadataFile, etag?: string): Promise<void>;

  // ========== 数据项操作 ==========
  
  /**
   * 获取单个数据文件
   * @param path 相对路径（如 'prompts/data/abc123.json'）
   */
  getItem<D extends SyncDoc = SyncDoc>(path: string): Promise<ItemResult<D>>;
  
  /**
   * 保存单个数据文件
   * @param path 相对路径
   * @param data 数据内容
   */
  putItem(path: string, data: SyncDoc): Promise<void>;
  
  /**
   * 删除单个数据文件
   * 注意：通常我们使用软删除，此方法仅用于清理
   * @param path 相对路径
   */
  deleteItem?(path: string): Promise<void>;
}

/**
 * 传输层工厂函数类型
 */
export type TransportFactory<T extends SyncTransport = SyncTransport> = (
  config: TransportConfig
) => T;

/**
 * 通用传输层配置
 */
export interface TransportConfig {
  /** 基础路径 */
  basePath: string;
  /** 其他配置由具体实现定义 */
  [key: string]: unknown;
}

/**
 * WebDAV 传输层配置
 */
export interface WebDAVTransportConfig extends TransportConfig {
  /** WebDAV 服务器 URL */
  url: string;
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
}
