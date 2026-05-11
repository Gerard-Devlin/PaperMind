<script setup lang="ts">
import { BIconSend } from "bootstrap-icons-vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const question = ref("");
const asking = ref(false);
const messages = ref<Array<{ role: "user" | "assistant"; content: string }>>([]);
const { t } = useI18n();

const ask = async () => {
  const text = question.value.trim();
  if (!text || asking.value) {
    return;
  }

  messages.value.push({ role: "user", content: text });
  question.value = "";
  asking.value = true;
  const result = await PLAPI.askService.ask(text);
  messages.value.push({
    role: "assistant",
    content: result.answer || t("plugin.askNoAnswer"),
  });
  asking.value = false;
};
</script>

<template>
  <div class="flex h-full min-w-0 flex-col px-2 pb-2">
    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="mb-2 rounded-md px-2 py-1.5 text-xs leading-5"
        :class="
          message.role === 'user'
            ? 'ml-4 bg-accentlight text-white dark:bg-accentdark'
            : 'mr-4 bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
        "
      >
        {{ message.content }}
      </div>
      <div
        class="px-2 py-1 text-xs text-neutral-400"
        v-if="messages.length === 0"
      >
        {{ $t("plugin.askHint") }}
      </div>
    </div>

    <div class="flex flex-none gap-1">
      <textarea
        class="max-h-24 min-h-9 min-w-0 flex-1 resize-none rounded-md bg-neutral-200 p-2 text-xs outline-none dark:bg-neutral-700"
        v-model="question"
        :placeholder="$t('plugin.askPlaceholder')"
        @keydown.enter.exact.prevent="ask"
      />
      <button
        class="flex h-9 w-9 flex-none rounded-md bg-neutral-300 text-neutral-700 disabled:opacity-50 dark:bg-neutral-600 dark:text-neutral-100"
        :disabled="asking"
        @click="ask"
      >
        <BIconSend class="m-auto text-xs" />
      </button>
    </div>
  </div>
</template>
