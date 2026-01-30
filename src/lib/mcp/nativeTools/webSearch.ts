import type { McpTool } from '@/lib/mcp/McpClient';

export const WEB_SEARCH_SERVER_NAME = 'web_search';

export const WEB_SEARCH_TOOL_SCHEMA: McpTool = {
  name: 'search',
  description: '在互联网上搜索实时信息。适用于新闻、天气、时事或需要最新数据的问题。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，例如 "东京今天的天气"',
        },
      },
      required: ['query'],
    },
  },
};

export const WEB_FETCH_TOOL_SCHEMA: McpTool = {
  name: 'fetch',
  description: '抓取指定网页内容，返回页面标题、正文与链接列表。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要抓取的网页地址（以 http:// 或 https:// 开头）',
        },
      },
      required: ['url'],
    },
  },
};

export const WEB_DOWNLOAD_TOOL_SCHEMA: McpTool = {
  name: 'download',
  description: '下载文件到本地。支持图片、文档等任意文件类型。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '文件下载地址（以 http:// 或 https:// 开头）',
        },
        savePath: {
          type: 'string',
          description: '保存路径（相对于 @WorkDir 或绝对路径）。例如: "images/cat.jpg" 或 "@WorkDir/downloads/file.pdf"',
        },
        filename: {
          type: 'string',
          description: '可选：自定义文件名。如果不指定，从 URL 或响应头中提取',
        },
      },
      required: ['url', 'savePath'],
    },
  },
};

export const WEB_SEARCH_TOOLS: McpTool[] = [
  WEB_SEARCH_TOOL_SCHEMA, 
  WEB_FETCH_TOOL_SCHEMA,
  WEB_DOWNLOAD_TOOL_SCHEMA,
];


