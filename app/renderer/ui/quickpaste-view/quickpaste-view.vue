<script setup lang="ts">
import {
  BIconArrowReturnLeft,
  BIconCheck,
  BIconCommand,
  BIconCopy,
  BIconLink,
  BIconShift,
  BIconTable,
} from "bootstrap-icons-vue";
import { Ref, computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { disposable } from "@/base/dispose";
import { debounce } from "@/base/misc";
import type {
  ExperimentCompareColumn,
  ExperimentCompareResult,
} from "@/service/services/ask-service";
import { CategorizerType, PaperFolder } from "@/models/categorizer";
import { PaperEntity } from "@/models/paper-entity";
import { cmdOrCtrl } from "@/base/shortcut";
import { sanitizeHTML } from "@/renderer/utils/sanitize";

import TableItem from "./components/table-item.vue";

const { t } = useI18n();
const QUICKPASTE_MIN_HEIGHT = 88;
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
const compareResult = ref<ExperimentCompareResult | null>(null);
const compareStatus = ref("");
const comparing = ref(false);
const compareCopySuccess = ref(false);
const comparePaperEntities: Ref<any[]> = ref([]);
const copySuccess = ref(false);
const quickpasteRoot = ref<HTMLElement | null>(null);
const headerRef = ref<HTMLElement | null>(null);
const dividerRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const footerRef = ref<HTMLElement | null>(null);
const darkMode = ref(false);

// ====================
// State
// ====================
const searchInput = ref(null);
const exportMode = ref<"BibTex" | "PlainText" | "Ask" | "Compare">("BibTex");
const searchText = ref("");
const searchDebounce = ref(300);
const selectedIndex: Ref<number> = ref(0);
const linkedFolder = ref("");
const mainviewSortBy = ref("addTime");
const mainviewSortOrder: Ref<"desc" | "asce"> = ref("desc");
let searchRequestSeq = 0;
const isAskMode = computed(() => exportMode.value === "Ask");
const isCompareMode = computed(() => exportMode.value === "Compare");
const isAssistantMode = computed(() => isAskMode.value || isCompareMode.value);
const getPaperId = (paper: any) => `${paper?.id || paper?._id || ""}`.trim();
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
  return `${html || ""}`.replace(/\[(\d+)\]/g, (_match, num) => {
    const key = `${num}`;
    const currentOcc = (occurMap.get(key) || 0) + 1;
    occurMap.set(key, currentOcc);
    return `<button class="ask-cite-ref px-1 min-w-[1.25rem] text-xxxs bg-neutral-400 opacity-70 bg-opacity-50 rounded-lg text-center text-neutral-900 dark:text-neutral-100" data-cite-index="${num}" data-cite-occ="${currentOcc}" type="button">${num}</button>`;
  });
};

