import { PLAPI, PLExtAPI, PLExtension } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";
import stringSimilarity from "string-similarity";

class PaperMindCitationCountExtension extends PLExtension {
  disposeCallbacks: (() => void)[];
  private readonly _cache: Map<string, { content: string; at: number }>;
  private readonly _inflight: Set<string>;
  private _rateLimitedUntil: number;

  constructor() {
    super({
      id: "@future-scholars/paperlib-citation-count-extension",
      defaultPreference: {},
    });

    this.disposeCallbacks = [];
    this._cache = new Map();
    this._inflight = new Set();
    this._rateLimitedUntil = 0;
  }

  async initialize() {
    await PLExtAPI.extensionPreferenceService.register(
      this.id,
      this.defaultPreference
    );

    this.disposeCallbacks.push(
      PLAPI.uiStateService.onChanged("selectedPaperEntities", (newValues) => {
        if (newValues.value.length === 1) {
          this.getCitationCount(newValues.value[0]);
        }
      })
    );
  }

  async dispose() {
    for (const disposeCallback of this.disposeCallbacks) {
      disposeCallback();
    }

    PLExtAPI.extensionPreferenceService.unregister(this.id);
  }

  async getCitationCount(paperEntity: PaperEntity) {
    const lang = await PLAPI.preferenceService.get("language");
    const title = lang === "zh-CN" ? "引用次数" : "Citation Count";
    const paperKey = this._paperKey(paperEntity);

    const cached = this._cache.get(paperKey);
    if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) {
      await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
        "paperlib-citation-count": {
          title,
          content: cached.content,
        },
      });
      return;
    }

    if (this._inflight.has(paperKey)) {
      return;
    }

    if (Date.now() < this._rateLimitedUntil) {
      const waitSeconds = Math.ceil((this._rateLimitedUntil - Date.now()) / 1000);
      await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
        "paperlib-citation-count": {
          title,
          content:
            lang === "zh-CN"
              ? `请求过快，请 ${waitSeconds}s 后重试`
              : `Rate limited, retry in ${waitSeconds}s`,
        },
      });
      return;
    }

    this._inflight.add(paperKey);
    await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
      "paperlib-citation-count": {
        title,
        content: "Loading...",
      },
    });

    const useSearchEndpoint = paperEntity.doi === "" && paperEntity.arxiv === "";
    let scrapeURL = "";

    if (paperEntity.doi !== "") {
      scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
        paperEntity.doi
      )}?fields=title,year,authors,citationCount,influentialCitationCount`;
    } else if (paperEntity.arxiv !== "") {
      scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(
        paperEntity.arxiv.toLowerCase().replace("arxiv:", "").split("v")[0]
      )}?fields=title,year,authors,citationCount,influentialCitationCount`;
    } else {
      scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
        paperEntity.title
      )}&limit=15&fields=title,year,authors,citationCount,influentialCitationCount`;
    }

    try {
      const response = await PLExtAPI.networkTool.get(
        scrapeURL,
        {},
        1,
        8000,
        true,
        true
      );
      const parsedResponse = response.body;
      const itemList = parsedResponse.data ? parsedResponse.data : [parsedResponse];

      const existTitle = stringUtils.formatString({
        str: paperEntity.title,
        removeStr: "&amp;",
        removeSymbol: true,
        lowercased: true,
      });
      const targetYear = Number.parseInt(`${(paperEntity as any).year || ""}`, 10);
      const targetAuthorToken = this._firstAuthorToken(`${paperEntity.authors || ""}`);

      let bestScore = -1;
      let bestItem: any = null;
      for (const item of itemList) {
        if (!item) {
          continue;
        }

        const plainHitTitle = stringUtils.formatString({
          str: item.title || "",
          removeStr: "&amp;",
          removeSymbol: true,
          lowercased: true,
        });
        const sim = plainHitTitle
          ? stringSimilarity.compareTwoStrings(plainHitTitle, existTitle)
          : 0;

        if (!useSearchEndpoint) {
          bestItem = item;
          break;
        }

        let score = sim;
        const hitYear = Number.parseInt(`${item.year || ""}`, 10);
        if (!Number.isNaN(targetYear) && !Number.isNaN(hitYear)) {
          if (hitYear === targetYear) {
            score += 0.15;
          } else if (Math.abs(hitYear - targetYear) <= 1) {
            score += 0.06;
          }
        }

        const hitAuthorToken = this._firstAuthorTokenFromHit(item);
        if (targetAuthorToken && hitAuthorToken && targetAuthorToken === hitAuthorToken) {
          score += 0.15;
        }

        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }

      let citationCount = "N/A";
      let influentialCitationCount = "N/A";
      if (bestItem && (!useSearchEndpoint || bestScore >= 0.62)) {
        citationCount = `${bestItem.citationCount ?? "N/A"}`;
        influentialCitationCount = `${bestItem.influentialCitationCount ?? "N/A"}`;
      }

      let content = "N/A";
      if (citationCount !== "N/A" && influentialCitationCount !== "N/A") {
        content = `${citationCount} (${influentialCitationCount})`;
      } else if (citationCount !== "N/A") {
        content = `${citationCount}`;
      } else if (influentialCitationCount !== "N/A") {
        content = `N/A (${influentialCitationCount})`;
      }

      await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
        "paperlib-citation-count": {
          title,
          content,
        },
      });
      this._cache.set(paperKey, { content, at: Date.now() });
    } catch (err) {
      const message = `${(err as Error).message || err}`;
      if (message.includes("429")) {
        this._rateLimitedUntil = Date.now() + 60 * 1000;
        await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
          "paperlib-citation-count": {
            title,
            content:
              lang === "zh-CN"
                ? "请求过快，请稍后再试"
                : "Rate limited, please retry later",
          },
        });
      } else {
        PLAPI.logService.error(
          "Failed to get citation count.",
          err as Error,
          false,
          "CitationCountExt"
        );
        await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
          "paperlib-citation-count": {
            title,
            content: "N/A",
          },
        });
      }
    } finally {
      this._inflight.delete(paperKey);
    }
  }

  private _paperKey(paperEntity: PaperEntity) {
    const doi = `${paperEntity.doi || ""}`.trim().toLowerCase();
    const arxiv = `${paperEntity.arxiv || ""}`.trim().toLowerCase();
    const title = `${paperEntity.title || ""}`.trim().toLowerCase();
    if (doi) {
      return `doi:${doi}`;
    }
    if (arxiv) {
      return `arxiv:${arxiv}`;
    }
    return `title:${title}`;
  }

  private _firstAuthorToken(authors: string) {
    if (!authors) {
      return "";
    }
    const firstAuthor = authors.split(",")[0].trim().toLowerCase();
    if (!firstAuthor) {
      return "";
    }
    const parts = firstAuthor.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : "";
  }

  private _firstAuthorTokenFromHit(item: any) {
    const first =
      Array.isArray(item?.authors) && item.authors.length > 0
        ? `${item.authors[0]?.name || ""}`.toLowerCase()
        : "";
    if (!first) {
      return "";
    }
    const parts = first.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : "";
  }
}

async function initialize() {
  const extension = new PaperMindCitationCountExtension();
  await extension.initialize();

  return extension;
}

export { initialize };
