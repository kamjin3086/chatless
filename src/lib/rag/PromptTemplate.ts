/**
 * RAG提示词模板管理器
 */

export interface PromptTemplateConfig {
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户查询模板 */
  userTemplate: string;
  /** 上下文插入位置标记 */
  contextPlaceholder: string;
  /** 查询插入位置标记 */
  queryPlaceholder: string;
  /** 温度参数 */
  temperature?: number;
  /** 最大生成token数 */
  maxTokens?: number;
}

/**
 * 默认的RAG提示词模板
 */
export const DEFAULT_RAG_TEMPLATES: Record<string, PromptTemplateConfig> = {
  evidence: {
    name: 'Evidence RAG',
    description: 'Strict citation Q&A over verifiable evidence blocks',
    systemPrompt: `You are a knowledge base assistant. Answer only from the source text inside the evidence blocks below.

Rules (binding):
1. Use only what the <EVIDENCE id="E..."> blocks contain. Do not use general knowledge and do not invent anything.
2. Cite evidence only as [[E1]], [[E2]] and so on, and only with ids that exist in the evidence list.
3. If the evidence is not enough to answer, say "there is not enough evidence in the knowledge base" explicitly. Do not guess.
4. Never write your own file names, page numbers or quotations.

Evidence:
{context}`,
    userTemplate: `Question: {query}

Answer from the evidence above and cite with [[E...]] markers.`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.2,
    maxTokens: 4000,
  },

  general: {
    name: 'General Q&A',
    description: 'For ordinary knowledge questions',
    systemPrompt: `You are a professional assistant answering questions from the knowledge base content below.

Rules:
1. Answer only from that content; never invent information.
2. If the content does not cover the question, say so.
3. Cite the concrete sources, including document name and position.
4. Stay accurate and objective.
5. Keep the answer clear and concise.

Knowledge base content:
{context}`,
    userTemplate: `Answer this question from the knowledge base content above:

{query}

Make sure the answer:
- stays within the provided content
- cites the concrete sources
- says what information is missing when it is incomplete`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.3,
    maxTokens: 2000
  },

  technical: {
    name: 'Technical documentation',
    description: 'For questions about technical documentation',
    systemPrompt: `You are a technical expert who helps the user understand and apply documentation.

Rules:
1. Give accurate technical information grounded in the knowledge base content.
2. Include concrete code examples where they exist.
3. Explain the concepts and the implementation details.
4. Offer best-practice advice.
5. Point out the caveats and limitations.

Technical knowledge base content:
{context}`,
    userTemplate: `Answer this technical question from the documentation above:

{query}

Include in the answer:
- a detailed technical explanation
- the relevant code examples where applicable
- implementation steps or best practices
- the concrete sources cited`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.2,
    maxTokens: 3000
  },

  analytical: {
    name: 'Analysis report',
    description: 'For data analysis and report questions',
    systemPrompt: `You are a data analyst working from the data and reports below.

Rules:
1. Analyse the data objectively.
2. Present a clear reading of the data and its trends.
3. State the key findings and insights.
4. Back conclusions with the concrete numbers.
5. Keep the analysis logical and ordered.

Data and reports:
{context}`,
    userTemplate: `Analyse this question from the data and reports above:

{query}

Include in the analysis:
- the key data and trends
- the deeper insights
- the concrete evidence behind each conclusion
- the sources cited`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.1,
    maxTokens: 2500
  },

  creative: {
    name: 'Creative writing',
    description: 'For generating creative content',
    systemPrompt: `You are a creative writing assistant working from the material and inspiration below.

Rules:
1. Build creatively on the material provided.
2. Keep the result original.
3. Combine information from several sources.
4. Keep it coherent and readable.
5. Credit the source material where it matters.

Material:
{context}`,
    userTemplate: `Create the following from the material above:

{query}

Make sure the result:
- is creative and original
- is clearly structured and logical
- weaves in the provided material
- marks where the inspiration came from`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.7,
    maxTokens: 2000
  }
};

/**
 * 提示词模板管理器
 */
export class PromptTemplate {
  private templates: Map<string, PromptTemplateConfig> = new Map();
  private currentTemplate: string = 'evidence';

  constructor() {
    // 加载默认模板
    Object.entries(DEFAULT_RAG_TEMPLATES).forEach(([key, template]) => {
      this.templates.set(key, template);
    });
  }