const renderAskAnswerWithCitations = async () => {
  const rendered = await PLAPI.renderService.renderMarkdown(
    askAnswer.value,
    true
  );
  renderedAskAnswer.value = withCitationAnchors(rendered.renderedStr);
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

const compareValueFor = (
  result: ExperimentCompareResult,
  rowIndex: number,
  columnId: string
) => {
  const row = result.rows[rowIndex];
  return `${row?.values?.[columnId] || "-"}`.trim() || "-";
};

const paperYear = (paper: any) => `${paper?.pubTime || paper?.year || ""}`;

const paperPublication = (paper: any) =>
  `${paper?.publication || paper?.journal || paper?.booktitle || ""}`;

const loadComparePapers = async () => {
  const ids = ((await PLMainAPI.preferenceService.get(
    "quickpasteComparePaperIds"
  )) || []) as string[];
  const uniqueIds = Array.from(new Set(ids.map((id) => `${id}`.trim()))).filter(
    Boolean
  );

  if (uniqueIds.length < 2) {
    comparePaperEntities.value = [];
    paperEntities.value = [];
    compareStatus.value = t("plugin.compareSelectAtLeastTwo");
    return [];
  }

  const loaded = (await PLAPI.paperService.loadByIds(
    uniqueIds.slice(0, 6) as any
  )) as any[];
  comparePaperEntities.value = loaded || [];
  paperEntities.value = (loaded || []) as any;
  compareStatus.value =
    comparePaperEntities.value.length < 2 ? t("plugin.compareLoadFailed") : "";
  return comparePaperEntities.value;
};

const restoreLastCompare = async () => {
  const lastInstruction = `${
    (await PLMainAPI.preferenceService.get(
      "quickpasteLastCompareInstruction"
    )) || ""
  }`;
  const lastResult = (await PLMainAPI.preferenceService.get(
    "quickpasteLastCompareResult"
  )) as ExperimentCompareResult | null;

  searchText.value = lastInstruction;
  if (lastResult?.columns && lastResult?.rows && lastResult?.papers) {
    compareResult.value = lastResult;
  }
};

const restoreLastAskAnswer = async () => {
  const lastAnswer = `${
    (await PLMainAPI.preferenceService.get("quickpasteLastAskAnswer")) || ""
  }`;
  askAnswer.value = lastAnswer;
  if (lastAnswer) {
    await renderAskAnswerWithCitations();
  } else {
    renderedAskAnswer.value = "";
  }
  await resizeQuickpaste();
};

const verticalMarginOf = (element: HTMLElement | null) => {
  if (!element) {
    return 0;
  }
  const style = window.getComputedStyle(element);
  return (
    Number.parseFloat(style.marginTop || "0") +
    Number.parseFloat(style.marginBottom || "0")
  );
};

const resizeQuickpaste = async () => {
  await nextTick();
  const headerHeight = headerRef.value?.offsetHeight || 0;
  const dividerHeight = dividerRef.value?.offsetHeight || 0;
  const contentHeight = isCompareMode.value
    ? Array.from(contentRef.value?.children || []).reduce((height, child) => {
        const element = child as HTMLElement;
        const style = window.getComputedStyle(element);
        return (
          height +
          element.offsetHeight +
          Number.parseFloat(style.marginTop || "0") +
          Number.parseFloat(style.marginBottom || "0")
        );
      }, 0)
    : contentRef.value?.scrollHeight || 0;
  const footerHeight =
    (footerRef.value?.offsetHeight || 0) + verticalMarginOf(footerRef.value);
  const rootExtra = isCompareMode.value
    ? 0
    : (quickpasteRoot.value?.offsetHeight || 0) -
      (headerHeight +
        dividerHeight +
        (contentRef.value?.offsetHeight || 0) +
        footerHeight);

  const measuredHeight =
    headerHeight +
    dividerHeight +
    contentHeight +
    footerHeight +
    Math.max(rootExtra, 0);
  const newHeight = Math.min(
    Math.max(measuredHeight, QUICKPASTE_MIN_HEIGHT),
    620
  );
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

const cycleMode = async () => {
  const nextMode =
    exportMode.value === "BibTex"
      ? "PlainText"
      : exportMode.value === "PlainText"
      ? "Ask"
      : exportMode.value === "Ask"
      ? "Compare"
      : "BibTex";

  exportMode.value = nextMode;
  askAnswer.value = "";
  renderedAskAnswer.value = "";
  askStatus.value = "";
  compareStatus.value = "";

  if (nextMode === "Compare") {
    await restoreLastCompare();
    await loadComparePapers();
  } else {
    comparePaperEntities.value = [];
    if (!searchText.value.trim()) {
      paperEntities.value = [];
    }
  }

  // @ts-ignore
  searchInput.value?.focus();
  await resizeQuickpaste();
  await onSearchTextChanged();
};

const applyLaunchMode = async () => {
  const launchMode = await PLMainAPI.preferenceService.get(
    "quickpasteLaunchMode"
  );
  exportMode.value =
    launchMode === "ask"
      ? "Ask"
      : launchMode === "compare"
      ? "Compare"
      : "BibTex";
  if (exportMode.value === "Ask") {
    await restoreLastAskAnswer();
  } else if (exportMode.value === "Compare") {
    askAnswer.value = "";
    renderedAskAnswer.value = "";
    askStatus.value = "";
    await restoreLastCompare();
    await loadComparePapers();
  } else {
    askAnswer.value = "";
    renderedAskAnswer.value = "";
    askStatus.value = "";
    compareResult.value = null;
    compareStatus.value = "";
  }
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

  if (isCompareMode.value) {
    await resizeQuickpaste();
    return;
  }

  if (query) {
    paperEntities.value = [];
    selectedIndex.value = 0;
    askStatus.value = isAskMode.value
      ? t("plugin.askFindingRelated")
      : askStatus.value;

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
    askStatus.value = `${t("plugin.askFailedPrefix")}: ${
      (error as Error).message || error
    }`;
  } finally {
    asking.value = false;
    await resizeQuickpaste();
    // @ts-ignore
    searchInput.value?.focus();
  }
};

const compareSelectedPapers = async () => {
  if (comparing.value) {
    return;
  }

  const papers =
    comparePaperEntities.value.length >= 2
      ? comparePaperEntities.value
      : await loadComparePapers();
  if (papers.length < 2) {
    compareStatus.value = t("plugin.compareSelectAtLeastTwo");
    await resizeQuickpaste();
    return;
  }

  comparing.value = true;
  compareStatus.value = t("plugin.compareReading");
  await nextTick();
  await resizeQuickpaste();

  try {
    const result = await PLAPI.askService.compareExperiments(
      papers.slice(0, 6),
      `${searchText.value || ""}`.trim()
    );
    compareResult.value = result;
    await PLMainAPI.preferenceService.set({
      quickpasteLastCompareInstruction: `${searchText.value || ""}`.trim(),
      quickpasteLastCompareResult: result as any,
    });
    compareStatus.value =
      result.rows.length > 0 ? "" : t("plugin.compareNoTableExtracted");
  } catch (error) {
    compareStatus.value = `${t("plugin.compareFailedPrefix")}: ${
      (error as Error).message || error
    }`;
  } finally {
    comparing.value = false;
    await resizeQuickpaste();
    // @ts-ignore
    searchInput.value?.focus();
  }
};

const escapeLatex = (value: string) =>
  `${value || ""}`
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

const buildCompareCopyLatex = (result: ExperimentCompareResult) => {
  const table = `${result.latex || ""}`.trim();
  if (!table) {
    return "";
  }

  const paperLegend = (result.papers || [])
    .map((paper, index) => `[${index + 1}] ${escapeLatex(paper.title || "")}`)
    .filter(Boolean)
    .join("; ");
  const notes = (result.notes || [])
    .map((note) => escapeLatex(note))
    .filter(Boolean)
    .join("; ");
  const warnings = (result.warnings || [])
    .map((warning) => escapeLatex(warning))
    .filter(Boolean)
    .join("; ");
  const footnoteLines = [
    paperLegend ? `\\textbf{Papers.} ${paperLegend}.` : "",
    notes ? `\\textbf{Notes.} ${notes}.` : "",
    warnings ? `\\textbf{Warnings.} ${warnings}.` : "",
  ].filter(Boolean);

  return [
    "% Requires \\usepackage{booktabs}",
    "\\begin{table*}[t]",
    "\\centering",
    `\\caption{${escapeLatex(result.title || "Experiment comparison")}}`,
    "\\small",
    table,
    footnoteLines.length > 0
      ? [
          "\\vspace{0.5em}",
          "\\begin{minipage}{\\linewidth}",
          "\\footnotesize",
          footnoteLines.join("\\\\\n"),
          "\\end{minipage}",
        ].join("\n")
      : "",
    "\\end{table*}",
  ]
    .filter(Boolean)
    .join("\n");
};

const copyCompareLatex = async () => {
  const text = compareResult.value
    ? buildCompareCopyLatex(compareResult.value)
    : "";
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    compareCopySuccess.value = true;
    setTimeout(() => {
      compareCopySuccess.value = false;
    }, 1200);
  } catch {
    compareCopySuccess.value = false;
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
  const papers = (await PLAPI.paperService.loadByIds([
    source.id as any,
  ])) as any[];
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
  if (isCompareMode.value) {
    await compareSelectedPapers();
    return;
  }

  const selectedEntity = paperEntities.value[selectedIndex.value];
  if (selectedEntity && selectedEntity.id === "semantic-empty") {
    return;
  } else if (
    selectedEntity &&
    selectedEntity.id === "search-in-google-scholar"
  ) {
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
  if (isCompareMode.value) {
    await compareSelectedPapers();
    return;
  }

  const selectedEntity = paperEntities.value[selectedIndex.value];
  if (selectedEntity && selectedEntity.id === "semantic-empty") {
    return;
  } else if (
    selectedEntity &&
    selectedEntity.id === "search-in-google-scholar"
  ) {
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
  if (isCompareMode.value) {
    await compareSelectedPapers();
    return;
  }

  const selectedEntity = paperEntities.value[selectedIndex.value];
  if (selectedEntity && selectedEntity.id === "semantic-empty") {
    return;
  } else if (
    selectedEntity &&
    selectedEntity.id === "search-in-google-scholar"
  ) {
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
    async () => {
      await cycleMode();
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

disposable(
  PLMainAPI.preferenceService.onChanged(
    ["quickpasteLaunchMode", "quickpasteComparePaperIds"],
    async () => {
      const launchMode = await PLMainAPI.preferenceService.get(
        "quickpasteLaunchMode"
      );
      if (launchMode !== "compare") {
        return;
      }
      if (exportMode.value !== "Compare") {
        exportMode.value = "Compare";
        askAnswer.value = "";
        renderedAskAnswer.value = "";
        askStatus.value = "";
        await restoreLastCompare();
      }
      await loadComparePapers();
      await resizeQuickpaste();
    }
  )
);

onMounted(() => {
  nextTick(async () => {
    darkMode.value =
      await PLMainAPI.windowProcessManagementService.isDarkMode();
    await checkLinkedFolder();
    await applyLaunchMode();
  });
});
</script>

<template>
  <div
    ref="quickpasteRoot"
    class="relative flex h-full w-full flex-col overflow-hidden text-neutral-700 dark:text-neutral-200"
  >
    <div ref="headerRef" class="flex">
      <input
        ref="searchInput"
        class="w-full h-12 text-sm px-3 bg-transparent focus:outline-none grow"
        type="text"
        autofocus
        :placeholder="
          isCompareMode
            ? $t('plugin.comparePlaceholder')
            : $t('plugin.searchinpaperlib')
        "
        v-model="searchText"
        @input="onSearchTextChanged"
      />
      <div
        class="mr-2 my-auto flex flex-none select-none whitespace-nowrap rounded-md border-[1px] border-neutral-400 px-2 py-1 text-xxs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-600 hover:dark:border-neutral-200 hover:dark:text-neutral-200 dark:border-neutral-500"
        @click="isCompareMode ? compareSelectedPapers() : cycleMode()"
      >
        {{ isCompareMode ? "Compare" : exportMode }}
      </div>
    </div>

    <hr
      ref="dividerRef"
      class="border-neutral-300 dark:border-neutral-700 mx-2"
    />

    <div
      ref="contentRef"
      :class="
        isCompareMode
          ? 'flex-none overflow-hidden'
          : 'min-h-0 flex-1 overflow-hidden'
      "
    >
      <div class="w-full px-2 pt-1">
        <div
          class="overflow-y-auto"
          :class="isCompareMode ? 'max-h-[86px]' : 'max-h-full'"
        >
          <TableItem
            v-for="(item, index) in paperEntities"
            :key="getPaperId(item) || index"
            :title="item.title"
            :authors="item.authors"
            :year="paperYear(item)"
            :publication="paperPublication(item)"
            :active="!isCompareMode && selectedIndex == index"
            class="h-[28px]"
            @click="() => !isCompareMode && (selectedIndex = index)"
          />
        </div>
      </div>

      <div
        v-if="isCompareMode && compareResult"
        class="mx-2 mt-2 h-96 overflow-y-auto rounded-md bg-neutral-100 px-3 py-2 text-xs leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      >
        <div>
          <div class="mb-1 flex items-center justify-between gap-2">
            <div class="min-w-0 truncate font-semibold">
              {{ compareResult.title }}
            </div>
            <button
              class="inline-flex h-6 w-6 flex-none items-center justify-center rounded hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-700"
              :disabled="!compareResult.latex"
              :title="$t('plugin.copyLatex')"
              @click="copyCompareLatex"
            >
              <BIconCheck v-if="compareCopySuccess" class="text-xs" />
              <BIconCopy v-else class="text-xs" />
            </button>
          </div>

          <div
            class="mb-2 space-y-0.5 text-[10px] leading-4 text-neutral-500 dark:text-neutral-400"
          >
            <div
              v-for="(paper, paperIndex) in compareResult.papers"
              :key="paper.id"
              class="truncate"
              :title="paper.title"
            >
              [{{ paperIndex + 1 }}] {{ paper.title }}
            </div>
          </div>

          <div
            v-if="
              compareResult.columns.length > 0 && compareResult.rows.length > 0
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
                      compareResult.columns
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
                    v-for="column in compareResult.columns"
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
                  v-for="(row, rowIndex) in compareResult.rows"
                  :key="row.id"
                  :class="row.role === 'proposed' ? 'proposed-row' : ''"
                >
                  <td :title="row.paperTitle">[{{ row.paperIndex }}]</td>
                  <td>
                    <span>{{ row.method }}</span>
                    <span
                      v-if="row.role !== 'other'"
                      class="role-badge ml-1 inline-flex h-4 items-center rounded border border-neutral-300 px-1 text-[10px] font-normal leading-none text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
                      :style="
                        darkMode && row.role === 'proposed'
                          ? {
                              borderColor: '#d4d4d4',
                              color: '#d4d4d4',
                              backgroundColor: 'transparent',
                            }
                          : undefined
                      "
                    >
                      {{ row.role }}
                    </span>
                  </td>
                  <td>{{ row.setting || "-" }}</td>
                  <td
                    v-for="column in compareResult.columns"
                    :key="`${row.id}-${column.id}`"
                    class="text-center tabular-nums"
                    :class="row.best?.[column.id] ? 'best-value' : ''"
                  >
                    {{ compareValueFor(compareResult, rowIndex, column.id) }}
                  </td>
                  <td>{{ row.source || "-" }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ $t("plugin.compareNoTable") }}
          </div>

          <div
            v-if="compareResult.warnings.length > 0"
            class="mt-2 space-y-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300"
          >
            <div v-for="warning in compareResult.warnings" :key="warning">
              {{ warning }}
            </div>
          </div>

          <div
            v-if="compareResult.notes.length > 0"
            class="mt-2 space-y-1 text-[10px] leading-4 text-neutral-500 dark:text-neutral-400"
          >
            <div v-for="note in compareResult.notes" :key="note">
              {{ note }}
            </div>
          </div>
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

    <div
      ref="footerRef"
      class="mb-2 mt-1 h-[24px] flex-none px-2 text-xxs text-neutral-400 flex justify-between"
    >
      <div
        class="flex my-auto space-x-4 ml-1 hover:text-neutral-600 hover:dark:text-neutral-300 transition-colors"
      >
        <div
          class="flex space-x-1"
          @click="onLinkClicked"
          v-if="linkedFolder === '' && !isAssistantMode"
        >
          <BIconLink class="my-auto text-base" />
          <span class="my-auto mr-1 select-none">{{
            $t("plugin.linkfolder")
          }}</span>
        </div>
        <div
          class="flex space-x-1"
          @click="onUnlinkClicked"
          v-if="linkedFolder !== '' && !isAssistantMode"
          :class="
            linkedFolder !== ''
              ? 'text-neutral-600 dark:text-neutral-300'
              : 'text-neutral-400'
          "
        >
          <BIconLink class="my-auto text-base" />
          <span class="my-auto mr-1 select-none">{{ linkedFolder }}</span>
        </div>
        <div
          v-if="isAskMode"
          class="flex space-x-1 text-neutral-500 dark:text-neutral-300"
        >
          <span class="my-auto mr-1 select-none">{{
            $t("plugin.askLibrary")
          }}</span>
        </div>
        <div
          v-if="isCompareMode"
          class="flex space-x-1 text-neutral-500 dark:text-neutral-300"
        >
          <BIconTable class="my-auto text-xs" />
          <span class="my-auto mr-1 select-none">
            {{
              $t("plugin.selectedPapers", {
                count: comparePaperEntities.length,
              })
            }}
          </span>
        </div>
      </div>

      <div v-if="!isAssistantMode" class="flex my-auto space-x-4">
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
      <div v-if="isCompareMode" class="flex my-auto space-x-1">
        <button
          class="inline-flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:text-neutral-600 dark:text-neutral-300 hover:dark:text-neutral-100"
          :disabled="!compareResult?.latex"
          @click="copyCompareLatex"
        >
          <BIconCheck v-if="compareCopySuccess" class="text-sm" />
          <BIconCopy v-else class="text-xs" />
        </button>
        <span
          v-if="comparing"
          class="my-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-accentlight dark:border-neutral-600 dark:border-t-accentdark"
        />
        <span class="my-auto mr-1 select-none">{{
          comparing ? $t("plugin.answering") : $t("plugin.answer")
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
      {{
        citationPopover.source.quote ||
        citationPopover.source.publication ||
        citationPopover.source.title
      }}
    </div>
    <div
      class="mt-1 truncate text-[10px] text-neutral-500 dark:text-neutral-400"
    >
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
