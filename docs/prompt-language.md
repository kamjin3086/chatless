# Prompt language

**Every prompt that goes to a model is written in English.** Instructions in
English behaved noticeably more consistently across providers and models -
including for Chinese users - so the prompt layer is English-only, regardless of
the interface language.

**The answer language is a separate matter.** The agent contract says "Answer in
the language the user wrote in", so a Chinese user still gets Chinese answers.
Translating a prompt never changes what the user reads.

## What counts as a prompt (English required)

| Where | Files |
|-------|-------|
| System prompt blocks | `src/lib/mcp/injection/promptBuilder.ts`, `src/lib/mcp/prompt/agentContract.ts`, `src/lib/mcp/injection/InjectionManager.ts` |
| Time / platform context | `src/lib/prompts/TimeContext.ts`, `src/lib/utils/runtimePlatform.ts` |
| Built-in templates | `src/lib/prompts/SystemPrompts.ts`, `src/lib/rag/PromptTemplate.ts` |
| Tool descriptions (native schemas) | `src/lib/mcp/nativeTools/*.ts`, `src/lib/userFs/userFsTools.ts` |
| Tool documentation (appended to descriptions) | `public/tool-docs/*.txt` |
| Text injected as messages | `src/lib/mcp/pipeline/context/ConversationEventLog.ts` (tool results, run notes), `src/lib/mcp/agentLoop/AgentLoopRunner.ts`, `src/lib/mcp/pipeline/context/ContextWindowManager.ts` (summaries), adapters under `src/lib/mcp/pipeline/adapters/` |
| Retrieval / evidence | `src/lib/rag/*` |
| Title generation | `src/lib/chat/TitleService.ts` (English prompt, the title itself follows the user's message) |
| Skill index | `src/lib/skills/SkillManager.ts` (`buildSkillIndexPrompt`) |

## What stays in the interface language

- any UI string under `src/i18n/`, components and toasts
- user-facing errors and their diagnostics (for example the RAG fallbacks, the
  `PromptTemplate` validation errors, the sandbox blocking reasons)
- `console.*`/log messages
- intent-detection keyword lists (`TimeContext.isTimeRelatedQuery` matches
  Chinese and English keywords on purpose - that is matching, not prompting)

## Notes

- Section delimiters keep the `【...】` style that the prompt layer already used
  for its English contract; they are punctuation, not prose.
- Chat-template control tokens (`<|im_end|>` and friends) are handled separately
  in `src/lib/llm/chatTemplateTokens.ts` - see `docs/llm-troubleshooting.md`.
- Known prompt assets that are **not referenced by any code** and are still
  Chinese. They are either dead or reserved, so they were left alone:
  `public/tool-docs/core/*.txt`, `public/tool-docs/followup_*.txt`,
  `src/lib/agent/agentWorkflowTools.ts`,
  `src/lib/mcp/nativeTools/systemSkills.ts`,
  `src/lib/mcp/providerAdapters.ts`,
  `src/lib/skills/skillTools.ts`, `src/lib/skills/skillFileTools.ts`.
  Delete them, or translate them when they are wired up.
