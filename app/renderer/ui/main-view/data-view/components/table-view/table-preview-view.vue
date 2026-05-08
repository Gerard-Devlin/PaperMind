<script setup lang="ts">
import { PropType, ref } from "vue";

import { Entity, IEntityCollection } from "@/models/entity";
import { OID } from "@/models/id";
import { FieldTemplate } from "@/renderer/types/data-view";

import PaperGalleryItem from "./components/paper-gallery-item.vue";

const props = defineProps({
  entities: {
    type: Object as PropType<IEntityCollection>,
    required: true,
  },
  candidates: {
    type: Object as PropType<Record<string, Entity[]>>,
    required: true,
  },
  fieldTemplates: {
    type: Object as PropType<Map<string, FieldTemplate>>,
    required: true,
  },
  entitySortBy: {
    type: String,
    default: "addTime",
  },
  entitySortOrder: {
    type: String,
    default: "desc",
  },
  platform: {
    type: String,
    required: true,
  },
  itemSize: {
    type: Number,
    default: 28,
  },
  selectedIndex: {
    type: Array<number>,
    required: true,
  },
  displayingURL: {
    type: String,
    required: true,
  },
});

const lastSelectedSingleIndex = ref<number>(-1);

const emits = defineEmits([
  "event:click",
  "event:dblclick",
  "event:contextmenu",
  "event:drag",
  "event:drag-file",
  "event:header-click",
  "event:header-width-change",
  "event:click-candidate-btn",
]);

const calSelectedIndex = (event: MouseEvent, index: number) => {
  let selectedIndexBuffer = JSON.parse(JSON.stringify(props.selectedIndex));
  if (event.shiftKey && lastSelectedSingleIndex.value >= 0) {
    const minIndex = Math.min(lastSelectedSingleIndex.value, index);
    const maxIndex = Math.max(lastSelectedSingleIndex.value, index);
    selectedIndexBuffer = [];
    for (let i = minIndex; i <= maxIndex; i++) {
      selectedIndexBuffer.push(i);
    }
  } else if (
    (event.ctrlKey && props.platform !== "darwin") ||
    (event.metaKey && props.platform === "darwin")
  ) {
    if (selectedIndexBuffer.indexOf(index) >= 0) {
      selectedIndexBuffer.splice(selectedIndexBuffer.indexOf(index), 1);
    } else {
      selectedIndexBuffer.push(index);
    }
  } else {
    selectedIndexBuffer = [index];
    lastSelectedSingleIndex.value = index;
  }

  return selectedIndexBuffer;
};

const onItemClicked = (event: MouseEvent, index: number) => {
  emits("event:click", calSelectedIndex(event, index));
};

const onItemRightClicked = (event: MouseEvent, index: number) => {
  let selectedIndex = props.selectedIndex;
  if (props.selectedIndex.indexOf(index) === -1) {
    selectedIndex = calSelectedIndex(event, index);
  }
  emits("event:contextmenu", selectedIndex);
};

const onItemDoubleClicked = (event: MouseEvent, index: number) => {
  emits("event:dblclick", calSelectedIndex(event, index));
};

const onItemDraged = (event: DragEvent, index: number, id: OID) => {
  event.dataTransfer?.setData(
    "application/json",
    JSON.stringify({
      type: "PaperEntity",
      value: id,
    })
  );

  let selectedIndex = props.selectedIndex;
  if (props.selectedIndex.indexOf(index) === -1) {
    selectedIndex = calSelectedIndex(event as unknown as MouseEvent, index);
  }

  if (event.altKey || event.metaKey) {
    event.preventDefault();
    event.stopPropagation();
    emits("event:drag-file", selectedIndex);
    return;
  }

  const el = event.target as HTMLElement;
  event.dataTransfer?.setDragImage(el, 0, 0);
  emits("event:drag", selectedIndex);
};
</script>

<template>
  <div class="h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
    <div
      class="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-x-5 gap-y-7"
    >
      <PaperGalleryItem
        v-for="(item, index) in entities"
        :id="`item-${index}`"
        :key="`${item._id}`"
        :item="item"
        :active="selectedIndex.indexOf(index) >= 0"
        draggable="true"
        @click="(e: MouseEvent) => onItemClicked(e, index)"
        @contextmenu="(e: MouseEvent) => onItemRightClicked(e, index)"
        @dblclick="(e: MouseEvent) => onItemDoubleClicked(e, index)"
        @dragstart="(event: DragEvent) => onItemDraged(event, index, item._id)"
      />
    </div>
  </div>
</template>
