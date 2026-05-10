<script setup lang="ts">
import { Ref, computed, nextTick, onMounted, provide, ref } from "vue";

import { disposable } from "@/base/dispose";
import { removeLoading } from "@/base/loading";
import { FeedEntityFilterOptions } from "@/base/filter";
import { IFeedEntityCollection } from "@/models/feed-entity";
import { IFeedCollection } from "@/models/feed";
import { Entity, IEntityCollection } from "@/models/entity";
import { Process } from "@/base/process-id";
import { CategorizerType, ICategorizerCollection } from "@/models/categorizer";
import {
  PaperSmartFilterType,
  IPaperSmartFilterCollection,
} from "@/models/smart-filter";

import DeleteConfirmView from "./delete-confirm-view/delete-confirm-view.vue";
import DevView from "./dev-view/dev-view.vue";
import EditView from "./edit-view/edit-view.vue";
import FeedEditView from "./edit-view/feed-edit-view.vue";
import PaperSmartFilterEditView from "./edit-view/smartfilter-edit-view.vue";
import MainView from "./main-view/main-view.vue";
import PreferenceView from "./preference-view/preference-view.vue";
import PresettingView from "./presetting-view/presetting-view.vue";
import WelcomeView from "./welcome-view/welcome-view.vue";
import OverlayNotificationView from "./overlay-notification-view/overlay-notification-view.vue";
import GuideView from "./guide-view/guide-view.vue";
import { Supplementary } from "@/models/supplementary";
import { uid } from "@/base/misc";

// ================================
// State
// ================================

const uiState = PLUIAPILocal.uiStateService.useState();
const prefState = PLMainAPI.preferenceService.useState();
const showAPISetup = ref(false);
const setupAPIKey = ref("");
const setupSaving = ref(false);
const setupIsCN = computed(() => prefState.language === "zh-CN");

// ================================
// Data
// ================================
const paperEntities: Ref<IEntityCollection> = ref([]);
provide(
  "paperEntities",
  computed(() => paperEntities.value) as Ref<IEntityCollection>
);
const tags: Ref<ICategorizerCollection> = ref([]);
provide("tags", tags);
const folders: Ref<ICategorizerCollection> = ref([]);
provide("folders", folders);
const smartfilters: Ref<IPaperSmartFilterCollection> = ref([]);
provide("smartfilters", smartfilters);

const feeds: Ref<IFeedCollection> = ref([]);
provide("feeds", feeds);
const feedEntities: Ref<IFeedEntityCollection> = ref([]);
provide(
  "feedEntities",
  computed(() => feedEntities.value)
);

// ================================
// Data load
// ================================
const reloadPaperEntities = async () => {
  let querySentence: string;
  let fulltextQuerySetence: string | undefined = undefined;
  if (
    uiState.commandBarSearchMode === "semantic" &&
    uiState.querySentenceCommandbar.startsWith("semantic:")
  ) {
    paperEntities.value = await PLAPI.semanticSearchService.search(
      uiState.commandBarText,
      20
    );
    PLUIAPILocal.uiStateService.fire({ entitiesReloaded: Date.now() });
    return;
  }

  if (uiState.querySentenceCommandbar.includes("(fulltext contains")) {
    querySentence = uiState.querySentencesSidebar
      .map((x) => `(${x})`)
      .join(" AND ");
    fulltextQuerySetence = uiState.querySentenceCommandbar;
  } else {
    querySentence = [
      uiState.querySentenceCommandbar,
      ...uiState.querySentencesSidebar,
    ]
      .filter((x) => x)
      .map((x) => `(${x})`)
      .join(" AND ");
  }

  paperEntities.value = await PLAPI.paperService.load(
    querySentence,
    prefState.mainviewSortBy,
    prefState.mainviewSortOrder,
    fulltextQuerySetence
  );

  PLUIAPILocal.uiStateService.fire({ entitiesReloaded: Date.now() });
};

