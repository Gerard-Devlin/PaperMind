<script setup lang="ts">
import {
  BIconArrowReturnLeft,
  BIconCheck,
  BIconCommand,
  BIconCopy,
  BIconLink,
  BIconShift,
} from "bootstrap-icons-vue";
import { Ref, computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { disposable } from "@/base/dispose";
import { debounce } from "@/base/misc";
import { CategorizerType, PaperFolder } from "@/models/categorizer";
import { PaperEntity } from "@/models/paper-entity";
import { cmdOrCtrl } from "@/base/shortcut";
import { sanitizeHTML } from "@/renderer/utils/sanitize";

import TableItem from "./components/table-item.vue";

const { t } = useI18n();
const QUICKPASTE_MIN_HEIGHT = 76;
const QUICKPASTE_ASK_SINGLE_MIN_HEIGHT = 220;
const QUICKPASTE_ASK_DUAL_MIN_HEIGHT = 340;

// ====================
// Data
// ====================
const paperEntities: Ref<PaperEntity[]> = ref([]);
const folders: Ref<PaperFolder[]> = ref([]);
const askAnswer = ref("");
const renderedAskAnswer = ref("");
const askSources = ref<
  Array<{
    id: string;
    mainURL?: string;
    title: string;
    authors: string;
    year: string;
    publication: string;
    quote?: string;
    quoteCandidates?: string[];
  }>
>([]);
const askStatus = ref("");
const asking = ref(false);
const copySuccess = ref(false);
const quickpasteRoot = ref<HTMLElement | null>(null);
const headerRef = ref<HTMLElement | null>(null);
const dividerRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const footerRef = ref<HTMLElement | null>(null);

// ====================
// State
// ====================
const searchInput = ref(null);
const exportMode = ref<"BibTex" | "PlainText" | "Ask">("BibTex");
const searchText = ref("");
const searchDebounce = ref(300);
const selectedIndex: Ref<number> = ref(0);
const linkedFolder = ref("");
const mainviewSortBy = ref("addTime");
const mainviewSortOrder: Ref<"desc" | "asce"> = ref("desc");
let searchRequestSeq = 0;
const isAskMode = computed(() => exportMode.value === "Ask");
const citationPopover = ref<{
  visible: boolean;
  x: number;
  y: number;
  source: (typeof askSources.value)[number] | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  source: null,
});

