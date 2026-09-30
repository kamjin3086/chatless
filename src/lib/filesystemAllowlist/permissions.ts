import type { AllowlistPermissions } from './types';

/**
 * Permissions granted when a user allows a folder for everyday work:
 * read, write and create, never delete.  Deleting stays a per-call decision so
 * "allow this folder" cannot silently destroy anything.
 */
export const EVERYDAY_DIRECTORY_PERMISSIONS: AllowlistPermissions = {
  read: true,
  write: true,
  create: true,
  delete: false,
};