const removeBuiltInWelcomePapers = async () => {
  const seededWelcomePapers = paperEntities.value.filter((paper) => {
    const title = `${paper.title || ""}`.trim().toLowerCase();
    const authors = `${paper.authors || ""}`.trim().toLowerCase();
    const note = `${paper.note || ""}`.toLowerCase();
    const journal = `${paper.journal || ""}`.toLowerCase();

    const isWelcomeTitle =
      title === "welcome to paperlib!" ||
      title === "welcome to paperlib" ||
      title === "welcome to papermind!" ||
      title === "welcome to papermind";

    const isBuiltInSignature =
      authors.includes("papermind team") ||
      authors.includes("future scholars") ||
      authors.includes("geoffrey chen") ||
      note.includes("get started with paperlib") ||
      note.includes("get started with papermind") ||
      journal.includes("paperlib.app") ||
      journal === "papermind";

    return isWelcomeTitle && isBuiltInSignature;
  });

  if (seededWelcomePapers.length === 0) {
    return;
  }

  await PLAPI.paperService.delete(seededWelcomePapers.map((paper) => paper._id));
};

disposable(
  PLAPI.paperService.on("updated", () => {
    reloadPaperEntities();
  })
);

const reloadTags = async () => {
  tags.value = await PLAPI.categorizerService.load(
    CategorizerType.PaperTag,
    prefState.sidebarSortBy,
    prefState.sidebarSortOrder
  );
};
disposable(PLAPI.categorizerService.on("tagsUpdated", () => reloadTags()));

const reloadFolders = async () => {
  folders.value = await PLAPI.categorizerService.load(
    CategorizerType.PaperFolder,
    prefState.sidebarSortBy,
    prefState.sidebarSortOrder
  );
};
disposable(
  PLAPI.categorizerService.on("foldersUpdated", () => reloadFolders())
);

const reloadPaperSmartFilters = async () => {
  smartfilters.value = await PLAPI.smartFilterService.load(
    PaperSmartFilterType.smartfilter,
    prefState.sidebarSortBy === "count" ? "name" : prefState.sidebarSortBy,
    prefState.sidebarSortOrder
  );
};
disposable(
  PLAPI.smartFilterService.on("updated", () => reloadPaperSmartFilters())
);

const reloadFeeds = async () => {
  const results = await PLAPI.feedService.load(
    prefState.sidebarSortBy,
    prefState.sidebarSortOrder
  );
  feeds.value = results;
};
disposable(PLAPI.feedService.on("updated", () => reloadFeeds()));

const reloadFeedEntities = async () => {
  let feedName = "";
  let unread = false;

  if (uiState.selectedFeed === "feed-all") {
    feedName = "";
  } else if (uiState.selectedFeed === "feed-unread") {
    unread = true;
    feedName = "";
  } else {
    feedName = uiState.selectedFeed.replace("feed-", "");
  }

  feedEntities.value = await PLAPI.feedService.loadEntities(
    new FeedEntityFilterOptions({
      search: uiState.commandBarText,
      searchMode: uiState.commandBarSearchMode as any,
      feedNames: feedName ? [feedName] : [],
      unread,
    }),
    prefState.mainviewSortBy,
    prefState.mainviewSortOrder
  );
  PLUIAPILocal.uiStateService.fire({ entitiesReloaded: Date.now() });
};
disposable(PLAPI.feedService.on("entitiesUpdated", () => reloadFeedEntities()));

const changeFontsize = (fontsize: string) => {
  const html = document.querySelector("html");
  if (html) {
    html.style.fontSize =
      { normal: 100, large: 115, larger: 120 }[fontsize] + "%";
  }
};

const checkFirstAPISetup = async () => {
  const existingKey = await PLMainAPI.preferenceService.getPassword("qwenEmbedding");
  const dismissed = await PLMainAPI.preferenceService.get("apiSetupDismissed");
  showAPISetup.value = !existingKey && !dismissed;
  if (import.meta.env.DEV) {
    showAPISetup.value = true;
  }
};