const escapeHtml = (value: string) =>
  `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const withCitationAnchors = (html: string) => {
  const occurMap = new Map<string, number>();
  return `${html || ""}`.replace(
    /\[(\d+)\]/g,
    (_match, num) => {
      const key = `${num}`;
      const currentOcc = (occurMap.get(key) || 0) + 1;
      occurMap.set(key, currentOcc);
      return `<button class="ask-cite-ref px-1 min-w-[1.25rem] text-xxxs bg-neutral-400 opacity-70 bg-opacity-50 rounded-lg text-center text-neutral-900 dark:text-neutral-100" data-cite-index="${num}" data-cite-occ="${currentOcc}" type="button">${num}</button>`;
    }
  );
};

const renderAskAnswerWithCitations = async () => {
  const rendered = await PLAPI.renderService.renderMarkdown(askAnswer.value, true);
  renderedAskAnswer.value = withCitationAnchors(rendered.renderedStr);
};

const restoreLastAskAnswer = async () => {
  const lastAnswer = `${(await PLMainAPI.preferenceService.get("quickpasteLastAskAnswer")) || ""}`;
  askAnswer.value = lastAnswer;
  if (lastAnswer) {
    await renderAskAnswerWithCitations();
  } else {
    renderedAskAnswer.value = "";
  }
  await resizeQuickpaste();
};

const resizeQuickpaste = async () => {
  await nextTick();
  const headerHeight = headerRef.value?.offsetHeight || 0;
  const dividerHeight = dividerRef.value?.offsetHeight || 0;
  const contentHeight = contentRef.value?.scrollHeight || 0;
  const footerHeight = footerRef.value?.offsetHeight || 0;
  const rootExtra =
    (quickpasteRoot.value?.offsetHeight || 0) -
    (headerHeight + dividerHeight + (contentRef.value?.offsetHeight || 0) + footerHeight);

  const measuredHeight =
    headerHeight + dividerHeight + contentHeight + footerHeight + Math.max(rootExtra, 0);
  const newHeight = Math.min(Math.max(measuredHeight, QUICKPASTE_MIN_HEIGHT), 620);
  const hasList = paperEntities.value.length > 0;
  const hasAnswer = !!`${renderedAskAnswer.value || ""}`.trim();

  let minHeight = QUICKPASTE_MIN_HEIGHT;
  if (isAskMode.value && hasList && hasAnswer) {
    // Ask mode dual-pane minimum: list + answer + footer all visible.
    minHeight = QUICKPASTE_ASK_DUAL_MIN_HEIGHT;
  } else if (isAskMode.value && (hasList || hasAnswer)) {
    // Ask mode single-pane minimum: one content area + footer visible.
    minHeight = QUICKPASTE_ASK_SINGLE_MIN_HEIGHT;
  }

  await PLMainAPI.windowProcessManagementService.resize(
    "quickpasteProcess",
    600,
    Math.max(newHeight, minHeight)
  );
};

const cycleMode = () => {
  exportMode.value =
    exportMode.value === "BibTex"
      ? "PlainText"
      : exportMode.value === "PlainText"
        ? "Ask"
        : "BibTex";
  askAnswer.value = "";
  renderedAskAnswer.value = "";
  askStatus.value = "";
  // @ts-ignore
  searchInput.value?.focus();
  void resizeQuickpaste();
  void onSearchTextChanged();
};

const applyLaunchMode = async () => {
  const launchMode = await PLMainAPI.preferenceService.get(
    "quickpasteLaunchMode"
  );
  exportMode.value = launchMode === "ask" ? "Ask" : "BibTex";
  await restoreLastAskAnswer();
  await resizeQuickpaste();
  await nextTick();
  // @ts-ignore
  searchInput.value?.focus();
};

// ====================
// Event Handler
// ====================
const onSearchTextChanged = debounce(async () => {
  const query = `${searchText.value || ""}`.trim();
  const requestSeq = ++searchRequestSeq;

  if (query) {
    paperEntities.value = [];
    selectedIndex.value = 0;
    askStatus.value = isAskMode.value ? t("plugin.askFindingRelated") : askStatus.value;

    let semanticResults: PaperEntity[] = [];
    try {
      semanticResults = (await PLAPI.semanticSearchService.search(
        query,
        8
      )) as unknown as PaperEntity[];
    } catch {
      semanticResults = [];
    }
    if (requestSeq !== searchRequestSeq) {
      return;
    }
    paperEntities.value = semanticResults.slice(0, 8);
    askStatus.value = "";
    if (paperEntities.value.length === 0) {
      // @ts-ignore
      paperEntities.value.push({
        id: "semantic-empty",
        title: t("plugin.askNoSemanticResultTryRebuild"),
      });
    }

    if (!isAskMode.value) {
      paperEntities.value = paperEntities.value.filter(
        // @ts-ignore
        (item) => item.id !== "search-in-google-scholar"
      );
      // @ts-ignore
      paperEntities.value.push({
        id: "search-in-google-scholar",
        title: t("plugin.searchInGoogleScholar"),
      });
    }

    await resizeQuickpaste();
  } else {
    await PLMainAPI.windowProcessManagementService.resize(
      "quickpasteProcess",
      600,
      QUICKPASTE_MIN_HEIGHT
    );
    paperEntities.value = [];
    askAnswer.value = "";
    renderedAskAnswer.value = "";
    await PLMainAPI.preferenceService.set({ quickpasteLastAskAnswer: "" });
    askStatus.value = "";
  }
}, searchDebounce.value);

const askLibrary = async () => {
  const query = `${searchText.value || ""}`.trim();
  if (!query || asking.value) {
    return;
  }

  asking.value = true;
  askAnswer.value = "";
  renderedAskAnswer.value = "";
  askStatus.value = t("plugin.askThinking");
  await nextTick();
  await resizeQuickpaste();

  try {
    const result = await PLAPI.askService.ask(query);
    askAnswer.value = result.answer || t("plugin.askNoAnswer");
    askSources.value = result.sources || [];
    await PLMainAPI.preferenceService.set({
      quickpasteLastAskAnswer: askAnswer.value,
    });
    await renderAskAnswerWithCitations();
    askStatus.value =
      result.sources.length === 0 ? t("plugin.askNoSemanticResultFound") : "";
  } catch (error) {
    askAnswer.value = "";
    renderedAskAnswer.value = "";
    askStatus.value = `${t("plugin.askFailedPrefix")}: ${(error as Error).message || error}`;
  } finally {
    asking.value = false;
    await resizeQuickpaste();
    // @ts-ignore
    searchInput.value?.focus();
  }
};

const onCitationHover = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }
  const refEl = target.closest(".ask-cite-ref") as HTMLElement | null;
  if (!refEl) {
    citationPopover.value.visible = false;
    return;
  }
  const idx = Number(refEl.dataset.citeIndex || "0");
  const occ = Number(refEl.dataset.citeOcc || "1");
  if (!idx || idx > askSources.value.length) {
    citationPopover.value.visible = false;
    return;
  }
  const source = askSources.value[idx - 1];
  const preciseQuote =
    source?.quoteCandidates && source.quoteCandidates.length >= occ
      ? source.quoteCandidates[occ - 1]
      : source?.quote || "";
  const sourceForPopover = {
    ...source,
    quote: preciseQuote || source?.quote || "",
  };
  const rect = refEl.getBoundingClientRect();
  const popoverWidth = 320;
  const popoverHeight = 170;
  const margin = 10;
  let left = rect.right + 8;
  let top = rect.top + rect.height / 2 - popoverHeight / 2;
  if (left + popoverWidth > window.innerWidth - margin) {
    left = rect.left - popoverWidth - 8;
  }
  if (left < margin) {
    left = rect.left;
  }
  if (left + popoverWidth > window.innerWidth - margin) {
    left = window.innerWidth - popoverWidth - margin;
  }
  if (left < margin) {
    left = margin;
  }
  if (top + popoverHeight > window.innerHeight - margin) {
    top = window.innerHeight - popoverHeight - margin;
  }
  if (top < margin) {
    top = margin;
  }
  citationPopover.value = {
    visible: true,
    x: left,
    y: top,
    source: sourceForPopover,
  };
};

const onCitationLeave = () => {
  citationPopover.value.visible = false;
};

const onCitationDoubleClick = async (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }
  const refEl = target.closest(".ask-cite-ref") as HTMLElement | null;
  if (!refEl) {
    return;
  }
  const idx = Number(refEl.dataset.citeIndex || "0");
  if (!idx || idx > askSources.value.length) {
    return;
  }
  const source = askSources.value[idx - 1];
  if (source?.mainURL) {
    await PLAPI.fileService.open(source.mainURL);
    return;
  }
  const papers = (await PLAPI.paperService.loadByIds([source.id as any])) as any[];
  const paper = papers?.[0];
  if (paper?.mainURL) {
    await PLAPI.fileService.open(paper.mainURL);
  }
};

const copyAskAnswer = async () => {
  const text = `${askAnswer.value || ""}`.trim();
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 1200);
  } catch {
    copySuccess.value = false;
  }
};

const exportSelectedCiteKeys = async () => {
  if (isAskMode.value) {
    await askLibrary();
    return;
  }

  const selectedEntity = paperEntities.value[selectedIndex.value];
  if (selectedEntity && selectedEntity.id === "semantic-empty") {
    return;
  } else if (selectedEntity && selectedEntity.id === "search-in-google-scholar") {
    await PLAPI.fileService.open(
      `https://scholar.google.com/scholar?q=${searchText.value}`
    );
  } else {
    await PLAPI.referenceService.export([selectedEntity] as any, "BibTex-Key");

    if (linkedFolder.value) {
      await PLAPI.paperService.updateWithCategorizer(
        [`${selectedEntity.id}`],
        new PaperFolder({ name: linkedFolder.value }),
        CategorizerType.PaperFolder
      );
    }
  }

  searchText.value = "";
  paperEntities.value = [];

  await PLMainAPI.windowProcessManagementService.hide(
    "quickpasteProcess",
    true
  );
};

