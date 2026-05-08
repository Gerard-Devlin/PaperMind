import { PLAPI, PLExtAPI, PLExtension, PLMainAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { MetadataScrapeService } from "@/services/metadata-scrape-service";

interface IScraperPreference {
  type: "boolean";
  name: string;
  description: string;
  value: boolean;
}

class PaperlibMetadataScrapeExtension extends PLExtension {
  disposeCallbacks: (() => void)[];

  private readonly _metadataScrapeService: MetadataScrapeService;

  constructor() {
    super({
      id: "@future-scholars/paperlib-metadata-scrape-extension",
      defaultPreference: {
        presetting: {
          type: "options",
          name: "Presetting",
          description: "Scraper bundle presetting.",
          options: {
            general: "General",
            cs: "Computer Science",
            es: "Earth Science",
            phy: "Physics",
          },
          value: "general",
          order: 0,
        },
        "scraper-arxiv": {
          type: "boolean",
          name: "Arxiv",
          description: "arxiv.org",
          value: true,
          order: 1,
        },
        "scraper-chemrxiv": {
          type: "boolean",
          name: "ChemRxiv",
          description: "chemrxiv.org",
          value: false,
          order: 1,
        },
        "scraper-crossref": {
          type: "boolean",
          name: "Crossref",
          description: "crossref.org",
          value: true,
          order: 1,
        },
        "scraper-dblp": {
          type: "boolean",
          name: "DBLP",
          description: "dblp.org - Computer Science Bibliography",
          value: true,
          order: 1,
        },
        "scraper-doi": {
          type: "boolean",
          name: "DOI",
          description: "Digital Object Identifier (DOI)",
          value: true,
          order: 1,
        },
        "scraper-openreview": {
          type: "boolean",
          name: "OpenReview",
          description: "openreview.net",
          value: true,
          order: 1,
        },
        "scraper-pwc": {
          type: "boolean",
          name: "Paper with Code",
          description: "paperwithcode.com",
          value: true,
          order: 1,
        },
        "scraper-pubmed": {
          type: "boolean",
          name: "PubMed",
          description: "pubmed.ncbi.nlm.nih.gov",
          value: false,
          order: 1,
        },
        "scraper-semanticscholar": {
          type: "boolean",
          name: "Semantic Scholar",
          description: "semanticscholar.org",
          value: true,
          order: 1,
        },
        "scraper-springer": {
          type: "boolean",
          name: "Springer",
          description: "Springer",
          value: false,
          order: 1,
        },
        "scraper-adsabs": {
          type: "boolean",
          name: "NASA/ADS",
          description: "adsabs.harvard.edu",
          value: false,
          order: 1,
        },
        "scraper-ieee": {
          type: "boolean",
          name: "IEEE xplore",
          description: "IEEE Xplore Digital Library",
          value: false,
          order: 2,
        },
        "ieee-scrapers-api-key": {
          type: "string",
          name: "IEEE API Key",
          description: "IEEE API Key, get one from https://developer.ieee.org/",
          value: "",
          order: 2,
        },
        "show-presetting-hint": {
          type: "hidden",
          name: "Show Presetting Hint",
          description: "Show presetting hint.",
          value: true,
          order: 3,
        }
      },
    });

    this._metadataScrapeService = new MetadataScrapeService();

    this.disposeCallbacks = [];
  }

  async initialize() {
    await PLExtAPI.extensionPreferenceService.register(
      this.id,
      this.defaultPreference,
    );

    this.disposeCallbacks.push(
      PLExtAPI.extensionPreferenceService.onChanged(
        `${this.id}:presetting`,
        (newValue) => {
          this.setPresetting(newValue.value.value);
        },
      ),
    );

    this.disposeCallbacks.push(
      PLAPI.hookService.hookModify("scrapeMetadata", this.id, "scrapeMetadata"),
    );

    this._registerContextMenu();
    this._showPresettingHint();
  }

  async dispose() {
    for (const disposeCallback of this.disposeCallbacks) {
      disposeCallback();
    }
    PLExtAPI.extensionPreferenceService.unregister(this.id);
    PLMainAPI.contextMenuService.unregisterScraperExtension(this.id);
  }

  private _registerContextMenu() {
    const enabledScrapers: { [id: string]: string } = {};

    const scraperPref: Map<string, IScraperPreference> =
      PLExtAPI.extensionPreferenceService.getAllMetadata(this.id);

    for (const [id, pref] of scraperPref.entries()) {
      if (id.startsWith("scraper-") && pref.value) {
        enabledScrapers[id] = pref.name;
      }
    }

    PLMainAPI.contextMenuService.registerScraperExtension(
      this.id,
      enabledScrapers,
    );
  }

  async scrapeMetadata(
    paperEntityDrafts: PaperEntity[],
    specificScrapers: string[],
    force: boolean,
  ) {
    console.time("scrapeMetadata");
    if (paperEntityDrafts.length === 0) {
      console.timeEnd("scrapeMetadata");

      return [paperEntityDrafts, specificScrapers, force];
    }

    // Get enabled scrapers
    let scrapers: string[] = [];
    if (specificScrapers.length > 0) {
      scrapers = specificScrapers.filter((scraper) =>
        scraper.startsWith(this.id),
      );
      if (scrapers.length === 0) {
        console.timeEnd("scrapeMetadata");

        return [paperEntityDrafts, specificScrapers, force];
      } else {
        scrapers = scrapers.map((scraper) =>
          scraper.replace(`${this.id}-`, ""),
        );
      }
    } else {
      const scraperPref: Map<string, IScraperPreference> =
        PLExtAPI.extensionPreferenceService.getAllMetadata(this.id);

      for (const [id, pref] of scraperPref.entries()) {
        if (pref.value && id.startsWith("scraper-")) {
          scrapers.push(id);
        }
      }
    }
    scrapers = scrapers.map((scraper) => scraper.replace("scraper-", ""));

    if (scrapers.includes("chemrxiv")) {
      scrapers.push("chemrxivprecise");
      scrapers.push("chemrxivfuzzy");
      scrapers = scrapers.filter((scraper) => scraper !== "chemrxiv");
    }

    const scrapedPaperEntityDrafts = await this._metadataScrapeService.scrape(
      paperEntityDrafts.map((paperEntityDraft) => {
        return new PaperEntity(paperEntityDraft);
      }),
      scrapers,
      force,
    );

    console.timeEnd("scrapeMetadata");

    return [scrapedPaperEntityDrafts, specificScrapers, force];
  }

  setPresetting(presetting: string) {
    if (!["general", "cs", "es", "phy"].includes(presetting)) {
      return;
    }

    if (presetting === "general" || presetting === "cs") {
      PLExtAPI.extensionPreferenceService.set(this.id, {
        "scraper-arxiv": true,
        "scraper-chemrxiv": false,
        "scraper-crossref": true,
        "scraper-dblp": true,
        "scraper-doi": true,
        "scraper-openreview": true,
        "scraper-pwc": true,
        "scraper-pubmed": false,
        "scraper-semanticscholar": true,
        "scraper-springer": false,
        "scraper-adsabs": false,
        "scraper-ieee": false,
      });
    } else if (presetting === "es") {
      PLExtAPI.extensionPreferenceService.set(this.id, {
        "scraper-arxiv": false,
        "scraper-chemrxiv": false,
        "scraper-crossref": true,
        "scraper-dblp": false,
        "scraper-doi": true,
        "scraper-openreview": false,
        "scraper-pwc": false,
        "scraper-pubmed": false,
        "scraper-semanticscholar": true,
        "scraper-springer": true,
        "scraper-adsabs": true,
        "scraper-ieee": false,
      });
    } else if (presetting === "phy") {
      PLExtAPI.extensionPreferenceService.set(this.id, {
        "scraper-arxiv": true,
        "scraper-chemrxiv": false,
        "scraper-crossref": true,
        "scraper-dblp": false,
        "scraper-doi": true,
        "scraper-openreview": false,
        "scraper-pwc": false,
        "scraper-pubmed": false,
        "scraper-semanticscholar": true,
        "scraper-adsabs": true,
        "scraper-springer": false,
        "scraper-ieee": false,
      });
    }
  }

  private async _showPresettingHint() {
    if (!PLExtAPI.extensionPreferenceService.get(this.id, "show-presetting-hint")) {
      return;
    }

    const presetting = PLExtAPI.extensionPreferenceService.get(
      this.id,
      "presetting",
    ) as string;

    const lang = (await PLAPI.preferenceService.get("language")) as string;

    const title = lang === "zh-CN" ? "选择最佳的元数据抓取器组合" : "Choose Your Best Metadata Scraper Bundle";
    const content = lang === "zh-CN" ? "<div>如果您是 CS 学科，使用默认的元数据抓取器组合没有问题。</div><div>但是对于其他学科，您需要在 Metadata Scrape 扩展首选项中自定义元数据抓取器组合。比如医学生物学科的用户，请手动打开 PubMed。<p style='color: rgb(239 68 68)'>合适的组合可以加快元数据抓取的速度，提高准确度。</p></div><div>请点击<b>右上角设置</b>-进入<b>插件界面</b>-点击 paperlib-metadata-scraper-extension 的<b>小齿轮</b>进行设置。</div><div>抓取器并非越多越好，合适的组合才能取得速度与精度的权衡。</div>" : "<div>Using the default metadata scraper bundle may not be a problem if your research topic is CS.</div><div>But for other research fields, it would be nessasary to customize your metadata scraper bundle in the extension preference. For example, users in the field of medical biology, please manually turn on PubMed. <p style='color: rgb(239 68 68)'>A suitable bundle can speed up your metadata scraping and improve accuracy.</p></div><div>Please click the <b>setting button in the upper right corner</b> - enter the <b>extension tab</b> - click the <b>small gear</b> of paperlib-metadata-scraper-extension to set.</div><div>More scrapers are not always better. A suitable bundle gives you a trade-off between speed and accuracy.</div>";

    if (presetting === "general") {
      await PLAPI.uiSlotService.updateSlot("overlayNotifications", {
        [`${this.id}-presetting-hint`]: {
          title,
          content,
        }
      })
      await PLAPI.uiStateService.setState({
        "overlayNoticationShown": true
      })


    }
    PLExtAPI.extensionPreferenceService.set(this.id, {
      "show-presetting-hint": false,
    });
  }
}

async function initialize() {
  const extension = new PaperlibMetadataScrapeExtension();
  await extension.initialize();

  return extension;
}

export { initialize };
