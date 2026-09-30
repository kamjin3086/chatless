import { RAGService, createDefaultRAGConfig } from "./RAGService";

let _ragService: RAGService | null = null;
let _ragInitPromise: Promise<RAGService> | null = null;

/**
 * 获取全局 RAGService 实例（带懒加载与初始化）。
 * 1. 初次调用时创建并初始化实例
 * 2. 后续调用复用同一实例，避免重复加载 ONNX/session 等重量资源
 */
export async function getRAGService(): Promise<RAGService> {
  if (_ragService) {
    // 已初始化
    return _ragService;
  }
  if (!_ragInitPromise) {
    _ragInitPromise = (async () => {
      // 创建默认配置（后续可在运行时通过 updateConfig 调整）
      const config = createDefaultRAGConfig();
      const service = new RAGService(config);
      await service.initialize();
      _ragService = service;
      return service;
    })().catch((error) => {
      _ragInitPromise = null;
      throw error;
    });
  }
  return _ragInitPromise;
}
