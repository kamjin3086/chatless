export type CatalogStrategy =
  | 'openai'               // OpenAI 官方
  | 'openai-responses'     // OpenAI Responses (/responses)
  | 'openai-compatible'    // 兼容 OpenAI 接口的聚合/代理
  | 'anthropic'            // Claude
  | 'gemini'               // Google AI
  | 'deepseek'             // DeepSeek
  | 'ollama'               // Ollama（本地部署）
  | 'multi';               // 多策略委派（例如 New API：按模型选择具体协议）

export interface CatalogProviderDef {
  id: string;          // 唯一 id，用作内部标识
  name: string;        // 展示名称与 ProviderEntity.name 对齐
  strategy: CatalogStrategy;
  requiresKey: boolean;
  defaultUrl?: string;
  notes?: string;
  staticModels?: Array<{ id: string; label?: string }>; // 可选：静态模型清单
}

// 可添加的 Provider 清单（本地 / 热门 / 常见网关优先，冷门靠后）
export const AVAILABLE_PROVIDERS_CATALOG: CatalogProviderDef[] = [
  // —— 本地 / 免密优先 ——
  { id: 'lemonade', name: 'Lemonade', strategy: 'openai-compatible', requiresKey: false, defaultUrl: 'http://localhost:13305/api/v1', notes: '本地 Lemonade Server，需先在服务端加载模型' },
  { id: 'lmstudio', name: 'LM Studio', strategy: 'openai-compatible', requiresKey: false, defaultUrl: 'http://localhost:1234/v1' },
  { id: 'ollama', name: 'Ollama', strategy: 'ollama', requiresKey: false, defaultUrl: 'http://localhost:11434' },

  // —— 主流官方云 ——
  {
    id: 'deepseek',
    name: 'DeepSeek',
    strategy: 'deepseek',
    requiresKey: true,
    defaultUrl: 'https://api.deepseek.com',
  },
  {
    id: 'google-ai',
    name: 'Google AI',
    strategy: 'gemini',
    requiresKey: true,
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    strategy: 'openai',
    requiresKey: true,
    defaultUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'openai-responses',
    name: 'OpenAI (Responses)',
    strategy: 'openai-responses',
    requiresKey: true,
    defaultUrl: 'https://api.openai.com/v1',
    notes: '使用 /responses 端点，支持 reasoning 与工具调用预留',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    strategy: 'anthropic',
    requiresKey: true,
    defaultUrl: 'https://api.anthropic.com/v1',
  },
  { id: 'azure-openai', name: 'Azure OpenAI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: '' },

  // —— 自建聚合网关 / 多策略 ——
  {
    id: 'newapi',
    name: 'New API',
    strategy: 'multi',
    requiresKey: true,
    // 默认服务端口，根据部署填入聚合网关地址
    defaultUrl: 'http://localhost:3000/v1',
  },
  {
    id: 'gptload-openai',
    name: 'GPT-Load OpenAI',
    strategy: 'openai-compatible',
    requiresKey: true,
    // 默认服务端口，根据部署填入聚合网关地址
    defaultUrl: 'http://localhost:3001/proxy/openai',
  },
  {
    id: 'gptload-gemini',
    name: 'GPT-Load Gemini',
    strategy: 'openai-compatible',
    requiresKey: true,
    // 默认服务端口，根据部署填入聚合网关地址
    defaultUrl: 'http://localhost:3001/proxy/gemini/v1beta/openai',
  },
  {
    id: 'gptload-anthropic',
    name: 'GPT-Load Anthropic',
    strategy: 'anthropic',
    requiresKey: true,
    // 默认服务端口，根据部署填入聚合网关地址
    defaultUrl: 'http://localhost:3001/proxy/anthropic',
  },

  // —— 常见 OpenAI 兼容聚合 / 代理（国际） ——
  { id: 'openrouter', name: 'OpenRouter', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://openrouter.ai/api/v1' },
  { id: 'orcarouter', name: 'OrcaRouter', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.orcarouter.ai/v1' },
  { id: 'mixroute', name: 'MixRoute', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.mixroute.ai/v1' },
  { id: 'novita', name: 'Novita', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.novita.ai/openai/v1' },
  { id: '302ai', name: '302AI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.302.ai/v1' },
  { id: 'aihubmix', name: 'AIHubMix', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.aihubmix.com/v1' },
  { id: 'tokenflux', name: 'TokenFlux', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://tokenflux.ai/v1' },
  { id: 'ocoolai', name: 'ocoolAI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://one.ocoolai.com/v1' },
  { id: 'groq', name: 'Groq', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.mistral.ai/v1' },
  { id: 'perplexity', name: 'Perplexity', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.perplexity.ai' },
  { id: 'nvidia', name: 'NVIDIA', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://integrate.api.nvidia.com/v1' },
  { id: 'voyageai', name: 'VoyageAI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.voyageai.com/v1', notes: 'Embedding 专用接口，不适合作为聊天模型 Provider' },
  { id: 'hyperbolic', name: 'Hyperbolic', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.hyperbolic.xyz/v1' },
  { id: 'jina', name: 'Jina', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.jina.ai/v1' },
  { id: 'together', name: 'Together', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.together.xyz/v1' },
  { id: 'fireworks', name: 'Fireworks', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.fireworks.ai/inference/v1' },

  // —— 国内 / 区域主流与云厂商 ——
  { id: 'moonshot', name: 'Moonshot AI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', name: 'ZhiPu', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'modelscope', name: 'ModelScope', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api-inference.modelscope.cn/v1' },
  { id: 'dashscope', name: 'Bailian', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'stepfun', name: 'StepFun', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.stepfun.com/v1' },
  { id: 'minimax', name: 'MiniMax', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.minimax.chat/v1' },
  { id: 'baichuan', name: 'BAICHUAN AI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.baichuan-ai.com/v1' },
  { id: 'hunyuan', name: 'hunyuan', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'tencent-cloud-ti', name: 'Tencent Cloud TI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.lkeap.cloud.tencent.com' },
  { id: 'baidu-cloud', name: 'Baidu Cloud', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://qianfan.baidubce.com/v2' },
  { id: 'qiniu', name: 'Qiniu', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.qnaigc.com/v1' },
  { id: 'ppio', name: 'PPIO', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.ppinfra.com/v3/openai' },
  { id: 'dmxapi', name: 'DMXAPI', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://www.dmxapi.cn/v1' },
  { id: 'alayanew', name: 'AlayaNew', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://deepseek.alayanew.com/v1' },
  { id: 'lanyun', name: 'LANYUN', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://maas-api.lanyun.net/v1' },
  { id: 'cephalon', name: 'Cephalon', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://cephalon.cloud/user-center/v1/model' },
  { id: 'infini', name: 'Infini', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://cloud.infini-ai.com/maas/v1' },
  { id: 'xirang', name: 'Xirang', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://wishub-x1.ctyun.cn/v1' },

  // —— 其他扩展 / 小众服务 ——
  { id: 'silicon', name: 'Silicon', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'burncloud', name: 'BurnCloud', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://ai.burncloud.com/v1' },
  { id: 'grok', name: 'Grok', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.x.ai' },
  { id: 'gptgod', name: 'GPT-GOD', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://api.gptgod.online/v1' },
  { id: 'ph8', name: 'PH8', strategy: 'openai-compatible', requiresKey: true, defaultUrl: 'https://ph8.co/v1', notes: '海外模型已下线，国内模型仍可用' },
];


