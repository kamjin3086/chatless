import { EmbeddingStrategy, EmbeddingError, ModelLoadError, EmbeddingInputError } from '../types';
import { tauriFetch } from '@/lib/request';

type Config = { apiUrl: string; modelName: string; dimension: number; timeout?: number; maxBatchSize?: number; maxLength?: number };

/** Real Ollama inference. The server must reject overlong input, never truncate it. */
export class OllamaStrategy implements EmbeddingStrategy {
  private isInitialized = false;
  private dimension: number;
  private maxLength: number;
  private digest = '';
  constructor(private readonly config: Config) {
    this.dimension = config.dimension;
    this.maxLength = config.maxLength || 512;
  }
  getName() { return 'OllamaStrategy'; }
  getDimension() { return this.dimension; }
  getMaxInputTokens() { return this.maxLength; }
  getModelIdentity() { return `${this.config.apiUrl.replace(/\/$/, '')}:${this.digest}`; }

  private async request(path: string, body?: object): Promise<any> {
    const response = await tauriFetch(`${this.config.apiUrl.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });
    const data = typeof response.json === 'function' ? await response.json() : response;
    if (response.ok === false || Number(response.status) >= 400 || data.error) {
      const message = String(data.error || `Ollama HTTP ${response.status}`);
      if (/context length|input length|too long|exceed.*context/i.test(message)) throw new EmbeddingInputError(message);
      throw new EmbeddingError(message);
    }
    return data;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.digest = await this.readDigest();
      const info = await this.request('/api/show', { model: this.config.modelName });
      const lengths = Object.entries(info.model_info || {}).filter(([key, value]) =>
        key.endsWith('.context_length') && typeof value === 'number' && value > 0).map(([, value]) => Number(value));
      if (lengths.length) this.maxLength = Math.min(this.config.maxLength || Infinity, ...lengths);
      const vectors = await this.embed(['embedding readiness']);
      this.dimension = vectors[0].length;
      await this.assertIdentity();
      this.isInitialized = true;
    } catch (error) {
      this.isInitialized = false;
      throw new ModelLoadError(`Ollama model is unavailable: ${error instanceof Error ? error.message : String(error)}`, this.config.modelName);
    }
  }

  private async readDigest(): Promise<string> {
    const tags = await this.request('/api/tags');
    const model = (tags.models || []).find((item: { name: string }) =>
      item.name === this.config.modelName || item.name === `${this.config.modelName}:latest`);
    if (typeof model?.digest !== 'string' || !model.digest.trim()) throw new EmbeddingError('Ollama model digest is unavailable');
    return model.digest;
  }

  private async assertIdentity() {
    if (await this.readDigest() !== this.digest) throw new EmbeddingError('Ollama model identity changed; reload the model');
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const data = await this.request('/api/embed', { model: this.config.modelName, input: texts, truncate: false });
    const vectors = data.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some((vector: unknown) =>
      !Array.isArray(vector) || !vector.length || vector.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new EmbeddingError('Ollama returned invalid embeddings');
    }
    return vectors;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) throw new EmbeddingError('Ollama service is not initialized');
    const result: number[][] = [];
    const batchSize = this.config.maxBatchSize || 16;
    try {
      for (let offset = 0; offset < texts.length; offset += batchSize) {
        await this.assertIdentity();
        const vectors = await this.embed(texts.slice(offset, offset + batchSize));
        if (vectors.some((vector) => vector.length !== this.dimension)) throw new EmbeddingError('Ollama embedding dimension changed; reload the model');
        await this.assertIdentity();
        result.push(...vectors);
      }
      return result;
    } catch (error) {
      if (!(error instanceof EmbeddingInputError)) this.isInitialized = false;
      throw error;
    }
  }
  async cleanup() { this.isInitialized = false; }
  isReady() { return this.isInitialized; }
  getConfig() { return { ...this.config, dimension: this.dimension, isInitialized: this.isInitialized }; }
  async testConnection() {
    try { await this.request('/api/tags'); return true; } catch { return false; }
  }
}
