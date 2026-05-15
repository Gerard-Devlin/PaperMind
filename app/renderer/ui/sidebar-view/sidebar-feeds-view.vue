<script setup lang="ts">
import {
  BIconAppIndicator,
  BIconBroadcast,
  BIconRss,
  BIconTag,
} from "bootstrap-icons-vue";
import { Ref, inject, nextTick, ref } from "vue";

import { Feed } from "@/models/feed";
import { IFeedCollection } from "@/models/feed";

import { disposable } from "@/base/dispose";
import CollopseGroup from "./components/collopse-group.vue";
import SectionItem from "./components/section-item.vue";

const colorClass = (color?: string) => {
  switch (color) {
    case "blue":
    case null:
    case undefined:
      return "text-blue-500";
    case "red":
      return "text-red-500";
    case "green":
      return "text-green-500";
    case "yellow":
      return "text-yellow-500";
    case "purple":
      return "text-purple-500";
    case "pink":
      return "text-pink-500";
    case "orange":
      return "text-orange-500";
    case "cyan":
      return "text-cyan-500";
    default:
      return "text-blue-500";
  }
};

// ================================
// State
// ================================
const prefState = PLMainAPI.preferenceService.useState();
const uiState = PLUIAPILocal.uiStateService.useState();
const feedState = PLAPI.feedService.useState();
const processingState = PLUIAPILocal.uiStateService.processingState.useState();

// ================================
// Data
// ================================
const feeds = inject<Ref<IFeedCollection>>("feeds");
const isAddingRecommendationKeyword = ref(false);
const newRecommendationKeyword = ref("");
const recommendationKeywordInput = ref<HTMLInputElement | null>(null);
const editingRecommendationKeyword = ref("");

// ================================
// Event Functions
// ================================
const onSelectFeed = (feed: string) => {
  uiState.selectedFeed = feed;
};

const onSelectRecommendationKeyword = (keyword: string) => {
  uiState.selectedFeed = `feed-recommended-arxiv:${keyword}`;
};

const onItemRightClicked = (event: MouseEvent, feed: Feed) => {
  PLMainAPI.contextMenuService.showSidebarMenu(`${feed.id}`, "feed");
};

const onAddNewFeedClicked = () => {
  uiState.feedEditViewShown = true;
};

const normalizeRecommendationKeyword = (keyword: string) =>
  `${keyword || ""}`.replace(/\s+/g, " ").trim();

const onAddRecommendationKeywordClicked = async () => {
  isAddingRecommendationKeyword.value = true;
  newRecommendationKeyword.value = "";
  await nextTick();
  recommendationKeywordInput.value?.focus();
};

const onRecommendationKeywordInputConfirmed = async () => {
  const keyword = normalizeRecommendationKeyword(newRecommendationKeyword.value);
  if (!keyword) {
    isAddingRecommendationKeyword.value = false;
    return;
  }

  const keywords = Array.from(
    new Set([
      ...((prefState.arxivRecommendationKeywords || []) as string[]),
      keyword,
    ])
  );
  uiState.selectedFeed = `feed-recommended-arxiv:${keyword}`;
  await PLMainAPI.preferenceService.set({ arxivRecommendationKeywords: keywords });
  isAddingRecommendationKeyword.value = false;
  newRecommendationKeyword.value = "";
};

const onRecommendationKeywordInputCanceled = () => {
  isAddingRecommendationKeyword.value = false;
  newRecommendationKeyword.value = "";
};

const removeRecommendationKeyword = async (keyword: string) => {
  const keywords = ((prefState.arxivRecommendationKeywords || []) as string[])
    .map(normalizeRecommendationKeyword)
    .filter((item) => item && item !== keyword);
  const colors = { ...(prefState.arxivRecommendationKeywordColors || {}) };
  delete colors[keyword];
  if (uiState.selectedFeed === `feed-recommended-arxiv:${keyword}`) {
    uiState.selectedFeed = "feed-all";
  }
  await PLMainAPI.preferenceService.set({
    arxivRecommendationKeywords: keywords,
    arxivRecommendationKeywordColors: colors,
  });
};

