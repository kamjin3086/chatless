import type { McpTool } from '@/lib/mcp/McpClient';

export const KNOWLEDGE_SERVER_NAME = 'knowledge';

export const KNOWLEDGE_SEARCH_TOOL: McpTool = {
  name: 'search',
  description:
    '在当前会话已挂载的知识库与附件中检索（关键词，配置 embedding 后叠加语义检索）。返回 evidenceId、文档名、位置与摘要，引用时使用 [[E编号]]。',
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
        documentIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，只在指定文档内检索；只能缩小当前会话已挂载的范围',
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
  description:
    '读取原文。可用 evidenceId 重新打开引用（默认扩展相邻内容），或用 documentId 配合 cursor 顺序读取长文档；返回 nextCursor 时表示还有后续内容。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', description: 'knowledge_search 返回的 evidenceId，如 E1；按实际交付范围重新打开原文' },
        documentId: { type: 'string', description: '文档 ID（顺序读取或与 page 配合）' },
        page: { type: 'number', description: 'PDF 页码（可选）' },
        cursor: { type: 'string', description: '上一轮返回的 nextCursor；原样回传，失效时返回 CURSOR_INVALID' },
        limit: { type: 'number', description: '读取上限，默认约 8000 tokens' },
        before: { type: 'number', description: '按引用重新打开时向前扩展的分块数（默认 1，0 表示只读交付范围）' },
        after: { type: 'number', description: '按引用重新打开时向后扩展的分块数（默认 1，0 表示只读交付范围）' },
      },
    },
  },
};

export const KNOWLEDGE_TOOLS: McpTool[] = [KNOWLEDGE_LIST_TOOL, KNOWLEDGE_SEARCH_TOOL, KNOWLEDGE_READ_TOOL];
