/**
 * 时间上下文注入
 * 
 * 目的：
 * 1. 让 LLM 知道当前时间，避免搜索时不知道"今天"是哪一天
 * 2. 帮助 LLM 组装更准确的搜索查询（例如："今天"→"2024年1月15日"）
 * 3. 减少 LLM 对时间的臆测和编造
 */

/**
 * 获取当前时间的格式化字符串
 */
export function getCurrentTimeInfo(): {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weekday: string; // 星期几
  datetime: string; // 完整日期时间
  timestamp: number; // 时间戳
} {
  const now = new Date();
  
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[now.getDay()];
  
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
    weekday,
    datetime: `${year}年${month}月${day}日 ${weekday} ${hours}:${minutes}`,
    timestamp: now.getTime(),
  };
}

/**
 * 构建时间上下文的系统消息
 * 
 * @param includeInSearch - 是否特别强调搜索时使用当前时间
 */
export function buildTimeContextMessage(includeInSearch: boolean = false): string {
  const timeInfo = getCurrentTimeInfo();
  
  let message = `【当前时间】${timeInfo.datetime}`;
  
  if (includeInSearch) {
    message += `

【重要】：
- 当用户问"今天"、"现在"、"最新"等时间相关问题时，请使用上述当前时间
- 进行网络搜索时，应在查询中包含具体日期（如"${timeInfo.date}"）以获取最新信息
- 例如：用户问"今天新闻"，应搜索"${timeInfo.date} 新闻"或"${timeInfo.datetime.split(' ')[0]}新闻"`;
  }
  
  return message;
}

/**
 * 构建简洁的时间上下文消息（用于追问阶段）
 */
export function buildSimpleTimeContext(): string {
  const timeInfo = getCurrentTimeInfo();
  return `当前时间：${timeInfo.datetime}`;
}

/**
 * 检查用户问题是否涉及时间相关查询
 */
export function isTimeRelatedQuery(content: string): boolean {
  const timeKeywords = [
    '今天', '今日', '现在', '当前', '最新', '近期', '最近',
    '这周', '本周', '这个月', '本月', '今年',
    '明天', '昨天', '前天', '后天',
    '天气', '新闻', '股价', '汇率', '赛事', '航班',
    'today', 'now', 'current', 'latest', 'recent',
    'weather', 'news', 'stock', 'flight'
  ];
  
  const contentLower = content.toLowerCase();
  return timeKeywords.some(keyword => contentLower.includes(keyword));
}

/**
 * 为搜索查询添加时间上下文
 * 
 * @param query - 原始搜索查询
 * @returns 增强后的搜索查询
 */
export function enhanceQueryWithTime(query: string): string {
  const timeInfo = getCurrentTimeInfo();
  
  // 如果查询已经包含日期，不再添加
  if (/\d{4}[-年]\d{1,2}[-月]\d{1,2}[日]?/.test(query)) {
    return query;
  }
  
  // 如果查询包含时间关键词，添加具体日期
  const timeKeywords = ['今天', '今日', '现在', '当前', '最新'];
  const hasTimeKeyword = timeKeywords.some(keyword => query.includes(keyword));
  
  if (hasTimeKeyword) {
    // 替换时间关键词为具体日期
    let enhanced = query;
    timeKeywords.forEach(keyword => {
      if (enhanced.includes(keyword)) {
        enhanced = enhanced.replace(keyword, `${timeInfo.date}`);
      }
    });
    return enhanced;
  }
  
  return query;
}

