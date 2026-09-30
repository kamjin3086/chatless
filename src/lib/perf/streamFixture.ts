/**
 * 固定流式夹具：中文长段落 + 40 行代码块 + 表格 + 列表。
 *
 * 每次测量用同一段内容、同样的切分粒度与速率，保证改造前后的数字可比。
 */

export type StreamFixtureChunk = { text: string };

const PARAGRAPH = [
  '这是一段用于测量的中文长段落，包含**强调**、`行内代码`、以及一个 <div>标签</div> 用来触发安全转义。',
  '它还会带上一些英文专名与型号，例如 Chatless、Qwen3.8-Flash-Next-medium、ERR_CONNECTION_REFUSED，用来检验分词与渲染路径。',
  '段落会重复若干次，以便让正文长度接近一次真实的长回答。',
].join('');

const TABLE = [
  '',
  '| 项目 | 说明 | 数值 |',
  '| --- | --- | --- |',
  '| 帧间隔 | P95 目标 | 20ms |',
  '| 长任务 | 目标 | 0 |',
  '| 首字上屏 | 目标 | 1 帧 |',
  '',
].join('\n');

const LIST = [
  '',
  '- 中文短词、专名、错误码都要覆盖',
  '- 代码块要覆盖高亮路径',
  '- 表格要覆盖复杂 DOM 结构',
  '',
].join('\n');

const CODE = [
  '```ts',
  ...Array.from({ length: 40 }, (_, i) => `const value${i} = compute(${i}, { retries: ${i % 3} });`),
  '```',
].join('\n');

export function buildStreamFixtureText(): string {
  return [
    '# 流式渲染夹具',
    '',
    PARAGRAPH.repeat(6),
    TABLE,
    LIST,
    PARAGRAPH.repeat(3),
    CODE,
    PARAGRAPH.repeat(2),
  ].join('\n');
}

/**
 * 按固定粒度切分（模拟逐 token 到达）。
 * 中文约 1 字 1 token，这里用 12 字符一片，接近真实模型的 token 尺寸。
 */
export function buildStreamFixture(chunkSize = 12): StreamFixtureChunk[] {
  const text = buildStreamFixtureText();
  const chunks: StreamFixtureChunk[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({ text: text.slice(i, i + chunkSize) });
  }
  return chunks;
}
