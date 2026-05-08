<script setup lang="ts">
import { BIconArrowRepeat, BIconCheck2Circle, BIconSearch } from "bootstrap-icons-vue";
import { ref } from "vue";

import Input from "./components/Input.vue";
import Toggle from "./components/toggle.vue";

const prefState = PLMainAPI.preferenceService.useState();
const qwenKey = ref("");
const askKey = ref("");
const testing = ref(false);
const indexing = ref(false);
const statusText = ref("");

const updatePref = (key: string, value: unknown) => {
  PLMainAPI.preferenceService.set({ [key]: value });
};

const saveQwenKey = async (value: string) => {
  qwenKey.value = value;
  if (value.trim()) {
    await PLMainAPI.preferenceService.setPassword("qwenEmbedding", value.trim());
  }
};

const saveAskKey = async (value: string) => {
  askKey.value = value;
  if (value.trim()) {
    await PLMainAPI.preferenceService.setPassword("askAPIKey", value.trim());
  }
};

const testSettings = async () => {
  testing.value = true;
  statusText.value = "";
  const ok = await PLAPI.semanticSearchService.testSettings();
  statusText.value = ok ? "Semantic search settings are ready." : "Semantic search settings failed.";
  testing.value = false;
};

const rebuildIndex = async () => {
  indexing.value = true;
  statusText.value = "Rebuilding semantic index...";
  const result = await PLAPI.semanticSearchService.rebuildIndex();
  statusText.value = `Indexed ${result.indexed} paper(s).`;
  indexing.value = false;
};
</script>

<template>
  <div
    class="flex flex-col text-neutral-800 dark:text-neutral-300 w-[400px] md:w-[500px] lg:w-[700px]"
  >
    <div class="text-base font-semibold mb-4">Semantic Search</div>

    <Input
      class="mb-5"
      title="Qwen API Key"
      info="Stored in the system keychain. DashScope compatible-mode embeddings are used."
      :value="qwenKey"
      type="password"
      placeholder="sk-..."
      show-saving-status
      @event:submit="saveQwenKey"
    />

    <Toggle
      class="mb-5"
      title="Auto AI Tags"
      info="When papers are imported or updated, PaperMind asks the chat model to add short research tags."
      :enable="prefState.autoAITagging"
      @event:change="(value) => updatePref('autoAITagging', value)"
    />

    <div class="text-sm font-semibold mb-3 mt-2">Ask</div>

    <Input
      class="mb-5"
      title="Ask API Key"
      info="Stored in the system keychain. Any OpenAI-compatible chat API works."
      :value="askKey"
      type="password"
      placeholder="sk-..."
      show-saving-status
      @event:submit="saveAskKey"
    />

    <Input
      class="mb-5"
      title="Ask API Base URL"
      info="OpenAI-compatible chat completions endpoint root."
      :value="prefState.askAPIBaseURL"
      type="text"
      placeholder="https://api.openai.com/v1"
      @event:change="(value) => updatePref('askAPIBaseURL', value)"
      @event:submit="(value) => updatePref('askAPIBaseURL', value)"
    />

    <Input
      class="mb-5"
      title="Ask Model"
      info="The chat model used by the Ask panel."
      :value="prefState.askModel"
      type="text"
      placeholder="gpt-4o-mini"
      @event:change="(value) => updatePref('askModel', value)"
      @event:submit="(value) => updatePref('askModel', value)"
    />

    <Input
      class="mb-5"
      title="PostgreSQL URL"
      info="A PostgreSQL database with pgvector available. PaperMind creates the required tables."
      :value="prefState.semanticSearchPostgresURL"
      type="text"
      placeholder="postgresql://user:password@localhost:5432/paperlib"
      show-saving-status
      @event:change="(value) => updatePref('semanticSearchPostgresURL', value)"
      @event:submit="(value) => updatePref('semanticSearchPostgresURL', value)"
    />

    <Input
      class="mb-5"
      title="Qwen Embedding Model"
      info="Default is text-embedding-v4."
      :value="prefState.qwenEmbeddingModel"
      type="text"
      placeholder="text-embedding-v4"
      @event:change="(value) => updatePref('qwenEmbeddingModel', value)"
      @event:submit="(value) => updatePref('qwenEmbeddingModel', value)"
    />

    <div class="flex space-x-2 mb-3">
      <button
        class="flex h-8 px-3 rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 hover:dark:bg-neutral-600 disabled:opacity-50"
        :disabled="testing"
        @click="testSettings"
      >
        <BIconCheck2Circle class="my-auto mr-2 text-xs" />
        <span class="my-auto text-xs">{{ testing ? "Testing..." : "Test" }}</span>
      </button>
      <button
        class="flex h-8 px-3 rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 hover:dark:bg-neutral-600 disabled:opacity-50"
        :disabled="indexing"
        @click="rebuildIndex"
      >
        <BIconArrowRepeat class="my-auto mr-2 text-xs" />
        <span class="my-auto text-xs">{{ indexing ? "Indexing..." : "Rebuild Index" }}</span>
      </button>
    </div>

    <div class="flex space-x-2 text-xs text-neutral-500 dark:text-neutral-400">
      <BIconSearch class="my-auto flex-none" />
      <span class="my-auto">
        Use \search_semantic query in the command bar after indexing.
      </span>
    </div>
    <div class="text-xs text-neutral-600 dark:text-neutral-400 mt-3" v-if="statusText">
      {{ statusText }}
    </div>
  </div>
</template>

