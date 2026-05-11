<script setup lang="ts">
import {
  BIconArrowRepeat,
  BIconCheck2Circle,
  BIconSearch,
} from "bootstrap-icons-vue";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import Input from "./components/Input.vue";
import Toggle from "./components/toggle.vue";

const prefState = PLMainAPI.preferenceService.useState();
const { t } = useI18n();
const qwenKey = ref("");
const testing = ref(false);
const indexing = ref(false);
const embeddingModelLoading = ref(false);
const askModelLoading = ref(false);
const aiTagModelLoading = ref(false);
const embeddingModelOptions = ref<string[]>([]);
const askModelOptions = ref<string[]>([]);
const aiTagModelOptions = ref<string[]>([]);
const statusText = ref("");
const defaultCompatibleBaseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

const updatePref = (key: string, value: unknown) => {
  PLMainAPI.preferenceService.set({ [key]: value });
};

const saveQwenKey = async (value: string) => {
  qwenKey.value = value;
  if (value.trim()) {
    await PLMainAPI.preferenceService.setPassword("qwenEmbedding", value.trim());
  }
};

const testSettings = async () => {
  testing.value = true;
  statusText.value = "";
  const ok = await PLAPI.semanticSearchService.testSettings();
  statusText.value = ok
    ? t("semanticsearch.statusReady")
    : t("semanticsearch.statusFailed");
  testing.value = false;
};

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
    target === "ask" ? prefState.qwenAskBaseURL : prefState.qwenAITagBaseURL;
  const models = await PLAPI.askService.listChatModels(`${baseURL || ""}`, true);

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

const refreshEmbeddingModels = async () => {
  embeddingModelLoading.value = true;
  const baseURL = `${prefState.qwenEmbeddingBaseURL || defaultCompatibleBaseURL}`;
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
  const embeddingBaseURL = `${prefState.qwenEmbeddingBaseURL || defaultCompatibleBaseURL}`;
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
    `${prefState.qwenAskBaseURL || ""}`,
    false
  );
  aiTagModelOptions.value = await PLAPI.askService.listChatModels(
    `${prefState.qwenAITagBaseURL || ""}`,
    false
  );
};

onMounted(() => {
  void loadModelCache();
});
</script>

<template>
  <div
    class="flex flex-col text-neutral-800 dark:text-neutral-300 w-[400px] md:w-[500px] lg:w-[700px]"
  >
    <div class="text-base font-semibold mb-4">{{ $t("semanticsearch.title") }}</div>

    <Input
      class="mb-5"
      :title="$t('semanticsearch.qwenApiKeyTitle')"
      :info="$t('semanticsearch.qwenApiKeyInfo')"
      :value="qwenKey"
      type="password"
      placeholder="sk-..."
      show-saving-status
      @event:submit="saveQwenKey"
    />

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

    <hr class="mb-5 border-neutral-300 dark:border-neutral-700" />

    <Input
      class="mb-5"
      :title="$t('semanticsearch.askBaseURLTitle')"
      :info="$t('semanticsearch.askBaseURLInfo')"
      :value="prefState.qwenAskBaseURL"
      type="text"
      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
      @event:change="(value) => updatePref('qwenAskBaseURL', value)"
      @event:submit="(value) => updatePref('qwenAskBaseURL', value)"
    />

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

    <Input
      class="mb-5"
      :title="$t('semanticsearch.aiTaggingBaseURLTitle')"
      :info="$t('semanticsearch.aiTaggingBaseURLInfo')"
      :value="prefState.qwenAITagBaseURL"
      type="text"
      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
      @event:change="(value) => updatePref('qwenAITagBaseURL', value)"
      @event:submit="(value) => updatePref('qwenAITagBaseURL', value)"
    />

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

    <div class="flex space-x-2 mb-3">
      <button
        class="flex h-8 px-3 rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 hover:dark:bg-neutral-600 disabled:opacity-50"
        :disabled="testing"
        @click="testSettings"
      >
        <BIconCheck2Circle class="my-auto mr-2 text-xs" />
        <span class="my-auto text-xs">{{
          testing ? $t("semanticsearch.testing") : $t("semanticsearch.test")
        }}</span>
      </button>
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

    <div class="flex space-x-2 text-xs text-neutral-500 dark:text-neutral-400">
      <BIconSearch class="my-auto flex-none" />
      <span class="my-auto">
        {{ $t("semanticsearch.commandHint") }}
      </span>
    </div>
    <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
      {{ $t("semanticsearch.providerHint") }}
    </div>
    <div class="text-xs text-neutral-600 dark:text-neutral-400 mt-3" v-if="statusText">
      {{ statusText }}
    </div>
  </div>
</template>

