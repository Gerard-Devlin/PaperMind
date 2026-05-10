<script setup lang="ts">
import { Switch } from "@headlessui/vue";
import { computed, onMounted, ref } from "vue";

import { Process } from "@/base/process-id";
import Spinner from "../components/spinner.vue";

type PrefItem = {
  type: string;
  name: string;
  description: string;
  value: any;
  options?: Record<string, string>;
};

const EXT_ID = "@future-scholars/paperlib-metadata-scrape-extension";

const loading = ref(true);
const ready = ref(false);
const prefs = ref<Map<string, PrefItem>>(new Map());
const prefState = PLMainAPI.preferenceService.useState();

const isCN = computed(() => `${prefState.language || ""}`.startsWith("zh"));
const text = computed(() => {
  if (isCN.value) {
    return {
      title: "抓取设置",
      presetTitle: "预设",
      presetInfo: "快速切换抓取策略。",
      sourceTitle: "抓取源",
      sourceInfo: "选择启用的元数据抓取源，重抓时会按这些源执行。",
      ieeeTitle: "IEEE API Key",
      ieeeInfo: "仅在启用 IEEE 抓取源时需要。",
      loading: "加载中...",
      notReady: "抓取扩展未就绪，请重启后重试。",
    };
  }

  return {
    title: "Scrape Settings",
    presetTitle: "Presetting",
    presetInfo: "Quickly switch scraper strategy.",
    sourceTitle: "Scrape Sources",
    sourceInfo:
      "Choose enabled metadata sources. Rescrape will follow these switches.",
    ieeeTitle: "IEEE API Key",
    ieeeInfo: "Only required when IEEE scraper is enabled.",
    loading: "Loading...",
    notReady: "Scrape extension is not ready. Please restart and retry.",
  };
});

const sourceKeys = [
  "scraper-arxiv",
  "scraper-chemrxiv",
  "scraper-crossref",
  "scraper-dblp",
  "scraper-doi",
  "scraper-openreview",
  "scraper-pwc",
  "scraper-pubmed",
  "scraper-semanticscholar",
  "scraper-springer",
  "scraper-adsabs",
  "scraper-ieee",
];

const readPrefs = async () => {
  prefs.value = await PLExtAPI.extensionPreferenceService.getAllMetadata(EXT_ID);
};

const setPref = async (key: string, value: any) => {
  await PLExtAPI.extensionPreferenceService.set(EXT_ID, { [key]: value });
  await readPrefs();
};

onMounted(async () => {
  loading.value = true;

  const extReady = await PLUIAPILocal.rendererRPCService.waitForAPI(
    Process.extension,
    "PLExtAPI",
    5000
  );

  if (!extReady) {
    ready.value = false;
    loading.value = false;
    return;
  }

  try {
    await PLExtAPI.extensionManagementService.ensureOfficialScrapeExtensionsInstalled();
    await readPrefs();
    ready.value = true;
  } catch {
    ready.value = false;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div
    class="flex flex-col text-neutral-800 dark:text-neutral-300 w-[400px] md:w-[500px] lg:w-[700px]"
  >
    <div class="text-base font-semibold mb-4">{{ text.title }}</div>

    <div
      class="flex items-center space-x-2 text-xs text-neutral-500 mb-3"
      v-if="loading"
    >
      <Spinner />
      <span>{{ text.loading }}</span>
    </div>

    <div class="text-xs text-red-500" v-else-if="!ready">
      {{ text.notReady }}
    </div>

    <template v-else>
      <div class="flex justify-between mb-5">
        <div class="flex flex-col max-w-[90%]">
          <div class="text-xs font-semibold">{{ text.presetTitle }}</div>
          <div class="text-xxs text-neutral-600 dark:text-neutral-500">
            {{ text.presetInfo }}
          </div>
        </div>
        <div>
          <select
            class="my-auto bg-gray-50 border text-xxs border-gray-300 text-gray-900 rounded-md block w-36 h-7 dark:bg-neutral-700 dark:border-neutral-600 dark:text-white"
            :value="prefs.get('presetting')?.value"
            @change="
              (e: Event) =>
                setPref('presetting', (e.target as HTMLSelectElement).value)
            "
          >
            <option
              v-for="([k, v], idx) in Object.entries(prefs.get('presetting')?.options || {})"
              :key="idx"
              :value="k"
            >
              {{ v }}
            </option>
          </select>
        </div>
      </div>

      <div class="text-xs font-semibold">{{ text.sourceTitle }}</div>
      <div class="text-xxs text-neutral-600 dark:text-neutral-500 mb-2">
        {{ text.sourceInfo }}
      </div>

      <div class="grid grid-cols-2 gap-2 mb-5">
        <div
          v-for="key in sourceKeys"
          :key="key"
          class="flex items-center justify-between rounded-md bg-neutral-200 dark:bg-neutral-700 px-3 h-8"
        >
          <div class="truncate pr-2 text-xs">
            {{ prefs.get(key)?.name || key }}
          </div>
          <Switch
            :model-value="Boolean(prefs.get(key)?.value)"
            :class="
              Boolean(prefs.get(key)?.value)
                ? 'bg-neutral-500 dark:bg-neutral-400'
                : 'bg-neutral-300 dark:bg-neutral-700'
            "
            class="my-auto relative inline-flex h-5 w-10 items-center rounded-full min-w-10"
            @update:model-value="(value: boolean) => setPref(key, value)"
          >
            <span
              :class="
                Boolean(prefs.get(key)?.value)
                  ? 'translate-x-5.5'
                  : 'translate-x-0.5'
              "
              class="inline-block h-4 w-4 transform rounded-full bg-neutral-100 dark:bg-neutral-800 transition ease-in-out"
            />
          </Switch>
        </div>
      </div>

      <div class="text-xs font-semibold">{{ text.ieeeTitle }}</div>
      <div class="text-xxs text-neutral-600 dark:text-neutral-500 mb-2">
        {{ text.ieeeInfo }}
      </div>
      <input
        class="p-2 rounded-md text-xs bg-neutral-200 dark:bg-neutral-700 focus:outline-none w-full text-neutral-700 dark:text-neutral-300"
        type="password"
        :placeholder="text.ieeeTitle"
        :value="prefs.get('ieee-scrapers-api-key')?.value || ''"
        @change="
          (e: Event) =>
            setPref(
              'ieee-scrapers-api-key',
              (e.target as HTMLInputElement).value
            )
        "
      />
    </template>
  </div>
</template>

