/*
  NOTE: 本文件为静态模型清单数据源，按 provider 维度完整列举模型。
  为保证覆盖度与可读性，文件行数可能超过 500 行（项目规则对“复杂配置/数据文件”允许例外）。
*/
export interface StaticModelDef { id: string; label: string }

// 使用数组对象字面量承载静态模型清单，避免使用 Record/Map
export const STATIC_PROVIDER_MODELS = [
  {
    providerName: "DeepSeek",
    models: [
    { id: "deepseek-chat", label: "DeepSeek V3" },
    { id: "deepseek-reasoner", label: "DeepSeek R1" }
    ]
  },
  {
    providerName: "Google AI",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp" },
      { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
      { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B" },
    ]
  },
  {
    providerName: "Anthropic",
    models: [
      { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
      { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku" }
    ]
  },
  {
    providerName: "OpenAI",
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-nano", label: "GPT-5 Nano" },
      { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "gpt-4.5-preview", label: "GPT-4.5 Preview" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { id: "o3", label: "o3" },
      { id: "o3-mini", label: "o3-mini" },
    { id: "o1-mini", label: "o1-mini" },
    { id: "o1-preview", label: "o1-preview" },
      { id: "gpt-4o-search-preview", label: "GPT-4o Search Preview" },
      { id: "gpt-4o-mini-search-preview", label: "GPT-4o Mini Search Preview" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
    { id: "gpt-image-1", label: "GPT-Image-1" }
    ]
  },

  // 兼容 OpenAI 的聚合/代理服务
  {
    providerName: "302AI",
    models: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "chatgpt-4o-latest", label: "ChatGPT 4o Latest" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
    { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash Preview" },
    { id: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro Preview" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { id: "jina-clip-v2", label: "Jina CLIP V2" },
      { id: "jina-reranker-m0", label: "Jina Reranker M0" },
      { id: "qwen3-235b-a22b", label: "Qwen3 235B A22B" }
    ]
  },
  {
    providerName: "AIHubMix",
    models: [
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-image-1", label: "GPT-Image-1" },
    { id: "DeepSeek-V3", label: "DeepSeek V3" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro Preview" },
    { id: "gemini-2.5-flash-preview-05-20-nothink", label: "Gemini 2.5 Flash Preview (NoThink)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "qwen3-235b-a22b", label: "Qwen3 235B A22B" }
    ]
  },
  {
    providerName: "OpenRouter",
    models: [
    { id: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash Preview" },
    { id: "qwen/qwen-2.5-7b-instruct:free", label: "Qwen 2.5 7B Instruct (Free)" },
    { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
      { id: "mistralai/mistral-7b-instruct:free", label: "Mistral 7B Instruct (Free)" },
      { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", label: "Mixtral 8x22B Instruct v0.1" }
    ]
  },
  {
    providerName: "OrcaRouter",
    models: [
      { id: "orcarouter/auto", label: "Auto Router" },
      { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
      { id: "qwen/qwen-plus", label: "Qwen Plus" },
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
      { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
    ]
  },
  {
    providerName: "MixRoute",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "qwen-plus", label: "Qwen Plus" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    ]
  },
  {
    providerName: "Novita",
    models: [
      { id: "deepseek/deepseek-v3-0324", label: "DeepSeek V3" },
      { id: "qwen/qwen2.5-72b-instruct", label: "Qwen2.5 72B Instruct" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
    ]
  },
  {
    providerName: "TokenFlux",
    models: [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "deepseek-r1", label: "DeepSeek R1" },
    { id: "deepseek-v3", label: "DeepSeek V3" },
    { id: "qwen-max", label: "Qwen Max" },
    { id: "qwen-plus", label: "Qwen Plus" }
    ]
  },
  {
    providerName: "ocoolAI",
    models: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1" },
      { id: "HiSpeed/DeepSeek-R1", label: "DeepSeek R1 (HiSpeed)" },
      { id: "ocoolAI/DeepSeek-R1", label: "DeepSeek R1 (ocoolAI)" },
      { id: "Azure/DeepSeek-R1", label: "DeepSeek R1 (Azure)" },
    { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-all", label: "GPT-4o All" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4", label: "GPT-4" },
    { id: "o1-preview", label: "o1-preview" },
    { id: "o1-mini", label: "o1-mini" },
    { id: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (20240620)" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (20241022)" },
    { id: "gemini-pro", label: "Gemini Pro" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { id: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo", label: "Llama 3.2 90B Vision Turbo" },
    { id: "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo", label: "Llama 3.2 11B Vision Turbo" },
    { id: "meta-llama/Llama-3.2-3B-Vision-Instruct-Turbo", label: "Llama 3.2 3B Vision Turbo" },
    { id: "google/gemma-2-27b-it", label: "Gemma 2 27B IT" },
    { id: "google/gemma-2-9b-it", label: "Gemma 2 9B IT" },
    { id: "text-embedding-3-large", label: "Text Embedding 3 Large" },
    { id: "text-embedding-3-small", label: "Text Embedding 3 Small" }
    ]
  },
  {
    providerName: "Groq",
    models: [
    { id: "llama3-8b-8192", label: "LLaMA3 8B" },
    { id: "llama3-70b-8192", label: "LLaMA3 70B" },
    { id: "mistral-saba-24b", label: "Mistral Saba 24B" },
    { id: "gemma-9b-it", label: "Gemma 9B IT" }
    ]
  },
  // 其余常见 openai-compatible 平台（给出代表性模型，避免过长）
  {
    providerName: "Mistral",
    models: [
    { id: "pixtral-12b-2409", label: "Pixtral 12B [Free]" },
    { id: "pixtral-large-latest", label: "Pixtral Large" },
    { id: "ministral-3b-latest", label: "Mistral 3B [Free]" },
    { id: "ministral-8b-latest", label: "Mistral 8B [Free]" },
    { id: "codestral-latest", label: "Mistral Codestral" },
    { id: "mistral-large-latest", label: "Mistral Large" },
    { id: "mistral-small-latest", label: "Mistral Small" },
    { id: "open-mistral-nemo", label: "Mistral Nemo" },
    { id: "mistral-embed", label: "Mistral Embedding" }
    ]
  },
  {
    providerName: "Perplexity",
    models: [
    { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
    { id: "sonar-reasoning", label: "Sonar Reasoning" },
    { id: "sonar-pro", label: "Sonar Pro" },
    { id: "sonar", label: "Sonar" },
    { id: "sonar-deep-research", label: "Sonar Deep Research" }
    ]
  },
  {
    providerName: "NVIDIA",
    models: [
    { id: "01-ai/yi-large", label: "Yi Large" },
    { id: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct" },
    { id: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct" }
    ]
  },
  {
    providerName: "Moonshot AI",
    models: [
    { id: "moonshot-v1-8k", label: "Moonshot v1 8k" },
    { id: "moonshot-v1-32k", label: "Moonshot v1 32k" },
      { id: "moonshot-v1-128k", label: "Moonshot v1 128k" },
      { id: "moonshot-v1-auto", label: "Moonshot v1 Auto" },
      { id: "kimi-k2-0711-preview", label: "Kimi K2 0711 Preview" }
    ]
  },
  {
    providerName: "ZhiPu",
    models: [
    { id: "glm-4.5", label: "GLM-4.5" },
      { id: "glm-4.5-flash", label: "GLM-4.5 Flash" },
    { id: "glm-4", label: "GLM-4" },
    { id: "glm-4-air", label: "GLM-4-Air" },
      { id: "glm-4-airx", label: "GLM-4-AirX" },
    { id: "glm-4-plus", label: "GLM-4-Plus" },
    { id: "glm-4v-flash", label: "GLM-4V-Flash" },
      { id: "glm-4v-plus-0111", label: "GLM-4V-Plus-0111" },
      { id: "glm-4-alltools", label: "GLM-4 AllTools" },
      { id: "glm-4-long", label: "GLM-4 Long" },
    { id: "embedding-3", label: "Embedding-3" }
    ]
  },
  {
    providerName: "StepFun",
    models: [
    { id: "step-1-8k", label: "Step 1 8K" },
      { id: "step-1-flash", label: "Step 1 Flash" },
      { id: "step-1o", label: "Step 1o" },
      { id: "step-1v", label: "Step 1v" }
    ]
  },
  {
    providerName: "MiniMax",
    models: [
      { id: "abab6.5s-chat", label: "abab6.5s Chat" },
      { id: "abab6.5g-chat", label: "abab6.5g Chat" },
      { id: "abab6.5t-chat", label: "abab6.5t Chat" },
      { id: "abab5.5s-chat", label: "abab5.5s Chat" },
      { id: "minimax-text-01", label: "minimax-01" },
    { id: "abab-embed-text-embedding-002", label: "Text Embedding 002" }
    ]
  },
  {
    providerName: "Jina",
    models: [
    { id: "jina-clip-v1", label: "Jina CLIP V1" },
    { id: "jina-clip-v2", label: "Jina CLIP V2" },
    { id: "jina-embeddings-v2-base-en", label: "Jina Embeddings V2 Base EN" },
    { id: "jina-embeddings-v2-base-es", label: "Jina Embeddings V2 Base ES" },
    { id: "jina-embeddings-v2-base-de", label: "Jina Embeddings V2 Base DE" },
    { id: "jina-embeddings-v2-base-zh", label: "Jina Embeddings V2 Base ZH" },
    { id: "jina-embeddings-v2-base-code", label: "Jina Embeddings V2 Base Code" },
    { id: "jina-embeddings-v3", label: "Jina Embeddings V3" },
    { id: "jina-reranker-m0", label: "Jina Reranker M0" }
    ]
  },
  {
    providerName: "Together",
    models: [
    { id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", label: "Llama 3.1 70B Instruct Turbo" },
      { id: "mistralai/Mistral-Nemo-Instruct-2407", label: "Mistral Nemo Instruct 2407" },
      { id: "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo", label: "Llama 3.2 11B Vision" },
      { id: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo", label: "Llama 3.2 90B Vision" },
      { id: "google/gemma-2-27b-it", label: "Gemma 2 27B IT" },
      { id: "google/gemma-2-9b-it", label: "Gemma 2 9B IT" }
    ]
  },
  {
    providerName: "Fireworks",
    models: [
    { id: "accounts/fireworks/models/llama-v3p1-70b-instruct", label: "Llama 3.1 70B Instruct" },
      { id: "accounts/fireworks/models/mixtral-8x22b-instruct", label: "Mixtral 8x22B Instruct" },
      { id: "accounts/fireworks/models/llama-v3-70b-instruct", label: "Llama 3 70B Instruct" },
      { id: "accounts/fireworks/models/mythomax-l2-13b", label: "mythomax-l2-13b" }
    ]
  },
  {
    providerName: "ModelScope",
    models: [
    { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen2.5 72B Instruct" },
    { id: "Qwen/Qwen2.5-VL-72B-Instruct", label: "Qwen2.5 VL 72B Instruct" },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen2.5 Coder 32B Instruct" },
    { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1" },
    { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3" }
    ]
  },
  {
    providerName: "Bailian",
    models: [
    { id: "qwen-vl-plus", label: "Qwen-VL Plus" },
    { id: "qwen-coder-plus", label: "Qwen Coder Plus" },
    { id: "qwen-turbo", label: "Qwen Turbo" },
      { id: "qwen-turbo-latest", label: "Qwen Turbo (Latest)" },
    { id: "qwen-plus", label: "Qwen Plus" },
      { id: "qwen-plus-latest", label: "Qwen Plus (Latest)" },
      { id: "qwq", label: "QWQ" },
    { id: "qwen-max", label: "Qwen Max" }
    ]
  },
  {
    providerName: "PPIO",
    models: [
    { id: "deepseek/deepseek-r1-0528", label: "DeepSeek R1 (0528)" },
      { id: "deepseek-v3", label: "DeepSeek V3" },
      { id: "deepseek/deepseek-r1/community", label: "DeepSeek R1 (Community)" },
      { id: "deepseek/deepseek-v3/community", label: "DeepSeek V3 (Community)" },
      { id: "minimaxai/minimax-m1-80k", label: "MiniMax M1 80K" },
      { id: "qwen/qwen3-235b-a22b-fp8", label: "Qwen3 235B FP8" },
      { id: "qwen/qwen3-32b-fp8", label: "Qwen3 32B FP8" },
      { id: "qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B A3B FP8" },
      { id: "qwen/qwen2.5-vl-72b-instruct", label: "Qwen2.5 VL 72B Instruct" },
      { id: "qwen/qwen3-embedding-8b", label: "Qwen3 Embedding 8B" },
      { id: "qwen/qwen3-reranker-8b", label: "Qwen3 Reranker 8B" }
    ]
  },
  {
    providerName: "DMXAPI",
    models: [
    { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen2.5 7B Instruct" },
    { id: "ERNIE-Speed-128K", label: "ERNIE Speed 128K" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "DMXAPI-DeepSeek-R1", label: "DeepSeek R1" },
    { id: "DMXAPI-DeepSeek-V3", label: "DeepSeek V3" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (20241022)" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }
    ]
  },
  // —— 以下为新增补全，确保与 catalog 名称一一对应 ——
  {
    providerName: "Grok",
    models: [
    { id: "grok-4", label: "Grok 4" },
    { id: "grok-3", label: "Grok 3" },
    { id: "grok-3-fast", label: "Grok 3 Fast" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-3-mini-fast", label: "Grok 3 Mini Fast" },
    { id: "grok-2-vision-1212", label: "Grok 2 Vision 1212" },
    { id: "grok-2-1212", label: "Grok 2 1212" }
    ]
  },
  {
    providerName: "Silicon",
    models: [
    { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1" },
    { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3" },
    { id: "Qwen/Qwen3-8B", label: "Qwen3 8B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen2.5 72B Instruct" },
    { id: "Kwai-Kolors/Kolors", label: "Kolors" }
    ]
  },
  {
    providerName: "BurnCloud",
    models: [
    { id: "claude-3-7-sonnet-20250219-thinking", label: "Claude 3.7 thinking" },
    { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4.5-preview", label: "GPT-4.5 Preview" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "o3-mini", label: "o3-mini" },
      { id: "gemini-2.5-pro-preview-03-25", label: "Gemini 2.5 Pro Preview (03-25)" },
      { id: "gemini-2.5-pro-exp-03-25", label: "Gemini 2.5 Pro Exp (03-25)" },
      { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
      { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "deepseek-v3", label: "DeepSeek V3" }
    ]
  },
  {
    providerName: "AlayaNew",
    models: [
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "deepseek-chat", label: "DeepSeek Chat" }
    ]
  },
  {
    providerName: "Hyperbolic",
    models: [
      { id: "Qwen/Qwen2-VL-72B-Instruct", label: "Qwen2-VL 72B Instruct" },
      { id: "Qwen/Qwen2-VL-7B-Instruct", label: "Qwen2-VL 7B Instruct" },
      { id: "mistralai/Pixtral-12B-2409", label: "Pixtral 12B 2409" },
      { id: "meta-llama/Meta-Llama-3.1-405B", label: "Meta-Llama 3.1 405B" }
    ]
  },
  {
    providerName: "LANYUN",
    models: [
    { id: "/maas/deepseek-ai/DeepSeek-R1-0528", label: "DeepSeek R1" },
    { id: "/maas/deepseek-ai/DeepSeek-V3-0324", label: "DeepSeek V3" },
    { id: "/maas/qwen/Qwen2.5-72B-Instruct", label: "Qwen2.5 72B Instruct" },
    { id: "/maas/qwen/Qwen3-235B-A22B", label: "Qwen3 235B A22B" },
    { id: "/maas/minimax/MiniMax-M1-80k", label: "MiniMax M1 80k" },
    { id: "/maas/google/Gemma3-27B", label: "Gemma3 27B" }
    ]
  },
  {
    providerName: "Cephalon",
    models: [
    { id: "DeepSeek-R1", label: "DeepSeek-R1满血版" }
    ]
  },
  {
    providerName: "BAICHUAN AI",
    models: [
    { id: "Baichuan4", label: "Baichuan 4" },
    { id: "Baichuan3-Turbo", label: "Baichuan3 Turbo" },
    { id: "Baichuan3-Turbo-128k", label: "Baichuan3 Turbo 128k" }
    ]
  },
  {
    providerName: "Infini",
    models: [
    { id: "deepseek-r1", label: "DeepSeek R1" },
    { id: "deepseek-r1-distill-qwen-32b", label: "DeepSeek R1 Distill Qwen 32B" },
    { id: "deepseek-v3", label: "DeepSeek V3" },
    { id: "qwen2.5-72b-instruct", label: "Qwen2.5 72B Instruct" },
    { id: "qwen2.5-32b-instruct", label: "Qwen2.5 32B Instruct" },
    { id: "qwen2.5-14b-instruct", label: "Qwen2.5 14B Instruct" },
    { id: "qwen2.5-7b-instruct", label: "Qwen2.5 7B Instruct" },
    { id: "qwen2-72b-instruct", label: "Qwen2 72B Instruct" },
    { id: "qwq-32b-preview", label: "QWQ 32B Preview" },
    { id: "qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B Instruct" },
    { id: "llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
    { id: "bge-m3", label: "BGE M3" },
    { id: "gemma-2-27b-it", label: "Gemma 2 27B IT" },
    { id: "jina-embeddings-v2-base-zh", label: "Jina Embeddings V2 Base ZH" },
    { id: "jina-embeddings-v2-base-code", label: "Jina Embeddings V2 Base Code" }
    ]
  },
  {
    providerName: "Xirang",
    models: []
  },
  {
    providerName: "hunyuan",
    models: [
    { id: "hunyuan-pro", label: "Hunyuan Pro" },
    { id: "hunyuan-standard", label: "Hunyuan Standard" },
    { id: "hunyuan-lite", label: "Hunyuan Lite" },
    { id: "hunyuan-standard-256k", label: "Hunyuan Standard 256K" },
    { id: "hunyuan-vision", label: "Hunyuan Vision" },
    { id: "hunyuan-code", label: "Hunyuan Code" },
    { id: "hunyuan-role", label: "Hunyuan Role" },
    { id: "hunyuan-turbo", label: "Hunyuan Turbo" },
    { id: "hunyuan-turbos-latest", label: "Hunyuan Turbos Latest" },
    { id: "hunyuan-embedding", label: "Hunyuan Embedding" }
    ]
  },
  {
    providerName: "Tencent Cloud TI",
    models: [
    { id: "deepseek-r1", label: "DeepSeek R1" },
    { id: "deepseek-v3", label: "DeepSeek V3" }
    ]
  },
  {
    providerName: "Baidu Cloud",
    models: [
    { id: "deepseek-r1", label: "DeepSeek R1" },
    { id: "deepseek-v3", label: "DeepSeek V3" },
    { id: "ernie-4.0-8k-latest", label: "ERNIE 4.0" },
    { id: "ernie-4.0-turbo-8k-latest", label: "ERNIE 4.0 Turbo" },
    { id: "ernie-speed-8k", label: "ERNIE Speed" },
    { id: "ernie-lite-8k", label: "ERNIE Lite" },
    { id: "bge-large-zh", label: "BGE Large ZH" },
    { id: "bge-large-en", label: "BGE Large EN" }
    ]
  },
  {
    providerName: "VoyageAI",
    models: [
    { id: "voyage-3-large", label: "Voyage 3 Large" },
    { id: "voyage-3", label: "Voyage 3" },
    { id: "voyage-3-lite", label: "Voyage 3 Lite" },
    { id: "voyage-code-3", label: "Voyage Code 3" },
    { id: "voyage-finance-3", label: "Voyage Finance 3" },
    { id: "voyage-law-2", label: "Voyage Law 2" },
    { id: "voyage-code-2", label: "Voyage Code 2" },
    { id: "rerank-2", label: "Rerank 2" },
    { id: "rerank-2-lite", label: "Rerank 2 Lite" }
    ]
  },
  {
    providerName: "Qiniu",
    models: [
    { id: "deepseek-r1", label: "DeepSeek R1" },
    { id: "deepseek-r1-search", label: "DeepSeek R1 Search" },
    { id: "deepseek-r1-32b", label: "DeepSeek R1 32B" },
    { id: "deepseek-v3", label: "DeepSeek V3" },
    { id: "deepseek-v3-search", label: "DeepSeek V3 Search" },
    { id: "deepseek-v3-tool", label: "DeepSeek V3 Tool" },
    { id: "qwq-32b", label: "QWQ 32B" },
    { id: "qwen2.5-72b-instruct", label: "Qwen2.5 72B Instruct" },
    { id: "qwen-plus", label: "Qwen Plus" }
    ]
  },
  {
    providerName: "PH8",
    models: [
    { id: "deepseek-v3-241226", label: "DeepSeek V3 241226" },
    { id: "deepseek-r1-250120", label: "DeepSeek R1 250120" }
    ]
  },
  {
    providerName: "Azure OpenAI",
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-nano", label: "GPT-5 Nano" },
      { id: "gpt-5-mini", label: "GPT-5 Mini" },
    
      { id: "gpt-4.5", label: "GPT-4.5" },
      { id: "gpt-4.5-preview", label: "GPT-4.5 Preview" },
      
    { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" }
    ]
  },
  {
    providerName: "Lemonade",
    models: []
  },
  {
    providerName: "LM Studio",
    models: []
  },
  {
    providerName: "Ollama",
    models: []
  },
  {
    providerName: "Github Copilot",
    models: [
    { id: "gpt-4o-mini", label: "GPT-4o Mini" }
    ]
  },
{
  providerName: "GPT-GOD",
  models: [

    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-nano", label: "GPT-5 Nano" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
   
    { id: "gpt-4", label: "GPT-4" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4.5", label: "GPT-4.5" },
    { id: "gpt-4.5-preview", label: "GPT-4.5 Preview" },

    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
    { id: "gpt-3.5-turbo-16k", label: "GPT-3.5 Turbo 16K" },

  ]
},

  {
    providerName: "VertexAI",
    models: [
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }
    ]
  },
  {
    providerName: "AWS Bedrock",
    models: [
      { id: "anthropic.claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
      { id: "anthropic.claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
      { id: "anthropic.claude-3-5-haiku", label: "Claude 3.5 Haiku" },
      { id: "anthropic.claude-3-opus", label: "Claude 3 Opus" },
      { id: "meta.llama3-70b-instruct", label: "Llama 3 70B Instruct" },
      { id: "meta.llama3-8b-instruct", label: "Llama 3 8B Instruct" },
      { id: "meta.llama3.1-70b-instruct", label: "Llama 3.1 70B Instruct" },
      { id: "meta.llama3.1-8b-instruct", label: "Llama 3.1 8B Instruct" },
      { id: "mistral.mistral-large", label: "Mistral Large" },
      { id: "mistral.mixtral-8x7b-instruct", label: "Mixtral 8x7B Instruct" },
      { id: "cohere.command-r-plus", label: "Cohere Command R+" },
      { id: "cohere.command-r", label: "Cohere Command R" },
      { id: "ai21.jamba-1.5-large", label: "AI21 Jamba 1.5 Large" },
      { id: "ai21.jamba-1.5-mini", label: "AI21 Jamba 1.5 Mini" },
      { id: "amazon.nova-pro", label: "Amazon Nova Pro" },
      { id: "amazon.nova-lite", label: "Amazon Nova Lite" },
      { id: "amazon.nova-micro", label: "Amazon Nova Micro" },
      { id: "amazon.titan-text-express", label: "Amazon Titan Text Express" },
      { id: "amazon.titan-embed-text-v2", label: "Amazon Titan Embeddings V2" }
    ]
  },
  {
    providerName: "GPUStack",
    models: []
  },
  {
    providerName: "New API",
    models: []
  },
  {
    providerName: "Poe",
    models: [
      // Poe 官方机器人名称即为 ID（保持大小写与连字符）
      { id: "App-Creator", label: "App-Creator" },
      { id: "ChatGPT-5", label: "ChatGPT-5" },
      { id: "GPT-5", label: "GPT-5" },
      { id: "Claude-Sonnet-4", label: "Claude-Sonnet-4" },
      { id: "Claude-Opus-4.1", label: "Claude-Opus-4.1" },
      { id: "Gemini-2.5-Pro", label: "Gemini-2.5-Pro" },
      { id: "Grok-4", label: "Grok-4" },
      { id: "GPT-5-mini", label: "GPT-5-mini" },
      { id: "GPT-4o", label: "GPT-4o" },
      { id: "GPT-5-nano", label: "GPT-5-nano" },
      { id: "o3-pro", label: "o3-pro" },
      { id: "GPT-OSS-120B-T", label: "GPT-OSS-120B-T" },
      { id: "Gemini-2.5-Flash", label: "Gemini-2.5-Flash" },
      { id: "Gemini-2.5-Flash-Lite-Preview", label: "Gemini-2.5-Flash-Lite-Preview" },
      { id: "GPT-Image-1", label: "GPT-Image-1" },
      { id: "DeepSeek-R1", label: "DeepSeek-R1" },
      { id: "DeepSeek-V3", label: "DeepSeek-V3" },
      { id: "Kimi-K2", label: "Kimi-K2" },
      { id: "Kimi-K2-T", label: "Kimi-K2-T" },
      { id: "o4-mini", label: "o4-mini" },
      { id: "GPT-4.1", label: "GPT-4.1" },
      { id: "o3", label: "o3" },
      { id: "Llama-4-Scout-B10", label: "Llama-4-Scout-B10" },
      { id: "Llama-4-Maverick", label: "Llama-4-Maverick" },
      { id: "Grok-3", label: "Grok-3" },
      { id: "Grok-3-Mini", label: "Grok-3-Mini" },
      { id: "o3-deep-research", label: "o3-deep-research" },
      { id: "o4-mini-deep-research", label: "o4-mini-deep-research" },
      { id: "Claude-Opus-4", label: "Claude-Opus-4" },
      { id: "Claude-Opus-4-Reasoning", label: "Claude-Opus-4-Reasoning" },
      { id: "Claude-Sonnet-4-Reasoning", label: "Claude-Sonnet-4-Reasoning" },
      { id: "Deepseek-V3-FW", label: "Deepseek-V3-FW" },
      { id: "GPT-4.1-mini", label: "GPT-4.1-mini" },
      { id: "GPT-4.1-nano", label: "GPT-4.1-nano" },
      { id: "Llama-4-Scout-T", label: "Llama-4-Scout-T" },
      { id: "Llama-3-70b-Groq", label: "Llama-3-70b-Groq" },
      { id: "Llama-4-Scout-CS", label: "Llama-4-Scout-CS" },
      { id: "Claude-Sonnet-3.7", label: "Claude-Sonnet-3.7" },
      { id: "Claude-Sonnet-3.5", label: "Claude-Sonnet-3.5" },
      { id: "Claude-Haiku-3.5", label: "Claude-Haiku-3.5" },
      { id: "Claude-Opus-4-Search", label: "Claude-Opus-4-Search" },
      { id: "Claude-Sonnet-4-Search", label: "Claude-Sonnet-4-Search" },
      { id: "Gemini-2.0-Flash-Lite", label: "Gemini-2.0-Flash-Lite" },
      { id: "Claude-Sonnet-3.7-Search", label: "Claude-Sonnet-3.7-Search" },
      { id: "Claude-Sonnet-3.5-Search", label: "Claude-Sonnet-3.5-Search" },
      { id: "Claude-Haiku-3.5-Search", label: "Claude-Haiku-3.5-Search" },
      { id: "Gemini-2.0-Flash", label: "Gemini-2.0-Flash" },
      { id: "Gemini-2.0-Flash-Preview", label: "Gemini-2.0-Flash-Preview" },
      { id: "GLM-4.5", label: "GLM-4.5" },
      { id: "OpenAI-GPT-OSS-120B", label: "OpenAI-GPT-OSS-120B" },
      { id: "OpenAI-GPT-OSS-20B", label: "OpenAI-GPT-OSS-20B" },
      { id: "Qwen-3-235B-2507-T", label: "Qwen-3-235B-2507-T" },
      { id: "Qwen3-235B-2507-FW", label: "Qwen3-235B-2507-FW" },
      { id: "Qwen3-Coder-480B-FW", label: "Qwen3-Coder-480B-FW" },
      { id: "Qwen3-235B-A22B", label: "Qwen3-235B-A22B" },
      { id: "Qwen3-235B-A22B-DI", label: "Qwen3-235B-A22B-DI" },
      { id: "QwQ-32B-T", label: "QwQ-32B-T" },
      { id: "MiniMax-M1", label: "MiniMax-M1" },
      { id: "o1", label: "o1" },
      { id: "o1-pro", label: "o1-pro" },
      { id: "o1-mini", label: "o1-mini" },
      { id: "ChatGPT-4o-Latest", label: "ChatGPT-4o-Latest" },
      { id: "GPT-4o-mini", label: "GPT-4o-mini" },
      { id: "o3-mini-high", label: "o3-mini-high" },
      { id: "o3-mini", label: "o3-mini" },
      { id: "Claude-Sonnet-3.7-Reasoning", label: "Claude-Sonnet-3.7-Reasoning" },
      { id: "Inception-Mercury-Coder", label: "Inception-Mercury-Coder" },
      { id: "Mistral-Medium", label: "Mistral-Medium" },
      { id: "Llama-4-Scout", label: "Llama-4-Scout" },
      { id: "Llama-4-Maverick-T", label: "Llama-4-Maverick-T" },
      { id: "Llama-3.3-70B-FW", label: "Llama-3.3-70B-FW" },
      { id: "Llama-3.3-70B", label: "Llama-3.3-70B" },
      { id: "DeepSeek-R1-FW", label: "DeepSeek-R1-FW" },
      { id: "DeepSeek-R1-DI", label: "DeepSeek-R1-DI" },
      { id: "GPT-Researcher", label: "GPT-Researcher" },
      { id: "Gemini-1.5-Pro", label: "Gemini-1.5-Pro" },
      { id: "Web-Search", label: "Web-Search" },
      { id: "GPT-4o-Search", label: "GPT-4o-Search" },
      { id: "GPT-4o-mini-Search", label: "GPT-4o-mini-Search" },
      { id: "Reka-Research", label: "Reka-Research" },
      { id: "Perplexity-Sonar", label: "Perplexity-Sonar" },
      { id: "Perplexity-Sonar-Pro", label: "Perplexity-Sonar-Pro" },
      { id: "PPLX-Sonar-Rsn-Pro", label: "PPLX-Sonar-Rsn-Pro" },
      { id: "Perplexity-Sonar-Rsn", label: "Perplexity-Sonar-Rsn" },
      { id: "FLUX-pro-1.1-ultra", label: "FLUX-pro-1.1-ultra" },
      { id: "DeepSeek-R1-Distill", label: "DeepSeek-R1-Distill" },
      { id: "Mistral-Small-3.2", label: "Mistral-Small-3.2" },
      { id: "Mistral-Small-3.1", label: "Mistral-Small-3.1" },
      { id: "Mistral-NeMo", label: "Mistral-NeMo" },
      { id: "Llama-3.3-70B-Vers", label: "Llama-3.3-70B-Vers" },
      { id: "PPLX-Deep-Research", label: "PPLX-Deep-Research" },
      { id: "Claude-Opus-3", label: "Claude-Opus-3" },
      { id: "PlayAI-Dialog", label: "PlayAI-Dialog" },
      { id: "PlayAI-TTS", label: "PlayAI-TTS" },
      { id: "Unreal-Speech-TTS", label: "Unreal-Speech-TTS" },
      { id: "Hailuo-Speech-02", label: "Hailuo-Speech-02" },
      { id: "ElevenLabs", label: "ElevenLabs" },
      { id: "Cartesia", label: "Cartesia" },
      { id: "Orpheus-TTS", label: "Orpheus-TTS" },
      { id: "Imagen-4-Ultra-Exp", label: "Imagen-4-Ultra-Exp" },
      { id: "Imagen-4-Fast", label: "Imagen-4-Fast" },
      { id: "Imagen-4", label: "Imagen-4" },
      { id: "Phoenix-1.0", label: "Phoenix-1.0" },
      { id: "Flux-Kontext-Max", label: "Flux-Kontext-Max" },
      { id: "Flux-Kontext-Pro", label: "Flux-Kontext-Pro" },
      { id: "Imagen-3", label: "Imagen-3" },
      { id: "Imagen-3-Fast", label: "Imagen-3-Fast" },
      { id: "Inception-Mercury", label: "Inception-Mercury" },
      { id: "Ideogram-v3", label: "Ideogram-v3" },
      { id: "Ideogram-v2", label: "Ideogram-v2" },
      { id: "FLUX-dev-DI", label: "FLUX-dev-DI" },
      { id: "FLUX-schnell-DI", label: "FLUX-schnell-DI" },
      { id: "FLUX-pro-1.1", label: "FLUX-pro-1.1" },
      { id: "Luma-Photon", label: "Luma-Photon" },
      { id: "Luma-Photon-Flash", label: "Luma-Photon-Flash" },
      { id: "Hidream-I1-full", label: "Hidream-I1-full" },
      { id: "Retro-Diffusion-Core", label: "Retro-Diffusion-Core" },
      { id: "StableDiffusion3.5-L", label: "StableDiffusion3.5-L" },
      { id: "FLUX-pro", label: "FLUX-pro" },
      { id: "FLUX-schnell", label: "FLUX-schnell" },
      { id: "Kling-2.1-Master", label: "Kling-2.1-Master" },
      { id: "Hailuo-02", label: "Hailuo-02" },
      { id: "Hailuo-Director-01", label: "Hailuo-Director-01" },
      { id: "Pixverse-v4.5", label: "Pixverse-v4.5" },
      { id: "FLUX-dev", label: "FLUX-dev" },
      
    ]
  }
] as const;

// 从静态清单推导强类型的 ProviderName（数组元素字面量推断）
export type ProviderName = typeof STATIC_PROVIDER_MODELS[number]["providerName"];

// 工具函数：安全获取某 Provider 的静态模型列表
export function getStaticModels(provider: ProviderName | string): StaticModelDef[] {
  const entry = (STATIC_PROVIDER_MODELS as readonly { providerName: string; models: readonly Readonly<StaticModelDef>[] }[])
    .find((p) => p.providerName === provider);
  return entry ? (entry.models as StaticModelDef[]).slice() : [];
}

// 工具常量：已收录的 Provider 名称（展示名）
export const KNOWN_STATIC_MODEL_PROVIDERS: ProviderName[] = (STATIC_PROVIDER_MODELS.map(p => p.providerName));

// —— 模型能力归类（正则优先 + 手动补充）——

export type ModelCapabilityFlags = {
  supportsThinking: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  supportsEmbedding: boolean;
  supportsRerank: boolean;
  supportsWebSearch: boolean;
  supportsImageGeneration: boolean;
  supportsAudioIn: boolean;
  supportsAudioOut: boolean;
  supportsVideoGeneration: boolean;
  supportsJSONMode: boolean;
  supportsReasoningControl: boolean;
  notSupportTextDelta?: boolean;
  notSupportSystemMessage?: boolean;
};

function toLowerBaseId(modelId: string): { raw: string; base: string } {
  const raw = (modelId || '').trim();
  const base = raw.split('/').pop() || raw;
  return { raw: raw.toLowerCase(), base: base.toLowerCase() };
}

// —— 模型品牌 Logo 匹配（首个出现的品牌优先）——

type BrandRule = { logoKey: string; patterns: readonly RegExp[] };

const BRAND_LOGO_RULES: readonly BrandRule[] = [
  { logoKey: 'openai', patterns: [/\bopenai\b/i, /\bchatgpt\b/i, /\bgpt-?\d/i, /^o[134](?:-|$)/i, /gpt-image-1/i] },
  { logoKey: 'anthropic', patterns: [/\banthropic\b/i, /\bclaude\b/i] },
  { logoKey: 'google-ai', patterns: [/\bgemini\b/i, /\bgoogle\//i, /\bgoogle\b/i] },
  // 谷歌家族中的 Gemma 单独识别为 gemma（如存在 /llm-provider-icon/gemma.svg 将直接命中）
  { logoKey: 'gemma', patterns: [/\bgemma\b/i] },
  { logoKey: 'deepseek', patterns: [/\bdeepseek\b/i] },
  // 放宽 Qwen 匹配，支持 qwen2.5 / qwen3 等前缀形式
  { logoKey: 'qwen', patterns: [/qwen/i, /\bqwq\b/i] },
  { logoKey: 'mistral', patterns: [/\bmistral\b/i, /\bmixtral\b/i, /\bcodestral\b/i, /\bpixtral\b/i] },
  { logoKey: 'groq', patterns: [/\bgroq\b/i] },
  // 支持 glm4 / glm-4 等
  { logoKey: 'zhipu', patterns: [/glm-?\d/i, /zhipu/i] },
  { logoKey: 'moonshot', patterns: [/moonshot/i, /kimi/i] },
  { logoKey: 'yi', patterns: [/yi-\w+/i, /01-ai\//i] },
  // 放宽 Llama 匹配，支持 llama3 / llama-3 等
  { logoKey: 'llama', patterns: [/llama/i] },
  { logoKey: 'voyageai', patterns: [/voyage/i] },
  { logoKey: 'cohere', patterns: [/cohere/i, /command-r/i] },
  { logoKey: 'perplexity', patterns: [/perplexity/i, /sonar/i, /pplx/i] },
  { logoKey: 'jina', patterns: [/jina/i] },
  { logoKey: 'stability', patterns: [/stability/i, /stable[- ]?diffusion|sd[23x]?/i] },
  { logoKey: 'ideogram', patterns: [/ideogram/i] },
  { logoKey: 'flux', patterns: [/flux/i] },
  { logoKey: 'imagen', patterns: [/imagen/i] },
  { logoKey: 'luma', patterns: [/luma/i, /photon/i] },
  { logoKey: 'runway', patterns: [/runway/i] },
  { logoKey: 'sora', patterns: [/sora/i] },
  { logoKey: 'veo', patterns: [/veo/i] },
  { logoKey: 'kling', patterns: [/kling/i] },
  { logoKey: 'pixverse', patterns: [/pixverse/i] },
  { logoKey: 'hunyuan', patterns: [/hunyuan/i] },
  { logoKey: 'doubao', patterns: [/doubao/i] },
  { logoKey: 'baichuan', patterns: [/baichuan/i] },
  { logoKey: 'reka', patterns: [/reka/i] },
  { logoKey: 'elevenlabs', patterns: [/elevenlabs/i] },
  { logoKey: 'topazlabs', patterns: [/topazlabs/i] },
  { logoKey: 'clarity', patterns: [/clarity[- ]?upscaler/i] },
  { logoKey: 'cartesia', patterns: [/cartesia/i] },
  { logoKey: 'orpheus', patterns: [/orpheus[- ]?tts/i] },
  { logoKey: 'playai', patterns: [/playai/i] },
  { logoKey: 'unreal-speech', patterns: [/unreal[- ]?speech/i] },
  { logoKey: 'together', patterns: [/together/i] },
  { logoKey: 'openrouter', patterns: [/openrouter/i] },
  { logoKey: 'orcarouter', patterns: [/orcarouter/i] },
  { logoKey: 'mixroute', patterns: [/mixroute/i] },
  { logoKey: 'novita', patterns: [/novita/i] },
  { logoKey: 'poe', patterns: [/poe/i] },
];

function indexOfAny(text: string, patterns: readonly RegExp[]): number {
  let min = Infinity;
  for (const p of patterns) {
    const m = text.match(new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'));
    if (!m) continue;
    const idx = text.toLowerCase().indexOf(m[0].toLowerCase());
    if (idx >= 0 && idx < min) min = idx;
  }
  return min;
}

export function getModelLogoKey(modelId: string, opts?: { providerName?: string }): string {
  const src = (modelId || '').trim();
  if (!src) return opts?.providerName?.toLowerCase() || 'default';
  const text = src; // 保持大小写，搜索时统一做 toLowerCase 比较
  let best: { logoKey: string; idx: number } | null = null;
  for (const rule of BRAND_LOGO_RULES) {
    const idx = indexOfAny(text, rule.patterns);
    if (idx === Infinity) continue;
    if (!best || idx < best.idx) best = { logoKey: rule.logoKey, idx };
  }
  if (best) return best.logoKey;
  // 回退：用 providerName 作为 logoKey（转为常见 key），否则 default
  if (opts?.providerName) {
    const pn = opts.providerName.toLowerCase();
    if (pn.includes('google')) return 'google-ai';
    if (pn.includes('openai')) return 'openai';
    if (pn.includes('anthropic')) return 'anthropic';
    if (pn.includes('deepseek')) return 'deepseek';
    return pn;
  }
  return 'default';
}

export function getModelDisplayInfo(modelId: string, opts?: { providerName?: string }) {
  return {
    id: modelId,
    logoKey: getModelLogoKey(modelId, opts),
    capabilities: getModelCapabilities(modelId),
  };
}

// —— Logo 资源包装 ——
export type LogoAssetOptions = {
  providerName?: string;
  prefer?: 'svg' | 'png';
  dirs?: readonly string[]; // public 下的相对路径，形如 "/llm-provider-icon"
  fallbackSrc?: string; // 找不到时兜底
};

export type LogoAsset = {
  src: string; // 最终给 <img src> / Next <Image src>
  format: 'svg' | 'png';
  logoKey: string; // 用于调试或后续处理
};

/**
 * 返回模型对应的品牌 Logo 资源路径。规则：
 * 1) 根据模型名获取 logoKey
 * 2) 依偏好扩展名（默认 svg）与目录列表组合出候选路径
 * 3) 返回第一个候选项；若你确认存在性，可按需在外部做 HEAD 检查；否则回退到 fallback
 */
export function getModelLogoAsset(modelId: string, opts?: LogoAssetOptions): LogoAsset {
  const logoKey = getModelLogoKey(modelId, { providerName: opts?.providerName });
  const prefer: 'svg' | 'png' = opts?.prefer ?? 'svg';
  const exts = prefer === 'svg' ? (['svg', 'png'] as const) : (['png', 'svg'] as const);
  const dirs = opts?.dirs ?? [
    '/llm-provider-icon', // 项目已有目录
    '/logos',
    '/images/brands',
  ];

  // 构造候选 src 列表（不做文件存在性检查，交由部署端保障或由调用方兜底）
  const candidates: { src: string; format: 'svg' | 'png' }[] = [];
  for (const dir of dirs) {
    for (const ext of exts) {
      candidates.push({ src: `${dir}/${logoKey}.${ext}`, format: ext });
    }
  }

  // 直接返回第一个候选；若使用方需要存在性验证，可在外部添加 fetch/HEAD 检测
  const picked = candidates[0] ?? { src: '', format: prefer };
  const fallbackSrc = opts?.fallbackSrc ?? '/logo.svg';
  return {
    src: picked.src || fallbackSrc,
    format: picked.format,
    logoKey,
  };
}

function matchAny(patterns: readonly RegExp[], text: string): boolean {
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

// 视觉（多模态）模型（简化版，聚合常见关键词）
export const VISION_MODEL_PATTERNS: readonly RegExp[] = [
  /vision/i,
  /gpt-4o(?:-[\w-]+)?/i,
  /gpt-4\.1(?:-[\w-]+)?/i,
  /gpt-5(?:-[\w-]+)?/i,
  /gemini-1\.5/i,
  /gemini-2\./i,
  /llava/i,
  /vl(?:-[\w-]+)?$/i,
  /qwen2\.5-vl/i,
  /qwen3-vl/i,
  /llama.*vision/i,
  /claude-(?:opus|sonnet)-4/i,
  /claude-3-(?:opus|sonnet|haiku)/i,
  /claude-3-5-(?:sonnet|haiku)/i,
  /claude-3-7-sonnet/i,
  /pixtral/i,
  /glm-4v/i,
  /yi-vision/i,
  /kimi-k2/i,
];

// 嵌入模型
export const EMBEDDING_MODEL_PATTERNS: readonly RegExp[] = [
  /(?:^text-|embed|embedding|bge-|e5-|jina-embeddings|retrieval|uae-|gte-|voyage-)/i,
  /titan-embed/i,
];

// 排序/重排模型
export const RERANK_MODEL_PATTERNS: readonly RegExp[] = [
  /rerank|re-rank|re-ranker|re-ranking|retriever/i,
];

// 以"思考/推理"能力为导向的模型（总体）
export const REASONING_MODEL_PATTERNS: readonly RegExp[] = [
  /^o\d+(?:-[\w-]+)?$/i,           // o1 / o3 / o4 家族
  /reasoning|reasoner|thinking/i,   // 名称包含 reasoning/think
  /-r\d+/i,                        // -r1 / -r2 类似标记
  /qwq(?:-[\w-]+)?/i,
  /grok-(?:3-mini|4)(?:-[\w-]+)?/i,
  /grok-4/i,
];

// 手动补充：一律视为"支持思考/推理"的模型（变体包含）
export const ALWAYS_THINKING_MODEL_PATTERNS: readonly RegExp[] = [
  /deepseek[-/ ]?r1/i,              // DeepSeek R1 全变体
  /deepseek\W*r1\W*distill/i,
  /gemini-2\.5-pro/i,              // Gemini 2.5 Pro
  /gemini-2\.5-flash/i,            // Gemini 2.5 Flash (支持思考模式)
  /claude-.*\b(opus|sonnet)-4\b/i, // Claude Opus/Sonnet 4 系列
  /claude-3-7-sonnet/i,            // Claude 3.7 Sonnet (支持扩展思考)
  /sonar-.*reason/i,                // Perplexity Sonar Reasoning 系列
  /kimi-k2/i,                       // Kimi K2 (支持思考)
  /step-1o/i,                       // Step 1o (推理模型)
  /gpt-5/i,                         // GPT-5 系列 (假设支持)
];

// 函数调用（工具调用）模型（宽松识别）
export const FUNCTION_CALLING_MODEL_PATTERNS: readonly RegExp[] = [
  /gpt-4o(?:-[\w-]+)?/i,
  /gpt-4\.1(?:-[\w-]+)?/i,
  /gpt-4\.5(?:-[\w-]+)?/i,
  /gpt-5(?:-[\w-]+)?/i,
  /^o[134](?:-[\w-]+)?$/i,
  /claude/i,
  /qwen/i,
  /gemini/i,
  /grok-3|grok-4/i,
  /glm-4(?:\.|-|$)/i,
  /glm-4\.5/i,
  /doubao/i,
  /llama-3(?:\.\d+)?-(?:70b|405b)/i,
  /llama-4/i,
  /mistral-large/i,
  /mixtral/i,
  /deepseek-(?:chat|v3)/i,
  /kimi-k2/i,
  /moonshot/i,
  /minimax/i,
];

// 图像生成模型
export const IMAGE_GENERATION_MODEL_PATTERNS: readonly RegExp[] = [
  /gpt-image-1/i,
  /dall[- ]?e/i,
  /flux/i,
  /imagen/i,
  /ideogram/i,
  /stability|stable[- ]?diffusion|sd[23x]?/i,
  /luma|kling|pixverse|runway|sora/i,
];

// Web 搜索类
export const WEB_SEARCH_MODEL_PATTERNS: readonly RegExp[] = [
  /web[- ]?search/i,
  /gpt-4o-.*search/i,
  /sonar/i,
  /reka-?research/i,
  /deep-?research/i,
];

// 音频输入（语音转文本等）
export const AUDIO_IN_MODEL_PATTERNS: readonly RegExp[] = [
  /whisper/i,
  /speech[- ]?to[- ]?text/i,
  /flashaudio/i,
];

// 音频输出（文本转语音等）
export const AUDIO_OUT_MODEL_PATTERNS: readonly RegExp[] = [
  /tts/i,
  /elevenlabs/i,
  /playai[- ]?tts/i,
  /unreal[- ]?speech[- ]?tts/i,
  /cartesia/i,
  /orpheus[- ]?tts/i,
];

// 视频生成
export const VIDEO_GENERATION_MODEL_PATTERNS: readonly RegExp[] = [
  /kling|pixverse|runway|sora|veo|photon/i,
];

// 支持 JSON Mode（保守估计：主流通用 LLM 家族，排除搜索/图像/音频/视频专用）
export const JSON_MODE_MODEL_PATTERNS: readonly RegExp[] = [
  /gpt-4(?:\.|o|-)|gpt-3\.5|o[134](?:-[\w-]+)?/i,
  /claude/i,
  /gemini/i,
  /llama|mistral|mixtral|qwen|glm-4|deepseek|grok/i,
];

// 可控思考参数（thinkingBudget / reasoning_effort 等）
export const REASONING_CONTROL_MODEL_PATTERNS: readonly RegExp[] = [
  /claude.*(?:sonnet|opus)-4/i,
  /gemini-2\.5-(?:pro|flash)/i,
  /grok-4|grok-3(?:-mini)?/i,
];

// 例外项：某些模型不支持文本增量 / system message（按需扩展）
export const NO_TEXT_DELTA_PATTERNS: readonly RegExp[] = [
  /o1-(?:mini|preview)/i,
];
export const NO_SYSTEM_MESSAGE_PATTERNS: readonly RegExp[] = [
  /qwen-?mt/i,
  /gemma/i,
  /^o1(?:-|$)/i,
];

export function isEmbeddingModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  return matchAny(EMBEDDING_MODEL_PATTERNS, raw) || matchAny(EMBEDDING_MODEL_PATTERNS, base);
}

export function isRerankModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  return matchAny(RERANK_MODEL_PATTERNS, raw) || matchAny(RERANK_MODEL_PATTERNS, base);
}

export function isVisionModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  return matchAny(VISION_MODEL_PATTERNS, raw) || matchAny(VISION_MODEL_PATTERNS, base);
}

export function isImageGenModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  return matchAny(IMAGE_GENERATION_MODEL_PATTERNS, raw) || matchAny(IMAGE_GENERATION_MODEL_PATTERNS, base);
}

export function isWebSearchModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  return matchAny(WEB_SEARCH_MODEL_PATTERNS, raw) || matchAny(WEB_SEARCH_MODEL_PATTERNS, base);
}

export function isFunctionCallingModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  return matchAny(FUNCTION_CALLING_MODEL_PATTERNS, raw) || matchAny(FUNCTION_CALLING_MODEL_PATTERNS, base);
}

export function isThinkingModelId(modelId: string): boolean {
  const { raw, base } = toLowerBaseId(modelId);
  if (matchAny(ALWAYS_THINKING_MODEL_PATTERNS, raw) || matchAny(ALWAYS_THINKING_MODEL_PATTERNS, base)) return true;
  if (matchAny(REASONING_MODEL_PATTERNS, raw) || matchAny(REASONING_MODEL_PATTERNS, base)) return true;
  return false;
}

export function getModelCapabilities(modelId: string): ModelCapabilityFlags {
  const supportsEmbedding = isEmbeddingModelId(modelId);
  const supportsRerank = !supportsEmbedding && isRerankModelId(modelId);
  const supportsVision = !supportsEmbedding && !supportsRerank && isVisionModelId(modelId);
  const supportsImageGeneration = isImageGenModelId(modelId);
  const supportsWebSearch = isWebSearchModelId(modelId);
  const supportsThinking = isThinkingModelId(modelId);
  const supportsFunctionCalling = isFunctionCallingModelId(modelId);
  const { raw, base } = toLowerBaseId(modelId);
  const supportsAudioIn = matchAny(AUDIO_IN_MODEL_PATTERNS, raw) || matchAny(AUDIO_IN_MODEL_PATTERNS, base);
  const supportsAudioOut = matchAny(AUDIO_OUT_MODEL_PATTERNS, raw) || matchAny(AUDIO_OUT_MODEL_PATTERNS, base);
  const supportsVideoGeneration = matchAny(VIDEO_GENERATION_MODEL_PATTERNS, raw) || matchAny(VIDEO_GENERATION_MODEL_PATTERNS, base);
  const supportsJSONMode = (!supportsImageGeneration && !supportsWebSearch && !supportsRerank && !supportsEmbedding) && (
    matchAny(JSON_MODE_MODEL_PATTERNS, raw) || matchAny(JSON_MODE_MODEL_PATTERNS, base)
  );
  const supportsReasoningControl = matchAny(REASONING_CONTROL_MODEL_PATTERNS, raw) || matchAny(REASONING_CONTROL_MODEL_PATTERNS, base);

  const notSupportTextDelta = matchAny(NO_TEXT_DELTA_PATTERNS, raw) || matchAny(NO_TEXT_DELTA_PATTERNS, base) || false;
  const notSupportSystemMessage = matchAny(NO_SYSTEM_MESSAGE_PATTERNS, raw) || matchAny(NO_SYSTEM_MESSAGE_PATTERNS, base) || false;

  return {
    supportsThinking,
    supportsFunctionCalling,
    supportsVision,
    supportsEmbedding,
    supportsRerank,
    supportsWebSearch,
    supportsImageGeneration,
    supportsAudioIn,
    supportsAudioOut,
    supportsVideoGeneration,
    supportsJSONMode,
    supportsReasoningControl,
    notSupportTextDelta,
    notSupportSystemMessage,
  };
}
