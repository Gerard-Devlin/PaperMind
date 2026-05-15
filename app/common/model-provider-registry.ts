export type ModelProviderId =
  | "qwen"
  | "openai"
  | "deepseek"
  | "moonshot"
  | "zhipu";

export interface IModelProviderPreset {
  id: ModelProviderId;
  label: string;
  baseURL: string;
  defaultAskModel: string;
  defaultEmbeddingModel: string;
}

export const MODEL_PROVIDER_PRESETS: IModelProviderPreset[] = [
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultAskModel: "qwen3.6-flash",
    defaultEmbeddingModel: "text-embedding-v4",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultAskModel: "gpt-4.1-mini",
    defaultEmbeddingModel: "text-embedding-3-large",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    defaultAskModel: "deepseek-v4-flash",
    defaultEmbeddingModel: "text-embedding-3-large",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    baseURL: "https://api.moonshot.cn/v1",
    defaultAskModel: "moonshot-v1-8k",
    defaultEmbeddingModel: "text-embedding-3-large",
  },
  {
    id: "zhipu",
    label: "Zhipu (GLM)",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultAskModel: "glm-4.7-flash",
    defaultEmbeddingModel: "embedding-3",
  },
];

export function getModelProviderPreset(
  providerID: string | null | undefined
): IModelProviderPreset {
  return (
    MODEL_PROVIDER_PRESETS.find((preset) => preset.id === providerID) ||
    MODEL_PROVIDER_PRESETS[0]
  );
}
