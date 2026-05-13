import { PLAPI, PLExtAPI, PLExtension } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";
import stringSimilarity from "string-similarity";

class PaperMindCitationCountExtension extends PLExtension {
  disposeCallbacks: (() => void)[];
  private readonly _cache: Map<string, { content: string; at: number }>;
  private readonly _inflight: Set<string>;

  constructor() {
    super({
      id: "@future-scholars/paperlib-citation-count-extension",
      defaultPreference: {},
    });

    this.disposeCallbacks = [];
    this._cache = new Map();
    this._inflight = new Set();
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

    const selectedPaperEntities = (await PLAPI.uiStateService.getState(
      "selectedPaperEntities"
    )) as unknown as PaperEntity[];
    if (selectedPaperEntities?.length === 1) {
      void this.getCitationCount(selectedPaperEntities[0]);
    }
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
    const doi = `${paperEntity.doi || ""}`.trim();
    const arxiv = `${paperEntity.arxiv || ""}`.trim();
    const paperTitle = `${paperEntity.title || ""}`.trim();

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

    this._inflight.add(paperKey);
    await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
      "paperlib-citation-count": {
        title,
        content: "Loading...",
      },
    });

    try {
      const count =
        (await this._fetchSemanticScholarCount(paperEntity, doi, arxiv, paperTitle)) ||
        (await this._fetchOpenAlexCount(paperEntity, doi, paperTitle)) ||
        (await this._fetchCrossrefCount(doi, paperTitle));
      const content = this._formatCitationCount(count);

      await PLAPI.uiSlotService.updateSlot("paperDetailsPanelSlot1", {
        "paperlib-citation-count": {
          title,
          content,
        },
      });
      this._cache.set(paperKey, { content, at: Date.now() });
    } catch (err) {
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

  private async _fetchSemanticScholarCount(
    paperEntity: PaperEntity,
    doi: string,
    arxiv: string,
    paperTitle: string
  ) {
    const useSearchEndpoint = !doi && !arxiv;
    let scrapeURL = "";

    if (doi) {
      scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
        doi
      )}?fields=title,year,authors,citationCount,influentialCitationCount`;
    } else if (arxiv) {
      scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(
        arxiv.toLowerCase().replace("arxiv:", "").split("v")[0]
      )}?fields=title,year,authors,citationCount,influentialCitationCount`;
    } else {
      scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
        paperTitle
      )}&limit=15&fields=title,year,authors,citationCount,influentialCitationCount`;
    }

    try {
      const parsedResponse = (
        await PLExtAPI.networkTool.get(
          scrapeURL,
          { Accept: "application/json" },
          0,
          10000,
          false,
          true
        )
      ).body;
      const itemList = parsedResponse.data ? parsedResponse.data : [parsedResponse];
      const bestItem = this._pickBestItem(
        paperEntity,
        itemList,
        useSearchEndpoint ? 0.5 : 0
      );

      if (!bestItem) {
        return null;
      }

      const citationCount =
        typeof bestItem.citationCount === "number" ? bestItem.citationCount : null;
      const influentialCitationCount =
        typeof bestItem.influentialCitationCount === "number"
          ? bestItem.influentialCitationCount
          : null;

      if (citationCount === null && influentialCitationCount === null) {
        return null;
      }

      return {
        citationCount,
        influentialCitationCount,
      };
    } catch (error) {
      PLAPI.logService.warn(
        "Semantic Scholar citation lookup failed.",
        `${(error as Error).message || error}`,
        false,
        "CitationCountExt"
      );
      return null;
    }
  }

  private async _fetchOpenAlexCount(
    paperEntity: PaperEntity,
    doi: string,
    paperTitle: string
  ) {
    try {
      let parsedResponse: any;
      if (doi) {
        parsedResponse = (
          await PLExtAPI.networkTool.get(
            `https://api.openalex.org/works?filter=doi:${encodeURIComponent(
              doi
            )}&per-page=1&select=display_name,publication_year,cited_by_count,authorships`,
            { Accept: "application/json" },
            0,
            10000,
            false,
            true
          )
        ).body;
        parsedResponse = parsedResponse?.results?.[0];
      } else if (paperTitle) {
        parsedResponse = (
          await PLExtAPI.networkTool.get(
            `https://api.openalex.org/works?search=${encodeURIComponent(
              paperTitle
            )}&per-page=10&select=display_name,publication_year,cited_by_count,authorships`,
            { Accept: "application/json" },
            0,
            10000,
            false,
            true
          )
        ).body;
        parsedResponse = this._pickBestOpenAlexWork(
          paperEntity,
          parsedResponse?.results || []
        );
      }

      const citationCount =
        typeof parsedResponse?.cited_by_count === "number"
          ? parsedResponse.cited_by_count
          : null;

      if (citationCount === null) {
        return null;
      }

      return {
        citationCount,
        influentialCitationCount: null,
      };
    } catch (error) {
      PLAPI.logService.warn(
        "OpenAlex citation lookup failed.",
        `${(error as Error).message || error}`,
        false,
        "CitationCountExt"
      );
      return null;
    }
  }

  private async _fetchCrossrefCount(doi: string, paperTitle: string) {
    if (!doi) {
      return null;
    }

    try {
      const parsedResponse = (
        await PLExtAPI.networkTool.get(
          `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
          { Accept: "application/json" },
          0,
          10000,
          false,
          true
        )
      ).body;
      const item = parsedResponse?.message;
      const citationCount =
        typeof item?.["is-referenced-by-count"] === "number"
          ? item["is-referenced-by-count"]
          : null;

      if (citationCount === null) {
        return null;
      }

      return {
        citationCount,
        influentialCitationCount: null,
      };
    } catch (error) {
      PLAPI.logService.warn(
        "Crossref citation lookup failed.",
        `${(error as Error).message || error} ${paperTitle || ""}`,
        false,
        "CitationCountExt"
      );
      return null;
    }
  }

  private _formatCitationCount(
    count: { citationCount: number | null; influentialCitationCount: number | null } | null
  ) {
    if (!count) {
      return "N/A";
    }

    if (
      count.citationCount !== null &&
      count.influentialCitationCount !== null
    ) {
      return `${count.citationCount} (${count.influentialCitationCount})`;
    }

    if (count.citationCount !== null) {
      return `${count.citationCount}`;
    }

    if (count.influentialCitationCount !== null) {
      return `N/A (${count.influentialCitationCount})`;
    }

    return "N/A";
  }

  private _pickBestOpenAlexWork(paperEntity: PaperEntity, itemList: any[]) {
    return this._pickBestItem(
      paperEntity,
      itemList.map((item) => ({
        ...item,
        title: item.display_name,
        year: item.publication_year,
        authors: (item.authorships || []).map((authorship: any) => ({
          name: authorship?.author?.display_name || "",
        })),
      })),
      0.5
    );
  }

  private _pickBestItem(
    paperEntity: PaperEntity,
    itemList: any[],
    minScore: number
  ) {
    const existTitle = this._normalizeTitle(paperEntity.title);
    const targetYear = Number.parseInt(`${(paperEntity as any).year || ""}`, 10);
    const targetAuthorToken = this._firstAuthorToken(`${paperEntity.authors || ""}`);

    let bestScore = -1;
    let bestItem: any = null;
    for (const item of itemList || []) {
      if (!item) {
        continue;
      }

      const plainHitTitle = this._normalizeTitle(item.title || item.display_name || "");
      const sim = plainHitTitle
        ? stringSimilarity.compareTwoStrings(plainHitTitle, existTitle)
        : 0;

      let score = sim;
      const hitYear = Number.parseInt(`${item.year || item.publication_year || ""}`, 10);
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

    return bestScore >= minScore ? bestItem : null;
  }

  private _normalizeTitle(title: string) {
    return stringUtils.formatString({
      str: title,
      removeStr: "&amp;",
      removeSymbol: true,
      lowercased: true,
    });
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
