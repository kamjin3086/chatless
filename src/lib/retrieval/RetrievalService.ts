import {
  RetrievalStrategy,
  VectorSearchResult,
  SearchOptions,
  HybridSearchOptions,
  RetrievalError
} from './types';
import { VectorStoreFactory, VectorStoreCreationOptions, VectorStoreType } from './VectorStoreFactory';
import { SimilarityCalculator } from './similarity';
import { LexicalRetriever } from './LexicalRetriever';
import { reciprocalRankFusion } from './RRFFusion';
import {
  BM25_CANDIDATE_K,
  DENSE_CANDIDATE_K,
  FINAL_EVIDENCE_K,
  RRF_OUTPUT_K,
  RRF_RANK_CONSTANT,
} from '@/lib/rag/constants';
import { DatabaseService } from '@/lib/database/services/DatabaseService';

export class RetrievalService {
  private currentStrategy: RetrievalStrategy | null = null;
  private strategyConfig: VectorStoreCreationOptions;

  constructor(config?: Partial<VectorStoreCreationOptions>) {
    this.strategyConfig = {
      type: 'optimized_sqlite',
      performanceProfile: 'balanced',
      useCase: 'search',
      autoTune: true,
      ...config,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.currentStrategy) {
      // 确保使用最新配置（例如：关闭查询缓存等变更）
      try {
        VectorStoreFactory.clearCache();
      } catch {}
      this.currentStrategy = await VectorStoreFactory.create(this.strategyConfig);
      console.log('检索服务已初始化，使用优化的向量存储策略');
    }
  }

