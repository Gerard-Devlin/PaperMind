import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { uid } from "@/base/misc";
import { Process } from "@/base/process-id";
import { ILogService, LogService } from "@/common/services/log-service";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { HookService, IHookService } from "./hook-service";
import { IEntityCollection, Entity } from "@/models/entity";
import { PaperEntity } from "@/models/paper-entity";
import { Supplementary } from "@/models/supplementary";

export const IScrapeService = createDecorator("scrapeService");

/**
 * ScrapeService transforms a data source, such as a local file, web page, etc., into a PaperEntity with fullfilled metadata.
 *
 * Scrapers can be categorized into two types:
 *   1. Entry scraper: transforms a data source into a PaperEntity
 *   2. Metadata scraper: fullfill the metadata of a PaperEntity into
 *
 * Scraping pipeline:
 * | ----------------
 * | 1. Entry scraper transforms a data source, such as the following object, into a PaperEntity.
 * |     payload { // processed by different entry scrapers
 * |     . url: string  // an example payload consists of a url
 * |     }
 * |     NOTE: Entry scrapers also support type of "PaperEntity", which is a bypass for extensions
 * |           to parse a data source in themselve and get the metadata from here.
 * | ----------------
 * | 2. Metadata scraper fullfills the metadata of a PaperEntity.
 * | ----------------
 */
export class ScrapeService extends Eventable<{}> {
  constructor(
    @IHookService private readonly _hookService: HookService,
    @ILogService private readonly _logService: LogService
  ) {
    super("scrapeService", {});
  }

