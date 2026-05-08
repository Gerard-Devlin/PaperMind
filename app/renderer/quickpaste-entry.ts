import { RecycleScroller } from "@future-scholars/vue-virtual-scroller";
import { createPinia } from "pinia";
import { createApp } from "vue";
import { createI18n } from "vue-i18n";

import { InjectionContainer } from "@/base/injection/injection";
import { Process } from "@/base/process-id";
import { RendererProcessRPCService } from "@/base/rpc/rpc-service-renderer";
import { loadLocales } from "@/locales/load";

import { IInjectable } from "./services/injectable";
import { ShortcutService } from "./services/shortcut-service";
import QuickpasteView from "./ui/quickpaste-view/quickpaste-view.vue";

import "./css/index.css";

const normalizeLanguage = (language: string) => {
  if (language === "zh-CN" || language === "en-GB") {
    return language;
  }
  if (language === "zh-TW") {
    return "zh-CN";
  }
  return "en-GB";
};

async function initialize() {
  const pinia = createPinia();

  const app = createApp(QuickpasteView);
  app.use(pinia);

  app.component("RecycleScroller", RecycleScroller);

  // ============================================================
  // 1. Initilize the RPC service for current process
  const quickpasteRPCService = new RendererProcessRPCService(
    Process.quickpaste
  );
  // ============================================================
  // 2. Start the port exchange process.
  await quickpasteRPCService.initCommunication();

  // ============================================================
  // 3. Wait for the main process to expose its APIs (PLMainAPI & PLAPI)
  const mainAPIExposed = await quickpasteRPCService.waitForAPI(
    Process.main,
    "PLMainAPI",
    5000
  );
  if (!mainAPIExposed) {
    console.error("Main process API is not exposed");
    throw new Error("Main process API is not exposed");
  }
  const serviceAPIExposed = await quickpasteRPCService.waitForAPI(
    Process.service,
    "PLAPI",
    5000
  );
  if (!serviceAPIExposed) {
    console.error("Service process API is not exposed");
    throw new Error("Service process API is not exposed");
  }

  // ============================================================
  // 4. Create the instances for all services, tools, etc. of the current process.
  const injectionContainer = new InjectionContainer();
  const instances = injectionContainer.createInstance<IInjectable>({
    shortcutService: ShortcutService,
  });
  // 4.1 Expose the instances to the global scope for convenience.
  for (const [key, instance] of Object.entries(instances)) {
    if (!globalThis["PLQPUIAPI"]) {
      globalThis["PLQPUIAPI"] = {} as any;
    }
    globalThis[key] = instance;
    globalThis["PLQPUIAPI"][key] = instance;
  }

  // ============================================================
  // 6. Setup other things for the renderer process.
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
  app.mount("#quickpaste");
}

initialize();
