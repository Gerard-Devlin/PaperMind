import { RecycleScroller } from "@future-scholars/vue-virtual-scroller";
import "@future-scholars/vue-virtual-scroller/dist/vue-virtual-scroller.css";
import { createPinia } from "pinia";
import { Pane, Splitpanes } from "splitpanes";
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import draggable from "vuedraggable";

import { InjectionContainer } from "@/base/injection/injection";
import { Process } from "@/base/process-id";
import { RendererProcessRPCService } from "@/base/rpc/rpc-service-renderer";
import { removeLoading } from "@/base/loading";
import { loadLocales } from "@/locales/load";

import { CommandService } from "./services/command-service";
import { IInjectable } from "./services/injectable";
import { ShortcutService } from "./services/shortcut-service";
import { UISlotService } from "./services/uislot-service";
import { UIStateService } from "./services/uistate-service";
import { QuerySentenceService } from "./services/querysentence-service";
import AppView from "./ui/app-view.vue";

let globalLoadingWatchdog: ReturnType<typeof setTimeout> | null = null;

const clearGlobalLoadingWatchdog = () => {
  if (globalLoadingWatchdog) {
    clearTimeout(globalLoadingWatchdog);
    globalLoadingWatchdog = null;
  }
};

const forceRemoveLoading = () => {
  try {
    removeLoading();
  } catch (error) {
    console.error("Failed to remove loading overlay:", error);
  }
};

const API_READY_TIMEOUT_MS = 30000;

async function initialize() {
  const pinia = createPinia();

  const app = createApp(AppView);

  app.use(pinia);

  app.component("Splitpanes", Splitpanes);
  app.component("Pane", Pane);
  app.component("draggable", draggable);
  app.component("RecycleScroller", RecycleScroller);

  // ============================================================
  // 1. Initilize the RPC service for current process
  const rendererRPCService = new RendererProcessRPCService(
    Process.renderer,
    "PLUIAPI"
  );
  // ============================================================
  // 2. Start the port exchange process.
  await rendererRPCService.initCommunication();

  // ============================================================
  // 3. Wait for the main/service process to expose its APIs (PLMainAPI, PLAPI)
  const mainAPIExposed = await rendererRPCService.waitForAPI(
    Process.main,
    "PLMainAPI",
    API_READY_TIMEOUT_MS
  );

  if (!mainAPIExposed) {
    console.error("Main process API is not exposed");
    throw new Error("Main process API is not exposed");
  }

  const serviceAPIExposed = await rendererRPCService.waitForAPI(
    Process.service,
    "PLAPI",
    API_READY_TIMEOUT_MS
  );

  if (!serviceAPIExposed) {
    console.error("Service process API is not exposed");
    throw new Error("Service process API is not exposed");
  }

  // ============================================================
  // 4. Create the instances for all services, tools, etc. of the current process.
  const injectionContainer = new InjectionContainer({
    rendererRPCService,
  });
  const instances = injectionContainer.createInstance<IInjectable>({
    commandService: CommandService,
    uiStateService: UIStateService,
    uiSlotService: UISlotService,
    shortcutService: ShortcutService,
    querySentenceService: QuerySentenceService,
  });
  // 4.1 Expose the instances to the global scope for convenience.
  for (const [key, instance] of Object.entries(instances)) {
    if (!globalThis["PLUIAPILocal"]) {
      globalThis["PLUIAPILocal"] = {} as any;
    }
    globalThis[key] = instance;
    globalThis["PLUIAPILocal"][key] = instance;
  }

  // ============================================================
  // 5. Set actionors for RPC service with all initialized services.
  //    Expose the APIs of the current process to other processes
  rendererRPCService.setActionor(instances);

  // ============================================================
  // 6. Bind remote states to local Pinia stores.
  await PLMainAPI.preferenceService.bindState();
  await PLAPI.paperService.bindState();
  await PLAPI.feedService.bindState();
  await PLAPI.fileService.bindState();
  await PLAPI.syncService.bindState();

  // ============================================================
  // 6. Setup other things for the renderer process.
  const locales = loadLocales();

  const i18n = createI18n({
    locale: (await PLMainAPI.preferenceService.get("language")) as string,
    fallbackLocale: "en-GB",
    messages: locales,
    globalInjection: true,
    legacy: false
  });

  PLMainAPI.preferenceService.onChanged("language", (newValue) => {
    i18n.global.locale = newValue.value;
  });

  app.use(i18n);
  app.mount("#app");
  clearGlobalLoadingWatchdog();
}

globalLoadingWatchdog = setTimeout(() => {
  console.warn("Renderer initialization timeout fallback triggered.");
  forceRemoveLoading();
}, 25000);

initialize().catch((error) => {
  console.error("Renderer initialization failed:", error);
  clearGlobalLoadingWatchdog();
  forceRemoveLoading();

  const root = document.getElementById("app");
  if (root) {
    const errorMessage =
      error instanceof Error
        ? `${error.message}\n${error.stack || ""}`.trim()
        : `${error}`;
    root.innerHTML = `
      <div style="padding:24px;font-family:sans-serif;color:#333;">
        <h2 style="margin:0 0 8px 0;">PaperMind failed to initialize</h2>
        <p style="margin:0 0 10px 0;line-height:1.5;">Please restart the app. If this persists, share the error below.</p>
        <pre style="white-space:pre-wrap;background:#f3f4f6;padding:10px;border-radius:6px;font-size:12px;line-height:1.45;max-height:260px;overflow:auto;">${errorMessage
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")}</pre>
      </div>
    `;
  }
});
