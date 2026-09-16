import type { McpTool } from '@/lib/mcp/McpClient';

export const KNOWLEDGE_SERVER_NAME = 'knowledge';

export const KNOWLEDGE_SEARCH_TOOL: McpTool = {
  name: 'search',
  description:
    '在已挂载的知识库中混合检索（向量+BM25）。返回 evidenceId、文档名、位置与摘要，引用时使用 [[E编号]]。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询' },
        knowledgeBaseIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，限定知识库 ID；默认使用当前会话挂载的知识库',
        },
        limit: { type: 'number', description: '最多返回条数（默认 8）' },
      },
      required: ['query'],
    },
  },
};

export const KNOWLEDGE_LIST_TOOL: McpTool = {
  name: 'list',
  description: '列出当前会话可访问的知识库文档和临时附件，返回文档 ID、名称、类型、索引状态与长度。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: '分页游标（可选）' },
        limit: { type: 'number', description: '最多返回条数（默认 50）' },
      },
    },
  },
};

export const KNOWLEDGE_READ_TOOL: McpTool = {
  name: 'read',
  description: '读取知识库证据的完整原文，可按 evidenceId 或 documentId+page 定位。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', description: 'knowledge_search 返回的 evidenceId，如 E1' },
        documentId: { type: 'string', description: '文档 ID（与 page 配合）' },
        page: { type: 'number', description: 'PDF 页码（可选）' },
        cursor: { type: 'string', description: '顺序读取游标（可选）' },
        limit: { type: 'number', description: '读取上限，默认约 8000 tokens' },
        before: { type: 'number', description: '向前扩展 block 数（默认 1）' },
        after: { type: 'number', description: '向后扩展 block 数（默认 1）' },
      },
    },
  },
};

export const KNOWLEDGE_TOOLS: McpTool[] = [KNOWLEDGE_LIST_TOOL, KNOWLEDGE_SEARCH_TOOL, KNOWLEDGE_READ_TOOL];