const exportSelectedCiteBodies = async () => {
  if (isAskMode.value) {
    await askLibrary();
    return;
  }

  const selectedEntity = paperEntities.value[selectedIndex.value];
  if (selectedEntity && selectedEntity.id === "semantic-empty") {
    return;
  } else if (selectedEntity && selectedEntity.id === "search-in-google-scholar") {
    await PLAPI.fileService.open(
      `https://scholar.google.com/scholar?q=${searchText.value}`
    );
  } else {
    await PLAPI.referenceService.export(
      [selectedEntity] as any,
      exportMode.value
    );

    if (linkedFolder.value) {
      await PLAPI.paperService.updateWithCategorizer(
        [`${selectedEntity.id}`],
        new PaperFolder({ name: linkedFolder.value }),
        CategorizerType.PaperFolder
      );
    }
  }

  searchText.value = "";
  paperEntities.value = [];

  await PLMainAPI.windowProcessManagementService.hide(
    "quickpasteProcess",
    true
  );
};

const exportSelectedCiteBodiesInFolder = async () => {
  if (isAskMode.value) {
    await askLibrary();
    return;
  }

  const selectedEntity = paperEntities.value[selectedIndex.value];
  if (selectedEntity && selectedEntity.id === "semantic-empty") {
    return;
  } else if (selectedEntity && selectedEntity.id === "search-in-google-scholar") {
    await PLAPI.fileService.open(
      `https://scholar.google.com/scholar?q=${searchText.value}`
    );
  } else {
    if (linkedFolder.value && selectedEntity) {
      await PLAPI.paperService.updateWithCategorizer(
        [`${selectedEntity.id}`],
        new PaperFolder({ name: linkedFolder.value }),
        CategorizerType.PaperFolder
      );
    }

    if (exportMode.value === "BibTex") {
      await PLAPI.referenceService.export([], "BibTex-In-Folder");
    } else if (exportMode.value === "PlainText") {
      await PLAPI.referenceService.export([], "PlainText-In-Folder");
    }
  }

  searchText.value = "";
  paperEntities.value = [];

  await PLMainAPI.windowProcessManagementService.hide(
    "quickpasteProcess",
    true
  );
};

