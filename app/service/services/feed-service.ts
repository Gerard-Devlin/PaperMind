import { chunkRun } from "@/base/chunk";
import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { FeedEntityFilterOptions } from "@/base/filter";
import { createDecorator } from "@/base/injection/injection";
import { ILogService, LogService } from "@/common/services/log-service";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { Colors } from "@/models/categorizer";
import { Feed, IFeedCollection, IFeedObject } from "@/models/feed";
import {
  FeedEntity,
  IFeedEntityCollection,
  IFeedEntityObject,
} from "@/models/feed-entity";
import { Entity } from "@/models/entity";
import { OID } from "@/models/id";
import { PaperEntity } from "@/models/paper-entity";
import { Supplementary } from "@/models/supplementary";
import { DatabaseCore, IDatabaseCore } from "@/service/services/database/core";

import {
  FeedEntityRepository,
  IFeedEntityRepository,
} from "../repositories/db-repository/feed-entity-repository";
import {
  FeedRepository,
  IFeedRepository,
} from "../repositories/db-repository/feed-repository";
import {
  IRSSRepository,
  RSSRepository,
} from "../repositories/rss-repository/rss-repository";
import { IPaperService, PaperService } from "./paper-service";
import { ISchedulerService, SchedulerService } from "./scheduler-service";
import { IScrapeService, ScrapeService } from "./scrape-service";
import {
  ISemanticSearchService,
  SemanticSearchService,
} from "./semantic-search-service";

export interface IFeedServiceState {
  updated: number;
  entitiesCount: number;
  entitiesUpdated: number;
  arxivRecommendationsCount: number;
  arxivRecommendationsUpdated: number;
}

export const IFeedService = createDecorator("feedService");
const RECOMMENDED_ARXIV_FEED_NAME = "Recommended arXiv";
const ARXIV_RECOMMENDATION_LIMIT = 50;
const ARXIV_RECOMMENDATION_FETCH_LIMIT = 60;
const ARXIV_RECOMMENDATION_TIMEOUT = 25000;
const ARXIV_RECOMMENDATION_REQUEST_GAP = 3500;

export class FeedService extends Eventable<IFeedServiceState> {
  constructor(
    @IDatabaseCore private readonly _databaseCore: DatabaseCore,
    @IFeedEntityRepository
    private readonly _feedEntityRepository: FeedEntityRepository,
    @IFeedRepository private readonly _feedRepository: FeedRepository,
    @IRSSRepository private readonly _rssRepository: RSSRepository,
    @IScrapeService private readonly _scrapeService: ScrapeService,
    @IPaperService private readonly _paperService: PaperService,
    @ISemanticSearchService
    private readonly _semanticSearchService: SemanticSearchService,
    @ISchedulerService private readonly _schedulerService: SchedulerService,
    @ILogService private readonly _logService: LogService
  ) {
    super("feedService", {
      updated: 0,
      entitiesCount: 0,
      entitiesUpdated: 0,
      arxivRecommendationsCount: 0,
      arxivRecommendationsUpdated: 0,
    });

    this._feedRepository.on(["updated"], (payload) => {
      this.fire({
        updated: payload.value,
      });
    });

    this._feedEntityRepository.on(["count", "updated"], (payload) => {
      this.fire({
        [`entities${payload.key.slice(0, 1).toUpperCase()}${payload.key.slice(
          1
        )}`]: payload.value,
      });
    });

    this._databaseCore.already("dbInitialized", () => {
      this._schedulerService.createTask(
        "feedServiceScrapePreprint",
        () => {
          this._routineRefresh();
        },
        86400,
        undefined,
        true,
        false,
        60000
      );
    });
  }

  private _arxivRecommendationCaches = new Map<
    string,
    { entities: FeedEntity[]; updatedAt: number }
  >();

