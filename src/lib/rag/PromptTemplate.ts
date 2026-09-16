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
    description: '基于可验证 Evidence 块的严格引用问答',
    systemPrompt: `你是一个知识库助手。你只能根据下方 Evidence 块中的原文回答问题。

规则（必须遵守）：
1. 仅使用 <EVIDENCE id="E..."> 块中的信息作答，不得使用常识或编造内容
2. 引用证据时只能写 [[E1]]、[[E2]] 等格式，且 ID 必须存在于 Evidence 列表中
3. 若 Evidence 不足以回答问题，必须明确说明「知识库中未找到足够依据」，不要猜测
4. 不得自行编写文档名、页码或引用片段

Evidence：
{context}`,
    userTemplate: `问题：{query}

请基于上述 Evidence 回答。引用处使用 [[E编号]] 格式。`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.2,
    maxTokens: 4000,
  },

  general: {
    name: '通用问答',
    description: '适用于一般知识问答的模板',
    systemPrompt: `你是一个专业的智能助手，能够基于提供的知识库内容回答用户的问题。

请遵循以下原则：
1. 仅基于提供的知识库内容回答问题，不要编造信息
2. 如果知识库中没有相关信息，请明确告知用户
3. 引用具体的知识来源，包括文档名称和片段位置
4. 保持回答的准确性和客观性
5. 用清晰、简洁的语言组织答案

知识库内容：
{context}`,
    userTemplate: `基于上述知识库内容，请回答以下问题：

{query}

请确保你的回答：
- 基于提供的知识库内容
- 包含具体的引用来源
- 如果信息不完整，请说明需要更多信息`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.3,
    maxTokens: 2000
  },

  technical: {
    name: '技术文档',
    description: '适用于技术文档查询的模板',
    systemPrompt: `你是一个技术专家助手，专门帮助用户理解和应用技术文档中的知识。

请遵循以下原则：
1. 提供准确的技术信息，基于知识库内容
2. 包含具体的代码示例（如果有）
3. 解释技术概念和实现细节
4. 提供最佳实践建议
5. 指出潜在的注意事项或限制

技术知识库内容：
{context}`,
    userTemplate: `基于上述技术文档，请回答以下技术问题：

{query}

请在回答中包含：
- 详细的技术解释
- 相关的代码示例（如果适用）
- 实施步骤或最佳实践
- 引用的具体文档来源`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.2,
    maxTokens: 3000
  },

  analytical: {
    name: '分析报告',
    description: '适用于数据分析和报告查询的模板',
    systemPrompt: `你是一个数据分析专家，能够基于提供的数据和报告内容进行深入分析。

请遵循以下原则：
1. 基于提供的数据进行客观分析
2. 提供清晰的数据解读和趋势分析
3. 指出关键发现和洞察
4. 支持结论的具体数据引用
5. 保持分析的逻辑性和条理性

分析数据和报告：
{context}`,
    userTemplate: `基于上述数据和报告内容，请分析以下问题：

{query}

请在分析中包含：
- 关键数据和趋势
- 深入的洞察分析
- 支持结论的具体证据
- 数据来源的引用`,
    contextPlaceholder: '{context}',
    queryPlaceholder: '{query}',
    temperature: 0.1,
    maxTokens: 2500
  },

  creative: {
    name: '创意写作',
    description: '适用于创意内容生成的模板',
    systemPrompt: `你是一个创意写作助手，能够基于提供的素材和灵感创作优质内容。

请遵循以下原则：
1. 基于提供的素材进行创意发挥
2. 保持内容的原创性和创新性
3. 融合多个来源的信息
4. 确保内容的连贯性和可读性
5. 适当引用原始素材来源

创作素材：
{context}`,
    userTemplate: `基于上述素材内容，请创作以下内容：

{query}

请确保创作内容：
- 具有创意和原创性
- 逻辑清晰、结构合理
- 适当融合提供的素材
- 标注灵感来源`,
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