/**
 * SKILL.md 验证器
 * 
 * 验证技能文档是否符合标准格式规范
 */

import { parseSkillMd, type SkillMdParseResult } from './SkillMdParser';
import type { SkillFrontmatter } from './types';

/**
 * 验证结果
 */
export interface SkillValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误列表（阻止使用的问题） */
  errors: ValidationIssue[];
  /** 警告列表（建议修复的问题） */
  warnings: ValidationIssue[];
  /** 建议列表（可选的改进） */
  suggestions: ValidationIssue[];
  /** 验证得分 (0-100) */
  score: number;
}

/**
 * 验证问题
 */
export interface ValidationIssue {
  /** 问题代码 */
  code: string;
  /** 问题描述 */
  message: string;
  /** 问题位置（如果可确定） */
  location?: string;
  /** 修复建议 */
  suggestion?: string;
}

/**
 * 必填的 frontmatter 字段
 */
const REQUIRED_FIELDS: (keyof SkillFrontmatter)[] = ['name', 'description'];

/**
 * 推荐的 frontmatter 字段
 */
const RECOMMENDED_FIELDS: (keyof SkillFrontmatter)[] = ['version', 'author', 'tags'];

/**
 * 推荐的 Markdown 章节
 */
const RECOMMENDED_SECTIONS = [
  { name: 'When to Use', pattern: /^#+\s*When to Use/im },
  { name: 'Instructions', pattern: /^#+\s*Instructions?/im },
  { name: 'Examples', pattern: /^#+\s*Examples?/im },
  { name: 'Gotchas', pattern: /^#+\s*Gotchas?/im },
];

/**
 * 验证 SKILL.md 内容
 * 
 * @param content - SKILL.md 原始内容
 * @returns 验证结果
 */
export function validateSkillMd(content: string): SkillValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const suggestions: ValidationIssue[] = [];
  
  // 解析内容
  const parseResult = parseSkillMd(content);
  
  // 检查解析是否成功
  if (!parseResult.success) {
    errors.push({
      code: 'PARSE_ERROR',
      message: parseResult.error || 'Failed to parse SKILL.md',
      suggestion: 'Check the YAML frontmatter syntax',
    });
    return {
      valid: false,
      errors,
      warnings,
      suggestions,
      score: 0,
    };
  }
  
  // 验证 frontmatter
  validateFrontmatter(parseResult.frontmatter, errors, warnings, suggestions);
  
  // 验证 Markdown 内容
  validateMarkdownContent(parseResult.content, warnings, suggestions);
  
  // 计算得分
  const score = calculateScore(errors, warnings, suggestions);
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestions,
    score,
  };
}

/**
 * 验证 frontmatter
 */
function validateFrontmatter(
  frontmatter: SkillFrontmatter | null,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  suggestions: ValidationIssue[]
): void {
  // 没有 frontmatter
  if (!frontmatter) {
    errors.push({
      code: 'NO_FRONTMATTER',
      message: 'Missing YAML frontmatter',
      suggestion: 'Add a YAML frontmatter block at the beginning of the file',
    });
    return;
  }
  
  // 检查必填字段
  for (const field of REQUIRED_FIELDS) {
    const value = frontmatter[field];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      errors.push({
        code: `MISSING_${field.toUpperCase()}`,
        message: `Missing required field: ${field}`,
        location: 'frontmatter',
        suggestion: `Add "${field}" to the frontmatter`,
      });
    }
  }
  
  // 检查推荐字段
  for (const field of RECOMMENDED_FIELDS) {
    const value = frontmatter[field];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      warnings.push({
        code: `MISSING_${field.toUpperCase()}`,
        message: `Missing recommended field: ${field}`,
        location: 'frontmatter',
        suggestion: `Consider adding "${field}" to the frontmatter`,
      });
    }
  }
  
  // 检查描述长度
  if (frontmatter.description) {
    if (frontmatter.description.length > 200) {
      warnings.push({
        code: 'DESCRIPTION_TOO_LONG',
        message: 'Description is too long (>200 characters)',
        location: 'frontmatter.description',
        suggestion: 'Keep the description under 200 characters for better display in skill index',
      });
    }
    if (frontmatter.description.length < 20) {
      suggestions.push({
        code: 'DESCRIPTION_TOO_SHORT',
        message: 'Description is very short (<20 characters)',
        location: 'frontmatter.description',
        suggestion: 'Consider adding more detail to the description',
      });
    }
  }
  
  // 检查版本格式
  if (frontmatter.version && !/^\d+\.\d+\.\d+/.test(frontmatter.version)) {
    warnings.push({
      code: 'INVALID_VERSION_FORMAT',
      message: 'Version should follow semantic versioning (e.g., 1.0.0)',
      location: 'frontmatter.version',
      suggestion: 'Use semantic versioning format: MAJOR.MINOR.PATCH',
    });
  }
  
  // 检查触发关键词
  if (!frontmatter.triggers || frontmatter.triggers.length === 0) {
    suggestions.push({
      code: 'NO_TRIGGERS',
      message: 'No trigger keywords defined',
      location: 'frontmatter.triggers',
      suggestion: 'Add trigger keywords to improve skill discovery',
    });
  }
  
  // 检查依赖项格式
  if (frontmatter.dependencies) {
    for (const dep of frontmatter.dependencies) {
      if (typeof dep !== 'object') {
        warnings.push({
          code: 'INVALID_DEPENDENCY_FORMAT',
          message: 'Dependency should be an object with type and version',
          location: 'frontmatter.dependencies',
          suggestion: 'Use format: { python: ">=3.10" }',
        });
      }
    }
  }
}

