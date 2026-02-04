import type { McpTool } from '@/lib/mcp/McpClient';

export const WEB_SEARCH_SERVER_NAME = 'web';

export const WEB_SEARCH_TOOL_SCHEMA: McpTool = {
  name: 'search',
  description: '搜索互联网（可加 site:域名 限定网站）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，例如 "猫图片 site:pexels.com"',
        },
      },
      required: ['query'],
    },
  },
};

export const WEB_FETCH_TOOL_SCHEMA: McpTool = {
  name: 'fetch',
  description: '抓取网页内容，返回标题、正文、链接',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '网页地址或 API URL',
        },
      },
      required: ['url'],
    },
  },
};

export const WEB_DOWNLOAD_TOOL_SCHEMA: McpTool = {
  name: 'download',
  description: '下载文件到本地（需提供直链 URL）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '文件直链地址（必须是可直接下载的 URL，不是页面链接）',
        },
        savePath: {
          type: 'string',
          description: '保存路径（相对于 @WorkDir 或绝对路径）。例如: "images/cat.jpg"',
        },
        filename: {
          type: 'string',
          description: '可选：自定义文件名',
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


