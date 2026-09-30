type QueueItem<T> = {
  priority: number; sequence: number; signal?: AbortSignal; work: () => Promise<T>;
  resolve: (value: T | undefined) => void; reject: (error: unknown) => void;
  abort?: () => void;
};

type EndpointQueue = { active: boolean; pending: QueueItem<unknown>[] };

/** One inference lease per real endpoint. Cancellation of a waiter removes
 * only that waiter and can never release the active request's lease. */
export class ModelRequestScheduler {
  private queues = new Map<string, EndpointQueue>();
  private sequence = 0;

  schedule<T>(endpoint: string, options: { signal?: AbortSignal; priority?: 'high' | 'normal' | 'low' }, work: () => Promise<T>): Promise<T | undefined> {
    const key = endpoint.trim().replace(/\/$/, '') || endpoint;
    const queue = this.queues.get(key) || { active: false, pending: [] };
    this.queues.set(key, queue);
    const priorities = { high: 0, normal: 1, low: 2 } as const;
    return new Promise<T | undefined>((resolve, reject) => {
      const item: QueueItem<T> = { priority: priorities[options.priority || 'normal'], sequence: this.sequence++,
        signal: options.signal, work, resolve, reject };
      if (options.signal?.aborted) { resolve(undefined); return; }
      queue.pending.push(item as QueueItem<unknown>);
      queue.pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
      const abort = () => {
        const index = queue.pending.indexOf(item as QueueItem<unknown>);
        if (index >= 0) { queue.pending.splice(index, 1); resolve(undefined); }
      };
      item.abort = abort;
      options.signal?.addEventListener('abort', abort, { once: true });
      void this.drain(key, queue);
    });
  }

  private async drain(key: string, queue: EndpointQueue): Promise<void> {
    if (queue.active) return;
    queue.active = true;
    try {
      while (queue.pending.length) {
        const item = queue.pending.shift()!;
        if (item.abort) item.signal?.removeEventListener('abort', item.abort);
        if (item.signal?.aborted) { item.resolve(undefined); continue; }
        try { item.resolve(await item.work()); } catch (error) { item.reject(error); }
      }
    } finally {
      queue.active = false;
      if (!queue.pending.length && this.queues.get(key) === queue) this.queues.delete(key);
    }
  }
}

export const modelRequestScheduler = new ModelRequestScheduler();