/**
 * 验证 Markdown 内容
 */
function validateMarkdownContent(
  content: string,
  warnings: ValidationIssue[],
  suggestions: ValidationIssue[]
): void {
  // 检查是否有主标题
  if (!/^#\s+.+/m.test(content)) {
    warnings.push({
      code: 'NO_MAIN_HEADING',
      message: 'No main heading (# Title) found',
      location: 'content',
      suggestion: 'Add a main heading at the beginning of the content',
    });
  }
  
  // 检查推荐章节
  for (const section of RECOMMENDED_SECTIONS) {
    if (!section.pattern.test(content)) {
      suggestions.push({
        code: `MISSING_SECTION_${section.name.toUpperCase().replace(/\s+/g, '_')}`,
        message: `Missing recommended section: ${section.name}`,
        location: 'content',
        suggestion: `Consider adding a "${section.name}" section`,
      });
    }
  }
  
  // 检查内容长度
  if (content.length < 100) {
    warnings.push({
      code: 'CONTENT_TOO_SHORT',
      message: 'Content is very short (<100 characters)',
      location: 'content',
      suggestion: 'Add more detailed instructions for using this skill',
    });
  }
  
  // 检查是否有代码示例
  if (!/```[\s\S]*?```/.test(content)) {
    suggestions.push({
      code: 'NO_CODE_EXAMPLES',
      message: 'No code examples found',
      location: 'content',
      suggestion: 'Consider adding code examples to illustrate usage',
    });
  }
}

/**
 * 计算验证得分
 */
function calculateScore(
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  suggestions: ValidationIssue[]
): number {
  // 基础分 100，每个问题扣分
  let score = 100;
  
  score -= errors.length * 25;      // 错误扣 25 分
  score -= warnings.length * 10;    // 警告扣 10 分
  score -= suggestions.length * 5;  // 建议扣 5 分
  
  return Math.max(0, Math.min(100, score));
}

/**
 * 快速验证 - 只检查是否可用
 */
export function isValidSkillMd(content: string): boolean {
  const result = validateSkillMd(content);
  return result.valid;
}

/**
 * 获取验证摘要
 */
export function getValidationSummary(result: SkillValidationResult): string {
  const parts: string[] = [];
  
  if (result.valid) {
    parts.push(`✅ Valid (Score: ${result.score}/100)`);
  } else {
    parts.push(`❌ Invalid (Score: ${result.score}/100)`);
  }
  
  if (result.errors.length > 0) {
    parts.push(`${result.errors.length} error(s)`);
  }
  if (result.warnings.length > 0) {
    parts.push(`${result.warnings.length} warning(s)`);
  }
  if (result.suggestions.length > 0) {
    parts.push(`${result.suggestions.length} suggestion(s)`);
  }
  
  return parts.join(' | ');
}

