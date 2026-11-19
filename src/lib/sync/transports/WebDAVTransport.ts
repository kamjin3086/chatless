/**
 * WebDAV 传输层实现
 * 
 * 将现有的 WebDavClient 适配为 SyncTransport 接口
 */

import type { 
  SyncTransport, 
  MetadataResult, 
  ItemResult,
  WebDAVTransportConfig,
} from '../core/SyncTransport';
import type { SyncMetadataFile } from '../core/types';
import type { SyncDoc } from '../core/SyncAdapter';
import { WebDavClient, type WebDavClientConfig } from '../webdav/WebDavClient';

/**
 * WebDAV 传输层
 */
export class WebDAVTransport implements SyncTransport {
  readonly type = 'webdav';
  readonly displayName = 'WebDAV';
  
  private client: WebDavClient;
  private config: WebDAVTransportConfig;

  constructor(config: WebDAVTransportConfig) {
    this.config = config;
    
    const clientConfig: WebDavClientConfig = {
      url: config.url,
      basePath: config.basePath,
      auth: {
        username: config.username,
        password: config.password,
      },
    };
    
    this.client = new WebDavClient(clientConfig);
  }

  /**
   * 检查连接状态
   */
  async checkConnection(): Promise<boolean> {
    try {
      const resp = await this.client.propfind('', '0');
      return resp.status >= 200 && resp.status < 400;
    } catch {
      return false;
    }
  }

  /**
   * 确保目录存在
   */
  async ensureDirectory(path: string): Promise<void> {
    await this.client.ensureCollections([path]);
  }

  /**
   * 获取元数据文件
   */
  async getMetadata(path: string): Promise<MetadataResult> {
    return this.readResource<SyncMetadataFile>(path);
  }

  /**
   * 保存元数据文件
   */
  async putMetadata(
    path: string,
    data: SyncMetadataFile,
    etag: string | null,
  ): Promise<void> {
    await this.writeResource(path, data, etag);
  }

  /**
   * 获取单个数据文件
   */
  async getItem<D extends SyncDoc = SyncDoc>(path: string): Promise<ItemResult<D>> {
    return this.readResource<D>(path);
  }

  async putItem(path: string, data: SyncDoc, etag: string | null): Promise<void> {
    await this.writeResource(path, data, etag);
  }

  private async readResource<T>(path: string): Promise<{ data: T | null; etag?: string }> {
    const result = await this.client.getJson<T>(path);
    if (result.status === 404) return { data: null };
    if (result.json == null || typeof result.json !== 'object' || Array.isArray(result.json)) {
      throw new Error(`Invalid WebDAV JSON resource: ${path}`);
    }
    return { data: result.json, etag: result.etag };
  }

  private async writeResource(path: string, data: SyncDoc | SyncMetadataFile, etag: string | null): Promise<void> {
    await this.client.putJson(path, data, etag === null ? { ifNoneMatch: '*' } : { ifMatch: etag });
  }

  /**
   * 删除单个数据文件（可选）
   */
  async deleteItem(path: string): Promise<void> {
    try {
      await this.client.request('DELETE', path);
    } catch {
      // 忽略删除失败（文件可能不存在）
    }
  }
}

/**
 * 创建 WebDAV 传输层工厂函数
 */
export function createWebDAVTransport(config: WebDAVTransportConfig): WebDAVTransport {
  return new WebDAVTransport(config);
}