const onLinkClicked = async () => {
  folders.value = (
    await PLAPI.categorizerService.load(
      CategorizerType.PaperFolder,
      "name",
      "desc"
    )
  ).filter((f) => f.name !== "Folders") as PaperFolder[];
  PLMainAPI.contextMenuService.showQuickpasteLinkMenu(folders.value as any);
};

const onUnlinkClicked = async () => {
  await PLMainAPI.preferenceService.set({ pluginLinkedFolder: "" });
  linkedFolder.value = "";
  // @ts-ignore
  searchInput.value.focus();
};

const checkLinkedFolder = async () => {
  folders.value = (
    await PLAPI.categorizerService.load(
      CategorizerType.PaperFolder,
      "name",
      "desc"
    )
  ).filter((f) => f.name !== "Folders") as PaperFolder[];
  linkedFolder.value = (await PLMainAPI.preferenceService.get(
    "pluginLinkedFolder"
  )) as string;

  if (!folders.value.map((f) => f.name).includes(linkedFolder.value)) {
    linkedFolder.value = "";
  }
};

disposable(
  PLQPUIAPILocal.shortcutService.updateWorkingViewScope(
    PLQPUIAPILocal.shortcutService.viewScope.MAIN
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    "ArrowDown",
    () => {
      selectedIndex.value = Math.min(
        paperEntities.value.length - 1,
        selectedIndex.value + 1
      );
      // @ts-ignore
      searchInput.value.focus();
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    "ArrowUp",
    () => {
      selectedIndex.value = Math.max(0, selectedIndex.value - 1);
      // @ts-ignore
      searchInput.value.focus();
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    `${cmdOrCtrl}+Enter`,
    async () => {
      await exportSelectedCiteBodiesInFolder();

      // @ts-ignore
      searchInput.value.focus();
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    "Tab",
    () => {
      cycleMode();
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    "Shift+Enter",
    async () => {
      await exportSelectedCiteKeys();
      // @ts-ignore
      searchInput.value.focus();
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    "Enter",
    async () => {
      await exportSelectedCiteBodies();
      // @ts-ignore
      searchInput.value.focus();
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLQPUIAPILocal.shortcutService.register(
    "Escape",
    async () => {
      searchText.value = "";
      paperEntities.value = [];
      await PLMainAPI.windowProcessManagementService.hide(
        "quickpasteProcess",
        true
      );
    },
    true,
    true,
    PLQPUIAPILocal.shortcutService.viewScope.GLOBAL
  )
);

disposable(
  PLMainAPI.contextMenuService.on(
    "linkToFolderClicked",
    async (newValue: { value: string }) => {
      const folderName = newValue.value;
      if (
        !Object.values(folders.value)
          .map((f) => f.name)
          .includes(folderName)
      ) {
        await PLAPI.categorizerService.create(
          CategorizerType.PaperFolder,
          new PaperFolder({ name: folderName })
        );
      }

      await PLMainAPI.preferenceService.set({ pluginLinkedFolder: folderName });
      linkedFolder.value = folderName;
    }
  )
);

disposable(
  PLMainAPI.preferenceService.onChanged(
    "pluginLinkedFolder",
    (newValue: { value: string }) => {
      linkedFolder.value = newValue.value as string;
    }
  )
);

disposable(
  PLMainAPI.windowProcessManagementService.on(
    "quickpasteProcess",
    (payload: { value: string }) => {
      if (payload.value === "show") {
        void applyLaunchMode();
      }
    }
  )
);

onMounted(() => {
  nextTick(async () => {
    await checkLinkedFolder();
    await restoreLastAskAnswer();
  });
});
</script>

<template>
  <div ref="quickpasteRoot" class="relative flex h-full w-full flex-col overflow-hidden text-neutral-700 dark:text-neutral-200">
    <div ref="headerRef" class="flex">
      <input
        ref="searchInput"
        class="w-full h-12 text-sm px-3 bg-transparent focus:outline-none grow"
        type="text"
        autofocus
        :placeholder="$t('plugin.searchinpaperlib')"
        v-model="searchText"
        @input="onSearchTextChanged"
      />
      <div
        class="flex space-x-2 mr-2 text-xxs my-auto select-none text-neutral-400 border-[1px] border-neutral-400 dark:border-neutral-500 rounded-md px-2 py-1 hover:dark:border-neutral-200 hover:dark:text-neutral-200 hover:border-neutral-600 hover:text-neutral-600 transition-colors"
        @click="cycleMode"
      >
        {{ exportMode }}
      </div>
    </div>

    <hr ref="dividerRef" class="border-neutral-300 dark:border-neutral-700 mx-2" />

    <div ref="contentRef" class="min-h-0 flex-1 overflow-hidden">
      <div class="w-full px-2 pt-1">
        <div class="max-h-full overflow-y-auto">
          <TableItem
            v-for="(item, index) in paperEntities"
            :title="item.title"
            :authors="item.authors"
            :year="item.pubTime"
            :publication="item.publication"
            :active="selectedIndex == index"
            class="h-[28px]"
            @click="() => {}"
          />
        </div>
      </div>

      <div
        v-if="isAskMode && renderedAskAnswer"
        class="mx-2 mt-2 h-40 overflow-y-auto rounded-md bg-neutral-100 px-3 py-2 text-xs leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      >
        <div
          class="quickpaste-markdown"
          v-html="sanitizeHTML(renderedAskAnswer)"
          @mousemove="onCitationHover"
          @mouseleave="onCitationLeave"
          @dblclick="onCitationDoubleClick"
        />
      </div>
    </div>

    <div ref="footerRef" class="mb-[6px] mt-1 h-[24px] flex-none px-2 text-xxs text-neutral-400 flex justify-between">
      <div
        class="flex my-auto space-x-4 ml-1 hover:text-neutral-600 hover:dark:text-neutral-300 transition-colors"
      >
        <div
          class="flex space-x-1"
          @click="onLinkClicked"
          v-if="linkedFolder === '' && !isAskMode"
        >
          <BIconLink class="my-auto text-base" />
          <span class="my-auto mr-1 select-none">{{
            $t("plugin.linkfolder")
          }}</span>
        </div>
        <div
          class="flex space-x-1"
          @click="onUnlinkClicked"
          v-if="linkedFolder !== '' && !isAskMode"
          :class="
            linkedFolder !== ''
              ? 'text-neutral-600 dark:text-neutral-300'
              : 'text-neutral-400'
          "
        >
          <BIconLink class="my-auto text-base" />
          <span class="my-auto mr-1 select-none">{{ linkedFolder }}</span>
        </div>
        <div v-if="isAskMode" class="flex space-x-1 text-neutral-500 dark:text-neutral-300">
          <span class="my-auto mr-1 select-none">{{ $t("plugin.askLibrary") }}</span>
        </div>
      </div>

      <div v-if="!isAskMode" class="flex my-auto space-x-4">
        <div class="flex">
          <span class="my-auto mr-1 select-none">{{
            $t("plugin.citekey")
          }}</span>
          <div class="flex space-x-1">
            <BIconShift class="my-auto" /><BIconArrowReturnLeft
              class="my-auto"
            />
          </div>
        </div>
        <div class="flex" v-if="linkedFolder !== ''">
          <span class="my-auto mr-1 select-none">{{
            $t("plugin.allref")
          }}</span>
          <div class="flex space-x-1">
            <BIconCommand class="my-auto" />
            <BIconArrowReturnLeft class="my-auto" />
          </div>
        </div>
        <div class="flex">
          <span class="my-auto mr-1 select-none">{{
            $t("plugin.singleref")
          }}</span>
          <div class="flex space-x-1">
            <BIconArrowReturnLeft class="my-auto" />
          </div>
        </div>
      </div>
      <div v-if="isAskMode" class="flex my-auto space-x-1">
        <button
          class="inline-flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:text-neutral-600 dark:text-neutral-300 hover:dark:text-neutral-100"
          :disabled="!askAnswer"
          @click="copyAskAnswer"
        >
          <BIconCheck v-if="copySuccess" class="text-sm" />
          <BIconCopy v-else class="text-xs" />
        </button>
        <span
          v-if="asking"
          class="my-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-accentlight dark:border-neutral-600 dark:border-t-accentdark"
        />
        <span class="my-auto mr-1 select-none">{{
          asking ? $t("plugin.answering") : $t("plugin.answer")
        }}</span>
        <BIconArrowReturnLeft class="my-auto" />
      </div>
    </div>
  </div>
  <div
    v-if="citationPopover.visible && citationPopover.source"
    class="pointer-events-none fixed z-[9999] w-[320px] rounded-md border border-neutral-300 bg-white p-2 text-xxs text-neutral-700 shadow-lg dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
    :style="{ left: `${citationPopover.x}px`, top: `${citationPopover.y}px` }"
  >
    <div class="text-xs leading-5">
      {{ citationPopover.source.quote || citationPopover.source.publication || citationPopover.source.title }}
    </div>
    <div class="mt-1 truncate text-[10px] text-neutral-500 dark:text-neutral-400">
      [{{ citationPopover.source.year }}] {{ citationPopover.source.title }}
    </div>
  </div>
</template>

<style scoped>
.quickpaste-markdown :deep(p) {
  margin: 0 0 0.5rem;
}

.quickpaste-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.quickpaste-markdown :deep(ul),
.quickpaste-markdown :deep(ol) {
  margin: 0.25rem 0 0.5rem 1rem;
}

.quickpaste-markdown :deep(ul) {
  list-style: disc;
}

.quickpaste-markdown :deep(ol) {
  list-style: decimal;
}

.quickpaste-markdown :deep(strong) {
  font-weight: 650;
}

.quickpaste-markdown :deep(code) {
  border-radius: 0.25rem;
  background: rgb(229 229 229);
  padding: 0.05rem 0.25rem;
  font-size: 0.72rem;
}

.quickpaste-markdown :deep(.katex) {
  font-size: 1em;
}

.quickpaste-markdown :deep(.ask-cite-ref) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1rem;
  margin: 0 0.1rem;
  border: none;
  font-weight: 400;
  line-height: 1rem;
  cursor: pointer;
  pointer-events: auto;
  vertical-align: baseline;
  transform: translateY(-0.5px);
  transition: background-color 120ms ease;
}

.quickpaste-markdown :deep(.ask-cite-ref:hover) {
  background: rgb(163 163 163 / 0.68);
}

:global(.dark) .quickpaste-markdown :deep(.ask-cite-ref:hover) {
  background: rgb(115 115 115 / 0.65);
}

.quickpaste-markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  border-top: 1px solid rgb(163 163 163);
  border-bottom: 1px solid rgb(163 163 163);
  margin: 0.4rem 0;
}

.quickpaste-markdown :deep(thead tr) {
  border-bottom: 1px solid rgb(163 163 163);
}

.quickpaste-markdown :deep(th),
.quickpaste-markdown :deep(td) {
  padding: 0.2rem 0.45rem;
  text-align: left;
  border: none;
}

:global(.dark) .quickpaste-markdown :deep(table) {
  border-top-color: rgb(115 115 115);
  border-bottom-color: rgb(115 115 115);
}

:global(.dark) .quickpaste-markdown :deep(thead tr) {
  border-bottom-color: rgb(115 115 115);
}

:global(.dark) .quickpaste-markdown :deep(code) {
  background: rgb(64 64 64);
}
</style>
