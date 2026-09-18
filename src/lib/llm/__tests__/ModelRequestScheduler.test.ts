import { describe, expect, it } from 'vitest';
import { ModelRequestScheduler } from '../ModelRequestScheduler';

describe('ModelRequestScheduler', () => {
  it('does not let a later request overlap when a queued waiter is cancelled', async () => {
    const scheduler = new ModelRequestScheduler();
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    let running = 0;
    let peak = 0;
    const first = scheduler.schedule('endpoint', {}, async () => { running += 1; peak = Math.max(peak, running); await active; running -= 1; });
    const controller = new AbortController();
    const second = scheduler.schedule('endpoint', { signal: controller.signal }, async () => { throw new Error('must not run'); });
    controller.abort();
    let thirdStarted = false;
    const third = scheduler.schedule('endpoint', {}, async () => { thirdStarted = true; running += 1; peak = Math.max(peak, running); running -= 1; });
    await Promise.resolve();
    expect(thirdStarted).toBe(false);
    release();
    await Promise.all([first, second, third]);
    expect(peak).toBe(1);
  });

  it('runs high priority work before queued low priority work', async () => {
    const scheduler = new ModelRequestScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const first = scheduler.schedule('endpoint', {}, async () => { await gate; order.push('active'); });
    const low = scheduler.schedule('endpoint', { priority: 'low' }, async () => { order.push('low'); });
    const high = scheduler.schedule('endpoint', { priority: 'high' }, async () => { order.push('high'); });
    release();
    await Promise.all([first, low, high]);
    expect(order).toEqual(['active', 'high', 'low']);
  });
});
