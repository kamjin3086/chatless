import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSkill = vi.fn();
const getSkillIndex = vi.fn(() => [{ id: 'pdf-forms' }, { id: 'deploy' }]);

vi.mock('@/lib/skills/SkillManager', () => ({
  getSkillManager: () => ({
    initialize: vi.fn(async () => undefined),
    getSkillsBasePath: vi.fn(async () => '/skills'),
    getSkill,
    getSkillIndex,
  }),
}));

import { listSkillResources } from '../skillFileOperations';

// This message is returned to the model, so it is prompt text: it must name a tool the
// model can actually call, and say what is installed. `skills.list_available_skills`
// had been gone for a while and the text still sent the model looking for it.
describe('a wrong skill id', () => {
  beforeEach(() => {
    getSkill.mockResolvedValue(null);
  });

  it('points at a tool that exists', async () => {
    await expect(listSkillResources('nope')).rejects.toThrow(/skill__list/);
  });

  it('lists what is installed so the model can correct itself', async () => {
    await expect(listSkillResources('nope')).rejects.toThrow(/pdf-forms/);
  });

  it('is English, like every model-facing string', async () => {
    const message = await listSkillResources('nope').catch(
      (error: Error) => error.message,
    );
    expect(message).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
