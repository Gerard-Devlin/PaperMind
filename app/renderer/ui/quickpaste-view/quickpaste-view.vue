<script setup lang="ts">
import {
  BIconArrowReturnLeft,
  BIconCommand,
  BIconLink,
  BIconShift,
} from "bootstrap-icons-vue";
import { Ref, computed, nextTick, onMounted, ref } from "vue";

import { disposable } from "@/base/dispose";
import { debounce } from "@/base/misc";
import { CategorizerType, PaperFolder } from "@/models/categorizer";
import { PaperEntity } from "@/models/paper-entity";
import { cmdOrCtrl } from "@/base/shortcut";

import TableItem from "./components/table-item.vue";

// ====================
// Data
// ====================
const paperEntities: Ref<PaperEntity[]> = ref([]);
const folders: Ref<PaperFolder[]> = ref([]);
const askAnswer = ref("");
const askStatus = ref("");
const asking = ref(false);

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

const resizeQuickpaste = async () => {
  const paperHeight = paperEntities.value.length * 28;
  const answerHeight = isAskMode.value && askAnswer.value ? 170 : 0;
  const newHeight = Math.min(paperHeight + answerHeight + 78, 620);

  await PLMainAPI.windowProcessManagementService.resize(
    "quickpasteProcess",
    600,
    Math.max(newHeight, 76)
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
  askStatus.value = "";
  // @ts-ignore
  searchInput.value?.focus();
  void onSearchTextChanged();
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
    askAnswer.value = "";
    askStatus.value = isAskMode.value ? "Finding related papers..." : "";

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
        title: "No semantic result (try Rebuild Index)",
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
        title: "Search in Google Scholar...",
      });
    }

    await resizeQuickpaste();
  } else {
    await PLMainAPI.windowProcessManagementService.resize(
      "quickpasteProcess",
      600,
      76
    );
    paperEntities.value = [];
    askAnswer.value = "";
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
  askStatus.value = "Thinking with your library...";
  await nextTick();
  await resizeQuickpaste();

  try {
    const result = await PLAPI.askService.ask(query);
    askAnswer.value = result.answer || "No answer.";
    askStatus.value =
      result.sources.length === 0 ? "No semantic result found." : "";
  } catch (error) {
    askAnswer.value = "";
    askStatus.value = `Ask failed: ${(error as Error).message || error}`;
  } finally {
    asking.value = false;
    await resizeQuickpaste();
    // @ts-ignore
    searchInput.value?.focus();
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
      if (payload.value === "show" || payload.value === "hide") {
        paperEntities.value = [];
        askAnswer.value = "";
        askStatus.value = "";
      }
    }
  )
);

onMounted(() => {
  nextTick(async () => {
    await checkLinkedFolder();
  });
});
</script>

<template>
  <div class="w-full text-neutral-700 dark:text-neutral-200">
    <div class="flex">
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

    <hr class="border-neutral-300 dark:border-neutral-700 mx-2" />

    <div class="w-full px-2">
      <div class="flex flex-col pt-1">
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
      v-if="isAskMode && askAnswer"
      class="mx-2 mt-2 h-[150px] overflow-y-auto rounded-md bg-neutral-100 px-3 py-2 text-xs leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
    >
      <div v-if="askAnswer" class="whitespace-pre-wrap">
        {{ askAnswer }}
      </div>
    </div>

    <div
      class="h-[24px] p-2 text-xxs text-neutral-400 flex justify-between fixed bottom-[6px]"
    >
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
          <span class="my-auto mr-1 select-none">Ask library</span>
        </div>
      </div>

      <div v-if="!isAskMode" class="flex my-auto space-x-4 right-2 fixed">
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
      <div v-if="isAskMode" class="flex my-auto space-x-1 right-2 fixed">
        <span
          v-if="asking"
          class="my-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-accentlight dark:border-neutral-600 dark:border-t-accentdark"
        />
        <span class="my-auto mr-1 select-none">{{
          asking ? "Answering" : "Answer"
        }}</span>
        <BIconArrowReturnLeft class="my-auto" />
      </div>
    </div>
  </div>
</template>
