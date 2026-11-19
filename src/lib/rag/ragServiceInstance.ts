import { RAGService, createDefaultRAGConfig } from './RAGService';
import { getKnowledgeBaseConfigManager, loadKnowledgeBaseConfig, type KnowledgeBaseConfig } from '@/lib/knowledgeBaseConfig';
import type { EmbeddingConfig } from '@/lib/embedding/types';

type Runtime = { service: RAGService; version: number; users: number; retired: boolean; disposed: boolean };
let current: Runtime | null = null;
let desiredKey = '';
let version = 0;
let subscribed = false;
const pending = new Map<number, Promise<Runtime>>();

function embeddingConfig(config: KnowledgeBaseConfig['embedding']): EmbeddingConfig {
  return {
    strategy: config.strategy, modelName: config.modelName, modelPath: config.modelPath,
    tokenizerPath: config.tokenizerPath, apiUrl: config.apiUrl,
    maxBatchSize: config.maxBatchSize ?? config.batchSize, timeout: config.timeout,
    maxLength: config.maxLength,
  };
}

function select(config: EmbeddingConfig) {
  const key = JSON.stringify(config);
  if (desiredKey !== key) { desiredKey = key; version++; }
}

async function collect(runtime: Runtime) {
  if (!runtime.retired || runtime.users || runtime.disposed) return;
  runtime.disposed = true;
  await runtime.service.cleanup().catch((error) => console.warn('[RAG runtime] Cleanup failed:', error));
}

async function wakeWaiting(service: RAGService) {
  const { DatabaseService } = await import('@/lib/database/services/DatabaseService');
  if (!DatabaseService.getInstance().isInitialized()) return;
  const { semanticIndexQueue } = await import('@/lib/indexing/SemanticIndexQueue');
  await semanticIndexQueue.wakeWaiting(service.getEmbeddingService().getEmbeddingFingerprint() || undefined);
}

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  getKnowledgeBaseConfigManager().addListener((config) => {
    const next = embeddingConfig(config.embedding);
    const changed = JSON.stringify(next) !== desiredKey;
    if (!changed && current?.service.getEmbeddingService().isUsableForRag()) return;
    select(next);
    if (!changed) version++; // Installing the same previously unavailable model must be retryable.
    void ensureRuntime().catch((error) => console.warn('[RAG runtime] Model reload failed:', error));
  });
}

async function ensureRuntime(): Promise<Runtime> {
  subscribe();
  const observedVersion = version;
  const saved = await loadKnowledgeBaseConfig();
  const embedding = embeddingConfig(saved.embedding);
  if (version !== observedVersion && JSON.stringify(embedding) !== desiredKey) return ensureRuntime();
  select(embedding);
  const requestedVersion = version;
  if (current?.version === requestedVersion) return current;
  const inProgress = pending.get(requestedVersion);
  if (inProgress) return inProgress;
  const initializing = (async () => {
    const service = new RAGService({ ...createDefaultRAGConfig(), embedding });
    const runtime: Runtime = { service, version: requestedVersion, users: 0, retired: false, disposed: false };
    try {
      await service.initialize();
      if (requestedVersion !== version) {
        runtime.retired = true;
        await collect(runtime);
        return ensureRuntime();
      }
      const previous = current;
      current = runtime;
      if (previous) { previous.retired = true; await collect(previous); }
      void wakeWaiting(service).catch((error) => console.warn('[RAG runtime] Could not wake semantic jobs:', error));
      return runtime;
    } catch (error) {
      runtime.retired = true;
      await collect(runtime);
      if (requestedVersion !== version) return ensureRuntime();
      throw error;
    } finally {
      pending.delete(requestedVersion);
    }
  })();
  pending.set(requestedVersion, initializing);
  return initializing;
}

/** Status/compatibility accessor. Inference callers must hold a runtime lease. */
/** A successful status probe may discover a restored or replaced model. Do not
 * retire healthy leases for an unchanged fingerprint or an unsaved test config.
 */
export async function reconcileEmbeddingProbe(config: EmbeddingConfig, fingerprint: string | null): Promise<void> {
  if (!fingerprint) return;
  const service = await getRAGService();
  const saved = (await loadKnowledgeBaseConfig()).embedding;
  const fields = ['strategy', 'modelName', 'modelPath', 'tokenizerPath', 'apiUrl', 'maxLength'] as const;
  if (fields.some((field) => saved[field] !== config[field])) return;
  if (service.getEmbeddingService().getEmbeddingFingerprint() !== fingerprint) await refreshRAGService();
}

export async function getRAGService(): Promise<RAGService> {
  return (await ensureRuntime()).service;
}

/** Recheck a model installed after a previous unavailable initialization. */
export async function refreshRAGService(): Promise<RAGService> {
  version++;
  return getRAGService();
}

/** Keep one immutable model alive for the complete operation, including writes. */
export async function withRAGService<T>(operation: (service: RAGService, isCurrent: () => boolean) => Promise<T>): Promise<T> {
  let runtime = await ensureRuntime();
  while (runtime.retired || runtime.disposed) runtime = await ensureRuntime();
  runtime.users++;
  try {
    return await operation(runtime.service, () => current === runtime && runtime.version === version);
  } finally {
    runtime.users--;
    await collect(runtime);
  }
}
