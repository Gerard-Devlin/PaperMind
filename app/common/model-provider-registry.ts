export type ModelProviderId =
  | "qwen"
  | "openai"
  | "deepseek"
  | "moonshot"
  | "openrouter"
  | "together"
  | "custom_openai_compatible";

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
    defaultAskModel: "qwen-plus",
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
    defaultAskModel: "deepseek-chat",
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
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    defaultAskModel: "openai/gpt-4.1-mini",
    defaultEmbeddingModel: "openai/text-embedding-3-large",
  },
  {
    id: "together",
    label: "Together AI",
    baseURL: "https://api.together.ai/v1",
    defaultAskModel: "meta-llama/Llama-3.1-70B-Instruct-Turbo",
    defaultEmbeddingModel: "togethercomputer/m2-bert-80M-8k-retrieval",
  },
  {
    id: "custom_openai_compatible",
    label: "Custom OpenAI-Compatible",
    baseURL: "http://localhost:11434/v1",
    defaultAskModel: "gpt-oss-20b",
    defaultEmbeddingModel: "text-embedding-3-small",
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

