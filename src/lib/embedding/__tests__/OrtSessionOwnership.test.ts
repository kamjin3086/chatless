import { beforeEach, expect, it, vi } from 'vitest';
import { OrtEmbeddingStrategy } from '../strategies/OrtEmbeddingStrategy';
import { EmbeddingInputError } from '../types';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => {
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'get_onnx_view_generation') return 7;
    if (command === 'init_onnx_session')
      return { modelHash: 'weights', tokenizerHash: 'tokens' };
    if (command === 'tokenize_batch')
      return { input_ids: [[1]], attention_mask: [[1]], token_type_ids: [[0]] };
    if (command === 'generate_embedding') return [[1, 2, 3]];
  });
});
it('isolates model handles and releases only the caller-owned session', async () => {
  const first = new OrtEmbeddingStrategy({
    modelPath: 'a',
    tokenizerPath: 'tokens',
  });
  const second = new OrtEmbeddingStrategy({
    modelPath: 'a',
    tokenizerPath: 'tokens',
  });
  await first.initialize();
  await second.initialize();
  const handles = invoke.mock.calls
    .filter(([name]) => name === 'init_onnx_session')
    .map(([, args]) => args.sessionId);
  expect(handles[0]).not.toBe(handles[1]);
  expect(
    invoke.mock.calls
      .filter(([name]) => name === 'init_onnx_session')
      .every(([, args]) => args.expectedGeneration === 7),
  ).toBe(true);
  await first.cleanup();
  expect(invoke).toHaveBeenCalledWith('release_onnx_session', {
    sessionId: handles[0],
  });
  await second.generateEmbeddings(['still alive']);
  expect(
    invoke.mock.calls
      .filter(([name]) => name === 'generate_embedding')
      .at(-1)?.[1].sessionId,
  ).toBe(handles[1]);
  expect(second.getDimension()).toBe(3);
  expect(second.getModelIdentity()).toBe('weights:tokens');
});
it('binds initialization to its originating page generation and cleans up a superseded load', async () => {
  const strategy = new OrtEmbeddingStrategy({
    modelPath: 'a',
    tokenizerPath: 'tokens',
  });
  invoke
    .mockResolvedValueOnce(7)
    .mockRejectedValueOnce('ONNX loading was superseded by navigation');
  await expect(strategy.initialize()).rejects.toContain('superseded');
  expect(
    invoke.mock.calls.filter(([name]) => name === 'generate_embedding'),
  ).toHaveLength(0);
  expect(
    invoke.mock.calls.filter(([name]) => name === 'release_onnx_session'),
  ).toHaveLength(1);
});

it('classifies an overlong input without declaring the model broken', async () => {
  const strategy = new OrtEmbeddingStrategy({
    modelPath: 'a',
    tokenizerPath: 'tokens',
  });
  await strategy.initialize();
  invoke.mockRejectedValueOnce('EMBEDDING_INPUT_TOO_LONG: limit 256');
  await expect(
    strategy.generateEmbeddings(['too long']),
  ).rejects.toBeInstanceOf(EmbeddingInputError);
  expect(
    invoke.mock.calls.filter(([name]) => name === 'release_onnx_session'),
  ).toHaveLength(0);
  await expect(strategy.generateEmbeddings(['short'])).resolves.toEqual([
    [1, 2, 3],
  ]);
});
