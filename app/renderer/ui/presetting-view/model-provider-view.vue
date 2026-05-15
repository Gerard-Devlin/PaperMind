<script setup lang="ts">
import { BIconArrowRepeat, BIconCheck2Circle, BIconXCircle } from "bootstrap-icons-vue";
import { onMounted, ref } from "vue";
import {
  MODEL_PROVIDER_PRESETS,
  getModelProviderPreset,
  type ModelProviderId,
} from "@/common/model-provider-registry";
import qwenIcon from "@/renderer/assets/providers/qwen.png";
import deepseekIcon from "@/renderer/assets/providers/deepseek.svg";
import moonshotIcon from "@/renderer/assets/providers/moonshot.png";
import openaiIcon from "@/renderer/assets/providers/openai.svg";
import zhipuIcon from "@/renderer/assets/providers/Zhipu.svg";

const providerPresets = MODEL_PROVIDER_PRESETS;
const providerKeyDraft = ref<Record<string, string>>({});
const providerConnectivity = ref<Record<string, "checking" | "ok" | "fail">>({});

const providerIconPathMap: Partial<Record<ModelProviderId, string>> = {
  qwen: qwenIcon,
  openai: openaiIcon,
  deepseek: deepseekIcon,
  moonshot: moonshotIcon,
  zhipu: zhipuIcon,
};
const providerIconPath = (providerID: string) =>
  providerIconPathMap[providerID as ModelProviderId];

const loadProviderKeyState = async () => {
  const drafts = await Promise.all(
    providerPresets.map(async (provider) => {
      const key =
        (await PLMainAPI.preferenceService.getPassword(
          `modelProviderApiKey:${provider.id}`
        )) || "";
      return [provider.id, key] as const;
    })
  );
  providerKeyDraft.value = Object.fromEntries(drafts);
  await Promise.all(
    providerPresets.map(async (provider) => checkProviderConnectivity(provider.id))
  );
};

const onProviderKeyChange = (providerID: string, value: string) => {
  providerKeyDraft.value = {
    ...providerKeyDraft.value,
    [providerID]: value,
  };
};

const applyProviderDefaults = async (providerID: string) => {
  const preset = getModelProviderPreset(providerID);
  await PLMainAPI.preferenceService.set({
    askModelProvider: providerID,
    tagModelProvider: providerID,
    embeddingModelProvider: providerID,
    qwenAskBaseURL: preset.baseURL,
    qwenAITagBaseURL: preset.baseURL,
    qwenEmbeddingBaseURL: preset.baseURL,
    qwenAskModel: preset.defaultAskModel,
    qwenAITagModel: preset.defaultAskModel,
    qwenEmbeddingModel: preset.defaultEmbeddingModel,
  });
};

const onProviderKeySubmit = async (providerID: string, value: string) => {
  onProviderKeyChange(providerID, value);
  const trimmed = (providerKeyDraft.value[providerID] || "").trim();
  if (!trimmed) {
    providerConnectivity.value = {
      ...providerConnectivity.value,
      [providerID]: "fail",
    };
    return;
  }

  await PLMainAPI.preferenceService.setPassword(
    `modelProviderApiKey:${providerID}`,
    trimmed
  );
  await applyProviderDefaults(providerID);
  await checkProviderConnectivity(providerID);
};

const checkProviderConnectivity = async (providerID: string) => {
  providerConnectivity.value = {
    ...providerConnectivity.value,
    [providerID]: "checking",
  };
  try {
    const key =
      (await PLMainAPI.preferenceService.getPassword(
        `modelProviderApiKey:${providerID}`
      )) || "";
    if (!key.trim()) {
      providerConnectivity.value = {
        ...providerConnectivity.value,
        [providerID]: "fail",
      };
      return;
    }
    const baseURL = getModelProviderPreset(providerID).baseURL.replace(/\/+$/, "");
    const response = await fetch(`${baseURL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        "Content-Type": "application/json",
      },
    });
    providerConnectivity.value = {
      ...providerConnectivity.value,
      [providerID]: response.ok ? "ok" : "fail",
    };
  } catch {
    providerConnectivity.value = {
      ...providerConnectivity.value,
      [providerID]: "fail",
    };
  }
};

onMounted(() => {
  void loadProviderKeyState();
});
</script>

<template>
  <div class="flex flex-col">
    <div class="font-bold text-lg mb-2">
      {{ $t("semanticsearch.providerApiSectionTitle") }}
    </div>
    <div class="text-xs text-neutral-600 dark:text-neutral-400 mb-4">
      {{ $t("semanticsearch.providerInfo") }}
    </div>
    <div class="grid grid-cols-1 gap-2">
      <div
        v-for="provider in providerPresets"
        :key="`preset-provider-inline-${provider.id}`"
        class="rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-2 bg-neutral-100 dark:bg-neutral-700"
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-md bg-neutral-200 dark:bg-neutral-600 flex items-center justify-center shrink-0">
              <img
                v-if="providerIconPath(provider.id)"
                :src="providerIconPath(provider.id)"
                class="w-4 h-4 rounded-sm"
              />
            </div>
            <div class="text-sm font-medium truncate">{{ provider.label }}</div>
          </div>

          <div class="w-[50%] shrink-0 ml-auto">
            <input
              class="h-9 px-3 rounded-md text-xs bg-neutral-200 dark:bg-neutral-600 focus:outline-none w-full"
              type="password"
              placeholder="sk-..."
              :value="providerKeyDraft[provider.id] || ''"
              @input="
                (event) =>
                  onProviderKeyChange(
                    provider.id,
                    (event.target as HTMLInputElement).value
                  )
              "
              @keydown.enter="
                () =>
                  onProviderKeySubmit(
                    provider.id,
                    providerKeyDraft[provider.id] || ''
                  )
              "
              @change="
                (event) =>
                  onProviderKeySubmit(
                    provider.id,
                    (event.target as HTMLInputElement).value
                  )
              "
            />
          </div>

          <div class="flex justify-end w-5 shrink-0">
            <BIconArrowRepeat
              v-if="providerConnectivity[provider.id] === 'checking'"
              class="text-neutral-500 animate-spin"
            />
            <BIconCheck2Circle
              v-else-if="providerConnectivity[provider.id] === 'ok'"
              class="text-emerald-500"
            />
            <BIconXCircle v-else class="text-red-500" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
