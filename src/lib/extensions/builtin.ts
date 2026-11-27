/**
 * The single static manifest of builtin extensions (§5.3).
 *
 * This is the ONLY place that names concrete extensions; the core runtime must
 * never import this module directly (enforced by boundaries.test.ts). The
 * assembly entry (`assembly.ts`) passes these contributions - with their
 * injected dependencies - into `buildExtensionRegistry`.
 *
 * PR B: knowledge is the first entry, taking over its hand-written group
 * (plan §10 phase 2). PR F: prompt management is the second, taking over the
 * `prompt` group on the `system` server - the read/write/approval-path pilot.
 */
import { createKnowledgeExtension } from './knowledge/contribution';
import type { ExtensionAssemblyDeps } from './knowledge/contribution';
import { createPromptManagementExtension } from './prompts/contribution';
import type { BuiltinExtension } from './contracts';

export type { ExtensionAssemblyDeps };

export function assembleBuiltinExtensions(
  deps: ExtensionAssemblyDeps,
): BuiltinExtension[] {
  return [
    // Manifest order is catalog order: the retired TOOL_GROUPS placed the
    // prompt entry before knowledge, so the manifest keeps that sequence and
    // search pagination looks like it always did.
    createPromptManagementExtension(),
    createKnowledgeExtension(deps.knowledge),
  ];
}
