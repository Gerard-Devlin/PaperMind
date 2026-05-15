<script setup lang="ts">
import {
  BIconCheck,
  BIconDownload,
  BIconSend,
  BIconTable,
} from "bootstrap-icons-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AskAnswer,
  ExperimentCompareColumn,
  ExperimentCompareResult,
} from "@/service/services/ask-service";
import { downloadComparePDF } from "@/renderer/utils/compare-pdf";

const question = ref("");
const asking = ref(false);
const comparing = ref(false);
const downloadedPDFId = ref("");
const messages = ref<
  Array<{
    role: "user" | "assistant";
    content: string;
    kind?: "text" | "compare";
    sources?: AskAnswer["sources"];
    compare?: ExperimentCompareResult;
  }>
>([]);
const { t } = useI18n();
const uiState = PLUIAPILocal.uiStateService.useState();
const selectedPapers = computed(() => uiState.selectedPaperEntities || []);
const canCompare = computed(
  () => selectedPapers.value.length >= 2 && !asking.value && !comparing.value
);
let handledCompareRequest = 0;

const ask = async () => {
  const text = question.value.trim();
  if (!text || asking.value) {
    return;
  }

  messages.value.push({ role: "user", content: text });
  question.value = "";
  asking.value = true;
  try {
    const result = await PLAPI.askService.ask(
      text,
      selectedPapers.value.slice(0, 3)
    );
    messages.value.push({
      role: "assistant",
      content: result.answer || t("plugin.askNoAnswer"),
      kind: "text",
      sources: result.sources || [],
    });
  } finally {
    asking.value = false;
  }
};

const evidenceSearchText = (source: AskAnswer["sources"][number]) => {
  return `${source.quote || source.context || source.title || ""}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
};

const openEvidence = async (source: AskAnswer["sources"][number]) => {
  if (!source.mainURL) {
    return;
  }

  const fileURL = await PLAPI.fileService.access(source.mainURL, true);
  if (!fileURL) {
    return;
  }

  const params = new URLSearchParams({
    file: fileURL,
  });
  const searchText = evidenceSearchText(source);
  if (searchText) {
    params.set("search", searchText);
  }

  const pageHash = source.page ? `#page=${source.page}` : "";
  window.open(`../viewer/viewer.html?${params.toString()}${pageHash}`, "_blank");
};

const compareExperiments = async () => {
  if (!canCompare.value) {
    return;
  }

  const paperCount = Math.min(selectedPapers.value.length, 6);
  messages.value.push({
    role: "user",
    content: `Compare experiments for ${paperCount} selected papers.`,
    kind: "text",
  });
  comparing.value = true;

  try {
    const result = await PLAPI.askService.compareExperiments(
      selectedPapers.value.slice(0, 6)
    );
    messages.value.push({
      role: "assistant",
      content: result.title,
      kind: "compare",
      compare: result,
    });
  } finally {
    comparing.value = false;
  }
};

const handleCompareRequest = () => {
  const request = uiState.askExperimentCompareRequest || 0;
  if (!request || request === handledCompareRequest) {
    return;
  }

  handledCompareRequest = request;
  uiState.askExperimentCompareRequest = 0;
  void compareExperiments();
};

const groupedColumns = (columns: ExperimentCompareColumn[]) => {
  const groups: Array<{ label: string; span: number }> = [];
  for (const column of columns || []) {
    const label = column.group || "Results";
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.span += 1;
    } else {
      groups.push({ label, span: 1 });
    }
  }
  return groups;
};

const valueFor = (
  result: ExperimentCompareResult,
  rowIndex: number,
  columnId: string
) => {
  const row = result.rows[rowIndex];
  return `${row?.values?.[columnId] || "-"}`.trim() || "-";
};

const downloadPDF = async (
  messageIndex: number,
  result?: ExperimentCompareResult
) => {
  if (!result) {
    return;
  }

  const filePath = await downloadComparePDF(result);
  if (filePath) {
    downloadedPDFId.value = `${messageIndex}`;
    setTimeout(() => {
      if (downloadedPDFId.value === `${messageIndex}`) {
        downloadedPDFId.value = "";
      }
    }, 1200);
  }
};

