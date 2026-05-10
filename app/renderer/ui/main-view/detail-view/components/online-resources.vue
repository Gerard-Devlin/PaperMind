<script setup lang="ts">
import { BIconCodeSlash, BIconGithub, BIconLink } from "bootstrap-icons-vue";

const props = defineProps({
  codes: {
    type: Array as () => Array<string>,
    default: () => [],
  },
  arxiv: String,
  doi: String,
});

const parseCode = (codeRaw: string) => {
  try {
    const parsed = JSON.parse(codeRaw) as { url?: string; isOfficial?: boolean };
    if (parsed?.url) {
      return { url: parsed.url, isOfficial: Boolean(parsed.isOfficial) };
    }
  } catch {}

  return { url: `${codeRaw || ""}`.trim(), isOfficial: false };
};

const isCodeOfficial = (codeRaw: string) => {
  const code = parseCode(codeRaw);
  return code.isOfficial ? "codeofficial" : "codecommunity";
};

const isGithubCode = (codeRaw: string) => {
  const code = parseCode(codeRaw);
  return code.url.toLowerCase().includes("github");
};

const onLinkClick = (url: string) => {
  if (!url) return;
  PLAPI.fileService.open(url);
};

const onCodeClick = (codeRaw: string) => {
  const code = parseCode(codeRaw);
  if (!code.url) return;
  PLAPI.fileService.open(code.url);
};
</script>

<template>
  <div class="flex flex-wrap mt-1 text-xs">
    <div
      v-if="arxiv"
      class="flex space-x-1 bg-neutral-200 dark:bg-neutral-700 rounded-md p-1 hover:bg-neutral-300 hover:dark:bg-neutral-600 hover:shadow-sm select-none cursor-pointer mb-1 mr-1"
      @click="onLinkClick(`https://arxiv.org/abs/${arxiv!.toLowerCase().replaceAll('arxiv:', '').trim()}`)"
    >
      <BIconLink class="text-xs my-auto" />
      <div class="text-xxs my-auto">arXiv</div>
    </div>

    <div
      v-if="doi"
      class="flex space-x-1 bg-neutral-200 dark:bg-neutral-700 rounded-md p-1 hover:bg-neutral-300 hover:dark:bg-neutral-600 hover:shadow-sm select-none cursor-pointer mb-1 mr-1"
      @click="onLinkClick(`https://doi.org/${doi}`)"
    >
      <BIconLink class="text-xs my-auto" />
      <div class="text-xxs my-auto">DOI</div>
    </div>

    <div
      v-for="code in codes"
      :key="code"
      class="flex space-x-1 bg-neutral-200 dark:bg-neutral-700 rounded-md p-1 hover:bg-neutral-300 hover:dark:bg-neutral-600 hover:shadow-sm select-none cursor-pointer mb-1 mr-1"
      @click="onCodeClick(code)"
    >
      <BIconGithub class="text-xs my-auto" v-if="isGithubCode(code)" />
      <BIconCodeSlash class="text-xs my-auto" v-else />
      <div class="text-xxs my-auto">
        {{ $t(`mainview.${isCodeOfficial(code)}`) }}
      </div>
    </div>
  </div>
</template>

