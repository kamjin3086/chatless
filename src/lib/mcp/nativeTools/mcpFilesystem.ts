/**
 * MCP Filesystem tools (concept layer)
 *
 * Notes:
 * - this "filesystem" is the MCP file capability (local or remote MCP server)
 * - not for skill resources (use skills_fs)
 * - not for the user's authorized directories (use user_fs)
 *
 * Compatibility:
 * - the server name is still "filesystem" so existing MCP configs keep working
 *
 * Descriptions are English on purpose: they are part of the prompt, and English
 * instructions were the most stable across models.
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const MCP_FILESYSTEM_SERVER_NAME = 'fs';

export const MCP_FILESYSTEM_READ_FILE_TOOL: McpTool = {
  name: 'read',
  description: 'Read a file. Returns the content and the hash of the whole file; use it before editing to be sure you are looking at the current version.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path. Accepts @WorkDir/relative/path (preferred), @alias/path, or an absolute path' },
        // Legacy parameter, kept for compatibility.
        maxLines: { type: 'number', description: 'Maximum number of lines (optional, legacy; equivalent to reading maxLines lines from line 1)' },
        // Line-range reads (1-based).
        startLine: { type: 'number', description: 'First line to read (1-based, optional)' },
        endLine: { type: 'number', description: 'Last line to read (1-based, optional, >= startLine)' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_WRITE_FILE_TOOL: McpTool = {
  name: 'write',
  description: 'Write a file (overwrites). Use it to save user files, task output and documents.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path. Accepts @WorkDir/relative/path (preferred), @alias/path, or an absolute path. Example: @WorkDir/output/result.docx' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
};

export const MCP_FILESYSTEM_LIST_DIR_TOOL: McpTool = {
  name: 'ls',
  description: 'List the contents of a directory',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Accepts @WorkDir (preferred), @alias/path, or an absolute path' },
        limit: { type: 'number', description: 'Maximum entries to return (optional, default 200, max 2000)' },
        pattern: { type: 'string', description: 'Name wildcard (optional, * and ?; matches the name of entries in this directory only)' },
        kind: { type: 'string', description: 'Filter by type (optional): any | file | dir (default any)' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_CREATE_DIR_TOOL: McpTool = {
  name: 'mkdir',
  description: 'Create a directory',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Accepts @WorkDir/subdir (preferred), @alias/path, or an absolute path' },
        recursive: { type: 'boolean', description: 'Create parent directories too (optional, default true)' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_DELETE_FILE_TOOL: McpTool = {
  name: 'rm',
  description: 'Delete a file or directory',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'A single file/directory path. Accepts @WorkDir, @alias, or an absolute path' },
        paths: { type: 'array', description: 'A list of paths to delete in one call (optional). Accepts @WorkDir, @alias, or absolute paths', items: { type: 'string' } },
        dir: { type: 'string', description: 'Directory path (optional; used together with pattern). Accepts @WorkDir, @alias, or an absolute path' },
        pattern: { type: 'string', description: 'Name wildcard (optional; used together with dir, * and ?, not recursive by default)' },
        limit: { type: 'number', description: 'Maximum entries to match/delete in dir+pattern mode (optional, default 200, max 2000)' },
        kind: { type: 'string', description: 'Type filter in dir+pattern mode (optional): any | file | dir (default any)' },
        dryRun: { type: 'boolean', description: 'dir+pattern dry run: list the matches without deleting (optional, default false)' },
      },
      required: [],
    },
  },
};

export const MCP_FILESYSTEM_RENAME_FILE_TOOL: McpTool = {
  name: 'mv',
  description: 'Move or rename a file',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string', description: 'Current path. Accepts @WorkDir, @alias, or an absolute path' },
        newPath: { type: 'string', description: 'New path. Accepts @WorkDir, @alias, or an absolute path' },
      },
      required: ['oldPath', 'newPath'],
    },
  },
};

export const MCP_FILESYSTEM_EDIT_FILE_TOOL: McpTool = {
  name: 'edit',
  description: 'Exact edit: replace one passage of an existing file with new content (a unique match is required by default, so changing one line does not mean rewriting the file)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path. Accepts @WorkDir/relative/path, @alias, or an absolute path' },
        find: { type: 'string', description: 'The passage to replace (must match the file byte for byte; must be unique by default, otherwise the candidate lines are returned)' },
        replace: { type: 'string', description: 'The replacement (an empty string deletes the passage)' },
        all: { type: 'boolean', description: 'Allow replacing every match (default false: a unique match only)' },
        expectedHash: { type: 'string', description: 'Optional: the hash returned by read. If the file changed since then the edit is rejected with FILE_CHANGED' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
};

export const MCP_FILESYSTEM_SEARCH_FILES_TOOL: McpTool = {
  name: 'search',
  description:
    'Search a directory by content or file name (both by default). Skips .git/node_modules and similar, binaries and symlinks; '
    + 'returns how many entries were scanned, what was skipped and whether the result was truncated, so "not there" can be told apart from "not searched".',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Search root. Accepts @WorkDir, @alias, or an absolute path' },
        query: { type: 'string', description: 'Text to look for (literal by default; a regular expression when regex=true)' },
        glob: { type: 'string', description: 'File name wildcard filter (optional, * and ?, for example *.ts)' },
        limit: { type: 'number', description: 'Maximum matches to return (optional, default 50, max 500)' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression (optional, default false)' },
        mode: { type: 'string', enum: ['content', 'filename', 'both'], description: 'What to search (optional, default both)' },
      },
      required: ['root', 'query'],
    },
  },
};

export const MCP_FILESYSTEM_TOOLS: McpTool[] = [
  MCP_FILESYSTEM_READ_FILE_TOOL,
  MCP_FILESYSTEM_WRITE_FILE_TOOL,
  MCP_FILESYSTEM_EDIT_FILE_TOOL,
  MCP_FILESYSTEM_SEARCH_FILES_TOOL,
  MCP_FILESYSTEM_LIST_DIR_TOOL,
  MCP_FILESYSTEM_CREATE_DIR_TOOL,
  MCP_FILESYSTEM_DELETE_FILE_TOOL,
  MCP_FILESYSTEM_RENAME_FILE_TOOL,
];