watch(() => uiState.askExperimentCompareRequest, handleCompareRequest);
onMounted(handleCompareRequest);
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
            : message.kind === 'compare'
            ? 'mr-1 bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
            : 'mr-4 bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
        "
      >
        <template v-if="message.kind !== 'compare'">
          {{ message.content }}

          <div
            v-if="message.role === 'assistant' && message.sources?.length"
            class="mt-2 space-y-1"
          >
            <button
              v-for="(source, sourceIndex) in message.sources"
              :key="`${source.id}-${sourceIndex}`"
              class="block w-full rounded-md bg-neutral-100 px-2 py-1 text-left text-[10px] leading-4 hover:bg-neutral-50 dark:bg-neutral-800 dark:hover:bg-neutral-600"
              :class="source.mainURL ? 'cursor-pointer' : 'cursor-default opacity-70'"
              @click="openEvidence(source)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate font-semibold">
                  [{{ sourceIndex + 1 }}] {{ source.title }}
                </span>
                <span
                  v-if="source.page"
                  class="flex-none rounded bg-neutral-200 px-1 text-[9px] dark:bg-neutral-700"
                >
                  p. {{ source.page }}
                </span>
              </div>
              <div
                v-if="source.context || source.quote"
                class="mt-0.5 line-clamp-3 text-neutral-500 dark:text-neutral-400"
              >
                {{ source.context || source.quote }}
              </div>
            </button>
          </div>
        </template>

        <template v-else-if="message.compare">
          <div class="mb-1 flex items-center justify-between gap-2">
            <div class="min-w-0 truncate font-semibold">
              {{ message.compare.title }}
            </div>
            <button
              class="inline-flex h-6 min-w-6 flex-none items-center justify-center rounded hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-700"
              :disabled="!message.compare.rows.length"
              @click="downloadPDF(index, message.compare)"
              title="Download PDF"
            >
              <BIconCheck
                v-if="downloadedPDFId === `${index}`"
                class="text-xs"
              />
              <BIconDownload v-else class="text-xs" />
            </button>
          </div>

          <div
            class="mb-2 space-y-0.5 text-[10px] leading-4 text-neutral-500 dark:text-neutral-400"
          >
            <div
              v-for="(paper, paperIndex) in message.compare.papers"
              :key="paper.id"
              class="truncate"
              :title="paper.title"
            >
              [{{ paperIndex + 1 }}] {{ paper.title }}
            </div>
          </div>

          <div
            v-if="
              message.compare.columns.length > 0 &&
              message.compare.rows.length > 0
            "
            class="experiment-table-wrap"
          >
            <table class="experiment-table">
              <thead>
                <tr>
                  <th rowspan="2">Paper</th>
                  <th rowspan="2">Method</th>
                  <th rowspan="2">Setting</th>
                  <th
                    v-for="(group, groupIndex) in groupedColumns(
                      message.compare.columns
                    )"
                    :key="`${group.label}-${groupIndex}`"
                    :colspan="group.span"
                    class="text-center"
                  >
                    {{ group.label }}
                  </th>
                  <th rowspan="2">Source</th>
                </tr>
                <tr>
                  <th
                    v-for="column in message.compare.columns"
                    :key="column.id"
                    class="text-center"
                    :title="column.metric || column.label"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, rowIndex) in message.compare.rows"
                  :key="row.id"
                  :class="row.role === 'proposed' ? 'proposed-row' : ''"
                >
                  <td :title="row.paperTitle">[{{ row.paperIndex }}]</td>
                  <td>
                    <span>{{ row.method }}</span>
                    <span
                      v-if="row.role !== 'other'"
                      class="ml-1 rounded border border-neutral-300 px-1 text-[10px] font-normal text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
                    >
                      {{ row.role }}
                    </span>
                  </td>
                  <td>{{ row.setting || "-" }}</td>
                  <td
                    v-for="column in message.compare.columns"
                    :key="`${row.id}-${column.id}`"
                    class="text-center tabular-nums"
                    :class="row.best?.[column.id] ? 'best-value' : ''"
                  >
                    {{ valueFor(message.compare, rowIndex, column.id) }}
                  </td>
                  <td>{{ row.source || "-" }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="text-xs text-neutral-500 dark:text-neutral-400">
            No explicit experiment table was found in the selected papers.
          </div>

          <div
            v-if="message.compare.warnings.length > 0"
            class="mt-2 space-y-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300"
          >
            <div v-for="warning in message.compare.warnings" :key="warning">
              {{ warning }}
            </div>
          </div>

          <div
            v-if="message.compare.notes.length > 0"
            class="mt-2 space-y-1 text-[10px] leading-4 text-neutral-500 dark:text-neutral-400"
          >
            <div v-for="note in message.compare.notes" :key="note">
              {{ note }}
            </div>
          </div>
        </template>
      </div>
      <div
        class="px-2 py-1 text-xs text-neutral-400"
        v-if="messages.length === 0"
      >
        {{ $t("plugin.askHint") }}
      </div>
    </div>

    <div
      class="mb-1 flex flex-none items-center justify-between gap-1 text-xxs text-neutral-400"
    >
      <span class="truncate"> {{ selectedPapers.length }} selected </span>
      <button
        class="inline-flex h-7 flex-none items-center gap-1 rounded-md bg-neutral-200 px-2 text-neutral-700 disabled:opacity-50 dark:bg-neutral-700 dark:text-neutral-100"
        :disabled="!canCompare"
        @click="compareExperiments"
      >
        <BIconTable class="text-xs" />
        <span>Compare experiments</span>
      </button>
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
        :disabled="asking || comparing"
        @click="ask"
      >
        <span
          v-if="asking || comparing"
          class="m-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-400 border-t-accentlight dark:border-neutral-500 dark:border-t-accentdark"
        />
        <BIconSend v-else class="m-auto text-xs" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.experiment-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.experiment-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  border-top: 1px solid rgb(115 115 115);
  border-bottom: 1px solid rgb(115 115 115);
  font-size: 0.68rem;
  line-height: 1.25rem;
}

.experiment-table thead tr:first-child {
  border-bottom: 1px solid rgb(163 163 163);
}

.experiment-table thead tr:last-child {
  border-bottom: 1px solid rgb(115 115 115);
}

.experiment-table th,
.experiment-table td {
  padding: 0.15rem 0.35rem;
  white-space: nowrap;
  text-align: left;
  vertical-align: middle;
}

.experiment-table th {
  font-weight: 650;
}

.experiment-table tbody tr {
  border-top: 1px solid rgb(229 229 229);
}

.experiment-table tbody tr:first-child {
  border-top: none;
}

.proposed-row {
  background: rgb(229 229 229 / 0.5);
}

.best-value {
  font-weight: 750;
}

:global(.dark) .experiment-table {
  border-top-color: rgb(163 163 163);
  border-bottom-color: rgb(163 163 163);
}

:global(.dark) .experiment-table thead tr:first-child,
:global(.dark) .experiment-table thead tr:last-child {
  border-bottom-color: rgb(115 115 115);
}

:global(.dark) .experiment-table tbody tr {
  border-top-color: rgb(64 64 64);
}

:global(.dark) .proposed-row {
  background: rgb(64 64 64 / 0.5);
}
</style>
