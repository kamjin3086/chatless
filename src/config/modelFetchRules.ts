/**
 * 由脚本自动导出生成。建议人工校对后提交。
 * 合并策略：仅覆盖本次导出中出现的 provider 规则键；未出现的键保持不变。
 */

export type ModelFetchRule = {
  useV1?: boolean;
  endpointSuffix?: string;
  modelsArrayPath?: string;
  idPath?: string;
  labelPath?: string;
  autoLabelFromId?: boolean;
};

export const MODEL_FETCH_RULES: Record<string, ModelFetchRule> = {
  "orcarouter - api": {
    "autoLabelFromId": false,
    "endpointSuffix": "/models",
    "idPath": "id",
    "labelPath": "name",
    "modelsArrayPath": "data"
  },
  "orcarouter - auth": {
    "autoLabelFromId": false,
    "endpointSuffix": "/models",
    "idPath": "id",
    "labelPath": "name",
    "modelsArrayPath": "data"
  },
  "deepseek": {
    "autoLabelFromId": true,
    "endpointSuffix": "/models",
    "idPath": "id",
    "labelPath": "",
    "modelsArrayPath": "data"
  },
  "gpt-god": {
    "autoLabelFromId": true,
    "endpointSuffix": "/models",
    "idPath": "name",
    "labelPath": "label",
    "modelsArrayPath": ""
  },
  "groq": {
    "autoLabelFromId": false,
    "endpointSuffix": "/models",
    "idPath": "id",
    "labelPath": "label",
    "modelsArrayPath": "data"
  },
  "openai": {
    "autoLabelFromId": true,
    "endpointSuffix": "/models",
    "idPath": "id",
    "modelsArrayPath": "data"
  },
  "gpt-load gemini": {
    "autoLabelFromId": true,
    "endpointSuffix": "/models",
    "idPath": "id",
    "modelsArrayPath": "data"
  },
  "gpt-load openai": {
    "autoLabelFromId": true,
    "endpointSuffix": "/models",
    "idPath": "id",
    "modelsArrayPath": "data"
  },
  "google ai": {
    "endpointSuffix": "/models",
    "idPath": "name",
    "labelPath": "displayName",
    "modelsArrayPath": "models"
  },
  "new api": {
    "autoLabelFromId": true,
    "endpointSuffix": "/models"
  }
};
