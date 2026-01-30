import type { McpTool } from '@/lib/mcp/McpClient';

export const WEB_SEARCH_SERVER_NAME = 'web';

export const WEB_SEARCH_TOOL_SCHEMA: McpTool = {
  name: 'search',
  description: `在互联网上搜索实时信息。

搜索技巧：
- 限定网站：加 site:域名
- 文件搜索：加 filetype:pdf/doc/ppt

注意：某些信息可直接用 fetch 获取，无需搜索：
- 天气：fetch("https://wttr.in/城市?format=3")
- 汇率：fetch("https://api.exchangerate-api.com/v4/latest/USD")`,
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
  description: `抓取指定网页内容，返回页面标题、正文与链接列表。

如果返回 "Just a moment..." 或空内容，表示被网站拦截，换其他网站或方法。

常用免费 API（直接 fetch，无需 API Key）：
- 天气：https://wttr.in/城市?format=3
- 汇率：https://api.exchangerate-api.com/v4/latest/USD`,
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
  description: `下载文件到本地。支持图片、文档等任意文件类型。

URL 必须是可直接下载的直链，不是网页链接。`,
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