const saveFirstAPISetup = async () => {
  const key = setupAPIKey.value.trim();
  if (!key) {
    return;
  }

  setupSaving.value = true;
  await PLMainAPI.preferenceService.setPassword("qwenEmbedding", key);
  PLMainAPI.preferenceService.set({
    semanticSearchEnabled: true,
    autoAITagging: true,
    apiSetupDismissed: true,
  });
  setupSaving.value = false;
  showAPISetup.value = false;
};

const dismissFirstAPISetup = () => {
  PLMainAPI.preferenceService.set({ apiSetupDismissed: true });
  showAPISetup.value = false;
};

// ================================
// Register State
// ================================
disposable(
  PLMainAPI.preferenceService.onChanged(
    ["mainviewSortBy", "mainviewSortOrder"],
    (value) => {
      if (uiState.contentType === "library") {
        reloadPaperEntities();
      } else if (uiState.contentType === "feed") {
        reloadFeedEntities();
      }
    }
  )
);

disposable(
  PLMainAPI.preferenceService.onChanged(
    ["sidebarSortBy", "sidebarSortOrder"],
    (value) => {
      reloadTags();
      reloadFolders();
      reloadPaperSmartFilters();
    }
  )
);

disposable(
  PLUIAPILocal.uiStateService.onChanged(
    [
      "selectedFeed",
      "contentType",
      "querySentencesSidebar",
      "querySentenceCommandbar",
    ],
    (value) => {
      if (uiState.contentType === "library") {
        reloadPaperEntities();
      } else if (uiState.contentType === "feed") {
        reloadFeedEntities();
      }
    }
  )
);

disposable(
  PLMainAPI.preferenceService.onChanged("appLibFolder", async (value) => {
    await PLAPI.databaseService.initialize();
  })
);

var initStartTime = Date.now();
let loadingWatchdog: NodeJS.Timeout | null = null;

const clearLoadingWatchdog = () => {
  if (loadingWatchdog) {
    clearTimeout(loadingWatchdog);
    loadingWatchdog = null;
  }
};

const armLoadingWatchdog = () => {
  clearLoadingWatchdog();
  loadingWatchdog = setTimeout(() => {
    PLAPI.logService.warn(
      "Initialization timeout fallback triggered.",
      "Continue launching UI without blocking splash screen.",
      false,
      "UI"
    );
    removeLoading();
  }, 20000);
};

disposable(
  PLAPI.databaseService.on("dbInitializing", async () => {
    initStartTime = Date.now();
    armLoadingWatchdog();

    PLUIAPILocal.uiStateService.resetUIStates();

    paperEntities.value = [];
    tags.value = [];
    folders.value = [];
    feeds.value = [];
    feedEntities.value = [];
  })
);

disposable(
  PLAPI.databaseService.on("dbInitialized", async () => {
    clearLoadingWatchdog();
    await PLAPI.fileService.initialize();
    await reloadPaperEntities();
    await removeBuiltInWelcomePapers();
    await reloadTags();
    await reloadFolders();
    await reloadPaperSmartFilters();
    removeLoading();
    reloadFeedEntities();
    reloadFeeds();
    var endTime = Date.now();
    PLAPI.logService.info(
      `Database initialized in ${endTime - initStartTime}ms`,
      "",
      false,
      "UI"
    );

    // Notify the main process that the app is ready,
    //   so that the main process can initialize the extension process
    PLMainAPI.windowProcessManagementService.fireServiceReady(Process.renderer);
  })
);

disposable(
  PLMainAPI.windowProcessManagementService.on(
    Process.renderer,
    (newValue: { value: string }) => {
      if (newValue.value === "blur") {
        uiState.mainViewFocused = false;
        PLAPI.databaseService.pauseSync();
      } else if (newValue.value === "focus") {
        uiState.mainViewFocused = true;
        PLAPI.databaseService.resumeSync();
      }
    }
  )
);

disposable(
  PLMainAPI.upgradeService.on("downloading", (newValue: { value: number }) => {
    PLAPI.logService.progress(
      "Downloading Update...",
      newValue.value,
      true,
      "Version"
    );
  })
);

disposable(
  PLMainAPI.preferenceService.onChanged("fontsize", (newValue) => {
    changeFontsize(newValue.value);
  })
);

