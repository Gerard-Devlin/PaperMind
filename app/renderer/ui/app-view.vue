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
import PaperGraphView from "./paper-graph-view/paper-graph-view.vue";
import { Supplementary } from "@/models/supplementary";
import { uid } from "@/base/misc";

// ================================
// State
// ================================

const uiState = PLUIAPILocal.uiStateService.useState();
const uiSlotState = PLUIAPILocal.uiSlotService.useState();
const prefState = PLMainAPI.preferenceService.useState();
const hasRenderableOverlayNotifications = computed(() => {
  const notifications = Object.values(uiSlotState.overlayNotifications || {});
  return notifications.some((item: any) => {
    const title = `${item?.title || ""}`.trim();
    const content = `${item?.content || ""}`.trim();
    return title.length > 0 || content.length > 0;
  });
});

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
  const hasCommandSearch =
    `${uiState.commandBarText || ""}`.trim().length > 0 ||
    `${uiState.querySentenceCommandbar || ""}`.startsWith("semantic:");

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
    querySentence = hasCommandSearch
      ? ""
      : uiState.querySentencesSidebar.map((x) => `(${x})`).join(" AND ");
    fulltextQuerySetence = uiState.querySentenceCommandbar;
  } else {
    const sentenceParts = hasCommandSearch
      ? [uiState.querySentenceCommandbar]
      : [uiState.querySentenceCommandbar, ...uiState.querySentencesSidebar];
    querySentence = sentenceParts
      .filter((x) => x)
      .map((x) => `(${x})`)
      .join(" AND ");
  }

  const paperSortBy =
    prefState.mainviewSortBy === "recommendationScore"
      ? "addTime"
      : prefState.mainviewSortBy;

  paperEntities.value = await PLAPI.paperService.load(
    querySentence,
    paperSortBy,
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

const sortFeedEntityValue = (entity: any, key: string) => {
  if (key === "publication") {
    return `${entity.publication || ""}`.toLowerCase();
  }
  if (key === "recommendationScore") {
    return Number(`${entity.recommendationScore || "0"}`.replace("%", ""));
  }
  if (key === "pubTime") {
    return Date.parse(entity.pubTime || "") || Number(entity.pubTime || 0) || 0;
  }
  if (key === "addTime" || key === "feedTime") {
    return new Date(entity[key] || 0).getTime();
  }
  return `${entity[key] || ""}`.toLowerCase();
};

const sortFeedEntities = (entities: IFeedEntityCollection) => {
  const isRecommendation = `${uiState.selectedFeed || ""}`.startsWith(
    "feed-recommended-arxiv"
  );
  const sortBy = isRecommendation
    ? prefState.arxivRecommendationSortBy || "recommendationScore"
    : prefState.mainviewSortBy;
  const sortOrder = isRecommendation
    ? prefState.arxivRecommendationSortOrder || "desc"
    : prefState.mainviewSortOrder;
  return [...Array.from(entities as any)].sort((a, b) => {
    const left = sortFeedEntityValue(a, sortBy);
    const right = sortFeedEntityValue(b, sortBy);
    if (left === right) {
      return 0;
    }
    const result = left > right ? 1 : -1;
    return sortOrder === "desc" ? -result : result;
  }) as IFeedEntityCollection;
};

const reloadFeedEntities = async () => {
  let feedName = "";
  let unread = false;

  if (uiState.selectedFeed === "feed-all") {
    feedName = "";
  } else if (uiState.selectedFeed === "feed-unread") {
    unread = true;
    feedName = "";
  } else if (uiState.selectedFeed.startsWith("feed-recommended-arxiv")) {
    const keyword = uiState.selectedFeed
      .replace(/^feed-recommended-arxiv:?/, "")
      .trim();
    feedEntities.value = sortFeedEntities(
      await PLAPI.feedService.loadArxivRecommendations(keyword)
    );
    PLUIAPILocal.uiStateService.fire({ entitiesReloaded: Date.now() });
    return;
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
disposable(
  PLAPI.feedService.on(
    ["entitiesUpdated", "arxivRecommendationsUpdated"],
    () => reloadFeedEntities()
  )
);

const changeFontsize = (fontsize: string) => {
  const html = document.querySelector("html");
  if (html) {
    html.style.fontSize =
      { normal: 100, large: 115, larger: 120 }[fontsize] + "%";
  }
};

// ================================
// Register State
// ================================
disposable(
  PLMainAPI.preferenceService.onChanged(
    [
      "mainviewSortBy",
      "mainviewSortOrder",
      "arxivRecommendationSortBy",
      "arxivRecommendationSortOrder",
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
  PLMainAPI.preferenceService.onChanged(
    ["sidebarSortBy", "sidebarSortOrder", "arxivRecommendationKeywords"],
    (value) => {
      reloadTags();
      reloadFolders();
      reloadPaperSmartFilters();
      if (
        value.key === "arxivRecommendationKeywords" &&
        uiState.contentType === "feed" &&
        uiState.selectedFeed.startsWith("feed-recommended-arxiv")
      ) {
        reloadFeedEntities();
      }
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
      <PaperGraphView v-if="uiState.paperGraphViewShown" />
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <OverlayNotificationView
        v-if="uiState.overlayNoticationShown && hasRenderableOverlayNotifications"
      />
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

    <Transition
      enter-active-class="transition ease-out duration-75"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <PresettingView v-if="prefState.showPresetting" />
    </Transition>

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
  </div>
</template>