  /**
   * 构建RAG查询提示词
   */
  buildPrompt(
    query: string,
    context: string,
    templateName?: string
  ): {
    systemPrompt: string;
    userPrompt: string;
    fullPrompt: string;
    template: PromptTemplateConfig;
  } {
    const template = this.getTemplate(templateName || this.currentTemplate);
    
    // 替换系统提示词中的上下文
    const systemPrompt = template.systemPrompt.replace(
      template.contextPlaceholder,
      context
    );

    // 替换用户模板中的查询
    const userPrompt = template.userTemplate.replace(
      template.queryPlaceholder,
      query
    );

    // 构建完整提示词
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    return {
      systemPrompt,
      userPrompt,
      fullPrompt,
      template
    };
  }

  /**
   * 获取模板
   */
  getTemplate(name: string): PromptTemplateConfig {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }
    return template;
  }

  /**
   * 设置当前使用的模板
   */
  setCurrentTemplate(name: string): void {
    if (!this.templates.has(name)) {
      throw new Error(`模板 "${name}" 不存在`);
    }
    this.currentTemplate = name;
  }

  /**
   * 获取当前模板名称
   */
  getCurrentTemplateName(): string {
    return this.currentTemplate;
  }

  /**
   * 添加自定义模板
   */
  addTemplate(name: string, template: PromptTemplateConfig): void {
    this.templates.set(name, template);
  }

  /**
   * 删除模板
   */
  removeTemplate(name: string): boolean {
    if (name === this.currentTemplate) {
      throw new Error('不能删除当前正在使用的模板');
    }
    return this.templates.delete(name);
  }

  /**
   * 获取所有模板名称
   */
  getTemplateNames(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * 获取所有模板信息
   */
  getAllTemplates(): PromptTemplateConfig[] {
    return Array.from(this.templates.values());
  }

  /**
   * 验证模板格式
   */
  validateTemplate(template: PromptTemplateConfig): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!template.name || template.name.trim() === '') {
      errors.push('模板名称不能为空');
    }

    if (!template.systemPrompt || template.systemPrompt.trim() === '') {
      errors.push('系统提示词不能为空');
    }

    if (!template.userTemplate || template.userTemplate.trim() === '') {
      errors.push('用户模板不能为空');
    }

    if (!template.contextPlaceholder || template.contextPlaceholder.trim() === '') {
      errors.push('上下文占位符不能为空');
    }

    if (!template.queryPlaceholder || template.queryPlaceholder.trim() === '') {
      errors.push('查询占位符不能为空');
    }

    // 检查占位符是否在模板中存在
    if (!template.systemPrompt.includes(template.contextPlaceholder)) {
      errors.push(`系统提示词中缺少上下文占位符: ${template.contextPlaceholder}`);
    }

    if (!template.userTemplate.includes(template.queryPlaceholder)) {
      errors.push(`用户模板中缺少查询占位符: ${template.queryPlaceholder}`);
    }

    // 检查参数范围
    if (template.temperature !== undefined && (template.temperature < 0 || template.temperature > 2)) {
      errors.push('温度参数应在0-2之间');
    }

    if (template.maxTokens !== undefined && template.maxTokens <= 0) {
      errors.push('最大token数应大于0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 克隆模板
   */
  cloneTemplate(name: string, newName: string): PromptTemplateConfig {
    const template = this.getTemplate(name);
    const clonedTemplate: PromptTemplateConfig = {
      ...template,
      name: newName,
      description: `${template.description} (副本)`
    };
    
    this.addTemplate(newName, clonedTemplate);
    return clonedTemplate;
  }

  /**
   * 更新模板
   */
  updateTemplate(name: string, updates: Partial<PromptTemplateConfig>): void {
    const template = this.getTemplate(name);
    const updatedTemplate = { ...template, ...updates, name }; // 保持原名称
    
    const validation = this.validateTemplate(updatedTemplate);
    if (!validation.isValid) {
      throw new Error(`模板验证失败: ${validation.errors.join(', ')}`);
    }
    
    this.templates.set(name, updatedTemplate);
  }

  /**
   * 导出模板配置
   */
  exportTemplates(): Record<string, PromptTemplateConfig> {
    const result: Record<string, PromptTemplateConfig> = {};
    this.templates.forEach((template, name) => {
      result[name] = { ...template };
    });
    return result;
  }

  /**
   * 导入模板配置
   */
  importTemplates(templates: Record<string, PromptTemplateConfig>): {
    success: string[];
    errors: string[];
  } {
    const success: string[] = [];
    const errors: string[] = [];

    Object.entries(templates).forEach(([name, template]) => {
      try {
        const validation = this.validateTemplate(template);
        if (validation.isValid) {
          this.addTemplate(name, template);
          success.push(name);
        } else {
          errors.push(`${name}: ${validation.errors.join(', ')}`);
        }
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    });

    return { success, errors };
  }
} 