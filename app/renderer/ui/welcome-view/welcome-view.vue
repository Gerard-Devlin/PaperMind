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
      WELCOME TO PAPERMIND 4.0.0
    </div>

    <div class="w-[45rem] px-3 mx-auto my-20 flex flex-col" v-else>
      <div class="mx-auto font-semibold mb-8 space-x-2 flex">
        <span class="text-3xl my-auto">PAPERMIND</span>
        <span
          class="text-xl bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-800 rounded-md px-2 py-1 my-auto"
          >4.0.0</span
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
          Welcome to PaperMind 4.0.0.
        </div>
        <div class="mb-2">
          This release adds an experiment comparison workflow for paper reading:
        </div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">
            Select multiple papers and compare experiment results together
          </li>
          <li class="font-semibold">
            Align methods, baselines, datasets, settings, and numeric metrics
          </li>
          <li class="font-semibold">
            Use full-text experiment table context instead of screenshot OCR
          </li>
          <li class="font-semibold">
            Open Compare from the toolbar, right-click menu, or shortcut
          </li>
          <li class="font-semibold">
            Restore the previous Compare result when reopening Quickpaste
          </li>
          <li class="font-semibold">
            Copy a fuller LaTeX table with caption, paper legend, notes, and
            warnings
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
        <div>Thanks for using PaperMind 4.0.0.</div>
      </div>

      <div class="flex flex-col" v-else>
        <div class="mx-auto mb-8 font-semibold">欢迎来到 PaperMind 4.0.0。</div>
        <div class="mb-2">本次版本新增了面向读论文流程的实验对比功能：</div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">选择多篇论文后，一起对比实验结果</li>
          <li class="font-semibold">
            自动整理方法、baseline、实验设置、数据集与数值指标
          </li>
          <li class="font-semibold">
            基于论文全文中的实验表格文本，不依赖截图 OCR
          </li>
          <li class="font-semibold">
            可从顶部工具栏、右键菜单或快捷键打开 Compare
          </li>
          <li class="font-semibold">
            重新打开 Quickpaste 时保留上一次对比结果
          </li>
          <li class="font-semibold">
            复制时导出更完整的 LaTeX 表格，包含 caption、论文编号说明、notes 和
            warnings
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

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">语义检索与 Ask 优化</div>
        <div class="mb-2">
          Ask 和 Compare 都会使用全文分块与查询感知证据检索。
        </div>
        <div class="mb-2">
          复制 Compare 结果时会带上 LaTeX
          表格上下文，更方便放进笔记、草稿或论文写作中。
        </div>

        <hr class="my-8" />
        <div>感谢使用 PaperMind 4.0.0。</div>
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
