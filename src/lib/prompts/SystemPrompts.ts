/**
 * 系统内置提示词统一管理
 * 所有内置的系统提示词都应该在此文件中定义和管理
 * 
 * 设计原则：
 * - 精简：移除 LLM 已知的显而易见规则
 * - 合并：避免重复约束
 * - 保留：关键的决策指导
 */

// ================================
// MCP 相关提示词（精简版）
// ================================

export const MCPPrompts = {
  /**
   * 构建可用服务器列表提示
   */
  buildEnabledServersLine(enabled: string[]): string | null {
    if (!enabled.length) return null;
    const list = enabled.length > 3 
      ? `${enabled.slice(0, 3).join(', ')} (+${enabled.length - 3} more)` 
      : enabled.join(', ');
    return `Available tools: ${list}`;
  },

  /**
   * 联网检索策略
   */
  webSearchPolicy: [
    '[Web search policy]',
    '• Use it when the answer needs current or real-time information, or the user asks for it.',
    '• search: look for something from scratch; keep the core entities in the query.',
    '• fetch: read a page when you already have a concrete URL.',
    '• Follow-up questions: start from the results you already have and only call again if they are not enough.',
    '• Never invent live data; if a call fails, say why and suggest what to do next.'
  ].join(' ')
} as const;

// ================================
// RAG/知识库相关提示词（精简版）
// ================================

export const RAGPrompts = {
  /**
   * General knowledge-base assistant system prompt.
   */
  knowledgeAssistant: `You are a knowledge-base assistant. Answer the user's question from the context provided. If the context does not contain the answer, say so explicitly.`,

  /**
   * General Q&A template.
   */
  general: {
    name: 'General Q&A',
    systemPrompt: `You are a professional assistant that answers from the knowledge base content below.

Rules:
1. Answer only from the knowledge base content; never invent information.
2. If the content does not cover the question, say so.
3. Cite the specific sources.

Knowledge base content:
{context}`,
    userTemplate: `Answer from the knowledge base: {query}`
  },

  /**
   * Technical documentation template.
   */
  technical: {
    name: 'Technical documentation',
    systemPrompt: `You are a technical expert who helps the user understand and apply documentation.

Rules:
1. Be accurate about the technical details.
2. Include code examples where they help.
3. Point out the caveats.

Technical knowledge base content:
{context}`,
    userTemplate: `Technical question: {query}`
  },

  /**
   * Analysis report template.
   */
  analytical: {
    name: 'Analysis report',
    systemPrompt: `You are a data analyst working from the data and reports below.

Rules:
1. Analyse the data objectively.
2. State the key findings.
3. Cite the specific numbers.

Analysis data:
{context}`,
    userTemplate: `Analysis question: {query}`
  },

  /**
   * Creative writing template.
   */
  creative: {
    name: 'Creative writing',
    systemPrompt: `You are a creative writing assistant working from the material below.

Rules:
1. Build on the material.
2. Keep it original.
3. Mark where the inspiration came from.

Material:
{context}`,
    userTemplate: `Writing brief: {query}`
  }
} as const;

// ================================
// 文档处理相关提示词
// ================================

export const DocumentPrompts = {
  /**
   * Document summarisation prompt.
   */
  summarize: `Summarise the document below concisely and extract the key information:

{content}

Cover the main points, stay accurate, and keep it under 150 words.`,

  /**
   * Document Q&A prompt.
   */
  documentQA: (documentContent: string, question: string) => 
    `Answer the question from the document below. If the document does not cover it, say so.

Document:
${documentContent}

Question: ${question}`
} as const;

// ================================
// 对话增强相关提示词
// ================================

export const ConversationPrompts = {
  /**
   * Chain-of-thought prompt.
   */
  chainOfThought: `For complex problems: 1) break the problem down 2) reason step by step 3) state the conclusion`,

  /**
   * Base role-play template.
   */
  rolePlay: (role: string, context?: string) => 
    `You are now acting as ${role}.${context ? ` Context: ${context}` : ''} Stay in character.`
} as const;

// ================================
// 工具类函数
// ================================

/**
 * 替换模板中的占位符
 */
export function fillTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value);
  }
  return result;
}

/**
 * 构建RAG提示词
 */
export function buildRAGPrompt(
  query: string,
  context: string,
  templateType: 'general' | 'technical' | 'analytical' | 'creative' = 'general'
): { systemPrompt: string; userPrompt: string } {
  const template = RAGPrompts[templateType];
  
  return {
    systemPrompt: fillTemplate(template.systemPrompt, { context }),
    userPrompt: fillTemplate(template.userTemplate, { query })
  };
}

/**
 * 获取所有可用的提示词模板
 */
export function getAllPromptCategories() {
  return {
    mcp: MCPPrompts,
    rag: RAGPrompts,
    document: DocumentPrompts,
    conversation: ConversationPrompts
  };
}

/**
 * 导出类型定义
 */
export type RAGTemplateType = keyof typeof RAGPrompts;
export type PromptCategory = keyof ReturnType<typeof getAllPromptCategories>;
