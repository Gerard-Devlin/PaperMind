<script setup lang="ts">
const props = defineProps({
  authors: String,
});

const openAuthorScholar = (author: string) => {
  const query = `"${author.trim()}"`;

  PLAPI.fileService.open(
    `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(query)}`
  );
};

const onClick = (e: MouseEvent, author: string) => {
  e.preventDefault();
  e.stopPropagation();

  openAuthorScholar(author);
};

const onRightClick = (e: MouseEvent, author: string) => {
  e.preventDefault();
  e.stopPropagation();
  openAuthorScholar(author);
};
</script>

<template>
  <div class="flex flex-wrap">
    <div
      class="flex cursor-pointer"
      v-for="author in authors?.split(',').map((author) => author.trim())"
    >
      <div
        class="text-xxs hover:underline"
        @click="onClick($event, author)"
        @contextmenu="(e: MouseEvent) => onRightClick(e, author)"
      >
        {{ author }}
      </div>
      <div class="text-xxs" v-if="!authors?.endsWith(author)">,&nbsp;</div>
    </div>
  </div>
</template>
