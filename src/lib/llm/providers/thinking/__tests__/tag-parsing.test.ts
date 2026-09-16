/**
 * 标签解析测试
 * 
 * 测试各种边缘情况，确保不会误吞左尖括号
 */

import { StandardThinkingStrategy } from '../standard-thinking-strategy';
import { DeepSeekReasoningStrategy } from '../deepseek-reasoning-strategy';
import { filterToolCallContent } from '@/lib/chat/segments';

describe('标签解析 - 避免误吞左尖括号', () => {
  describe('Segments过滤器（filterToolCallContent）', () => {
    it('不应删除被拆分的左尖括号："<" + "head>" → "<head>"', () => {
      // 模拟流式分片：第一个chunk只有 "<"
      const first = filterToolCallContent('<');
      // 关键断言：不能把 "<" 吞掉
      expect(first).toBe('<');

      // 第二个chunk到来后整体内容应仍然完整
      const combined = filterToolCallContent(first + 'head>');
      expect(combined).toBe('<head>');
    });
  });

  describe('StandardThinkingStrategy', () => {
    let strategy: StandardThinkingStrategy;

    beforeEach(() => {
      strategy = new StandardThinkingStrategy();
    });

    it('应该正确处理包含 <think> 标签的内容', () => {
      const token = {
        content: '<think>这是思考内容</think>',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 thinking_start 和 thinking_token 事件
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'thinking_start' })
      );
      expect(result.events).toContainEqual(
        expect.objectContaining({ 
          type: 'thinking_token',
          content: '这是思考内容'
        })
      );
    });

    it('应该正确处理普通文本中的左尖括号', () => {
      const token = {
        content: '这是一个比较：a < b',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 content_token 事件，且包含完整的 '<' 字符
      const contentEvents = result.events.filter(e => e.type === 'content_token');
      expect(contentEvents.length).toBeGreaterThan(0);
      const allContent = contentEvents.map(e => e.content).join('');
      expect(allContent).toBe('这是一个比较：a < b');
    });

    it('应该正确处理包含 HTML 标签的内容', () => {
      const token = {
        content: '<div>这是HTML内容</div>',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 content_token 事件，且包含完整的标签
      const contentEvents = result.events.filter(e => e.type === 'content_token');
      const allContent = contentEvents.map(e => e.content).join('');
      expect(allContent).toContain('<div>');
      expect(allContent).toContain('</div>');
    });

    it('应该正确处理跨 token 的 <think> 标签', () => {
      // 第一个 token：开始标签的一部分
      const token1 = {
        content: '<th',
        done: false
      };
      const result1 = strategy.processToken(token1);
      
      // 第二个 token：完成开始标签和部分内容
      const token2 = {
        content: 'ink>分析中',
        done: false
      };
      const result2 = strategy.processToken(token2);
      
      // 第三个 token：剩余内容和结束标签
      const token3 = {
        content: '...</think>',
        done: false
      };
      const result3 = strategy.processToken(token3);
      
      // 应该有 thinking 相关事件
      const allEvents = [...result1.events, ...result2.events, ...result3.events];
      expect(allEvents).toContainEqual(
        expect.objectContaining({ type: 'thinking_start' })
      );
      expect(allEvents.some(e => e.type === 'thinking_token')).toBe(true);
    });

    it('应该正确处理不完整的标签（没有闭合）', () => {
      const token1 = {
        content: '<think>这是思考',
        done: false
      };
      const result1 = strategy.processToken(token1);
      
      // 开放标签流式模式：未闭合时也会实时输出 thinking token
      const thinkingEvents = result1.events.filter(e => e.type === 'thinking_token');
      expect(thinkingEvents.length).toBe(1);
      expect(thinkingEvents[0]).toEqual(
        expect.objectContaining({ type: 'thinking_token', content: '这是思考' })
      );
      
      // 当 done 时，应该正确处理
      const token2 = {
        content: '',
        done: true
      };
      const result2 = strategy.processToken(token2);
      
      // 应该有 stream_complete 事件
      expect(result2.events).toContainEqual(
        expect.objectContaining({ type: 'stream_complete' })
      );
    });
  });

  describe('DeepSeekReasoningStrategy', () => {
    let strategy: DeepSeekReasoningStrategy;

    beforeEach(() => {
      strategy = new DeepSeekReasoningStrategy();
    });

    it('应该正确处理 reasoning_content 字段', () => {
      const token = {
        reasoning_content: '这是推理内容',
        content: '',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 thinking_start 和 thinking_token 事件
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'thinking_start' })
      );
      expect(result.events).toContainEqual(
        expect.objectContaining({ 
          type: 'thinking_token',
          content: '这是推理内容'
        })
      );
    });

    it('应该正确处理 <reasoning> 标签', () => {
      const token = {
        content: '<reasoning>这是推理内容</reasoning>',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 thinking 相关事件
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'thinking_start' })
      );
      expect(result.events).toContainEqual(
        expect.objectContaining({ 
          type: 'thinking_token',
          content: '这是推理内容'
        })
      );
    });

    it('应该正确处理普通内容中的左尖括号', () => {
      const token = {
        content: '结果：x < y',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 content_token 事件，且包含完整的 '<' 字符
      const contentEvents = result.events.filter(e => e.type === 'content_token');
      const allContent = contentEvents.map(e => e.content).join('');
      expect(allContent).toBe('结果：x < y');
    });
  });

  describe('门控机制测试', () => {
    let strategy: StandardThinkingStrategy;

    beforeEach(() => {
      strategy = new StandardThinkingStrategy();
    });

    it('应该正确识别工具调用标签', () => {
      const token = {
        content: '我将使用工具：<use_mcp_tool>tool_name</use_mcp_tool>',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 content_token 事件，但不包含工具调用标签
      const contentEvents = result.events.filter(e => e.type === 'content_token');
      const allContent = contentEvents.map(e => e.content).join('');
      expect(allContent).toContain('我将使用工具：');
      // 工具调用标签应该被解析，不直接输出
    });

    it('不应该误将普通标签识别为工具调用', () => {
      const token = {
        content: '<user>用户输入</user>',
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 content_token 事件，且包含完整的标签
      const contentEvents = result.events.filter(e => e.type === 'content_token');
      const allContent = contentEvents.map(e => e.content).join('');
      expect(allContent).toContain('<user>');
      expect(allContent).toContain('</user>');
    });

    it('应该在缓冲区过大时释放内容', () => {
      // 构造一个很长的内容，以 < 开头但不是工具调用
      const longContent = '<' + 'a'.repeat(2500);
      
      const token = {
        content: longContent,
        done: false
      };

      const result = strategy.processToken(token);
      
      // 应该有 content_token 事件，且包含完整的内容
      const contentEvents = result.events.filter(e => e.type === 'content_token');
      const allContent = contentEvents.map(e => e.content).join('');
      expect(allContent).toContain('<');
      expect(allContent.length).toBeGreaterThan(2000);
    });
  });
});