disposable(
  PLMainAPI.preferenceService.onChanged("sourceFileOperation", (newValue) => {
    PLAPI.fileService.initialize();
  })
);

// ================================
// Dev Functions
// ================================
const onAddDummyClicked = async () => {
  const dummpyPaperEntities: Entity[] = [];

  for (
    let i = paperEntities.value.length;
    i < 100 + paperEntities.value.length;
    i++
  ) {
    const supId = uid();
    const sup = new Supplementary({
      _id: supId,
      name: `DUM - ${i}`,
      url: "https://www.google.com",
    });
    if (i % 2 === 0) {
      const codeSupId = uid();
      const codeSup = new Supplementary({
        _id: codeSupId,
        name: `Official`,
        url: "https://github.com/Future-Scholars/paperlib",
      });

      const dummyPaperEntity = new Entity(
        {
          title: `Dummy Paper <scp>D</scp>-${i}<sup>+T</sup> Test latex $^${i}_{a}$`,
          authors: "Dummy Author A, Dummy Author B, Dummy Author C",
          year: `${Math.round(2021 + Math.random() * 10)}`,
          journal: `Publication ${Math.round(Math.random() * 10)}`,
          type: "article",
          arxiv: "arXiv:2301.00001",
          supplementaries: {
            [supId]: sup,
            [codeSupId]: codeSup,
          }
        },
        true
      );
      dummpyPaperEntities.push(dummyPaperEntity);
    } else {
      const dummyPaperEntity = new Entity(
        {
          title: `Dummy Paper <scp>D</scp>-${i}<sup>+T</sup> Test latex $^${i}_{a}$`,
          authors: "Dummy Author A, Dummy Author B, Dummy Author C",
          year: `${Math.round(2021 + Math.random() * 10)}`,
          booktitle: `Publication ${Math.round(Math.random() * 10)}`,
          doi: "10.1000/xyz123",
          type: "inproceedings",
          supplementaries: {
            [supId]: sup
          }
        },
        true
      );
      dummpyPaperEntities.push(dummyPaperEntity);
    }
  }

  await PLAPI.paperService.update(dummpyPaperEntities);
};
const onAddFromFileClicked = async () => {
  await PLAPI.paperService.create([`${process.cwd()}/tests/pdfs/cs/1.pdf`]);
};
const onAddFromFilesClicked = async () => {
  await PLAPI.paperService.create([
    `${process.cwd()}/tests/pdfs/cs/1.pdf`,
    `${process.cwd()}/tests/pdfs/cs/2.pdf`,
  ]);
};

let clickTimes = 0;
let clickTimer: NodeJS.Timeout | null = null;
const onRemoveAllClicked = async () => {
  if (clickTimes < 5) {
    clickTimes++;

    if (!clickTimer) {
      clickTimer = setTimeout(() => {
        clickTimes = 0;
        clickTimer = null;
      }, 2000);
    }

    return;
  } else {
    PLAPI.paperService.delete(paperEntities.value.map((x) => x._id));
    clickTimes = 0;
  }
};
const onReloadAllClicked = async () => {
  await reloadPaperEntities();
  await reloadTags();
  await reloadFolders();
  await reloadPaperSmartFilters();
};
const onPrintClicked = () => {
  console.log("paperEntities ========");
  for (let i = 0; i < Math.min(10, paperEntities.value.length); i++) {
    console.log(paperEntities.value[i]);
  }

  console.log("tags ========");
  console.log(tags.value);

  console.log("folders ========");
  console.log(folders.value);
};
const onNotifyInfoClicked = () => {
  const randomString = Math.random().toString(36).slice(-8);
  PLAPI.logService.info(randomString, "additional info", true, "DEVLOG");
};
const onNotifyWarnClicked = () => {
  const randomString = Math.random().toString(36).slice(-8);
  PLAPI.logService.warn(randomString, "additional info", true, "DEVLOG");
};
const onNotifyErrorClicked = () => {
  const randomString = Math.random().toString(36).slice(-8);
  PLAPI.logService.error(randomString, "additional info", true, "DEVLOG");
};
const onNotifyProgressClicked = () => {
  const randomNumber = Math.floor(Math.random() * 100);
  PLAPI.logService.progress("Progress...", randomNumber, true, "DEVLOG");
};

