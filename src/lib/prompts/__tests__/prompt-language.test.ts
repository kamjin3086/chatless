import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgentContractBlock } from '@/lib/mcp/prompt/agentContract';
import { MCPPrompts, RAGPrompts, DocumentPrompts, ConversationPrompts } from '@/lib/prompts/SystemPrompts';
import { DEFAULT_RAG_TEMPLATES } from '@/lib/rag/PromptTemplate';
import { buildTimeContextMessage, buildSimpleTimeContext } from '@/lib/prompts/TimeContext';
import { getShellGuidance, type RuntimePlatform } from '@/lib/utils/runtimePlatform';
import { MCP_FILESYSTEM_TOOLS } from '@/lib/mcp/nativeTools/mcpFilesystem';
import { SHELL_EXECUTOR_TOOLS } from '@/lib/mcp/nativeTools/shellExecutor';
import { WEB_SEARCH_TOOLS } from '@/lib/mcp/nativeTools/webSearch';
import { KNOWLEDGE_TOOLS } from '@/lib/mcp/nativeTools/knowledge';
import { SKILL_UNIFIED_TOOLS } from '@/lib/mcp/nativeTools/skillUnifiedTools';
import { SYSTEM_PROMPT_TOOLS } from '@/lib/mcp/nativeTools/systemPrompts';
import { userFsTools } from '@/lib/userFs/userFsTools';

/**
 * Prompts are English-only on purpose: English instructions behaved noticeably
 * more consistently across providers and models. The answer language is a
 * separate instruction ("answer in the language the user wrote in"), so this
 * guard says nothing about what the user reads.
 *
 * See docs/prompt-language.md. UI strings, user-facing errors, log lines and
 * intent-detection keyword lists are deliberately not covered.
 */
const CJK = /[\u4e00-\u9fff]/;

/** Loaded at runtime into tool descriptions, so they are prompts too. */
const LOADED_TOOL_DOCS = ['fs.txt', 'shell_run.txt', 'web.txt', 'tools.txt', 'skills.txt', 'web_search.txt'];

function findCjk(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (CJK.test(value)) out.push(`${path}: ${value.slice(0, 80)}`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findCjk(entry, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) findCjk(entry, `${path}.${key}`, out);
  }
  return out;
}

function expectAllEnglish(label: string, value: unknown) {
  expect(findCjk(value), label).toEqual([]);
}

describe('prompt language', () => {
  it('keeps the agent contract English', () => {
    expectAllEnglish('agent contract', buildAgentContractBlock().content);
  });

  it('keeps the built-in prompt templates English', () => {
    expectAllEnglish('MCPPrompts', MCPPrompts);
    expectAllEnglish('RAGPrompts', RAGPrompts);
    expectAllEnglish('DocumentPrompts', DocumentPrompts);
    expectAllEnglish('ConversationPrompts', ConversationPrompts);
    expectAllEnglish('DEFAULT_RAG_TEMPLATES', DEFAULT_RAG_TEMPLATES);
  });

  it('keeps time and platform context English', () => {
    expectAllEnglish('time context', [buildTimeContextMessage(false), buildTimeContextMessage(true), buildSimpleTimeContext()]);

    const platforms: RuntimePlatform[] = ['windows', 'macos', 'linux', 'unknown'];
    for (const platform of platforms) {
      expectAllEnglish(`shell guidance (${platform})`, getShellGuidance(platform));
    }
  });

  it('keeps every native tool description English', () => {
    const tools = [
      ...MCP_FILESYSTEM_TOOLS,
      ...SHELL_EXECUTOR_TOOLS,
      ...WEB_SEARCH_TOOLS,
      ...KNOWLEDGE_TOOLS,
      ...SKILL_UNIFIED_TOOLS,
      ...SYSTEM_PROMPT_TOOLS,
    ];
    for (const tool of tools) {
      expectAllEnglish(`tool ${tool.name}.description`, tool.description);
      expectAllEnglish(`tool ${tool.name}.parameters`, tool.input_schema?.schema);
    }

    for (const tool of userFsTools) {
      expectAllEnglish(`tool ${tool.name}.description`, tool.description);
      expectAllEnglish(`tool ${tool.name}.parameters`, tool.parameters);
    }
  });

  it('keeps the tool documentation that is appended to descriptions English', () => {
    expect(LOADED_TOOL_DOCS.length).toBeGreaterThan(0);
    for (const name of LOADED_TOOL_DOCS) {
      const text = readFileSync(join(process.cwd(), 'public', 'tool-docs', name), 'utf8');
      expectAllEnglish(name, text);
    }

    // Nothing else belongs under tool-docs: a new document must be a deliberate
    // decision about whether it is loaded (and therefore English) or unused.
    const entries = readdirSync(join(process.cwd(), 'public', 'tool-docs'));
    expect(entries.sort()).toEqual([...LOADED_TOOL_DOCS].sort());
  });
});
