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
      WELCOME TO PAPERMIND 3.0
    </div>
    <div class="w-[45rem] px-3 mx-auto my-20 flex flex-col" v-else>
      <div class="mx-auto font-semibold mb-8 space-x-2 flex">
        <span class="text-3xl my-auto">PAPERMIND</span>
        <span
          class="text-xl bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-800 rounded-md px-2 py-1 my-auto"
          >3.0</span
        >
      </div>
      <div class="flex space-x-2 mx-auto mb-4">
        <div class="underline cursor-pointer" @click="language = 'en-GB'">
          English
        </div>
        <div>|</div>
        <div class="underline cursor-pointer" @click="language = 'zh-CN'">
          绠€浣撲腑鏂?
        </div>
      </div>
      <div class="flex flex-col" v-if="language === 'en-GB'">
        <div class="mx-auto mb-8 font-semibold">
          Welcome to the new major version --- PaperMind 3.0.
        </div>
        <div>
          In PaperMind 3.0, we bring you a new experience with many exciting new
          features:
        </div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">Extension System</li>
          <li class="font-semibold">Hierarchy Folders/SmartFilters</li>
          <li class="font-semibold">Some redesigned UI</li>
          <li>and more...</li>
        </ul>
        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">Extension System</div>
        <div class="mb-2">
          PaperMind 3.0 introduces a new extension system that allows you to
          extend the functionality of PaperMind. You can now install extensions
          from the Extension Marketplace, or develop and publish your own
          extension.
        </div>
        <div class="mb-2">
          <span
            >We also provide a lot of extensions created by the official team
            such as:</span
          >
          <ul class="list-disc px-4 mx-1">
            <li class="space-x-2">
              <span class="font-semibold">metadata-scrape</span>
              <span>-</span>
              <span>helps you scrape the metadata for your papers.</span>
            </li>
            <li class="space-x-2">
              <span class="font-semibold">ai-summary / ai-chat</span>
              <span>-</span>
              <span
                >uses LLM to summarise papers, tag a paper, filter your libray
                with human language, or chat with LLM about a paper.</span
              >
            </li>
            <li class="space-x-2">
              <span class="font-semibold">format-pubname</span>
              <span>-</span>
              <span>helps you to automatically format publication names.</span>
            </li>
            <li class="space-x-2">
              <span class="font-semibold">api-host</span>
              <span>-</span>
              <span
                >helps you to connect PaperMind with other Apps such as Raycast,
                Obsidian etc.</span
              >
            </li>
            <li>and more...</li>
          </ul>
        </div>
        <div class="mb-2">
          For developers, we provide a rich set of APIs to help you develop your
          own extensions. You can find more information our
          <a class="underline" href="https://paperlib.app/en/extension-doc/"
            >documentation</a
          >.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">
          Hierarchy Folders / SmartFilters
        </div>
        <div class="mb-2">
          PaperMind 3.0 introduces a new feature called Nested Folders /
          SmartFilters. You can now create a folder inside another folder. Also,
          the smartfilters can be organised in hierarchy.
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">And More...</div>
        <div class="mb-2">Other updates please refer to the release notes.</div>

        <hr class="my-8" />
        <div>馃摚 Seeking contributors 馃摚</div>
        <div>
          If you are interested in contributing, please
          <a class="underline" href="https://github.com/GeoffreyChen777"
            >contact me</a
          >.
        </div>
      </div>
      <div class="flex flex-col" v-else>
        <div class="mx-auto mb-8 font-semibold">
          娆㈣繋鏉ュ埌鍏ㄦ柊鐨勭増鏈?--- PaperMind 3.0銆?
        </div>
        <div>鍦?PaperMind 3.0 涓紝鎴戜滑涓烘偍甯︽潵浜嗚澶氫护浜哄叴濂嬬殑鏂板姛鑳斤細</div>
        <ul class="list-disc px-4 mx-1">
          <li class="font-semibold">鎵╁睍鎻掍欢绯荤粺</li>
          <li class="font-semibold">灞傜骇缁勫拰灞傜骇鏅鸿兘杩囨护鍣?/li>
          <li class="font-semibold">涓€浜?UI 閲嶆柊璁捐</li>
          <li>鍜岃璁稿澶?..</li>
        </ul>
        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">鎵╁睍鎻掍欢绯荤粺</div>
        <div class="mb-2">
          PaperMind 3.0 寮曞叆浜嗕竴涓柊鐨勬墿灞曠郴缁燂紝鍏佽鎮ㄦ墿灞?PaperMind
          鐨勫姛鑳姐€傜幇鍦ㄦ偍鍙互浠庢墿灞曞競鍦哄畨瑁呮墿灞曪紝鎴栬€呭紑鍙戝苟鍙戝竷鎮ㄨ嚜宸辩殑鎵╁睍銆?
        </div>
        <div class="mb-2">
          <span>鎴戜滑涔熸彁渚涗簡涓€浜涚敱瀹樻柟寮€鍙戠淮鎶ょ殑鎵╁睍鎻掍欢锛屾瘮濡傦細</span>
          <ul class="list-disc px-4 mx-1">
            <li class="space-x-2">
              <span class="font-semibold">metadata-scrape</span>
              <span>-</span>
              <span>甯姪浣犳悳绱㈣鏂囩殑鍏冩暟鎹€?/span>
            </li>
            <li class="space-x-2">
              <span class="font-semibold">ai-summary / ai-chat</span>
              <span>-</span>
              <span
                >浣跨敤 LLM
                鎬荤粨璁烘枃锛岀粰璁烘枃鑷姩鎵撴爣绛撅紝鐢ㄨ嚜鐒惰瑷€鎼滅储浣犵殑璁烘枃搴擄紝鍜?LLM
                璁ㄨ璁烘枃绛夈€?/span
              >
            </li>
            <li class="space-x-2">
              <span class="font-semibold">format-pubname</span>
              <span>-</span>
              <span>甯姪浣犺嚜鍔ㄦ牸寮忓寲璁烘枃鐨勫彂琛ㄤ俊鎭€?/span>
            </li>
            <li class="space-x-2">
              <span class="font-semibold">api-host</span>
              <span>-</span>
              <span>甯姪杩炴帴鍏朵粬搴旂敤绋嬪簭锛屾瘮濡?Raycast锛孫bsidian 绛夈€?/span>
            </li>
            <li>绛夌瓑...</li>
          </ul>
        </div>
        <div class="mb-2">
          瀵逛簬寮€鍙戣€咃紝鎴戜滑鎻愪緵浜嗕竴濂椾赴瀵岀殑
          API锛屼互甯姪鎮ㄥ紑鍙戣嚜宸辩殑鎵╁睍銆傛偍鍙互鍦ㄦ垜浠殑<a
            class="underline"
            href="https://paperlib.app/en/extension-doc/"
            >鏂囨。</a
          >涓壘鍒版洿澶氫俊鎭€?
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">灞傜骇缁勫拰灞傜骇鏅鸿兘杩囨护鍣?/div>
        <div class="mb-2">
          PaperMind 3.0
          寮曞叆浜嗕竴涓柊鍔熻兘锛屽眰绾х粍鍜屽眰绾ф櫤鑳借繃婊ゅ櫒銆傛偍鐜板湪鍙互鍦ㄥ彟涓€涓粍涓垱寤轰竴涓瓙缁勩€傛澶栵紝鏅鸿兘杩囨护鍣ㄤ篃鍙互浠ュ眰绾ф柟寮忕粍缁囥€?
        </div>

        <hr class="my-8" />
        <div class="font-bold text-xl mb-4">鏇村鏇存柊...</div>
        <div class="mb-2">鍏朵粬鏇存柊璇峰弬闃呮洿鏂版棩蹇椼€?/div>

        <hr class="my-8" />
        <div>馃摚 瀵绘眰鍚堜綔寮€鍙戣€?馃摚</div>
        <div>
          濡傛灉浣犳劅鍏磋叮鍙備笌 PaperMind 鐨勬牳蹇冨紑鍙戯紝璇?
          <a class="underline" href="https://github.com/GeoffreyChen777"
            >鑱旂郴鎴?/a
          >銆?
        </div>
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

