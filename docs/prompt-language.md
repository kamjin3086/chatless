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
| Tool descriptions (native schemas) | `src/lib/mcp/nativeTools/*.ts` - the `fs` tools (`read`, `write`, `ls`, `mkdir`, `rm`, `mv`, `edit`, `search`) are described in `src/lib/mcp/nativeTools/mcpFilesystem.ts`; `nativeTools/filesystem.ts` is a deprecated re-export kept only so old imports still resolve |
| Tool documentation (appended to descriptions) | `public/tool-docs/*.txt` |
| Text injected as messages | `src/lib/mcp/pipeline/context/ConversationEventLog.ts` (tool results, run notes), `src/lib/mcp/agentLoop/AgentLoopRunner.ts`, `src/lib/mcp/pipeline/context/ContextWindowManager.ts` (summaries), adapters under `src/lib/mcp/pipeline/adapters/` |
| Retrieval / evidence | `src/lib/rag/*` |
| Title generation | `src/lib/chat/TitleService.ts` (English prompt, the title itself follows the user's message) |
| Skill index | `src/lib/skills/skillIndex.ts` (`buildSkillIndex`, `skillIndexBlocks`) |

## What stays in the interface language

- any UI string under `src/i18n/`, components and toasts
- user-facing errors and their diagnostics (for example the RAG fallbacks, the
  `PromptTemplate` validation errors, the sandbox blocking reasons)
- `console.*`/log messages
- intent-detection keyword lists (`TimeContext.isTimeRelatedQuery` matches
  Chinese and English keywords on purpose - that is matching, not prompting)

## Notes

- Section delimiters are plain ASCII brackets, for example `[Tool result]` or
  `[How you work]`. CJK brackets (`【...】`) used to carry those labels; they
  were replaced so the whole prompt is one consistent ASCII surface.
- Text that the user pastes into a conversation is never rewritten - only
  prompts written by the app follow this policy.
- Chat-template control tokens (`<|im_end|>` and friends) are handled separately
  in `src/lib/llm/chatTemplateTokens.ts` - see `docs/llm-troubleshooting.md`.
- Known prompt assets that are **not referenced by any code** were deleted
  rather than translated: the `public/tool-docs/core/*.txt` and
  `followup_*.txt` documents, `src/lib/agent/agentWorkflowTools.ts`,
  `src/lib/mcp/nativeTools/systemSkills.ts`, `src/lib/mcp/providerAdapters.ts`,
  `src/lib/mcp/schemaHints.ts`, the `SkillsToolAdapter`/`SkillsFsAdapter` files
  and `src/lib/skills/skillFileTools.ts`.
- The parallel skill execution engine went with it: `src/lib/skills/skillTools.ts`,
  `SkillExecutor.ts`, `SkillOrchestrator.ts`, `ActionRouter.ts`, their UI
  (`SkillExecutionPlanPanel`, `SkillApprovalPanel`, `SkillActionCard`,
  `SkillInvocationCard`, `SkillParameterForm`, `ExecutionConfirmDialog`) and their
  stores. Nothing outside those files could reach them - `executeSkillTool` had no
  production caller - and the live path is `skill__*` plus the Agent Loop (#237). To reproduce: `grep -rn "executeSkillTool" src` is empty, and `grep -rn "list_available_skills" src` prints only the display table, tests and history comments.
