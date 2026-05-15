<script setup lang="ts">
import {
  BIconArrowCounterclockwise,
  BIconAspectRatio,
  BIconFlag,
  BIconFlagFill,
  BIconGear,
  BIconGrid3x2,
  BIconListUl,
  BIconPencilSquare,
  BIconShare,
  BIconTable,
  BIconTrash,
} from "bootstrap-icons-vue";

defineProps({
  btnName: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  withTooltip: {
    type: Boolean,
    default: true,
  },
  flagFilled: {
    type: Boolean,
    default: false,
  },
});

const emits = defineEmits(["event:click"]);

const btnIcons: Record<string, any> = {
  rescrape: BIconArrowCounterclockwise,
  delete: BIconTrash,
  edit: BIconPencilSquare,
  flag: BIconFlag,
  listview: BIconListUl,
  tableview: BIconGrid3x2,
  preference: BIconGear,
  tablereaderview: BIconAspectRatio,
  compareexperiments: BIconTable,
  papergraph: BIconShare,
};
</script>

<template>
  <button
    class="flex h-6 min-w-[1.875rem] shrink-0 rounded-md px-1 hover:bg-neutral-200 hover:dark:bg-neutral-700 has-tooltip"
    :disabled="disabled"
    @click="emits('event:click')"
  >
    <component
      :is="btnName === 'flag' && flagFilled ? BIconFlagFill : btnIcons[btnName as string]"
      class="text-sm m-auto"
      :class="
        disabled
          ? 'text-neutral-300 dark:text-neutral-600'
          : 'text-neutral-700 dark:text-neutral-300'
      "
    />
    <span
      class="tooltip top-10 bg-neutral-200 dark:bg-neutral-700 p-1 rounded-md"
      v-if="withTooltip"
    >
      {{ $t(`menu.${btnName}`) }}
    </span>
  </button>
</template>
