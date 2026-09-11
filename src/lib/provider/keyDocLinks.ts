// Provider API / 项目控制台文档链接集中维护
// key 一律使用小写名称（与 ProviderSettings 中的 provider.name.toLowerCase() 对齐）
export const PROVIDER_KEY_DOC_LINKS: Record<string, string> = {
  // —— 本地 / 免密类（无强制密钥，但可提供使用文档或官网） ——
  'lm studio': 'https://lmstudio.ai',
  ollama: 'https://ollama.com',

  // —— 主流官方云 —— //
  openai: 'https://platform.openai.com/account/api-keys',
  'openai (responses)': 'https://platform.openai.com/docs/guides/text-generation?context=responses-api',
  anthropic: 'https://console.anthropic.com/settings/keys',
  'google ai': 'https://aistudio.google.com/app/apikey',
  deepseek: 'https://platform.deepseek.com',
  'azure openai': 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',

  // —— 自建聚合网关 / 多策略 —— //
  'new api': 'https://github.com', // 聚合网关，留给用户自填具体项目地址
  'gpt-load openai': 'https://gptload.com',
  'gpt-load gemini': 'https://gptload.com',
  'gpt-load anthropic': 'https://gptload.com',

  // —— 常见 OpenAI 兼容聚合 / 代理（国际） —— //
  'orcarouter - api': 'https://www.orcarouter.ai/console/authorized-apps',
  'orcarouter - auth': 'https://www.orcarouter.ai/console/authorized-apps',
  openrouter: 'https://openrouter.ai/keys',
  '302ai': 'https://302.ai',
  aihubmix: 'https://aihubmix.com',
  tokenflux: 'https://tokenflux.io',
  ocoolai: 'https://ocoolai.com',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  perplexity: 'https://www.perplexity.ai/settings/api',
  nvidia: 'https://build.nvidia.com',
  voyageai: 'https://dashboard.voyageai.com/api-keys',
  hyperbolic: 'https://hyperbolic.xyz',
  jina: 'https://jina.ai',
  together: 'https://api.together.xyz',
  fireworks: 'https://fireworks.ai',
  'github models': 'https://docs.github.com/en/github-models',

  // —— 国内 / 区域主流与云厂商 —— //
  'moonshot ai': 'https://platform.moonshot.cn',
  zhipu: 'https://open.bigmodel.cn',
  yi: 'https://platform.lingyiwanwu.com',
  modelscope: 'https://modelscope.cn',
  bailian: 'https://dashscope.aliyuncs.com',
  stepfun: 'https://platform.stepfun.com',
  minimax: 'https://www.minimaxi.com',
  'baichuan ai': 'https://platform.baichuan-ai.com',
  hunyuan: 'https://console.cloud.tencent.com/hunyuan',
  'tencent cloud ti': 'https://console.cloud.tencent.com/ti',
  'baidu cloud': 'https://console.bce.baidu.com/qianfan',
  qiniu: 'https://portal.qiniu.com',
  ppio: 'https://www.ppinfra.com',
  dmxapi: 'https://www.dmxapi.cn',
  alayanew: 'https://deepseek.alayanew.com',
  lanyun: 'https://www.lanyun.net',
  cephalon: 'https://cephalon.cloud',
  infini: 'https://cloud.infini-ai.com',
  xirang: 'https://wishub-x1.ctyun.cn',

  // —— 其他扩展 / 小众服务 —— //
  silicon: 'https://siliconflow.cn',
  burncloud: 'https://ai.burncloud.com',
  grok: 'https://x.ai',
  'gpt-god': 'https://gptgod.online',
  ph8: 'https://ph8.co',
};

/** 根据 Provider 名称获取对应的 API 密钥 / 控制台文档链接 */
export function getProviderKeyDocLink(providerName: string): string | undefined {
  const key = providerName.trim().toLowerCase();
  return PROVIDER_KEY_DOC_LINKS[key];
}