  /**
   * 向量搜索
   */
  async search(
    queryEmbedding: number[],
    options: SearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    console.log('[RetrievalService] 开始向量搜索，查询向量维度:', queryEmbedding.length);
    console.log('[RetrievalService] 搜索选项:', options);

    await this.ensureInitialized();
    console.log('[RetrievalService] 初始化完成，当前策略:', this.currentStrategy?.constructor.name);

    if (!this.currentStrategy) {
      console.error('[RetrievalService] 错误：当前策略为空');
      return [];
    }

    try {
      const results = await this.currentStrategy.search(queryEmbedding, options);
      console.log('[RetrievalService] 向量搜索完成，结果数量:', results.length);
      return results;
    } catch (error) {
      console.error('[RetrievalService] 向量搜索失败:', error);
      // Let the evidence layer classify this as a semantic-search failure
      // and explicitly fall back to lexical retrieval. Returning [] here
      // would make a database/model error indistinguishable from no matches.
      throw error instanceof RetrievalError
        ? error
        : new RetrievalError(`向量搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Hybrid retrieval: Dense Top-K + BM25 Top-K → RRF → final Top-K
   */
  async searchByQuery(
    queryText: string,
    queryEmbedding: number[],
    options: {
      knowledgeBaseIds?: string[];
      topK?: number;
      /** Deprecated compatibility field; RRF does not threshold raw scores. */
      threshold?: number;
      embeddingFingerprint?: string;
    } = {}
  ): Promise<VectorSearchResult[]> {
    const kbIds = options.knowledgeBaseIds?.filter(Boolean);
    const filter: Record<string, string | string[]> = {};
    if (kbIds?.length) {
      filter.knowledgeBaseId = kbIds.length === 1 ? kbIds[0] : kbIds;
    }
    if (options.embeddingFingerprint) {
      filter.embeddingFingerprint = options.embeddingFingerprint;
    }

    const [rawDenseResults, bm25Results] = await Promise.all([
      this.search(queryEmbedding, {
        topK: DENSE_CANDIDATE_K,
        includeEmbeddings: false,
        filter: Object.keys(filter).length ? filter : undefined,
      }),
      new LexicalRetriever().search(queryText, {
        knowledgeBaseIds: kbIds,
        topK: BM25_CANDIDATE_K,
      }),
    ]);
    const denseResults = await this.restrictDenseResultsToMappings(rawDenseResults, kbIds);

    const fused = reciprocalRankFusion([denseResults, bm25Results], RRF_RANK_CONSTANT);
    const finalK = options.topK ?? FINAL_EVIDENCE_K;
    return fused.slice(0, RRF_OUTPUT_K).slice(0, finalK).map((item) => ({
      id: item.id,
      content: (item as VectorSearchResult).content,
      score: item.rrfScore,
      metadata: (item as VectorSearchResult).metadata,
    }));
  }

  /**
   * Vector rows are retired asynchronously and carry their scope in JSON
   * metadata. Re-check the durable mapping before fusion so a concurrent
   * detach cannot leak a vector after its document left the knowledge base.
   */
  private async restrictDenseResultsToMappings(
    results: VectorSearchResult[],
    knowledgeBaseIds?: string[],
  ): Promise<VectorSearchResult[]> {
    if (!results.length || !knowledgeBaseIds?.length) return results;

    const pairs = results
      .map((result) => ({
        documentId: String(result.metadata?.documentId || ''),
        knowledgeBaseId: String(result.metadata?.knowledgeBaseId || ''),
      }))
      .filter((pair) => pair.documentId && pair.knowledgeBaseId && knowledgeBaseIds.includes(pair.knowledgeBaseId));
    if (!pairs.length) return [];

    const db = DatabaseService.getInstance().getDbManager();
    const clauses = pairs.map(() => '(rc.document_id = ? AND rc.knowledge_base_id = ?)').join(' OR ');
    const params = pairs.flatMap((pair) => [pair.documentId, pair.knowledgeBaseId]);
    const rows = await db.select<{ document_id: string; knowledge_base_id: string }>(
      `SELECT rc.document_id, rc.knowledge_base_id
         FROM retrieval_chunks rc
         JOIN doc_knowledge_mappings m
           ON m.document_id = rc.document_id
          AND m.knowledge_base_id = rc.knowledge_base_id
        WHERE ${clauses}`,
      params,
    );
    const allowed = new Set((rows || []).map((row) => `${row.document_id}\u0000${row.knowledge_base_id}`));
    return results.filter((result) => {
      const documentId = String(result.metadata?.documentId || '');
      const knowledgeBaseId = String(result.metadata?.knowledgeBaseId || '');
      return allowed.has(`${documentId}\u0000${knowledgeBaseId}`);
    });
  }

  /**
   * @deprecated Use searchByQuery (RRF hybrid) instead.
   */
  async hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    options: HybridSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const kbFilter = options.filter?.knowledgeBaseId;
    const knowledgeBaseIds = Array.isArray(kbFilter)
      ? kbFilter
      : kbFilter
        ? [kbFilter]
        : undefined;
    return this.searchByQuery(queryText, queryEmbedding, {
      knowledgeBaseIds,
      topK: options.topK ?? 10,
      threshold: options.threshold,
    });
  }

  /**
   * 添加向量到索引
   */
  async addVectors(
    vectors: Array<{
      id: string;
      embedding: number[];
      content: string;
      metadata: Record<string, any>;
    }>
  ): Promise<void> {
    await this.ensureInitialized();
    await this.currentStrategy!.addVectors(vectors);
  }

  /**
   * 删除向量
   */
  async removeVectors(ids: string[]): Promise<void> {
    await this.ensureInitialized();
    await this.currentStrategy!.removeVectors(ids);
  }

  /**
   * 获取索引统计信息
   */
  async getStats(): Promise<{
    totalVectors: number;
    dimension: number;
    indexSize: number;
  }> {
    await this.ensureInitialized();
    return await this.currentStrategy!.getStats();
  }

  /**
   * 清空索引
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.currentStrategy!.clear();
  }

  /**
   * 切换向量存储策略
   */
  async switchStrategy(config: Partial<VectorStoreCreationOptions>): Promise<void> {
    this.strategyConfig = { ...this.strategyConfig, ...config };
    this.currentStrategy = await VectorStoreFactory.create(this.strategyConfig);
    console.log(`向量存储策略已切换到: ${this.strategyConfig.type}`);
  }

  /**
   * 获取当前策略配置
   */
  getCurrentConfig(): VectorStoreCreationOptions {
    return { ...this.strategyConfig };
  }

  /**
   * 获取推荐配置
   */
  static getRecommendedConfig(
    vectorCount: number,
    dimension: number,
    useCase: 'chat' | 'search' | 'analytics' = 'search'
  ): VectorStoreCreationOptions {
    return VectorStoreFactory.getRecommendedConfig(vectorCount, dimension, useCase);
  }

  /**
   * 计算查询向量与候选向量的相似度
   */
  calculateSimilarity(
    queryVector: number[],
    candidateVector: number[],
    metric: string = 'cosine'
  ): number {
    return SimilarityCalculator.calculate(queryVector, candidateVector, metric);
  }

  /**
   * 批量计算相似度
   */
  batchCalculateSimilarity(
    queryVector: number[],
    candidateVectors: number[][],
    metric: string = 'cosine'
  ): number[] {
    return candidateVectors.map(candidate =>
      this.calculateSimilarity(queryVector, candidate, metric)
    );
  }

  /**
   * 查找最相似的K个向量
   */
  findTopKSimilar(
    queryVector: number[],
    candidateVectors: Array<{ id: string; vector: number[]; metadata?: any }>,
    k: number = 10,
    metric: string = 'cosine',
    threshold?: number
  ): Array<{ id: string; score: number; metadata?: any }> {
    const results = candidateVectors.map(candidate => ({
      id: candidate.id,
      score: this.calculateSimilarity(queryVector, candidate.vector, metric),
      metadata: candidate.metadata,
    }));

    // 过滤阈值
    const filteredResults = threshold !== undefined
      ? results.filter(result => result.score >= threshold)
      : results;

    // 排序并返回前K个
    const isDistanceMetric = ['euclidean', 'manhattan'].includes(metric);
    filteredResults.sort((a, b) =>
      isDistanceMetric ? a.score - b.score : b.score - a.score
    );

    return filteredResults.slice(0, k);
  }

  /**
   * 验证向量维度
   */
  async validateVectorDimension(vectors: number[][]): Promise<{
    isValid: boolean;
    dimension?: number;
    error?: string;
  }> {
    if (vectors.length === 0) {
      return { isValid: false, error: '向量数组为空' };
    }

    const firstDimension = vectors[0].length;
    for (let i = 1; i < vectors.length; i++) {
      if (vectors[i].length !== firstDimension) {
        return {
          isValid: false,
          error: `向量维度不一致: 期望 ${firstDimension}, 实际 ${vectors[i].length} (索引 ${i})`
        };
      }
    }

    return { isValid: true, dimension: firstDimension };
  }

  /**
   * 搜索相似文档
   */
  async searchSimilarDocuments(
    documentId: string,
    options: SearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    await this.ensureInitialized();

    // 首先获取文档的向量
    const results = await this.search([], {
      filter: { id: documentId },
      topK: 1,
      includeEmbeddings: true
    });

    if (results.length === 0 || !results[0].embedding) {
      throw new RetrievalError(`文档 ${documentId} 未找到或缺少向量数据`);
    }

    // 使用文档向量搜索相似文档
    return await this.search(results[0].embedding, {
      ...options,
      filter: { ...options.filter, id: { $ne: documentId } } // 排除自身
    });
  }

  /**
   * 获取向量存储性能度量
   */
  async getMetrics(): Promise<any> {
    await this.ensureInitialized();

    // 如果当前策略是 AbstractVectorStore 的实例，获取详细度量
    if (this.currentStrategy && 'getMetrics' in this.currentStrategy) {
      return (this.currentStrategy as any).getMetrics();
    }

    return null;
  }

  /**
   * 运行基准测试
   */
  async benchmark(
    testVectorCount: number = 1000,
    dimension: number = 384
  ): Promise<any> {
    await this.ensureInitialized();

    if (this.currentStrategy && 'benchmark' in this.currentStrategy) {
      return await (this.currentStrategy as any).benchmark(testVectorCount, dimension);
    }

    throw new RetrievalError('当前向量存储策略不支持基准测试');
  }

  /**
   * 优化向量存储性能
   */
  async optimize(): Promise<void> {
    await this.ensureInitialized();

    if (this.currentStrategy && 'compactMemory' in this.currentStrategy) {
      await (this.currentStrategy as any).compactMemory();
    }
  }
}
