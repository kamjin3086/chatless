import { preprocessMarkdownForSafeRender } from '../markdownPreprocess';

describe('markdownPreprocess (regression)', () => {
  test('完整 HTML 文档应被包裹为 ```html 代码块（避免渲染为 DOM）', () => {
    const html = [
      '<!DOCTYPE html>',
      '<html>',
      '<head><title>x</title></head>',
      '<body><canvas id="c"></canvas></body>',
      '</html>',
    ].join('\n');
    const out = preprocessMarkdownForSafeRender(html, { wrapFullHtmlDocument: true });
    expect(out.startsWith('```html\n')).toBe(true);
    expect(out.includes('<canvas')).toBe(true);
    expect(out.endsWith('\n```')).toBe(true);
  });

  test('非代码区域的 < > 应转义，避免被当作 HTML 注入', () => {
    const s = '这里有一个标签：<div>hi</div>。';
    const out = preprocessMarkdownForSafeRender(s, { wrapFullHtmlDocument: false });
    expect(out).toContain('&lt;div&gt;hi&lt;/div&gt;');
  });

  test('代码围栏内不应转义（保持原样，按代码块展示）', () => {
    const s = '```html\n<div>hi</div>\n```';
    const out = preprocessMarkdownForSafeRender(s, { wrapFullHtmlDocument: true });
    expect(out).toBe(s);
  });

  test('包含 ```html 的内容应保持为代码块文本（由上层禁用 controls/rehype/remark 来确保不预览）', () => {
    // 这个测试验证预处理不会“拆掉代码块”，从而允许 UI 层稳定输出代码。
    // 是否发生预览/执行由 Streamdown props 控制（已在组件中 controls={false} rehypePlugins={[]} remarkPlugins={[]}）。
    const s = '```html\n<canvas id=\"c\"></canvas>\n<style>body{background:red}</style>\n```';
    const out = preprocessMarkdownForSafeRender(s, { wrapFullHtmlDocument: true });
    expect(out).toBe(s);
  });

  test('修复围栏不在行首/缺少换行："</think>```html<!DOCTYPE" 应变为换行后的代码块', () => {
    const s = '</think>```html<!DOCTYPE html>\n<html><body>ok</body></html>\n```';
    const out = preprocessMarkdownForSafeRender(s, { wrapFullHtmlDocument: true });
    // 1) </think> 会被转义（在代码围栏外）
    expect(out).toContain('&lt;/think&gt;');
    // 2) ```html 必须出现在新行
    expect(out).toContain('\n```html\n');
    // 3) <!DOCTYPE 在代码块内部应保持原样
    expect(out).toContain('<!DOCTYPE html>');
  });
});


