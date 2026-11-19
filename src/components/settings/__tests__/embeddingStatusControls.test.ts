import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { EmbeddingServiceStatus } from '../EmbeddingServiceStatus';

vi.stubGlobal('React', React);

it('keeps status inspection read-only while retaining refresh and real-inference testing', () => {
  const html = renderToStaticMarkup(createElement(EmbeddingServiceStatus));
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
  expect(buttons.some((button) => /Ollama 服务|本地模型/.test(button))).toBe(
    false,
  );
  expect(html).toContain('刷新');
  expect(html).toContain('测试嵌入生成');
  expect(html).toContain('上方模型管理器');
});