  private async _scrapeExtensionReady() {
    const extensionAPIExposed = await PLAPILocal.serviceRPCService.waitForAPI(
      Process.extension,
      "PLExtAPI",
      5000
    );

    if (!extensionAPIExposed) {
      this._logService.warn(
        "Official scrape extension is not installed yet.",
        "",
        true,
        "ScrapeService"
      );
      return false;
    } else {
      try {
        await PLExtAPI.extensionManagementService.ensureOfficialScrapeExtensionsInstalled();
      } catch (error) {
        this._logService.warn(
          "Failed to prepare bundled scrape extensions.",
          `${(error as Error).message}`,
          true,
          "ScrapeService"
        );
      }

      let status: "uninstalled" | "unloaded" | "loaded" = "uninstalled";
      for (let i = 0; i < 30; i++) {
        status =
          await PLExtAPI.extensionManagementService.isOfficialScrapeExtensionInstalled();

        if (status === "loaded") {
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      this._logService.warn(
        "Official scrape extension is not ready yet.",
        `Current status: ${status}`,
        true,
        "ScrapeService"
      );
      return false;
    }
  }

  /**
   * Scrape a data source's metadata.
   * @param payloads - data source payloads.
   * @param specificScrapers - list of metadata scrapers.
   * @param force - force scraping metadata.
   * @returns List of paper entities. */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to scrape data source.", true, "ScrapeService", [])
  async scrape(
    payloads: any[],
    specificScrapers: string[],
    force: boolean = false
  ): Promise<Entity[]> {
    // 0. Wait for scraper extension to be ready.
    if (!(await this._scrapeExtensionReady())) {
      return [];
    }

    // Do in chunks 10
    const jobID = Math.random().toString(36).substring(7);
    const results: Entity[] = [];
    for (let i = 0; i < payloads.length; i += 10) {
      if (payloads.length >= 20) {
        this._logService.progress(
          `Processing ${i} / ${payloads.length}...`,
          (i / payloads.length) * 100,
          true,
          "ScrapeService",
          jobID
        );
      }
      try {
        let payloadChunk = payloads.slice(i, i + 10);

        // 1. Entry scraper transforms data source payloads into a PaperEntity list.
        const paperEntityDrafts = await this.scrapeEntry(payloadChunk);

        if (paperEntityDrafts.length === 0) {
          this._logService.warn(
            "The data source yields no PaperEntity.",
            "",
            true,
            "ScrapeService"
          );
          return [];
        }

        // ENHANCE: merge duplicated paperEntityDrafts?

        // 2. Metadata scraper fullfills the metadata of PaperEntitys.
        const scrapedPaperEntityDrafts = await this.scrapeMetadata(
          paperEntityDrafts,
          specificScrapers,
          force
        );

        results.push(...scrapedPaperEntityDrafts);
      } catch (e) {
        this._logService.error(
          "Failed to scrape data source.",
          `${(e as Error).message} ${(e as Error).stack}`,
          true,
          "ScrapeService"
        );
      }
    }

    if (payloads.length >= 20) {
      this._logService.progress(`Done!`, 100, true, "ScrapeService", jobID);
    }

    return results;
  }

  /**
   * Scrape all entry scrapers to transform data source payloads into a PaperEntity list.
   * @param payloads - data source payloads.
   * @returns List of paper entities. */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to scrape entry.", true, "ScrapeService", [])
  async scrapeEntry(payloads: any[]) {
    // TODO: test performance of this._hookService.hookPoint
    if (this._hookService.hasHook("beforeScrapeEntry")) {
      [payloads] = await this._hookService.modifyHookPoint(
        "beforeScrapeEntry",
        5000,
        payloads
      );
    }

    let paperEntityDrafts: Entity[] = [];
    if (this._hookService.hasHook("scrapeEntry")) {
      paperEntityDrafts = (
        await this._hookService.transformhookPoint<any[], Object[]>(
          "scrapeEntry",
          600000, // 10 min
          payloads
        )
      ).map((p) => this._toCurrentEntity(p));
    }

    if (this._hookService.hasHook("afterScrapeEntry")) {
      [paperEntityDrafts] = await this._hookService.modifyHookPoint(
        "afterScrapeEntry",
        5000,
        paperEntityDrafts
      );
      paperEntityDrafts = paperEntityDrafts.map((p) =>
        this._toCurrentEntity(p)
      );
    }

    return paperEntityDrafts;
  }

  /**
   * Scrape all metadata scrapers to complete the metadata of PaperEntitys.
   * @param paperEntityDrafts - list of paper entities.
   * @param scrapers - list of metadata scrapers.
   * @param force - force scraping metadata.
   * @returns List of paper entities. */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to scrape metadata.", true, "ScrapeService", [])
  async scrapeMetadata(
    paperEntityDrafts: Entity[],
    scrapers: string[],
    force: boolean = false
  ) {
    if (this._hookService.hasHook("beforeScrapeMetadata")) {
      [paperEntityDrafts, scrapers, force] =
        await this._hookService.modifyHookPoint(
          "beforeScrapeMetadata",
          5000,
          paperEntityDrafts,
          scrapers,
          force
        );
    }

    let scrapedPaperEntityDrafts = paperEntityDrafts;
    if (this._hookService.hasHook("scrapeMetadata")) {
      const legacyPaperEntityDrafts = paperEntityDrafts.map((p) =>
        this._toLegacyPaperEntity(p)
      );
      [scrapedPaperEntityDrafts, scrapers, force] =
        await this._hookService.modifyHookPoint(
          "scrapeMetadata",
          60000,
          legacyPaperEntityDrafts,
          scrapers,
          force
        );
    }

    if (this._hookService.hasHook("afterScrapeMetadata")) {
      [scrapedPaperEntityDrafts, scrapers, force] =
        await this._hookService.modifyHookPoint(
          "afterScrapeMetadata",
          5000,
          scrapedPaperEntityDrafts,
          scrapers,
          force
        );
    }

    return scrapedPaperEntityDrafts.map((p) => this._toCurrentEntity(p));
  }

  /**
   * Scrape a data source's metadata.
   * @param payloads - data source payloads.
   * @returns List of paper entities' candidates. */
  @processing(ProcessingKey.General)
  @errorcatching(
    "Failed to fuzzily scrape data source.",
    true,
    "ScrapeService",
    []
  )
  async fuzzyScrape(
    paperEntities: IEntityCollection
  ): Promise<Record<string, Entity[]>> {
    // 0. Wait for scraper extension to be ready.
    if (!(await this._scrapeExtensionReady())) {
      return {};
    }

    // Do in chunks 10
    const jobID = Math.random().toString(36).substring(7);
    const results: Record<string, Entity[]> = {};
    for (let i = 0; i < paperEntities.length; i += 10) {
      if (paperEntities.length >= 20) {
        this._logService.progress(
          `Processing ${i} / ${paperEntities.length}...`,
          (i / paperEntities.length) * 100,
          true,
          "ScrapeService",
          jobID
        );
      }
      try {
        let paperEntityChunk = paperEntities.slice(i, i + 10);

        const paperEntityDraftCandidates = await this._fuzzyScrape(
          paperEntityChunk
        );

        paperEntityChunk.forEach((p, index) => {
          results[`${p._id}`] = paperEntityDraftCandidates[index];
        });
      } catch (e) {
        this._logService.error(
          "Failed to fuzzily scrape data source.",
          `${(e as Error).message} ${(e as Error).stack}`,
          true,
          "ScrapeService"
        );
      }
    }

    if (paperEntities.length >= 20) {
      this._logService.progress(`Done!`, 100, true, "ScrapeService", jobID);
    }

    return results;
  }

  /**
   * Scrape all entry scrapers to transform data source payloads into a PaperEntity list.
   * @param payloads - data source payloads.
   * @returns List of paper entities. */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to scrape entry.", true, "ScrapeService", [])
  async _fuzzyScrape(
    paperEntities: IEntityCollection
  ): Promise<Entity[][]> {
    if (this._hookService.hasHook("beforeFuzzyScrape")) {
      [paperEntities] = await this._hookService.modifyHookPoint(
        "beforeFuzzyScrape",
        5000,
        paperEntities
      );
    }

    let paperEntityDraftCandidates: Entity[][] = [];
    if (this._hookService.hasHook("fuzzyScrapeMetadata")) {
      paperEntityDraftCandidates = await this._hookService.transformhookPoint<
        any[],
        Object[]
      >(
        "fuzzyScrapeMetadata",
        600000, // 10 min
        paperEntities
      );
      paperEntityDraftCandidates = paperEntityDraftCandidates.map((group) =>
        group.map((p) => this._toCurrentEntity(p))
      );
    }

    if (this._hookService.hasHook("afterScrapeEntry")) {
      [paperEntityDraftCandidates] = await this._hookService.modifyHookPoint(
        "afterScrapeEntry",
        5000,
        paperEntityDraftCandidates
      );

      paperEntityDraftCandidates = paperEntityDraftCandidates.map((group) =>
        group.map((p) => this._toCurrentEntity(p))
      );
    }

    return paperEntityDraftCandidates;
  }

  private _toCurrentEntity(raw: any): Entity {
    if (
      raw &&
      (raw.publication !== undefined ||
        raw.pubTime !== undefined ||
        raw.mainURL !== undefined ||
        raw.supURLs !== undefined)
    ) {
      const type = this._legacyPubTypeToEntityType(raw.pubType);
      const supplementaries: Record<string, Supplementary> = {};
      let defaultSup: string | undefined;
      const urls = [raw.mainURL, ...(raw.supURLs || [])].filter(
        (url, index, array) => url && array.indexOf(url) === index
      );

      for (const url of urls) {
        const supId = uid();
        supplementaries[supId] = new Supplementary({
          _id: supId,
          name: defaultSup ? undefined : "Main",
          url,
        });
        defaultSup = defaultSup || supId;
      }

      return new Entity({
        _id: raw._id || raw.id,
        _partition: raw._partition,
        addTime: raw.addTime,
        library: "main",
        type,
        title: raw.title || "",
        authors: raw.authors || "",
        year: `${raw.pubTime || raw.year || ""}`.slice(0, 4),
        doi: raw.doi || undefined,
        arxiv: raw.arxiv || undefined,
        journal: type === "article" ? raw.publication || undefined : undefined,
        booktitle:
          type === "inproceedings" ? raw.publication || undefined : undefined,
        howpublished:
          !["article", "inproceedings"].includes(type) && raw.publication
            ? raw.publication
            : undefined,
        pages: raw.pages || undefined,
        volume: raw.volume || undefined,
        number: raw.number || undefined,
        publisher: raw.publisher || undefined,
        rating: raw.rating || 0,
        tags: raw.tags || [],
        folders: raw.folders || [],
        flag: raw.flag || false,
        note: raw.note || "",
        supplementaries,
        defaultSup,
      });
    }

    return new Entity(raw);
  }

  private _toLegacyPaperEntity(entity: Entity | any) {
    if (
      entity &&
      (entity.publication !== undefined ||
        entity.pubTime !== undefined ||
        entity.mainURL !== undefined ||
        entity.supURLs !== undefined)
    ) {
      return entity;
    }

    const supplementaries = entity?.supplementaries || {};
    const defaultSup = entity?.defaultSup
      ? supplementaries[entity.defaultSup]
      : undefined;
    const supURLs = Object.entries(supplementaries)
      .filter(([id]) => id !== entity?.defaultSup)
      .map(([, sup]) => (sup as Supplementary).url)
      .filter(Boolean);

    return new PaperEntity({
      _id: entity?._id,
      id: entity?._id,
      _partition: entity?._partition,
      addTime: entity?.addTime,
      title: entity?.title || "",
      authors: entity?.authors || "",
      publication:
        entity?.journal ||
        entity?.booktitle ||
        entity?.publisher ||
        entity?.school ||
        entity?.institution ||
        entity?.howpublished ||
        "",
      pubTime: entity?.year || "",
      pubType: this._entityTypeToLegacyPubType(entity?.type),
      doi: entity?.doi || "",
      arxiv: entity?.arxiv || "",
      mainURL: defaultSup?.url || "",
      supURLs,
      rating: entity?.rating || 0,
      tags: entity?.tags || [],
      folders: entity?.folders || [],
      flag: entity?.flag || false,
      note: entity?.note || "",
      pages: entity?.pages || "",
      volume: entity?.volume || "",
      number: entity?.number || "",
      publisher: entity?.publisher || "",
    });
  }

  private _legacyPubTypeToEntityType(pubType: number | string | undefined) {
    switch (Number(pubType)) {
      case 1:
        return "inproceedings";
      case 2:
        return "misc";
      case 3:
        return "book";
      default:
        return "article";
    }
  }

  private _entityTypeToLegacyPubType(type: string | undefined) {
    switch (type) {
      case "inproceedings":
      case "proceedings":
        return 1;
      case "misc":
      case "booklet":
      case "manual":
      case "techreport":
        return 2;
      case "book":
      case "inbook":
      case "incollection":
        return 3;
      default:
        return 0;
    }
  }
}
