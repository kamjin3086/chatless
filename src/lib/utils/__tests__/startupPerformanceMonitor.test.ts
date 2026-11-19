import { afterEach, expect, it, vi } from 'vitest';
import {
  afterStartupPaint,
  startupMonitor,
} from '../startupPerformanceMonitor';

afterEach(() => {
  startupMonitor.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the first chat readiness milestones separate from concurrent and unfinished background work', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(50);
  vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
    {
      name: 'first-contentful-paint',
      entryType: 'paint',
      startTime: 40,
      duration: 0,
      toJSON: () => ({}),
    },
  ]);
  startupMonitor.startPhase('Database');
  clock.mockReturnValue(60);
  startupMonitor.startPhase('MCP', { background: true });
  clock.mockReturnValue(120);
  startupMonitor.endPhase('Database');
  startupMonitor.markChatReady('historyVisible');
  clock.mockReturnValue(150);
  startupMonitor.markChatReady('composerEditable');
  clock.mockReturnValue(400);
  startupMonitor.markChatReady('historyVisible');

  const report = startupMonitor.generateReport();
  expect(report.firstContentfulPaint).toBe(40);
  expect(report.readiness).toEqual({
    historyVisible: 120,
    composerEditable: 150,
  });
  expect(report.phases).toMatchObject([{ name: 'Database', duration: 70 }]);
  expect(report.backgroundPhases).toMatchObject([{ name: 'MCP' }]);
  expect(report.backgroundPhases[0]?.duration).toBeUndefined();
});

it('waits for a presentation frame and can cancel a stale milestone', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) =>
    frames.delete(frame),
  );
  const advanceFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };
  const observed = vi.fn();
  const cancel = afterStartupPaint(observed);
  advanceFrame();
  expect(observed).not.toHaveBeenCalled();
  cancel();
  advanceFrame();
  expect(observed).not.toHaveBeenCalled();
  afterStartupPaint(observed);
  advanceFrame();
  advanceFrame();
  expect(observed).toHaveBeenCalledOnce();
});