const onRecommendationKeywordRightClicked = (
  event: MouseEvent,
  keyword: string
) => {
  event.preventDefault();
  PLMainAPI.contextMenuService.showSidebarMenu(
    keyword,
    "arxivRecommendationKeyword"
  );
};

const onRecommendationKeywordEditConfirmed = async (oldKeyword: string) => {
  const newKeyword = normalizeRecommendationKeyword(newRecommendationKeyword.value);
  editingRecommendationKeyword.value = "";
  newRecommendationKeyword.value = "";
  if (!newKeyword || newKeyword === oldKeyword) {
    return;
  }

  const keywords = ((prefState.arxivRecommendationKeywords || []) as string[])
    .map(normalizeRecommendationKeyword)
    .filter(Boolean)
    .map((item) => (item === oldKeyword ? newKeyword : item));
  const uniqueKeywords = Array.from(new Set(keywords));
  const colors = { ...(prefState.arxivRecommendationKeywordColors || {}) };
  if (colors[oldKeyword] && !colors[newKeyword]) {
    colors[newKeyword] = colors[oldKeyword];
  }
  delete colors[oldKeyword];
  if (uiState.selectedFeed === `feed-recommended-arxiv:${oldKeyword}`) {
    uiState.selectedFeed = `feed-recommended-arxiv:${newKeyword}`;
  }
  await PLMainAPI.preferenceService.set({
    arxivRecommendationKeywords: uniqueKeywords,
    arxivRecommendationKeywordColors: colors,
  });
};

const onRecommendationKeywordEditCanceled = () => {
  editingRecommendationKeyword.value = "";
  newRecommendationKeyword.value = "";
};

// ================================
// Register Context Menu Callbacks
// ================================
disposable(
  PLMainAPI.contextMenuService.on(
    "sidebarContextMenuDeleteClicked",
    (newValue: { value: { data: string; type: string } }) => {
      if (uiState.contentType === "feed") {
        if (newValue.value.type === "arxivRecommendationKeyword") {
          removeRecommendationKeyword(newValue.value.data);
          return;
        }
        PLAPI.feedService.delete([newValue.value.data]);
        uiState.selectedFeed = "feed-all";
      }
    }
  )
);

disposable(
  PLMainAPI.contextMenuService.on(
    "sidebarContextMenuFeedRefreshClicked",
    (newValue: { value: { data: string; type: string } }) => {
      if (uiState.contentType === "feed") {
        if (newValue.value.type === "arxivRecommendationKeyword") {
          uiState.selectedFeed = `feed-recommended-arxiv:${newValue.value.data}`;
          PLAPI.feedService.refreshArxivRecommendations(
            newValue.value.data,
            true
          );
          return;
        }
        PLAPI.feedService.refresh([newValue.value.data]);
      }
    }
  )
);

disposable(
  PLMainAPI.contextMenuService.on(
    "sidebarContextMenuColorClicked",
    (newValue: { value: { data: string; color: string } }) => {
      if (uiState.contentType === "feed") {
        if ((newValue.value as any).type === "arxivRecommendationKeyword") {
          PLMainAPI.preferenceService.set({
            arxivRecommendationKeywordColors: {
              ...(prefState.arxivRecommendationKeywordColors || {}),
              [newValue.value.data]: newValue.value.color,
            },
          });
          return;
        }
        PLAPI.feedService.colorize(
          newValue.value.color as any,
          newValue.value.data
        );
      }
    }
  )
);

disposable(
  PLMainAPI.contextMenuService.on(
    "sidebarContextMenuEditClicked",
    (newValue: { value: { data: string; type: string } }) => {
      if (
        uiState.contentType === "feed" &&
        newValue.value.type === "arxivRecommendationKeyword"
      ) {
        editingRecommendationKeyword.value = newValue.value.data;
        newRecommendationKeyword.value = newValue.value.data;
        nextTick(() => recommendationKeywordInput.value?.focus());
      }
    }
  )
);
</script>

