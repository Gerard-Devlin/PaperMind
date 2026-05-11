<script setup lang="ts">
import {
  BIconArrowRepeat,
  BIconCheck2Circle,
  BIconSearch,
  BIconXCircle,
} from "bootstrap-icons-vue";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
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

import Toggle from "./components/toggle.vue";

const prefState = PLMainAPI.preferenceService.useState();
const { t } = useI18n();
const providerKeyStatus = ref<Record<string, boolean>>({});
const providerKeyDraft = ref<Record<string, string>>({});
const providerConnectivity = ref<Record<string, "checking" | "ok" | "fail">>({});
const indexing = ref(false);
const embeddingModelLoading = ref(false);
const askModelLoading = ref(false);
const aiTagModelLoading = ref(false);
const embeddingModelOptions = ref<string[]>([]);
const askModelOptions = ref<string[]>([]);
const aiTagModelOptions = ref<string[]>([]);
const statusText = ref("");

const updatePref = (key: string, value: unknown) => {
  PLMainAPI.preferenceService.set({ [key]: value });
};

const providerPresets = MODEL_PROVIDER_PRESETS;
const providerIconPathMap: Partial<Record<ModelProviderId, string>> = {
  qwen: qwenIcon,
  openai: openaiIcon,
  deepseek: deepseekIcon,
  moonshot: moonshotIcon,
  zhipu: zhipuIcon,
};
const providerIconPath = (providerID: string) =>
  providerIconPathMap[providerID as ModelProviderId];

const providerFor = (scope: "ask" | "tag" | "embedding") => {
  if (scope === "ask") {
    return `${prefState.askModelProvider || "qwen"}`;
  }
  if (scope === "tag") {
    return `${prefState.tagModelProvider || "qwen"}`;
  }
  return `${prefState.embeddingModelProvider || "qwen"}`;
};

const applyProviderDefaults = async (
  scope: "ask" | "tag" | "embedding",
  providerID: string
) => {
  const preset = getModelProviderPreset(providerID);
  if (scope === "ask") {
    updatePref("askModelProvider", providerID);
    updatePref("qwenAskBaseURL", preset.baseURL);
    updatePref("qwenAskModel", preset.defaultAskModel);
  } else if (scope === "tag") {
    updatePref("tagModelProvider", providerID);
    updatePref("qwenAITagBaseURL", preset.baseURL);
    updatePref("qwenAITagModel", preset.defaultAskModel);
  } else {
    updatePref("embeddingModelProvider", providerID);
    updatePref("qwenEmbeddingBaseURL", preset.baseURL);
    updatePref("qwenEmbeddingModel", preset.defaultEmbeddingModel);
  }
};

const loadProviderKeyState = async () => {
  const entries = await Promise.all(
    providerPresets.map(async (provider) => {
      const key = await PLMainAPI.preferenceService.getPassword(
        `modelProviderApiKey:${provider.id}`
      );
      return [provider.id, Boolean((key || "").trim())] as const;
    })
  );
  providerKeyStatus.value = Object.fromEntries(entries);
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
  await Promise.all(providerPresets.map(async (provider) => checkProviderConnectivity(provider.id)));
};

const saveProviderApiKey = async (providerID: string) => {
  const trimmed = (providerKeyDraft.value[providerID] || "").trim();
  if (!trimmed) return;
  await PLMainAPI.preferenceService.setPassword(
    `modelProviderApiKey:${providerID}`,
    trimmed
  );
  providerKeyStatus.value = {
    ...providerKeyStatus.value,
    [providerID]: true,
  };
  await checkProviderConnectivity(providerID);
};

const onProviderKeyChange = (providerID: string, value: string) => {
  providerKeyDraft.value = {
    ...providerKeyDraft.value,
    [providerID]: value,
  };
};

