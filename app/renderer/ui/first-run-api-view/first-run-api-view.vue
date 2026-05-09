<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
}>();

const emits = defineEmits<{
  (e: "event:save", value: string): void;
  (e: "event:later"): void;
}>();

const apiKey = ref("");
const prefState = PLMainAPI.preferenceService.useState();
const locale = computed(() => `${prefState.language}`);
const isZh = computed(() => locale.value.startsWith("zh"));

watch(
  () => props.open,
  (open) => {
    if (!open) {
      apiKey.value = "";
    }
  }
);

const save = () => {
  emits("event:save", apiKey.value);
};
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
  >
    <div
      class="w-[520px] max-w-[92vw] rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-5"
    >
      <div class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {{ isZh ? "配置 API Key" : "Set Up API Key" }}
      </div>
      <div class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        {{
          isZh
            ? "为了启用语义搜索与 AI 标签，请先填写 Qwen API Key。你也可以稍后在 设置 > 语义搜索 中修改。"
            : "To enable semantic search and AI tagging, add your Qwen API key now. You can also change it later in Preference > Semantic."
        }}
      </div>

      <input
        v-model="apiKey"
        type="password"
        class="mt-4 h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 text-sm outline-none focus:border-neutral-500"
        placeholder="sk-..."
        @keydown.enter="save"
      />

      <div class="mt-5 flex justify-end space-x-2">
        <button
          class="h-8 px-3 rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 hover:dark:bg-neutral-600 text-xs"
          @click="emits('event:later')"
        >
          {{ isZh ? "稍后设置" : "Later" }}
        </button>
        <button
          class="h-8 px-3 rounded-md bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-100 text-xs"
          @click="save"
        >
          {{ isZh ? "保存" : "Save" }}
        </button>
      </div>
    </div>
  </div>
</template>