// ================================
// Mount Hook
// ================================
onMounted(async () => {
  nextTick(async () => {
    changeFontsize(
      (await PLMainAPI.preferenceService.get("fontsize")) as string
    );
    await checkFirstAPISetup();

    armLoadingWatchdog();
    try {
      await PLAPI.databaseService.initialize(true);
    } catch (error) {
      clearLoadingWatchdog();
      PLAPI.logService.error(
        "Failed to initialize database on startup.",
        `${(error as Error).message || error}`,
        true,
        "UI"
      );
      removeLoading();
    }
  });
});
</script>

<template>
  <div class="flex text-neutral-700 dark:text-neutral-200">
    <DevView
      @event:add-dummy="onAddDummyClicked"
      @event:add-from-file="onAddFromFileClicked"
      @event:add-from-files="onAddFromFilesClicked"
      @event:remove-all="onRemoveAllClicked"
      @event:reload-all="onReloadAllClicked"
      @event:print="onPrintClicked"
      @event:notify-info="onNotifyInfoClicked"
      @event:notify-warn="onNotifyWarnClicked"
      @event:notify-error="onNotifyErrorClicked"
      @event:notify-progress="onNotifyProgressClicked"
      v-if="uiState.isDevMode"
    />
    <MainView />

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <EditView v-if="uiState.editViewShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <FeedEditView v-if="uiState.feedEditViewShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <PaperSmartFilterEditView v-if="uiState.paperSmartFilterEditViewShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <PreferenceView v-if="uiState.preferenceViewShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <DeleteConfirmView v-if="uiState.deleteConfirmShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <OverlayNotificationView v-if="uiState.overlayNoticationShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <GuideView v-if="prefState.showGuide" />
    </Transition>

    <!-- <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <PresettingView v-if="prefState.showPresetting" />
    </Transition>  -->

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <WelcomeView v-if="prefState.showWelcome" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <div
        v-if="showAPISetup"
        class="fixed inset-0 z-50 flex bg-black/30 backdrop-blur-sm"
      >
        <div
          class="m-auto w-[420px] max-w-[calc(100vw-32px)] rounded-lg bg-white dark:bg-neutral-800 shadow-xl border border-neutral-200 dark:border-neutral-700 p-6"
        >
          <div class="text-lg font-semibold mb-2">
            {{ setupIsCN ? "配置 Qwen API" : "Set Up Qwen API" }}
          </div>
          <div class="text-xs text-neutral-600 dark:text-neutral-400 mb-4 leading-5">
            {{
              setupIsCN
                ? "PaperMind 会用这个 API 做语义搜索、导入时自动 embedding 和 AI 标签。你也可以以后在设置里的语义搜索页面修改。"
                : "PaperMind uses this API for semantic search, import-time embeddings, and AI tags. You can change it later in Semantic Search settings."
            }}
          </div>
          <input
            v-model="setupAPIKey"
            type="password"
            placeholder="sk-..."
            class="w-full h-9 rounded-md bg-neutral-100 dark:bg-neutral-700 px-3 text-sm outline-none border border-neutral-200 dark:border-neutral-600"
            @keydown.enter="saveFirstAPISetup"
          />
          <div class="flex justify-end space-x-2 mt-5">
            <button
              class="h-8 px-3 rounded-md text-xs bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 hover:dark:bg-neutral-600"
              @click="dismissFirstAPISetup"
            >
              {{ setupIsCN ? "稍后" : "Later" }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs text-white bg-accentlight dark:bg-accentdark disabled:opacity-50"
              :disabled="setupSaving || !setupAPIKey.trim()"
              @click="saveFirstAPISetup"
            >
              {{ setupSaving ? (setupIsCN ? "保存中" : "Saving") : setupIsCN ? "保存并启用" : "Save and Enable" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
