<script setup lang="ts">
import { onMounted, ref } from "vue";

const prefState = PLMainAPI.preferenceService.useState();

const hide = async () => {
  PLMainAPI.preferenceService.set({
    showWelcome: false,
    showPresetting: true,
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
  }, 2200);
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
  animation: typing 1.8s steps(15), caret 0.5s steps(1) infinite;
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
      WELCOME TO PAPERMIND 4.1.0
    </div>

    <div class="w-[45rem] px-3 mx-auto my-20 flex flex-col" v-else>
      <div class="mx-auto font-semibold mb-8 space-x-2 flex">
        <span class="text-3xl my-auto">PAPERMIND</span>
        <span
          class="text-xl bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-800 rounded-md px-2 py-1 my-auto"
          >4.1.0</span
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
          Welcome to PaperMind 4.1.0.
        </div>
        <div class="mb-2">
          This release adds several research workflow upgrades:
        </div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">
            Personalized arXiv recommendations from your research keywords
          </li>
          <li class="font-semibold">
            Interactive paper graph for exploring papers, authors, topics, and
            years
          </li>
          <li class="font-semibold">
            Search the graph and press Enter to move through matched nodes
          </li>
          <li class="font-semibold">
            Add recommended arXiv papers to the library with PDF download
          </li>
          <li class="font-semibold">
            Compare selected papers and export the result as LaTeX or PDF
          </li>
          <li class="font-semibold">
            Jump from Ask evidence back to the corresponding source PDF
          </li>
        </ul>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Experiment Compare</div>
        <div class="mb-2">
          Compare is designed for the common reading task where related papers
          report different numbers on the same datasets.
        </div>
        <div class="mb-2">
          PaperMind collects the selected papers' full-text experiment evidence,
          then generates a paper-style comparison table across proposed methods
          and baselines.
        </div>
        <div class="mb-2">
          Compare results can now be exported as a PDF and copied as fuller
          LaTeX table context for notes, drafts, and paper writing.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">arXiv Recommendations</div>
        <div class="mb-2">
          Add recommendation keywords in Feeds and PaperMind will fetch recent
          arXiv papers, score their relevance, and cache the result so repeated
          browsing stays fast.
        </div>
        <div class="mb-2">
          Recommended papers can be added to the local library together with
          their PDFs, and downloaded papers are marked directly in the list.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Paper Graph</div>
        <div class="mb-2">
          The new graph view opens as a Quickpaste-style floating window and
          visualizes the local library through paper, author, topic, and year
          relationships.
        </div>
        <div class="mb-2">
          You can search the graph, press Enter to jump between matches, drag
          nodes with elastic motion, and use it as a visual map of your reading
          space.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Semantic + Ask Improvements</div>
        <div class="mb-2">
          Ask and Compare both benefit from full-document chunking and
          query-aware evidence retrieval.
        </div>
        <div class="mb-2">
          The copied Compare output includes LaTeX table context so it is easier
          to reuse in notes, drafts, and paper writing.
        </div>

        <hr class="my-8" />
        <div>Thanks for using PaperMind 4.1.0.</div>
      </div>

      <div class="flex flex-col" v-else>
        <div class="mx-auto mb-8 font-semibold">欢迎来到 PaperMind 4.1.0。</div>
        <div class="mb-2">本次版本补充了几项面向研究流程的新功能：</div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">根据你的研究关键词推荐相关 arXiv 新论文</li>
          <li class="font-semibold">
            新增交互式论文图谱，展示论文、作者、主题和年份关系
          </li>
          <li class="font-semibold">
            在图谱里搜索后按 Enter，可以在多个匹配节点之间跳转
          </li>
          <li class="font-semibold">
            推荐论文加入文献库时会一起下载 PDF
          </li>
          <li class="font-semibold">
            实验对比结果支持导出 LaTeX 或 PDF
          </li>
          <li class="font-semibold">
            Ask 证据可以跳回对应的源 PDF
          </li>
        </ul>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">实验对比</div>
        <div class="mb-2">
          Compare 适合几篇相关论文在同一数据集上报告不同指标、不同 baseline
          的阅读场景。
        </div>
        <div class="mb-2">
          PaperMind
          会读取选中论文的全文实验上下文，生成接近论文实验表的横向对比结果。
        </div>
        <div class="mb-2">
          对比结果现在可以导出为 PDF，也可以复制为更完整的 LaTeX
          表格上下文，方便放进笔记、草稿或论文写作中。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">arXiv 推荐</div>
        <div class="mb-2">
          你可以在订阅页添加推荐关键词，PaperMind 会获取近期 arXiv
          论文、计算相关度，并缓存结果，避免每次重复请求。
        </div>
        <div class="mb-2">
          推荐论文可以直接加入本地文献库，并同步下载 PDF；已下载的论文会在列表中标记出来。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">论文图谱</div>
        <div class="mb-2">
          新增的图谱视图会以浮动窗口打开，用论文、作者、主题和年份关系展示本地文献库。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">语义检索与 Ask 优化</div>
        <div class="mb-2">
          Ask 和 Compare 都会使用全文分块与查询感知证据检索。
        </div>

        <hr class="my-8" />
        <div>感谢使用 PaperMind 4.1.0。</div>
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
