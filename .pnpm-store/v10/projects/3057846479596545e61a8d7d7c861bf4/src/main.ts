import { PLAPI, PLExtAPI, PLExtension } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { EntryScrapeService } from "@/services/entry-scrape-service";

class PaperlibEntryScrapeExtension extends PLExtension {
  disposeCallbacks: (() => void)[];

  private readonly _entryScrapeService: EntryScrapeService;

  constructor() {
    super({
      id: "@future-scholars/paperlib-entry-scrape-extension",
      defaultPreference: {
        "local-pdf-parse": {
          type: "boolean",
          name: "Parse PDF locally",
          description: "Use local function to parse PDFs (fast) or the online API (accurate)",
          value: true,
          order: 1,
        },
        "download-pdf": {
          type: "boolean",
          name: "Download PDF",
          description: "Download PDFs when importing papers via the browser extension.",
          value: true,
          order: 2,
        }
      },
    });

    this._entryScrapeService = new EntryScrapeService();

    this.disposeCallbacks = [];
  }

  async initialize() {
    await PLExtAPI.extensionPreferenceService.register(
      this.id,
      this.defaultPreference,
    );

    this.disposeCallbacks.push(
      PLAPI.hookService.hookTransform("scrapeEntry", this.id, "scrapeEntry"),
    );

    this.disposeCallbacks.push(
      PLAPI.commandService.on(
        "@future-scholars/paperlib-entry-scrape-extension:import" as any,
        (args) => {
          this._import(args);
        },
      ),
    );

    this.disposeCallbacks.push(
      PLAPI.commandService.registerExternel({
        id: `import-from`,
        description: "Import papers from given DOIs, ArXiv IDs, Webpage URLs or Titles (separated by ;).",
        event: "@future-scholars/paperlib-entry-scrape-extension:import",
      }),
    );
  }

  async dispose() {
    for (const disposeCallback of this.disposeCallbacks) {
      disposeCallback();
    }
    PLExtAPI.extensionPreferenceService.unregister(this.id);
  }

  async scrapeEntry(payloads: any[]) {
    const startTime = Date.now();
    PLAPI.logService.info(
      `Scrape entry - start`,
      JSON.stringify(payloads).substring(0, 100),
      false,
      "EntryScrapeExt",
    )

    if (payloads.length === 0) {
      const endTime = Date.now();
      PLAPI.logService.info(
        `Scrape entry - done`,
        `Time: ${endTime - startTime}ms`,
        false,
        "EntryScrapeExt",
      )
      return [];
    }

    const paperEntityDrafts = await this._entryScrapeService.scrape(payloads);

    const endTime = Date.now();
    PLAPI.logService.info(
      `Scrape entry - done`,
      `Time: ${endTime - startTime}ms, Result: ${paperEntityDrafts.length} entities.`,
      false,
      "EntryScrapeExt",
    )
    return paperEntityDrafts;
  }

  async _import(payloads: {value: string[]}) {
    const ids = payloads.value[0].split(";").map((id) => id.trim());

    PLAPI.logService.info("Import From", JSON.stringify(ids), false, "EntryScrapeExt");

    const dois: string[] = [];
    const arxivIds: string[] = [];
    const titles: string[] = [];
    const webUrls: string[] = [];

    for (const id of ids) {
      if (id.startsWith("http://") || id.startsWith("https://")) {
        webUrls.push(id);
      } else if (id.match(/^10.\d{4,9}\/[-._;()/:A-Z0-9]+$/i)) {
        dois.push(id);
      } else if (id.match(/.*(\d{4}\.\d{4,5}).*/)) {
        arxivIds.push(id);
      } else {
        titles.push(id);
      }
    }

    const entities: PaperEntity[] = [];

    for (const doi of dois) {
      entities.push(new PaperEntity({ doi }));
    }
    for (const arxivId of arxivIds) {
      entities.push(new PaperEntity({ arxiv: arxivId }));
    }
    for (const title of titles) {
      entities.push(new PaperEntity({ title }));
    }
    const downloadPDF = await PLExtAPI.extensionPreferenceService.get(this.id, "download-pdf");

    for (const webUrl of webUrls) {
      try {
        const webPageContent = webUrl.endsWith(".pdf") ? "" : (await PLExtAPI.networkTool.get(webUrl, undefined, 0, 5000, false, true)).body;

        const payload = {
          type: "webcontent",
          value: {
            url: webUrl,
            document: webPageContent,
            cookies: "",
            options: {
              downloadPDF
            }
          },
        }
        
        const paperEntities = await this.scrapeEntry([payload]);
        entities.push(...paperEntities);
      } catch (e) {
        PLAPI.logService.error(`Failed to fetch web page content: ${webUrl}`, e as Error, true, "EntryScrapeExt");
        continue;
      }
    }

    const scrapedEntities = await PLAPI.scrapeService.scrape(entities.map(v => {
      return {"type": "paperEntity", "value": v};
    }), []);
    await PLAPI.paperService.update(scrapedEntities);
  }
}

async function initialize() {
  const extension = new PaperlibEntryScrapeExtension();
  await extension.initialize();

  return extension;
}

export { initialize };
