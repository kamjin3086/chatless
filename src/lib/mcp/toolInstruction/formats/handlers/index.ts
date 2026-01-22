/**
 * 格式处理器导出
 * 
 * ## 处理器说明
 * 
 * 核心处理器（推荐使用）：
 * - OpenAIHandler: OpenAI 原生 function_call/tool_calls 格式
 * - XMLHandler: MCP 标准 XML 格式
 * - JsonHandler: JSON 格式工具调用
 * - GptOssTagHandler: GPT-OSS 模板标签清理（仅清理，不解析）
 * 
 * 已弃用的处理器（保留向后兼容）：
 * - GptOssHandler: 使用 GptOssTagHandler 替代
 * - SimpleHandler: 容易产生误匹配，不再推荐使用
 */

export { OpenAIHandler } from './openai';
export { XMLHandler } from './xml';
export { JsonHandler } from './json';
export { GptOssTagHandler } from './gptoss-tags';

// 已弃用，保留向后兼容
export { GptOssHandler } from './gptoss';
export { SimpleHandler } from './simple';

