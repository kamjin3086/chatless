/**
 * The text protocol for the prompt track (#163, spec #161).
 *
 * Endpoints without native tools used to get nothing: the request had no `tools`, the prompt had
 * no protocol, and the model still read a capability list naming `knowledge__*`. The block below
 * is the other half of that decision - one protocol, the shape the parser already reads, in
 * English like every model-facing prompt.
 */
import { describe, expect, it } from 'vitest';
import { buildToolChannelBlock } from '../promptBuilder';

describe('the prompt-track tool protocol', () => {
  it('names the servers the run can actually call', () => {
    const block = buildToolChannelBlock(['knowledge', 'filesystem']);
    expect(block).toContain('knowledge');
    expect(block).toContain('filesystem');
  });

  it('teaches the one shape the parser reads', () => {
    const block = buildToolChannelBlock(['knowledge']);
    // The parser's XML handler reads exactly this; a different example would be quoted as text.
    expect(block).toContain('<use_mcp_tool>');
    expect(block).toContain('<server_name>');
    expect(block).toContain('<tool_name>');
    expect(block).toContain('<arguments>');
    // One call per turn keeps the stream rewrite unambiguous.
    expect(block.toLowerCase()).toContain('one tool per turn');
  });

  it('is empty when there is nothing to call', () => {
    expect(buildToolChannelBlock([])).toBe('');
  });
});
