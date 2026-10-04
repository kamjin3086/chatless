import { RetrievedChunk, ContextConfig } from './types';

/**
 * 上下文构建器
 * 负责将检索到的知识片段组装成适合LLM的上下文
 */
export class ContextBuilder {
  private config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * 构建查询上下文
   */
  buildContext(chunks: RetrievedChunk[], query: string): {
    context: string;
    usedChunks: RetrievedChunk[];
    truncated: boolean;
  } {
    if (chunks.length === 0) {
      return {
        context: '',
        usedChunks: [],
        truncated: false
      };
    }

    // 去重：按 chunk id 或 content_hash（在metadata中）去重
    const seen = new Set<string>();
    const deduped: RetrievedChunk[] = [];
    for (const c of chunks) {
      const key = (c.id || '') + '|' + (c.metadata?.content_hash || c.metadata?.contentHash || '');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }

    // 按照配置排序
    const sortedChunks = this.sortChunks(deduped);
    
    // 构建上下文字符串
    const { context, usedChunks, truncated } = this.assembleContext(sortedChunks, query);

    return {
      context,
      usedChunks,
      truncated
    };
  }

  /**
   * 排序知识片段
   */
  private sortChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    if (this.config.sortByRelevance) {
      // 按相似度分数降序排列
      return chunks.sort((a, b) => b.score - a.score);
    } else {
      // 按知识库和文档顺序排列
      return chunks.sort((a, b) => {
        if (a.knowledgeBaseId !== b.knowledgeBaseId) {
          return a.knowledgeBaseId.localeCompare(b.knowledgeBaseId);
        }
        if (a.documentId !== b.documentId) {
          return (a.documentId || '').localeCompare(b.documentId || '');
        }
        return a.chunkIndex - b.chunkIndex;
      });
    }
  }

  /**
   * 组装上下文字符串
   */
  private assembleContext(chunks: RetrievedChunk[], query: string): {
    context: string;
    usedChunks: RetrievedChunk[];
    truncated: boolean;
  } {
    const contextParts: string[] = [];
    const usedChunks: RetrievedChunk[] = [];
    let currentLength = 0;
    let truncated = false;

    // 为查询本身预留一些空间
    const queryLength = query.length + 100; // 包括提示词的额外空间
    const availableLength = this.config.maxContextLength - queryLength;

    for (const chunk of chunks) {
      const chunkText = this.formatChunk(chunk);
      const chunkLength = chunkText.length + this.config.chunkSeparator.length;

      // 检查是否超出长度限制
      if (currentLength + chunkLength > availableLength) {
        // 尝试部分截取当前chunk
        const remainingLength = availableLength - currentLength - this.config.chunkSeparator.length;
        if (remainingLength > 100) { // 至少保留100个字符才有意义
          const truncatedChunk = {
            ...chunk,
            content: chunk.content.substring(0, remainingLength - 3) + '...'
          };
          contextParts.push(this.formatChunk(truncatedChunk));
          usedChunks.push(truncatedChunk);
        }
        truncated = true;
        break;
      }

      contextParts.push(chunkText);
      usedChunks.push(chunk);
      currentLength += chunkLength;
    }

    const context = contextParts.join(this.config.chunkSeparator);
    return { context, usedChunks, truncated };
  }

  /**
   * 格式化单个知识片段
   */
  private formatChunk(chunk: RetrievedChunk): string {
    let formattedChunk = chunk.content;

    if (this.config.includeSource) {
      const sourceInfo = this.buildSourceInfo(chunk);
      formattedChunk = `${sourceInfo}\n${chunk.content}`;
    }

    return formattedChunk;
  }

  /**
   * 构建来源信息
   */
  private buildSourceInfo(chunk: RetrievedChunk): string {
    const sourceParts: string[] = [];

    // 知识库信息
    sourceParts.push(`Knowledge base: ${chunk.knowledgeBaseName}`);

    // 文档信息
    if (chunk.documentName) {
      sourceParts.push(`Document: ${chunk.documentName}`);
    }

    // 片段位置
    sourceParts.push(`Chunk: #${chunk.chunkIndex + 1}`);

    // 相似度分数
    sourceParts.push(`Relevance: ${(chunk.score * 100).toFixed(1)}%`);

    return `[${sourceParts.join(' | ')}]`;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ContextConfig {
    return { ...this.config };
  }

  /**
   * 验证上下文长度
   */
  validateContextLength(text: string): {
    isValid: boolean;
    length: number;
    maxLength: number;
  } {
    return {
      isValid: text.length <= this.config.maxContextLength,
      length: text.length,
      maxLength: this.config.maxContextLength
    };
  }

  /**
   * 估算token数量（粗略估算，1个中文字符≈1.5个token）
   */
  estimateTokens(text: string): number {
    // 简单的token估算
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const otherChars = text.length - chineseChars - englishWords;

    return Math.ceil(chineseChars * 1.5 + englishWords * 1.2 + otherChars * 0.5);
  }

  /**
   * 根据token限制调整上下文
   */
  buildContextWithTokenLimit(
    chunks: RetrievedChunk[], 
    query: string, 
    maxTokens: number
  ): {
    context: string;
    usedChunks: RetrievedChunk[];
    truncated: boolean;
    estimatedTokens: number;
  } {
    const sortedChunks = this.sortChunks(chunks);
    const contextParts: string[] = [];
    const usedChunks: RetrievedChunk[] = [];
    let estimatedTokens = this.estimateTokens(query);
    let truncated = false;

    for (const chunk of sortedChunks) {
      const chunkText = this.formatChunk(chunk);
      const chunkTokens = this.estimateTokens(chunkText + this.config.chunkSeparator);

      if (estimatedTokens + chunkTokens > maxTokens) {
        // 尝试部分截取
        const remainingTokens = maxTokens - estimatedTokens;
        if (remainingTokens > 50) { // 至少50个token才有意义
          const approximateChars = Math.floor(remainingTokens / 1.5);
          const truncatedChunk = {
            ...chunk,
            content: chunk.content.substring(0, approximateChars - 3) + '...'
          };
          contextParts.push(this.formatChunk(truncatedChunk));
          usedChunks.push(truncatedChunk);
          estimatedTokens += this.estimateTokens(this.formatChunk(truncatedChunk));
        }
        truncated = true;
        break;
      }

      contextParts.push(chunkText);
      usedChunks.push(chunk);
      estimatedTokens += chunkTokens;
    }

    const context = contextParts.join(this.config.chunkSeparator);
    return {
      context,
      usedChunks,
      truncated,
      estimatedTokens
    };
  }
} 