  /**
   * Load feeds.
   * @param sortBy - Sort by.
   * @param sortOrder - Sort order.
   * @returns Feeds.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to load feeds.", true, "FeedService", [])
  async load(sortBy: string, sortOrder: string) {
    if (this._databaseCore.getState("dbInitializing")) {
      return [];
    }
    await this._deletePersistedRecommendedArxivFeed();
    return this._feedRepository.load(
      await this._databaseCore.realm(),
      sortBy,
      sortOrder
    );
  }

  /**
   * Load feed entities from the database.
   * @param filter - Filter.
   * @param sortBy - Sort by.
   * @param sortOrder - Sort order.
   * @returns Feed entities.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to load feed entities.", true, "FeedService", [])
  async loadEntities(
    filter: FeedEntityFilterOptions,
    sortBy: string,
    sortOrder: "asce" | "desc"
  ) {
    if (this._databaseCore.getState("dbInitializing")) {
      return [];
    }
    if (!(filter instanceof FeedEntityFilterOptions)) {
      filter = new FeedEntityFilterOptions(filter);
    }
    await this._deletePersistedRecommendedArxivFeed();

    return this._feedEntityRepository.load(
      await this._databaseCore.realm(),
      filter.toString(),
      filter.placeholders,
      sortBy,
      sortOrder
    );
  }

  @processing(ProcessingKey.General)
  @errorcatching(
    "Failed to load arXiv recommendations.",
    true,
    "FeedService",
    []
  )
  async loadArxivRecommendations(query = "", forceRefresh = false) {
    const normalizedQuery = await this._recommendationQuery(query);
    const cacheKey = this._recommendationCacheKey(normalizedQuery);
    const cache = this._arxivRecommendationCaches.get(cacheKey);
    if (!forceRefresh && cache) {
      this.fire({
        arxivRecommendationsCount: cache.entities.length,
      });
      return cache.entities;
    }

    return await this.refreshArxivRecommendations(normalizedQuery, true);
  }

  @processing(ProcessingKey.General)
  @errorcatching(
    "Failed to refresh arXiv recommendations.",
    true,
    "FeedService",
    []
  )
  async refreshArxivRecommendations(query = "", notify = true) {
    if (this._databaseCore.getState("dbInitializing")) {
      return [];
    }

    const normalizedQuery = await this._recommendationQuery(query);
    const realm = await this._databaseCore.realm();
    const libraryPapers = Array.from(realm.objects<Entity>("Entity"))
      .map((paper) => new Entity(paper))
      .filter((paper) => paper.title || paper.abstract);
    const profile = this._buildRecommendationProfile(libraryPapers);
    const existingIds = new Set(
      libraryPapers
        .map((paper) => `${paper.arxiv || ""}`.toLowerCase().trim())
        .filter(Boolean)
    );
    const existingTitles = new Set(
      libraryPapers
        .map((paper) => this._normalizeTitle(paper.title))
        .filter(Boolean)
    );

    const feed = new Feed(
      {
        name: RECOMMENDED_ARXIV_FEED_NAME,
        url: "",
        color: "purple",
      },
      true
    );
    const drafts = await this._fetchArxivRecommendationDrafts(
      feed,
      normalizedQuery
    );
    const candidates = drafts.filter((draft) => Boolean(draft.title));
    const libraryProfileText = this._buildLibraryProfileText(libraryPapers);
    const semanticScores = await this._semanticScoreArxivCandidates(
      normalizedQuery,
      libraryProfileText,
      candidates
    );
    const scored = candidates
      .map((draft, index) => {
        const score = normalizedQuery
          ? this._scoreQueriedArxivCandidate(
              draft,
              normalizedQuery,
              semanticScores.get(`${index}`)
            )
          : profile.length > 0
            ? this._scoreArxivCandidate(draft, profile)
            : {
                score: 1,
                reason: "latest arXiv paper from the default AI/ML categories.",
              };
        return { draft, score };
      })
      .filter(({ score }) => score.score > 0)
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, ARXIV_RECOMMENDATION_LIMIT)
      .map(({ draft, score }) => {
        const entity = new FeedEntity(draft, true);
        entity.feed = feed;
        const arxiv = `${draft.arxiv || ""}`.toLowerCase().trim();
        const title = this._normalizeTitle(draft.title);
        (entity as any).downloaded =
          (arxiv && existingIds.has(arxiv)) ||
          (title && existingTitles.has(title));
        (entity as any).recommendationScore = this._formatRecommendationScore(
          score.score,
          normalizedQuery
        );
        entity.abstract = [
          score.reason ? `PaperMind recommendation: ${score.reason}` : "",
          draft.abstract || "",
        ]
          .filter(Boolean)
          .join("\n\n");
        return entity;
      });

    if (scored.length === 0) {
      const cache = this._arxivRecommendationCaches.get(
        this._recommendationCacheKey(normalizedQuery)
      );
      if (cache) {
        this.fire({
          arxivRecommendationsCount: cache.entities.length,
          arxivRecommendationsUpdated: Date.now(),
        });
        this._logService.warn(
          "arXiv recommendations kept from cache.",
          `No fresh papers were fetched for "${normalizedQuery}".`,
          true,
          "FeedService"
        );
        return cache.entities;
      }
    }

    this._arxivRecommendationCaches.set(
      this._recommendationCacheKey(normalizedQuery),
      {
        entities: scored,
        updatedAt: Date.now(),
      }
    );
    this.fire({
      arxivRecommendationsCount: scored.length,
      arxivRecommendationsUpdated: Date.now(),
    });

    if (notify) {
      this._logService.info(
        "arXiv recommendations refreshed.",
        normalizedQuery
          ? `${scored.length} paper(s) matched for "${normalizedQuery}".`
          : `${scored.length} paper(s) recommended from latest arXiv submissions.`,
        true,
        "FeedService"
      );
    }

    return scored;
  }

  /**
   * Update feeds.
   * @param feeds - Feeds.
   * @param fromSync - True if from sync. Default: false.
   * @returns Updated feeds.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to update feeds.", true, "FeedService", [])
  async update(feeds: IFeedCollection, fromSync: boolean = false) {
    if (this._databaseCore.getState("dbInitializing")) {
      return [];
    }
    this._logService.info(
      `Updating ${feeds.length} feeds...`,
      "",
      false,
      "FeedService"
    );

    const realm = await this._databaseCore.realm();
    if (!fromSync) {
      await PLAPI.syncService.addSyncLog("feed", "update", { feeds });
    }

    const updatedFeeds: IFeedCollection = [];

    for (const feed of feeds) {
      const updatedFeed = this._feedRepository.update(
        realm,
        feed,
        this._databaseCore.getPartition()
      );
      updatedFeeds.push(updatedFeed);
    }

    return updatedFeeds;
  }

  /**
   * Update feed entities.
   * @param feedEntities - Feed entities
   * @param ignoreReadState - Ignore read state. Default: false.
   * @returns Updated feed entities.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to update feed entities.", true, "FeedService", [])
  async updateEntities(
    feedEntities: IFeedEntityCollection,
    ignoreReadState = false
  ) {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }
    this._logService.info(
      `Updating ${feedEntities.length} feed entities...`,
      "",
      false,
      "FeedEntityService"
    );

    const realm = await this._databaseCore.realm();
    const updatedFeedEntities: IFeedEntityCollection = [];

    for (const feedEntity of feedEntities) {
      const updatedFeedEntity = this._feedEntityRepository.update(
        realm,
        feedEntity,
        this._databaseCore.getPartition(),
        ignoreReadState
      );
      updatedFeedEntities.push(updatedFeedEntity);
    }

    return updatedFeedEntities;
  }

  /**
   * Create feeds.
   * @param feeds - Feeds
   * @param fromSync - True if from sync. Default: false.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to create feeds.", true, "FeedService", [])
  async create(feeds: Feed[], fromSync: boolean = false) {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }
    if (!fromSync) {
      await PLAPI.syncService.addSyncLog("feed", "create", { feeds });
    }

    feeds.forEach((feed) => {
      feed.name = feed.name.replace(/"/g, "'");
    });

    const updatedFeeds = await this.update(feeds);

    await this.refresh(undefined, updatedFeeds);
  }

  /**
   * Refresh feeds.
   * @param ids - Feed ids
   * @param feeds - Feeds
   * @returns
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to refresh feeds.", true, "FeedService")
  async refresh(ids?: OID[], feeds?: IFeedCollection) {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }

    if (!ids && !feeds) {
      throw new Error("No feed ids or feeds provided.");
    }

    this._logService.info(
      `Refreshing ${ids?.length || feeds?.length} feeds...`,
      "",
      false,
      "FeedService"
    );

    const realm = await this._databaseCore.realm();

    if (!feeds && ids) {
      feeds = this._feedRepository.loadByIds(realm, ids);
    } else {
      feeds = feeds!;
    }

    const feedEntityDraftListAndErrors = await chunkRun<
      IFeedObject,
      IFeedEntityCollection,
      IFeedEntityCollection
    >(
      feeds!,
      async (feed: IFeedObject) => {
        const feedEntityDrafts = await this._rssRepository.fetch(feed);
        return feedEntityDrafts;
      },
      async () => {
        return [];
      },
      5
    );

    for (const i in feedEntityDraftListAndErrors.errors) {
      const error = feedEntityDraftListAndErrors.errors[i];
      this._logService.error(
        `Failed to refresh feeds: ${feeds![i].name}`,
        error as Error,
        true,
        "Feed"
      );
    }
    const feedEntityDrafts = feedEntityDraftListAndErrors.results.flat();

    this._logService.info(
      `Fetched ${feedEntityDrafts.length} feed entities...`,
      "",
      false,
      "FeedService"
    );

    await this.updateEntities(feedEntityDrafts, true);
  }

  /**
   * Colorize a feed.
   * @param color - Color
   * @param id - Feed ID
   * @param feed - Feed
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to colorize feeds.", true, "FeedService", [])
  async colorize(color: Colors, id?: OID, feed?: IFeedObject) {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }
    this._feedRepository.colorize(
      await this._databaseCore.realm(),
      color,
      id,
      feed
    );
  }

  /**
   * Delete a feed.
   * @param ids - Feed IDs
   * @param feeds - Feeds
   * @param fromSync - True if from sync. Default: false.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to delete feeds.", true, "FeedService", [])
  async delete(ids?: OID[], feeds?: IFeedCollection, fromSync = false) {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }

    if (!fromSync) {
      await PLAPI.syncService.addSyncLog("feed", "delete", { ids, feeds });
    }

    if (!ids && !feeds) {
      this._logService.error(
        "Failed to delete feeds",
        "No feed ids or feeds provided.",
        false,
        "FeedService"
      );
      return;
    }

    this._logService.info(
      `Deleting ${ids?.length || feeds?.length} feeds...`,
      "",
      false,
      "FeedService"
    );

    const realm = await this._databaseCore.realm();

    if (!feeds && ids) {
      feeds = this._feedRepository.loadByIds(realm, ids);
    } else {
      feeds = feeds!;
    }

    const filter = new FeedEntityFilterOptions({
      feedIds: feeds!.map((feed: IFeedObject) => feed._id),
    });
    const toBeDeletedEntities = this._feedEntityRepository.load(
      realm,
      filter.toString(),
      filter.placeholders,
      "addTime",
      "asce"
    );
    this._feedEntityRepository.delete(realm, undefined, toBeDeletedEntities);

    this._feedRepository.delete(realm, undefined, feeds);
  }

  /**
   * Add feed entities to library.
   * @param feedEntities - Feed entities
   */
  @errorcatching("Failed to add feed entities to library.", true, "FeedService")
  async addToLib(feedEntities: IFeedEntityCollection) {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }

    this._logService.info(
      `Adding ${feedEntities.length} feed entities to library...`,
      "",
      true,
      "Feed"
    );

    const paperEntityDrafts = await Promise.all(
      feedEntities.map(async (feedEntityDraft: IFeedEntityObject) => {
        if (feedEntityDraft.feed?.name === RECOMMENDED_ARXIV_FEED_NAME) {
          return await this._recommendedArxivToPaperEntity(feedEntityDraft);
        }

        const paperEntityDraft = new PaperEntity({}, true).fromFeed(
          feedEntityDraft
        );
        // NOTE: we don't want to download the PDFs when adding regular feed entities to library.
        paperEntityDraft.mainURL = "";
        return paperEntityDraft;
      })
    );

    // NOTE: here we decide to not download the PDFs when adding to library.
    await this._paperService.update(paperEntityDrafts as any, false, false);
    this._markRecommendedArxivDownloaded(feedEntities);
  }

  private async _recommendedArxivToPaperEntity(feedEntity: IFeedEntityObject) {
    const paper = new Entity(
      {
        title: feedEntity.title,
        authors: feedEntity.authors,
        year: `${feedEntity.pubTime || ""}`.slice(0, 4),
        journal: feedEntity.publication || "arXiv",
        arxiv: feedEntity.arxiv,
        abstract: `${feedEntity.abstract || ""}`.replace(
          /^PaperMind recommendation:.*?\n\n/s,
          ""
        ),
        tags: [],
        folders: [],
        supplementaries: {},
      },
      true
    );

    const pdfURL = this._arxivPDFURL(feedEntity);
    if (!pdfURL) {
      return paper;
    }

    try {
      const downloaded = await PLExtAPI.networkTool.downloadPDFs([pdfURL]);
      const filePath = downloaded[0];
      if (!filePath) {
        throw new Error(`No file was downloaded from ${pdfURL}.`);
      }
      const sup = new Supplementary({
        name: "PDF",
        url: `file://${filePath.replace(/\\/g, "/")}`,
      });
      paper.defaultSup = sup._id;
      paper.supplementaries[sup._id] = sup;
    } catch (error) {
      this._logService.warn(
        "Failed to download recommended arXiv PDF.",
        `${(error as Error).message}`,
        true,
        "FeedService"
      );
    }

    return paper;
  }

  private _markRecommendedArxivDownloaded(feedEntities: IFeedEntityCollection) {
    const recommendedKeys = new Set(
      Array.from(feedEntities)
        .filter((feedEntity) => feedEntity.feed?.name === RECOMMENDED_ARXIV_FEED_NAME)
        .map((feedEntity) => this._recommendedArxivKey(feedEntity))
        .filter(Boolean)
    );
    if (recommendedKeys.size === 0) {
      return;
    }

    for (const cache of this._arxivRecommendationCaches.values()) {
      for (const entity of cache.entities) {
        if (recommendedKeys.has(this._recommendedArxivKey(entity))) {
          (entity as any).downloaded = true;
          entity.read = true;
        }
      }
    }

    this.fire({
      arxivRecommendationsUpdated: Date.now(),
    });
  }

  private _recommendedArxivKey(feedEntity: IFeedEntityObject) {
    return (
      `${feedEntity.arxiv || ""}`.toLowerCase().trim() ||
      this._normalizeTitle(feedEntity.title)
    );
  }

  private async _deletePersistedRecommendedArxivFeed() {
    const realm = await this._databaseCore.realm();
    const feeds = realm
      .objects<Feed>("Feed")
      .filtered("name == $0", RECOMMENDED_ARXIV_FEED_NAME);
    if (feeds.length === 0) {
      return;
    }

    realm.safeWrite(() => {
      const feedEntities = realm
        .objects<FeedEntity>("FeedEntity")
        .filtered("feed.name == $0", RECOMMENDED_ARXIV_FEED_NAME);
      realm.delete(feedEntities);
      realm.delete(feeds);
    });

    this.fire({
      updated: Date.now(),
      entitiesUpdated: Date.now(),
    });
  }

  private _arxivPDFURL(feedEntity: IFeedEntityObject) {
    const arxiv = `${feedEntity.arxiv || ""}`
      .replace(/^arxiv:/i, "")
      .replace(/v\d+$/i, "")
      .trim();
    if (arxiv) {
      return `https://arxiv.org/pdf/${arxiv}.pdf`;
    }

    const mainURL = `${feedEntity.mainURL || ""}`.trim();
    if (!mainURL) {
      return "";
    }
    if (mainURL.includes("/pdf/")) {
      return mainURL.endsWith(".pdf") ? mainURL : `${mainURL}.pdf`;
    }
    if (mainURL.includes("/abs/")) {
      return mainURL.replace("/abs/", "/pdf/") + ".pdf";
    }
    return "";
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to refresh feeds (routine).", true, "FeedService")
  private async _routineRefresh() {
    if (this._databaseCore.getState("dbInitializing")) {
      return;
    }
    const feeds = (await this.load("name", "desc")) as Feed[];
    await this.refresh(undefined, feeds);
    this._feedEntityRepository.deleteOutdate(await this._databaseCore.realm());
  }

  private _buildArxivSearchQuery(query: string) {
    const phrases = this._recommendationPhrases(query);
    if (phrases.length > 0) {
      return phrases
        .map((phrase) => {
          const terms = this._keywordTerms(phrase).slice(0, 8);
          return terms.length > 1
            ? `(${terms.map((term) => `all:${term}`).join(" AND ")})`
            : terms.map((term) => `all:${term}`).join(" AND ");
        })
        .filter(Boolean)
        .join(" OR ");
    }

    return this._defaultArxivCategoryQuery();
  }

  private async _fetchArxivRecommendationDrafts(feed: Feed, query: string) {
    const queries = this._buildArxivSearchQueries(query);
    const draftsByKey = new Map<string, FeedEntity>();

    for (const [queryIndex, arxivQuery] of queries.entries()) {
      if (queryIndex > 0) {
        await this._sleep(ARXIV_RECOMMENDATION_REQUEST_GAP);
      }
      const queryFeed = new Feed(
        {
          ...feed,
          url: `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(
            arxivQuery
          )}&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${ARXIV_RECOMMENDATION_FETCH_LIMIT}`,
        },
        true
      );
      let drafts: FeedEntity[] = [];
      try {
        drafts = await this._rssRepository.fetch(
          queryFeed,
          ARXIV_RECOMMENDATION_TIMEOUT
        );
      } catch (error) {
        const message = `${(error as Error).message}`;
        this._logService.warn(
          "Failed to fetch one arXiv recommendation query.",
          `${message}: ${arxivQuery}`,
          true,
          "FeedService"
        );
        if (message.includes("429")) {
          break;
        }
        continue;
      }
      for (const draft of drafts) {
        draft.feed = feed;
        const key =
          `${draft.arxiv || ""}`.toLowerCase().trim() ||
          this._normalizeTitle(draft.title);
        if (key && !draftsByKey.has(key)) {
          draftsByKey.set(key, draft);
        }
      }
    }

    return [...draftsByKey.values()];
  }

  private _buildArxivSearchQueries(query: string) {
    const strictQuery = this._buildArxivSearchQuery(query);
    const phrases = this._recommendationPhrases(query);
    const terms = Array.from(
      new Set(phrases.flatMap((phrase) => this._keywordTerms(phrase)))
    ).slice(0, 10);
    const queries = [this._defaultArxivCategoryQuery(), strictQuery];

    if (terms.length > 1) {
      queries.push(terms.map((term) => `all:${term}`).join(" OR "));
    }

    const aliases = this._arxivQueryAliases(query);
    if (aliases.length > 0) {
      queries.push(
        aliases
          .map((alias) => {
            const aliasTerms = this._keywordTerms(alias).slice(0, 8);
            return aliasTerms.length > 1
              ? `(${aliasTerms.map((term) => `all:${term}`).join(" AND ")})`
              : aliasTerms.map((term) => `all:${term}`).join(" AND ");
          })
          .filter(Boolean)
          .join(" OR ")
      );
    }

    return Array.from(new Set(queries.filter(Boolean))).slice(0, 4);
  }

  private _defaultArxivCategoryQuery() {
    return [
      "cat:cs.AI",
      "cat:cs.CL",
      "cat:cs.CV",
      "cat:cs.LG",
      "cat:cs.RO",
      "cat:stat.ML",
    ].join(" OR ");
  }

  private _arxivQueryAliases(query: string) {
    const normalized = this._normalizeText(query);
    const aliases: string[] = [];
    if (normalized.includes("video") && normalized.includes("understanding")) {
      aliases.push(
        "video large language model",
        "videollm",
        "long form video",
        "video language model",
        "video question answering"
      );
    }
    if (normalized.includes("multimodal") || normalized.includes("multi modal")) {
      aliases.push("vision language model", "large multimodal model");
    }
    return aliases;
  }

  private _sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private _recommendationCacheKey(query: string) {
    return `${query || ""}`.trim().toLowerCase() || "__default__";
  }

  private _formatRecommendationScore(score: number, query: string) {
    if (!query) {
      return "";
    }

    return `${Math.max(1, Math.min(99, Math.round(score)))}%`;
  }

  private async _recommendationQuery(query = "") {
    const explicitQuery = `${query || ""}`.trim();
    if (explicitQuery) {
      return explicitQuery;
    }

    const keywords = await this._recommendationKeywords();
    return keywords.join("; ");
  }

  private async _recommendationKeywords() {
    const raw = await PLMainAPI.preferenceService.get(
      "arxivRecommendationKeywords"
    );
    if (!Array.isArray(raw)) {
      return [];
    }

    return Array.from(
      new Set(
        raw
          .map((item) => `${item || ""}`.trim())
          .filter(Boolean)
      )
    ).slice(0, 20);
  }

  private _recommendationPhrases(query: string) {
    return `${query || ""}`
      .split(/[;\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  private async _semanticScoreArxivCandidates(
    topicQuery: string,
    libraryProfileText: string,
    candidates: FeedEntity[]
  ) {
    const queries: Record<string, string> = {};
    if (topicQuery) {
      queries.topic = topicQuery;
    }
    if (libraryProfileText) {
      queries.library = libraryProfileText;
    }

    const ranked = await this._semanticSearchService.rankTextsByQueries(
      queries,
      candidates.map((candidate, index) => ({
        id: `${index}`,
        text: this._arxivCandidateText(candidate),
      }))
    );

    return new Map(ranked.map((item) => [item.id, item.scores]));
  }

  private _scoreQueriedArxivCandidate(
    candidate: FeedEntity,
    query: string,
    semanticScores?: Record<string, number>
  ) {
    const lexicalScore = this._scoreQueryKeywords(candidate, query);
    const normalizedLexicalScore = Math.min(1, lexicalScore.score / 24);
    const topicScore = this._normalizeSemanticScore(semanticScores?.topic);
    const libraryScore = this._normalizeSemanticScore(semanticScores?.library);

    if (topicScore !== null || libraryScore !== null) {
      const semanticTopic = topicScore ?? 0;
      const semanticLibrary = libraryScore ?? 0;
      const score =
        (0.55 * semanticTopic +
          0.35 * semanticLibrary +
          0.1 * normalizedLexicalScore) *
        100;
      return {
        score,
        reason: [
          `topic ${(semanticTopic * 100).toFixed(0)}%`,
          libraryScore !== null
            ? `library profile ${(semanticLibrary * 100).toFixed(0)}%`
            : "",
          lexicalScore.reason,
        ]
          .filter(Boolean)
          .join("; "),
      };
    }

    return lexicalScore;
  }

  private _normalizeSemanticScore(score?: number) {
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return null;
    }

    return Math.max(0, Math.min(1, (score + 1) / 2));
  }

  private _scoreQueryKeywords(candidate: FeedEntity, query: string) {
    const terms = this._keywordTerms(query);
    const title = ` ${this._normalizeText(candidate.title)} `;
    const abstract = ` ${this._normalizeText(candidate.abstract)} `;
    let score = 0;
    const matched: string[] = [];

    for (const term of terms) {
      const needle = ` ${term} `;
      let termScore = 0;
      if (title.includes(needle)) {
        termScore += 6;
      }
      if (abstract.includes(needle)) {
        termScore += 2;
      }
      if (termScore > 0) {
        score += termScore;
        matched.push(term);
      }
    }

    const topMatches = matched.slice(0, 6);
    return {
      score,
      reason:
        topMatches.length > 0
          ? `keyword matches: ${topMatches.join(", ")}.`
          : "",
    };
  }

  private _arxivCandidateText(candidate: FeedEntity) {
    return [
      candidate.title,
      candidate.authors,
      candidate.publication,
      candidate.abstract,
    ]
      .filter(Boolean)
      .join("\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  }

  private _buildRecommendationProfile(papers: Entity[]) {
    const weights = new Map<string, number>();
    const addTerms = (text: string, weight: number) => {
      for (const term of this._keywordTerms(text)) {
        weights.set(term, (weights.get(term) || 0) + weight);
      }
    };

    for (const paper of papers.slice(0, 500)) {
      const importance = 1 + (paper.flag ? 1 : 0) + (paper.rating || 0) / 5;
      addTerms(paper.title || "", 4 * importance);
      addTerms(paper.abstract || "", 1 * importance);
      addTerms(paper.note || "", 2 * importance);
      addTerms(
        [...(paper.tags || []), ...(paper.folders || [])]
          .map((item) => item.name)
          .filter(Boolean)
          .join(" "),
        5 * importance
      );
    }

    return [...weights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 120);
  }

  private _buildLibraryProfileText(papers: Entity[]) {
    return papers
      .slice(0, 80)
      .map((paper, index) => {
        const recencyWeight = Math.max(0.2, 1 - index / 100);
        const importance =
          recencyWeight * (1 + (paper.flag ? 0.6 : 0) + (paper.rating || 0) / 10);
        const categories = [...(paper.tags || []), ...(paper.folders || [])]
          .map((item) => item.name)
          .filter(Boolean)
          .join(", ");
        return [
          `weight ${importance.toFixed(2)}`,
          paper.title,
          paper.authors,
          categories,
          paper.abstract,
          paper.note,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  }

  private _scoreArxivCandidate(
    candidate: FeedEntity,
    profile: Array<[string, number]>
  ) {
    const title = ` ${this._normalizeText(candidate.title)} `;
    const abstract = ` ${this._normalizeText(candidate.abstract)} `;
    let score = 0;
    const matched: string[] = [];

    for (const [term, weight] of profile) {
      const needle = ` ${term} `;
      let termScore = 0;
      if (title.includes(needle)) {
        termScore += weight * 3;
      }
      if (abstract.includes(needle)) {
        termScore += weight;
      }
      if (termScore > 0) {
        score += termScore;
        matched.push(term);
      }
    }

    const topMatches = matched.slice(0, 6);
    return {
      score,
      reason:
        topMatches.length > 0
          ? `matches your library interests: ${topMatches.join(", ")}.`
          : "",
    };
  }

  private _keywordTerms(text: string) {
    const stopwords = new Set([
      "about",
      "after",
      "also",
      "analysis",
      "based",
      "between",
      "data",
      "deep",
      "during",
      "from",
      "into",
      "large",
      "learning",
      "method",
      "model",
      "models",
      "network",
      "paper",
      "performance",
      "propose",
      "proposed",
      "results",
      "show",
      "study",
      "task",
      "that",
      "their",
      "these",
      "this",
      "using",
      "with",
    ]);

    return this._normalizeText(text)
      .split(" ")
      .map((term) => term.trim())
      .filter(
        (term) =>
          term.length >= 4 &&
          !stopwords.has(term) &&
          !/^\d+$/.test(term)
      );
  }

  private _normalizeText(text: string) {
    return `${text || ""}`
      .toLowerCase()
      .replace(/<[^>]*>/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private _normalizeTitle(title: string) {
    return this._normalizeText(title).replace(/\s+/g, " ");
  }

  /**
   * Migrate the local database to the cloud database. */
  @errorcatching(
    "Failed to migrate the local feeds to the cloud database.",
    true,
    "DatabaseService"
  )
  async migrateLocaltoCloud() {
    const localConfig = await this._databaseCore.getLocalConfig(false);
    const localRealm = new Realm(localConfig);

    const feeds = localRealm.objects<Feed>("Feed");
    await this.update(feeds.map((feed) => new Feed(feed)));

    const feedEntities = localRealm.objects<FeedEntity>("FeedEntity");
    await this.updateEntities(
      feedEntities.map((feedEntity) => new FeedEntity(feedEntity))
    );

    this._logService.info(
      `Migrated ${feeds.length} feed(s) to cloud database.`,
      "",
      true,
      "FeedService"
    );
  }
}
