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
      WELCOME TO PAPERMIND 3.7.0
    </div>

    <div class="w-[45rem] px-3 mx-auto my-20 flex flex-col" v-else>
      <div class="mx-auto font-semibold mb-8 space-x-2 flex">
        <span class="text-3xl my-auto">PAPERMIND</span>
        <span
          class="text-xl bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-800 rounded-md px-2 py-1 my-auto"
          >3.7.0</span
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
        <div class="mx-auto mb-8 font-semibold">Welcome to PaperMind 3.7.0.</div>
        <div class="mb-2">This release focuses on a cleaner and more reliable model workflow:</div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">Multi-provider support for Ask / Tag / Embedding</li>
          <li class="font-semibold">Provider-level API key management on one settings page</li>
          <li class="font-semibold">Per-capability provider and model selection (Ask / Embedding / Tag)</li>
          <li class="font-semibold">Connectivity-aware provider status indicators</li>
          <li class="font-semibold">Improved full-document embedding and query-aware evidence retrieval</li>
          <li class="font-semibold">Compare workflow removed for a simpler Ask experience</li>
        </ul>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Model Providers</div>
        <div class="mb-2">
          You can now configure multiple OpenAI-compatible providers in one place and reuse them across different capabilities.
        </div>
        <div class="mb-2">
          Supported providers in this release include Qwen, OpenAI, DeepSeek, Moonshot, and Zhipu.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Semantic + Ask Improvements</div>
        <div class="mb-2">
          Embedding now uses full-document chunking and pooled vectors, improving long-paper coverage.
        </div>
        <div class="mb-2">
          Ask evidence extraction is query-aware and supports lightweight / balanced / detailed context profiles.
        </div>

        <hr class="my-8" />
        <div>Thanks for using PaperMind 3.7.0.</div>
      </div>

      <div class="flex flex-col" v-else>
        <div class="mx-auto mb-8 font-semibold">欢迎来到 PaperMind 3.7.0。</div>
        <div class="mb-2">本次版本重点升级了模型配置与问答检索链路：</div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">支持多模型供应商接入（Ask / Tag / Embedding）</li>
          <li class="font-semibold">同一页面统一管理供应商 API Key</li>
          <li class="font-semibold">Ask / Embedding / Tag 分别可选供应商与模型</li>
          <li class="font-semibold">供应商状态支持连通性指示</li>
          <li class="font-semibold">全文分块 embedding + 查询感知证据提取</li>
          <li class="font-semibold">移除 compare 流程，Ask 体验更聚焦</li>
        </ul>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">模型供应商</div>
        <div class="mb-2">
          现在可以在同一处配置多个 OpenAI 兼容供应商，并在不同能力之间复用。
        </div>
        <div class="mb-2">
          本版本已支持 Qwen、OpenAI、DeepSeek、Moonshot、Zhipu。
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">语义检索与 Ask 优化</div>
        <div class="mb-2">Embedding 改为全文分块与向量池化，长文召回更稳定。</div>
        <div class="mb-2">Ask 证据提取改为查询感知，并支持快速/平衡/详细上下文档位。</div>

        <hr class="my-8" />
        <div>感谢使用 PaperMind 3.7.0。</div>
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
