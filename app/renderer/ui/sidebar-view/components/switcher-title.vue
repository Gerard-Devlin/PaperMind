<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps({
  titles: {
    type: Object as () => Array<String>,
    required: true,
  },
  selectedIndex: {
    type: Number,
    default: 0,
  },
});

const emits = defineEmits(["changed"]);

const selected = ref(props.selectedIndex);

watch(
  () => props.selectedIndex,
  (newValue) => {
    selected.value = newValue;
  }
);
</script>

<template>
  <div class="flex min-w-0 px-2 sm:px-4">
    <div
      class="my-auto min-w-0 text-xxs font-bold text-neutral-400 dark:text-neutral-500 select-none flex flex-wrap gap-x-2 gap-y-1"
    >
      <div
        class="cursor-pointer truncate transition ease-in-out hover:text-neutral-500 dark:hover:text-neutral-300"
        :class="
          titles.indexOf(title) === selected
            ? 'text-neutral-500 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200'
            : ''
        "
        v-for="title of titles"
        @click="
          () => {
            selected = titles.indexOf(title);
            emits('changed', selected);
          }
        "
      >
        {{ title }}
      </div>
    </div>
  </div>
</template>
