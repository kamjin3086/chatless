/**
 * The single static manifest of builtin extensions (§5.3).
 *
 * This is the ONLY place that names concrete extensions, and the only file
 * allowed to import `extensions/<feature>/contribution`. The core runtime must
 * never import this module (enforced by boundaries.test.ts); an application
 * bootstrap entry passes `builtinExtensions` into `buildExtensionRegistry`.
 *
 * PR A ships an empty manifest on purpose: migrating knowledge (PR B) is the
 * first real entry, so the mechanism earns a user before it earns lines.
 */
import type { BuiltinExtension } from './contracts';

export const builtinExtensions: readonly BuiltinExtension[] = [];
