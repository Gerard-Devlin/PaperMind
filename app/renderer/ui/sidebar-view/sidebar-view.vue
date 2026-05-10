<script setup lang="ts">
import stickyNoteLogo from "@/renderer/assets/logo-sticky-note.png?asset";

import NotificationBar from "./components/notification-bar.vue";
import SwitcherTitle from "./components/switcher-title.vue";
import WindowControlBar from "./components/window-control-bar.vue";
import SidebarFeedsView from "./sidebar-feeds-view.vue";
import SidebarLibraryView from "./sidebar-library-view.vue";

const uiState = PLUIAPILocal.uiStateService.useState();

const onViewContentSwitch = (view: number) => {
  if (view === 0) {
    uiState.selectedIndex = [];
    uiState.selectedQuerySentenceIds = ["lib-all"];
    uiState.querySentencesSidebar = [];
  } else {
    uiState.selectedIndex = [];
    uiState.selectedFeed = "feed-all";
  }
  uiState.contentType = ["library", "feed"][view];
};

</script>

<template>
  <div class="flex-none flex flex-col w-full min-w-0 h-screen justify-between overflow-hidden">
    <WindowControlBar class="flex-none" v-if="uiState.os !== 'win32'" />
    <div
      class="h-16 draggable-title flex w-full min-w-0 px-4"
      v-if="uiState.os === 'win32'"
    >
      <div class="flex-row flex items-center space-x-3 min-w-0">
        <img class="w-8 flex-none" :src="stickyNoteLogo" />
        <span class="text-sm font-semibold truncate">PAPERMIND</span>
      </div>
    </div>

    <SwitcherTitle
      class="h-7"
      :titles="[$t('mainview.library'), $t('mainview.feeds')]"
      @changed="onViewContentSwitch"
    />

    <SidebarLibraryView
      class="w-full min-w-0 h-[calc(100vh-5rem)] px-2 overflow-y-auto no-scrollbar"
      v-if="uiState.contentType === 'library'"
    />
    <SidebarFeedsView
      class="w-full min-w-0 h-[calc(100vh-5rem)] px-2 overflow-y-auto no-scrollbar"
      v-if="uiState.contentType === 'feed'"
    />

    <NotificationBar class="flex-none" />
  </div>
</template>
