import { removeLoading } from "@/base/loading";
import type { IInjectable } from "./services/injectable";
import "@future-scholars/vue-virtual-scroller/dist/vue-virtual-scroller.css";

let globalLoadingWatchdog: ReturnType<typeof setTimeout> | null = null;
let mounted = false;
const API_READY_TIMEOUT_MS = 30000;
const normalizeLanguage = (language: string) => {
  if (language === "zh-CN" || language === "en-GB") {
    return language;
  }
  if (language === "zh-TW") {
    return "zh-CN";
  }
  return "en-GB";
};

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

const showFatalOverlay = (title: string, details: string) => {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  const escaped = `${details || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  root.innerHTML = `
    <div style="position:fixed;inset:0;overflow:auto;background:#fff;color:#222;padding:24px;font-family:Segoe UI,sans-serif;z-index:2147483647;">
      <h2 style="margin:0 0 10px 0;">${title}</h2>
      <pre style="white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;line-height:1.45;">${escaped}</pre>
    </div>
  `;
};

const installGlobalErrorHooks = () => {
  window.addEventListener("error", (event) => {
    console.error("Window error:", event.error || event.message);
    forceRemoveLoading();
    showFatalOverlay(
      "PaperMind window error",
      `${event.message}\n\n${event.error?.stack || ""}`
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    console.error("Unhandled rejection:", reason);
    forceRemoveLoading();
    showFatalOverlay(
      "PaperMind unhandled rejection",
      `${reason?.stack || reason || "Unknown rejection"}`
    );
  });
};

async function initialize() {
  // Dynamically import all heavy dependencies so startup-time import failures
  // still go through this function's catch path instead of white-screening.
  const [{ RecycleScroller }, { createPinia }, { Pane, Splitpanes }, { createApp }, { createI18n }, { default: draggable }] =
    await Promise.all([
      import("@future-scholars/vue-virtual-scroller"),
      import("pinia"),
      import("splitpanes"),
      import("vue"),
      import("vue-i18n"),
      import("vuedraggable"),
    ]);

  const [{ InjectionContainer }, { Process }, { RendererProcessRPCService }, { loadLocales }, { CommandService }, { ShortcutService }, { UISlotService }, { UIStateService }, { QuerySentenceService }, { default: AppView }] =
    await Promise.all([
      import("@/base/injection/injection"),
      import("@/base/process-id"),
      import("@/base/rpc/rpc-service-renderer"),
      import("@/locales/load"),
      import("./services/command-service"),
      import("./services/shortcut-service"),
      import("./services/uislot-service"),
      import("./services/uistate-service"),
      import("./services/querysentence-service"),
      import("./ui/app-view.vue"),
    ]);

  const pinia = createPinia();
  const app = createApp(AppView);

  app.config.errorHandler = (error, _instance, info) => {
    console.error("Vue fatal error:", error, info);
    forceRemoveLoading();
    showFatalOverlay(
      "PaperMind runtime error",
      `${info}\n\n${(error as Error)?.stack || error}`
    );
  };

  app.use(pinia);
  app.component("Splitpanes", Splitpanes);
  app.component("Pane", Pane);
  app.component("draggable", draggable);
  app.component("RecycleScroller", RecycleScroller);

  const rendererRPCService = new RendererProcessRPCService(
    Process.renderer,
    "PLUIAPI"
  );
  await rendererRPCService.initCommunication();

  const mainAPIExposed = await rendererRPCService.waitForAPI(
    Process.main,
    "PLMainAPI",
    API_READY_TIMEOUT_MS
  );
  if (!mainAPIExposed) {
    throw new Error("Main process API is not exposed");
  }

  const serviceAPIExposed = await rendererRPCService.waitForAPI(
    Process.service,
    "PLAPI",
    API_READY_TIMEOUT_MS
  );
  if (!serviceAPIExposed) {
    throw new Error("Service process API is not exposed");
  }

  const injectionContainer = new InjectionContainer({
    rendererRPCService,
  });
  const instances = injectionContainer.createInstance<IInjectable>({
    commandService: CommandService,
    uiStateService: UIStateService,
    uiSlotService: UISlotService,
    shortcutService: ShortcutService,
    querySentenceService: QuerySentenceService,
  } as any);

  for (const [key, instance] of Object.entries(instances)) {
    if (!globalThis["PLUIAPILocal"]) {
      globalThis["PLUIAPILocal"] = {} as any;
    }
    globalThis[key] = instance;
    globalThis["PLUIAPILocal"][key] = instance;
  }

  rendererRPCService.setActionor(instances);

  await PLMainAPI.preferenceService.bindState();
  await PLAPI.paperService.bindState();
  await PLAPI.feedService.bindState();
  await PLAPI.fileService.bindState();
  await PLAPI.syncService.bindState();

  const locales = loadLocales();
  const initialLanguage = normalizeLanguage(
    (await PLMainAPI.preferenceService.get("language")) as string
  );
  const i18n = createI18n({
    locale: initialLanguage,
    fallbackLocale: "en-GB",
    messages: locales,
    globalInjection: true,
    legacy: false,
  });

  PLMainAPI.preferenceService.onChanged("language", (newValue) => {
    const normalizedLanguage = normalizeLanguage(newValue.value as string);
    const locale = i18n.global.locale as unknown;
    if (typeof locale === "string") {
      (i18n.global as any).locale = normalizedLanguage;
    } else {
      (locale as { value: string }).value = normalizedLanguage;
    }
  });

  app.use(i18n);
  app.mount("#app");
  mounted = true;
  clearGlobalLoadingWatchdog();
}

installGlobalErrorHooks();

globalLoadingWatchdog = setTimeout(() => {
  console.warn("Renderer initialization timeout fallback triggered.");
  forceRemoveLoading();
  if (!mounted) {
    showFatalOverlay(
      "PaperMind is still starting",
      "Startup is taking too long. Please check service.log and main.log in the PaperMind logs folder."
    );
  }
}, 25000);

initialize().catch((error) => {
  console.error("Renderer initialization failed:", error);
  clearGlobalLoadingWatchdog();
  forceRemoveLoading();
  const errorMessage =
    error instanceof Error
      ? `${error.message}\n${error.stack || ""}`.trim()
      : `${error}`;
  showFatalOverlay("PaperMind failed to initialize", errorMessage);
});
