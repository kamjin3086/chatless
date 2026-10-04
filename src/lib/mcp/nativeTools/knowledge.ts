import type { McpTool } from '@/lib/mcp/McpClient';

export const KNOWLEDGE_SERVER_NAME = 'knowledge';

export const KNOWLEDGE_SEARCH_TOOL: McpTool = {
  name: 'search',
  description:
    'Search the knowledge bases and attachments mounted in this session (keywords, plus semantic search when embeddings are configured). Returns evidenceId, document name, location and a snippet; cite with [[E1]]-style markers.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for' },
        knowledgeBaseIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: restrict to these knowledge base ids; defaults to what this session has mounted',
        },
        documentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: search only inside these documents; this can only narrow the mounted scope',
        },
        limit: { type: 'number', description: 'Maximum results (default 8)' },
      },
      required: ['query'],
    },
  },
};

export const KNOWLEDGE_LIST_TOOL: McpTool = {
  name: 'list',
  description: 'List the knowledge base documents and attachments this session can reach: id, name, type, index status and length.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'Pagination cursor (optional)' },
        limit: { type: 'number', description: 'Maximum entries (default 50)' },
      },
    },
  },
};

export const KNOWLEDGE_READ_TOOL: McpTool = {
  name: 'read',
  description:
    'Read the source text. Re-open a citation by evidenceId (neighbouring content is included by default), or read a long document sequentially with documentId and cursor; a returned nextCursor means more content follows.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', description: 'An evidenceId returned by knowledge_search, e.g. E1; re-opens the source around the delivered range' },
        documentId: { type: 'string', description: 'Document id (sequential read, or together with page)' },
        page: { type: 'number', description: 'PDF page number (optional)' },
        cursor: { type: 'string', description: 'The nextCursor from the previous call; pass it back unchanged. An expired cursor returns CURSOR_INVALID' },
        limit: { type: 'number', description: 'Read budget, about 8000 tokens by default' },
        before: { type: 'number', description: 'Chunks of context before the citation when re-opening (default 1; 0 reads only the delivered range)' },
        after: { type: 'number', description: 'Chunks of context after the citation when re-opening (default 1; 0 reads only the delivered range)' },
      },
    },
  },
};

export const KNOWLEDGE_TOOLS: McpTool[] = [KNOWLEDGE_LIST_TOOL, KNOWLEDGE_SEARCH_TOOL, KNOWLEDGE_READ_TOOL];