const onProviderKeySubmit = async (providerID: string, value: string) => {
  onProviderKeyChange(providerID, value);
  await saveProviderApiKey(providerID);
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

const providerLabel = (scope: "ask" | "tag" | "embedding") =>
  getModelProviderPreset(providerFor(scope)).label;

const rebuildIndex = async () => {
  indexing.value = true;
  statusText.value = t("semanticsearch.statusRebuilding");
  const result = await PLAPI.semanticSearchService.rebuildIndex();
  statusText.value = result.error
    ? `${t("semanticsearch.statusIndexFailed")}: ${result.error}`
    : t("semanticsearch.statusIndexed", {
        indexed: result.indexed,
        total: result.total,
      });
  indexing.value = false;
};

const refreshModels = async (target: "ask" | "tag") => {
  if (target === "ask") {
    askModelLoading.value = true;
  } else {
    aiTagModelLoading.value = true;
  }

  const baseURL =
    target === "ask"
      ? getModelProviderPreset(providerFor("ask")).baseURL
      : getModelProviderPreset(providerFor("tag")).baseURL;
  const models = await PLAPI.askService.listChatModels(
    `${baseURL || ""}`,
    true,
    target === "ask" ? "ask" : "tag"
  );

  if (target === "ask") {
    askModelOptions.value = models;
  } else {
    aiTagModelOptions.value = models;
  }

  statusText.value =
    models.length > 0
      ? t("semanticsearch.statusModelLoaded", { count: models.length })
      : t("semanticsearch.statusModelEmpty");

  if (target === "ask") {
    askModelLoading.value = false;
  } else {
    aiTagModelLoading.value = false;
  }
};

const onChangeProvider = async (
  scope: "ask" | "tag" | "embedding",
  providerID: string
) => {
  await applyProviderDefaults(scope, providerID);
  if (scope === "embedding") {
    await refreshEmbeddingModels();
    return;
  }
  await refreshModels(scope === "ask" ? "ask" : "tag");
};

const refreshEmbeddingModels = async () => {
  embeddingModelLoading.value = true;
  const baseURL = `${getModelProviderPreset(providerFor("embedding")).baseURL}`;
  const models = await PLAPI.askService.listEmbeddingModels(baseURL, true);
  embeddingModelOptions.value =
    models.length > 0
      ? models
      : prefState.qwenEmbeddingModel
      ? [prefState.qwenEmbeddingModel]
      : [];
  statusText.value =
    models.length > 0
      ? t("semanticsearch.statusModelLoaded", { count: models.length })
      : t("semanticsearch.statusModelEmpty");
  embeddingModelLoading.value = false;
};

const loadModelCache = async () => {
  const embeddingBaseURL = `${getModelProviderPreset(providerFor("embedding")).baseURL}`;
  const cachedEmbeddingModels = await PLAPI.askService.listEmbeddingModels(
    embeddingBaseURL,
    false
  );
  embeddingModelOptions.value =
    cachedEmbeddingModels.length > 0
      ? cachedEmbeddingModels
      : prefState.qwenEmbeddingModel
      ? [prefState.qwenEmbeddingModel]
      : [];
  askModelOptions.value = await PLAPI.askService.listChatModels(
    `${getModelProviderPreset(providerFor("ask")).baseURL || ""}`,
    false,
    "ask"
  );
  aiTagModelOptions.value = await PLAPI.askService.listChatModels(
    `${getModelProviderPreset(providerFor("tag")).baseURL || ""}`,
    false,
    "tag"
  );
};

onMounted(() => {
  void loadProviderKeyState();
  void loadModelCache();
});
</script>

<template>
  <div
    class="flex flex-col text-neutral-800 dark:text-neutral-300 w-[400px] md:w-[500px] lg:w-[700px]"
  >
    <div class="text-base font-semibold mb-4">{{ $t("semanticsearch.title") }}</div>
    <div class="mb-5">
      <div class="text-xs font-semibold mb-2">{{ $t("semanticsearch.providerApiSectionTitle") }}</div>
      <div class="grid grid-cols-1 gap-2">
        <div
          v-for="provider in providerPresets"
          :key="`provider-inline-${provider.id}`"
          class="rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-2 bg-neutral-50 dark:bg-neutral-700"
        >
          <div class="grid grid-cols-[200px_minmax(0,1fr)_20px] items-center gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-6 h-6 rounded-md bg-neutral-200 dark:bg-neutral-600 flex items-center justify-center shrink-0">
                <img
                  v-if="providerIconPath(provider.id)"
                  :src="providerIconPath(provider.id)"
                  class="w-4 h-4 rounded-sm"
                />
              </div>
              <div class="text-xs font-medium truncate">{{ provider.label }}</div>
            </div>
            <input
              class="h-8 px-2 rounded-md text-xs bg-neutral-200 dark:bg-neutral-600 focus:outline-none w-full min-w-0"
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
            <div class="flex justify-end">
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

    <hr class="mb-5 border-neutral-300 dark:border-neutral-700" />

    <div class="mb-3 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">{{ $t("semanticsearch.embeddingProviderTitle") }}</div>
      </div>
      <div class="relative">
        <img
          v-if="providerIconPath(providerFor('embedding'))"
          :src="providerIconPath(providerFor('embedding'))"
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-sm pointer-events-none"
        />
        <select
          class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow pl-8 pr-2"
          :value="providerFor('embedding')"
          @change="
            async (event) =>
              onChangeProvider('embedding', (event.target as HTMLSelectElement).value)
          "
        >
          <option
            v-for="provider in providerPresets"
            :key="`embedding-provider-${provider.id}`"
            :value="provider.id"
          >
            {{ provider.label }}
          </option>
        </select>
      </div>
    </div>

    <div class="mb-5 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">{{ $t("semanticsearch.embeddingModelTitle") }}</div>
        <div class="text-xxs text-neutral-600 dark:text-neutral-500">
          {{ $t("semanticsearch.embeddingModelInfo") }}
        </div>
      </div>
      <div class="relative flex items-center">
        <select
          v-if="embeddingModelOptions.length > 0"
          class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow px-2 pr-10"
          :value="prefState.qwenEmbeddingModel"
          @change="
            (event) =>
              updatePref(
                'qwenEmbeddingModel',
                (event.target as HTMLSelectElement).value
              )
          "
        >
          <option
            v-if="!embeddingModelOptions.includes(prefState.qwenEmbeddingModel)"
            :value="prefState.qwenEmbeddingModel"
          >
            {{ prefState.qwenEmbeddingModel }}
          </option>
          <option
            v-for="model in embeddingModelOptions"
            :key="`embedding-${model}`"
            :value="model"
          >
            {{ model }}
          </option>
        </select>
        <input
          v-else
          class="p-2 pr-10 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow"
          type="text"
          :placeholder="$t('semanticsearch.selectModelPlaceholder')"
          :value="prefState.qwenEmbeddingModel"
          @input="
            (event) =>
              updatePref(
                'qwenEmbeddingModel',
                (event.target as HTMLInputElement).value
              )
          "
          @change="
            (event) =>
              updatePref(
                'qwenEmbeddingModel',
                (event.target as HTMLInputElement).value
              )
          "
        />
        <button
          class="absolute right-[10px] flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-300 hover:text-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600 dark:hover:text-neutral-100 disabled:opacity-50"
          :disabled="embeddingModelLoading"
          @click="refreshEmbeddingModels"
        >
          <BIconArrowRepeat
            class="text-xs"
            :class="embeddingModelLoading ? 'animate-spin' : ''"
          />
        </button>
      </div>
    </div>

    <div class="flex space-x-2 mb-5">
      <button
        class="flex h-8 px-3 rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 hover:dark:bg-neutral-600 disabled:opacity-50"
        :disabled="indexing"
        @click="rebuildIndex"
      >
        <BIconArrowRepeat class="my-auto mr-2 text-xs" />
        <span class="my-auto text-xs">{{
          indexing ? $t("semanticsearch.indexing") : $t("semanticsearch.rebuildIndex")
        }}</span>
      </button>
    </div>

    <hr class="mb-5 border-neutral-300 dark:border-neutral-700" />


    <div class="mb-3 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">{{ $t("semanticsearch.askProviderTitle") }}</div>
      </div>
      <div class="relative">
        <img
          v-if="providerIconPath(providerFor('ask'))"
          :src="providerIconPath(providerFor('ask'))"
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-sm pointer-events-none"
        />
        <select
          class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow pl-8 pr-2"
          :value="providerFor('ask')"
          @change="
            async (event) =>
              onChangeProvider('ask', (event.target as HTMLSelectElement).value)
          "
        >
          <option
            v-for="provider in providerPresets"
            :key="`ask-provider-${provider.id}`"
            :value="provider.id"
          >
            {{ provider.label }}
          </option>
        </select>
      </div>
    </div>

    <div class="mb-5 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">{{ $t("semanticsearch.askModelTitle") }}</div>
        <div class="text-xxs text-neutral-600 dark:text-neutral-500">
          {{ $t("semanticsearch.askModelInfo") }}
        </div>
      </div>
      <div class="relative flex items-center">
        <select
          v-if="askModelOptions.length > 0"
          class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow px-2 pr-10"
          :value="prefState.qwenAskModel"
          @change="
            (event) =>
              updatePref(
                'qwenAskModel',
                (event.target as HTMLSelectElement).value
              )
          "
        >
          <option
            v-if="!askModelOptions.includes(prefState.qwenAskModel)"
            :value="prefState.qwenAskModel"
          >
            {{ prefState.qwenAskModel }}
          </option>
          <option
            v-for="model in askModelOptions"
            :key="`ask-${model}`"
            :value="model"
          >
            {{ model }}
          </option>
        </select>
        <input
          v-else
          class="p-2 pr-10 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow"
          type="text"
          :placeholder="$t('semanticsearch.selectModelPlaceholder')"
          :value="prefState.qwenAskModel"
          @input="
            (event) =>
              updatePref(
                'qwenAskModel',
                (event.target as HTMLInputElement).value
              )
          "
          @change="
            (event) =>
              updatePref(
                'qwenAskModel',
                (event.target as HTMLInputElement).value
              )
          "
        />
        <button
          class="absolute right-[10px] flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-300 hover:text-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600 dark:hover:text-neutral-100 disabled:opacity-50"
          :disabled="askModelLoading"
          @click="refreshModels('ask')"
        >
          <BIconArrowRepeat
            class="text-xs"
            :class="askModelLoading ? 'animate-spin' : ''"
          />
        </button>
      </div>
    </div>

    <div class="mb-5 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">
          {{ $t("semanticsearch.askContextProfileTitle") }}
        </div>
        <div class="text-xxs text-neutral-600 dark:text-neutral-500">
          {{ $t("semanticsearch.askContextProfileInfo") }}
        </div>
      </div>
      <select
        class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow px-2"
        :value="prefState.askContextProfile || 'fast'"
        @change="
          (event) =>
            updatePref(
              'askContextProfile',
              (event.target as HTMLSelectElement).value
            )
        "
      >
        <option value="fast">{{ $t("semanticsearch.askContextFast") }}</option>
        <option value="balanced">{{ $t("semanticsearch.askContextBalanced") }}</option>
        <option value="detailed">{{ $t("semanticsearch.askContextDetailed") }}</option>
      </select>
    </div>

    <hr class="mb-5 border-neutral-300 dark:border-neutral-700" />

    <Toggle
      class="mb-5"
      :title="$t('semanticsearch.autoAITagsTitle')"
      :info="$t('semanticsearch.autoAITagsInfo')"
      :enable="prefState.autoAITagging"
      @event:change="(value) => updatePref('autoAITagging', value)"
    />


    <div class="mb-3 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">{{ $t("semanticsearch.tagProviderTitle") }}</div>
      </div>
      <div class="relative">
        <img
          v-if="providerIconPath(providerFor('tag'))"
          :src="providerIconPath(providerFor('tag'))"
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-sm pointer-events-none"
        />
        <select
          class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow pl-8 pr-2"
          :value="providerFor('tag')"
          @change="
            async (event) =>
              onChangeProvider('tag', (event.target as HTMLSelectElement).value)
          "
        >
          <option
            v-for="provider in providerPresets"
            :key="`tag-provider-${provider.id}`"
            :value="provider.id"
          >
            {{ provider.label }}
          </option>
        </select>
      </div>
    </div>

    <div class="mb-5 flex flex-col space-y-1">
      <div class="flex flex-col">
        <div class="text-xs font-semibold">{{ $t("semanticsearch.aiTaggingModelTitle") }}</div>
        <div class="text-xxs text-neutral-600 dark:text-neutral-500">
          {{ $t("semanticsearch.aiTaggingModelInfo") }}
        </div>
      </div>
      <div class="relative flex items-center">
        <select
          v-if="aiTagModelOptions.length > 0"
          class="w-full h-9 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow px-2 pr-10"
          :value="prefState.qwenAITagModel"
          @change="
            (event) =>
              updatePref(
                'qwenAITagModel',
                (event.target as HTMLSelectElement).value
              )
          "
        >
          <option
            v-if="!aiTagModelOptions.includes(prefState.qwenAITagModel)"
            :value="prefState.qwenAITagModel"
          >
            {{ prefState.qwenAITagModel }}
          </option>
          <option
            v-for="model in aiTagModelOptions"
            :key="`tag-${model}`"
            :value="model"
          >
            {{ model }}
          </option>
        </select>
        <input
          v-else
          class="p-2 pr-10 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none grow"
          type="text"
          :placeholder="$t('semanticsearch.selectModelPlaceholder')"
          :value="prefState.qwenAITagModel"
          @input="
            (event) =>
              updatePref(
                'qwenAITagModel',
                (event.target as HTMLInputElement).value
              )
          "
          @change="
            (event) =>
              updatePref(
                'qwenAITagModel',
                (event.target as HTMLInputElement).value
              )
          "
        />
        <button
          class="absolute right-[10px] flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-300 hover:text-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600 dark:hover:text-neutral-100 disabled:opacity-50"
          :disabled="aiTagModelLoading"
          @click="refreshModels('tag')"
        >
          <BIconArrowRepeat
            class="text-xs"
            :class="aiTagModelLoading ? 'animate-spin' : ''"
          />
        </button>
      </div>
    </div>

    <div class="flex space-x-2 text-xs text-neutral-500 dark:text-neutral-400">
      <BIconSearch class="my-auto flex-none" />
      <span class="my-auto">
        {{ $t("semanticsearch.commandHint") }}
      </span>
    </div>
    <div class="text-xs text-neutral-600 dark:text-neutral-400 mt-3" v-if="statusText">
      {{ statusText }}
    </div>

  </div>
</template>

