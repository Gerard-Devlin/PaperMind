<script setup lang="ts">
import { onMounted, ref } from "vue";

const prefState = PLMainAPI.preferenceService.useState();

const hide = async () => {
  PLMainAPI.preferenceService.set({
    showWelcome: false,
  });
};

const darkMode = ref(false);

const language = ref("en-GB");

const isShowSlogan = ref(true);

onMounted(async () => {
  darkMode.value = await PLMainAPI.windowProcessManagementService.isDarkMode();
  language.value = `${prefState.language}`;

  setTimeout(() => {
    isShowSlogan.value = false;
  }, 2500);
});
</script>

<style>
@keyframes typing {
  from {
    width: 0;
  }
}

@keyframes caret {
  50% {
    border-right-color: transparent;
  }
}

.typing-style {
  width: 24ch;
  white-space: nowrap;
  overflow: hidden;
  border-right: 0.05em solid;
  animation: typing 2s steps(15), caret 0.5s steps(1) infinite;
}
</style>

<template>
  <div
    id="welcome-view"
    class="absolute w-full h-full top-0 left-0 bg-white dark:bg-neutral-800 z-50 overflow-auto dark:text-neutral-200"
  >
    <div
      class="typing-style text-xl font-bold font-mono mx-auto my-40"
      v-if="isShowSlogan"
    >
      WELCOME TO PAPERMIND 3.6.0
    </div>
    <div class="w-[45rem] px-3 mx-auto my-20 flex flex-col" v-else>
      <div class="mx-auto font-semibold mb-8 space-x-2 flex">
        <span class="text-3xl my-auto">PAPERMIND</span>
        <span
          class="text-xl bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-800 rounded-md px-2 py-1 my-auto"
          >3.6.0</span
        >
      </div>
      <div class="flex space-x-2 mx-auto mb-4">
        <div class="underline cursor-pointer" @click="language = 'en-GB'">
          English
        </div>
        <div>|</div>
        <div class="underline cursor-pointer" @click="language = 'zh-CN'">
          简体中文
        </div>
      </div>
      <div class="flex flex-col" v-if="language === 'en-GB'">
        <div class="mx-auto mb-8 font-semibold">
          Welcome to PaperMind 3.6.0.
        </div>
        <div>
          In PaperMind 3.6.0, your library workflow is upgraded with:
        </div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">Built-in scrape pipeline (no extra install needed)</li>
          <li class="font-semibold">Semantic search with local vector index</li>
          <li class="font-semibold">Ask your library (RAG, one-turn answer with sources)</li>
          <li class="font-semibold">Auto AI tags on import/update + manual regenerate</li>
          <li class="font-semibold">Quick Cite and multi-style citation export</li>
          <li class="font-semibold">Preview and citation-count integrations</li>
          <li class="font-semibold">English / Simplified Chinese UI</li>
        </ul>
        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Scrape + Metadata</div>
        <div class="mb-2">
          Entry scrape, metadata scrape, community metadata, preview, and
          citation count are bundled in the app build. Importing papers now
          works out of the box without installing official scrape extensions
          manually.
        </div>
        <div class="mb-2">
          <span>Metadata fields include title, authors, year, venue, DOI, arXiv, and online resources. Re-scrape from context menu supports overwrite flow for missing fields.</span>
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Semantic + Ask</div>
        <div class="mb-2">
          Semantic search uses embeddings + local vector retrieval and joins paper
          metadata for ranking and display. Ask mode retrieves related papers first,
          then generates a concise answer with cited sources.
        </div>
        <div class="mb-2">
          The settings page supports model management for Ask, AI Tag, and
          Embedding, with provider-compatible configuration and model refresh.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Productivity</div>
        <div class="mb-2">
          Quick Cite supports fast search and citation copy/export in multiple
          styles (for example IEEE, APA, MLA, BibTeX). AI tags can be generated
          automatically or manually from paper context actions.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">UI and Stability</div>
        <div class="mb-2">
          This release includes responsive layout updates, cover rendering
          optimization, startup flow fixes, and better first-run guidance.
        </div>

        <hr class="my-8" />
        <div>Community</div>
        <div>
          Thanks for using PaperMind 3.6.0.
        </div>
      </div>
      <div class="flex flex-col" v-else>
        <div class="mx-auto mb-8 font-semibold">
          欢迎来到 PaperMind 3.6.0。
        </div>
        <div>在 PaperMind 3.6.0 中，我们把现有核心能力都整合进来了：</div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">内置抓取链路（无需额外安装官方抓取扩展）</li>
          <li class="font-semibold">语义搜索（本地向量索引）</li>
          <li class="font-semibold">Ask 问答（RAG 检索后回答并附来源）</li>
          <li class="font-semibold">AI 标签（导入/更新自动打标 + 右键手动生成）</li>
          <li class="font-semibold">快速引用与多格式导出</li>
          <li class="font-semibold">封面预览与引用次数集成</li>
          <li class="font-semibold">中英文双语界面</li>
        </ul>
        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">抓取与元数据</div>
        <div class="mb-2">
          入口抓取、元数据抓取、社区元数据、预览、引用次数等能力已直接打包进应用。导入论文后可直接使用，不需要再安装官方抓取扩展。
        </div>
        <div class="mb-2">
          支持标题、作者、年份、期刊/会议、DOI、arXiv、在线资源等信息抓取；右键重抓支持覆盖补全缺失字段。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">语义搜索与 Ask</div>
        <div class="mb-2">
          语义搜索基于 embedding + 本地向量检索，并结合论文元数据返回结果。Ask 模式会先检索相关论文，再给出带来源标注的简洁回答。
        </div>
        <div class="mb-2">
          设置页已支持 Ask / AI 标签 / Embedding 三类模型配置与刷新，便于切换兼容供应商。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">效率功能</div>
        <div class="mb-2">
          快速引用支持检索、复制和多格式导出（例如 IEEE、APA、MLA、BibTeX）。AI 标签既可自动生成，也可在论文右键中手动触发。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">界面与稳定性</div>
        <div class="mb-2">
          本版本包含响应式布局优化、封面渲染优化、启动流程修复和首次引导体验改进。
        </div>

        <hr class="my-8" />
        <div>社区</div>
        <div>感谢使用 PaperMind 3.6.0。</div>
      </div>

      <div
        id="whats-new-close-btn"
        class="mt-10 mx-auto flex w-60 h-10 bg-accentlight dark:bg-accentdark text-neutral-50 rounded-md shadow-md cursor-pointer"
        @click="hide"
      >
        <span class="m-auto">Go</span>
      </div>
    </div>

    <div
      class="fixed bottom-0 left-0 w-full h-20 bg-gradient-to-t from-white dark:from-neutral-800 pointer-events-none"
    ></div>
  </div>
</template>

