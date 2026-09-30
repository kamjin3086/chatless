import type { McpTool } from '@/lib/mcp/McpClient';

export const WEB_SEARCH_SERVER_NAME = 'web';

export const WEB_SEARCH_TOOL_SCHEMA: McpTool = {
  name: 'search',
  description: 'Search the internet (add site:example.com to restrict it to one site)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords, for example "cat images site:pexels.com"',
        },
      },
      required: ['query'],
    },
  },
};

export const WEB_FETCH_TOOL_SCHEMA: McpTool = {
  name: 'fetch',
  description: 'Fetch a page and return its title, body text and links',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Page URL or API URL',
        },
      },
      required: ['url'],
    },
  },
};

export const WEB_DOWNLOAD_TOOL_SCHEMA: McpTool = {
  name: 'download',
  description: 'Download a file to disk (the URL must be a direct link)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Direct link to the file (a URL that downloads, not a page link)',
        },
        savePath: {
          type: 'string',
          description: 'Where to save it (relative to @WorkDir, or an absolute path). Example: "images/cat.jpg"',
        },
        filename: {
          type: 'string',
          description: 'Optional: a custom file name',
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