<template>
  <div>
    <SectionItem
      :name="$t('mainview.allfeeds')"
      :count="feedState.entitiesCount"
      :with-counter="prefState.showSidebarCount"
      :with-spinner="processingState.general > 0"
      :compact="prefState.isSidebarCompact"
      :active="uiState.selectedFeed === 'feed-all'"
      @click="onSelectFeed('feed-all')"
    >
      <BIconRss class="text-sm my-auto text-blue-500 min-w-[1em]" />
    </SectionItem>
    <SectionItem
      :name="$t('mainview.unread')"
      :with-counter="false"
      :with-spinner="false"
      :compact="prefState.isSidebarCompact"
      :active="uiState.selectedFeed === 'feed-unread'"
      @click="onSelectFeed('feed-unread')"
    >
      <BIconAppIndicator class="text-sm my-auto text-blue-500 min-w-[1em]" />
    </SectionItem>
    <CollopseGroup
      :title="$t('mainview.recommendations')"
      :with-add="true"
      @event:add-click="onAddRecommendationKeywordClicked"
    >
      <div
        class="w-full flex rounded-md px-1 space-x-1"
        :class="{
          'h-6': prefState.isSidebarCompact,
          'h-7': !prefState.isSidebarCompact,
        }"
        v-if="isAddingRecommendationKeyword"
      >
        <div class="w-3 flex-none" />
        <div class="text-sm my-auto flex-none w-3.5 text-purple-500">
          <BIconTag class="w-3.5" />
        </div>
        <input
          ref="recommendationKeywordInput"
          class="my-auto text-xs bg-transparent grow min-w-0 border-[1px] rounded px-1 border-purple-300 dark:border-purple-500 focus:outline-none"
          type="text"
          placeholder="keyword / research area"
          v-model="newRecommendationKeyword"
          @keydown.enter="onRecommendationKeywordInputConfirmed"
          @keydown.esc="onRecommendationKeywordInputCanceled"
          @blur="onRecommendationKeywordInputConfirmed"
        />
      </div>
      <div
        class="w-full flex rounded-md px-1 cursor-pointer group space-x-1"
        :class="{
          'bg-neutral-400 bg-opacity-30':
            uiState.selectedFeed === `feed-recommended-arxiv:${keyword}`,
          'h-6': prefState.isSidebarCompact,
          'h-7': !prefState.isSidebarCompact,
        }"
        v-for="keyword in prefState.arxivRecommendationKeywords || []"
        :key="keyword"
        @click="onSelectRecommendationKeyword(keyword)"
        @contextmenu="(event: MouseEvent) => onRecommendationKeywordRightClicked(event, keyword)"
      >
        <div class="w-3 flex-none" />
        <div
          class="text-sm my-auto flex-none w-3.5"
          :class="
            colorClass(
              (prefState.arxivRecommendationKeywordColors || {})[keyword] ||
                'purple'
            )
          "
        >
          <BIconTag class="w-3.5" />
        </div>
        <div
          class="my-auto text-xs select-none truncate grow"
          v-if="editingRecommendationKeyword !== keyword"
        >
          {{ keyword }}
        </div>
        <input
          ref="recommendationKeywordInput"
          class="my-auto text-xs bg-transparent grow min-w-0 border-[1px] rounded px-1 border-accentlight dark:border-accentdark focus:outline-none"
          type="text"
          v-model="newRecommendationKeyword"
          v-if="editingRecommendationKeyword === keyword"
          @click.stop
          @keydown.enter="onRecommendationKeywordEditConfirmed(keyword)"
          @keydown.esc="onRecommendationKeywordEditCanceled"
          @blur="onRecommendationKeywordEditConfirmed(keyword)"
        />
      </div>
    </CollopseGroup>

    <CollopseGroup
      :title="$t('mainview.feeds')"
      :with-add="true"
      @event:add-click="onAddNewFeedClicked"
    >
      <SectionItem
        :name="feed.name"
        :count="feed.count"
        :with-counter="prefState.showSidebarCount"
        :with-spinner="false"
        :compact="prefState.isSidebarCompact"
        v-for="feed in feeds"
        :active="uiState.selectedFeed === `feed-${feed.name}`"
        @click="onSelectFeed(`feed-${feed.name}`)"
        @contextmenu="(e: MouseEvent) => {onItemRightClicked(e, feed)}"
      >
        <BIconBroadcast
          class="text-sm my-auto min-w-[1em]"
          :class="colorClass(feed.color)"
        />
      </SectionItem>
    </CollopseGroup>
  </div>
</template>
