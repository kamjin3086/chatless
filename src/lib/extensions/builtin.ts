/**
 * The single static manifest of builtin extensions (§5.3).
 *
 * This is the ONLY place that names concrete extensions; the core runtime must
 * never import this module directly (enforced by boundaries.test.ts). The
 * assembly entry (`assembly.ts`) passes these contributions - with their
 * injected dependencies - into `buildExtensionRegistry`.
 *
 * PR B: knowledge is the first entry, taking over its hand-written group
 * (plan §10 phase 2).
 */
import { createKnowledgeExtension } from './knowledge/contribution';
import type { ExtensionAssemblyDeps } from './knowledge/contribution';
import type { BuiltinExtension } from './contracts';

export type { ExtensionAssemblyDeps };

export function assembleBuiltinExtensions(
  deps: ExtensionAssemblyDeps,
): BuiltinExtension[] {
  return [createKnowledgeExtension(deps.knowledge)];
}
