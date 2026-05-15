import { PLAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { chunkRun, metadataUtils } from "paperlib-api/utils";
import Queue from "queue";

import { ArXivScraper } from "@/scrapers/arxiv";
import { Scraper } from "@/scrapers/scraper";

type ScraperProps = { breakable: boolean; mustwait: boolean };
type ScraperMap = Map<string, ScraperProps>;

const PaperlibMetadataServiceScraper = {
  async scrape(paperEntityDraft: PaperEntity, _scrapers: string[] = []) {
    return paperEntityDraft;
  },
};

const PRECISE_SCRAPERS: ScraperMap = new Map([
  ["arxiv", { breakable: false, mustwait: false }],
]); // name: {breakable, mustwait}

const FUZZY_SCRAPERS: ScraperMap = new Map([]);

// Scrapers that should be run after all scrapers
const ADDITIONAL_SCRAPERS: ScraperMap = new Map([
]);

const PAPERLIB_METADATA_SERVICE_SCRAPERS: ScraperMap = new Map([
  ...PRECISE_SCRAPERS,
  ...FUZZY_SCRAPERS,
  ...ADDITIONAL_SCRAPERS,
  ...(new Map<string, ScraperProps>([
  ]))
]);

const CLIENTSIDE_SCRAPERS: ScraperMap = new Map([
  ["ieee", { breakable: true, mustwait: false }],
]);

const SCRAPER_OBJS = new Map<string, typeof Scraper>([
  ["arxiv", ArXivScraper],
]);

// ------------------------------- (PaperlibMetadataService first)
// | PaperlibMetadataServiceScraper  (default)
// -------------------------------
//    v
//    v
// ------------------------------- (Local Scrapers, if PaperlibMetadataService failed)
// |
// | PreciseScrapers (by some ids, e.g. DOI, arXiv, ChemRxiv)
// |  v
// | FuzzyScrapers and ClientsideScrapers (by title, e.g. DBLP, Semantic Scholar)
// |  v
// | AdditionalScrapers (e.g., paper with code)
// |
// -------------------------------
//    v
//    v
// ------------------------------- (Clientside Scrapers, if PaperlibMetadataService cannot find the paper)
// | ClientsideScrapers (by title, e.g. Google Scholar, IEEE)
// |  v
// | AdditionalScrapers (e.g., paper with code)
// -------------------------------

/**
 * EntryScrapeService transforms a data source, such as a local file, web page, etc., into a PaperEntity.*/
export class MetadataScrapeService {
  constructor() {}

  async scrape(
    paperEntityDrafts: PaperEntity[],
    scrapers: string[],
    force: boolean = false,
  ): Promise<PaperEntity[]> {
    let completedPaperEntityDrafts: PaperEntity[] = [];
    let incompletePaperEntityDrafts: PaperEntity[] = [];

    if (!force) {
      for (const paperEntityDraft of paperEntityDrafts) {
        if (!metadataUtils.isMetadataCompleted(paperEntityDraft)) {
          incompletePaperEntityDrafts.push(paperEntityDraft);
        } else {
          completedPaperEntityDrafts.push(paperEntityDraft);
        }
      }
    } else {
      incompletePaperEntityDrafts = paperEntityDrafts;
    }

    const randomId = Math.random().toString(36).substring(7);
    let completedNum = 0;
    const totalNum = incompletePaperEntityDrafts.length;
    PLAPI.logService.progress(
      `Metadata Scraping ${completedNum}/${totalNum}...`,
      (completedNum / totalNum) * 100,
      true,
      "MetadataScrapeExt",
      randomId,
    );

    const {
      results: _scrapedPaperEntityDrafts,
      errors: metadataScraperErrors,
    } = await chunkRun<PaperEntity, PaperEntity, PaperEntity>(
      incompletePaperEntityDrafts,
      async (paperEntityDraft): Promise<PaperEntity> => {
        const paperEntityDraftAndErrors = await this.scrapePMS(
          paperEntityDraft,
          scrapers,
          force,
        );
        paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;

        if (paperEntityDraftAndErrors.errors.length > 0) {
          PLAPI.logService.error(
            "Paperlib metadata service error.",
            paperEntityDraftAndErrors.errors[0] as Error,
            true,
            "MetadataScrapeExt",
          );
        }

        if (!metadataUtils.isMetadataCompleted(paperEntityDraft)) {
          // 2.2 Run some force-clientside scrapers
          const paperEntityDraftAndErrors = await this.scrapeClientside(
            paperEntityDraft,
            scrapers,
            force,
          );
          paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;

          if (paperEntityDraftAndErrors.errors.length > 0) {
            for (const error of paperEntityDraftAndErrors.errors) {
              PLAPI.logService.error(
                "Clientside metadata service failed.",
                `${error.message} \n ${error.stack}`,
                true,
                "MetadataScrapeExt",
              );
            }
          }
        }

        completedNum += 1;
        PLAPI.logService.progress(
          `Metadata Scraping ${completedNum}/${totalNum}...`,
          (completedNum / totalNum) * 100,
          true,
          "MetadataScrapeExt",
          randomId,
        );

        return paperEntityDraft;
      },
      async (paperEntityDraft): Promise<PaperEntity> => {
        completedNum += 1;
        PLAPI.logService.progress(
          `Metadata Scraping ${completedNum}/${totalNum}...`,
          (completedNum / totalNum) * 100,
          true,
          "MetadataScrapeExt",
          randomId,
        );

        return paperEntityDraft;
      },
    );

    PLAPI.logService.progress(
      "Metadata Scraping",
      100,
      true,
      "MetadataScrapeExt",
      randomId,
    );

    for (const error of metadataScraperErrors) {
      PLAPI.logService.error(
        "Failed to scrape metadata.",
        `${error.message} \n ${error.stack}`,
        true,
        "MetadataScrapeExt",
      );
    }
    let scrapedPaperEntityDrafts = _scrapedPaperEntityDrafts.flat();

    return [...completedPaperEntityDrafts, ...scrapedPaperEntityDrafts];
  }

  /**
   * Scrape from the default Paperlib Metadata Service(PMS)
   * @param paperEntityDraft - paper entity to be scraped
   * @param scrapers - list of scraper names to be used
   * @param force - whether to force scraping
   * @returns scraped paper entity with fullfilled metadata, and errors
   */
  async scrapePMS(
    paperEntityDraft: PaperEntity,
    scrapers: string[] = [],
    force: boolean = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabeledPMSScraperList = scrapers.filter((name) =>
      Array.from(PAPERLIB_METADATA_SERVICE_SCRAPERS.keys()).includes(name),
    );
    const errors: Error[] = [];
    try {
      paperEntityDraft = await PaperlibMetadataServiceScraper.scrape(
        paperEntityDraft,
        ["cache"].concat(enabeledPMSScraperList),
      );

      if (paperEntityDraft.publication === "" && (paperEntityDraft.arxiv || paperEntityDraft.doi)) {
        const paperEntityDraftAndErrors = await this.scrapePMSLocalBackup(
          paperEntityDraft,
          scrapers,
          force,
        );
  
        paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;
  
        errors.push(...paperEntityDraftAndErrors.errors);
      }


    } catch (e) {
      errors.push(e as Error);

      const paperEntityDraftAndErrors = await this.scrapePMSLocalBackup(
        paperEntityDraft,
        scrapers,
        force,
      );

      paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;

      errors.push(...paperEntityDraftAndErrors.errors);
    }
    return { paperEntityDraft, errors };
  }

  /**
   * Scrape from local scrapers as backup if Paperlib Metadata Service(PMS) failed.
   * @param paperEntityDraft - paper entity to be scraped
   * @param scrapers - list of scraper names to be used
   * @param force - whether to force scraping
   * @returns scraped paper entity with fullfilled metadata, and errors
   */
  async scrapePMSLocalBackup(
    paperEntityDraft: PaperEntity,
    scrapers: string[] = [],
    force: boolean = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const errors: Error[] = [];
    const draftAndErrorsPrecise = await this._scrapePrecise(
      paperEntityDraft,
      scrapers,
      force,
    );
    paperEntityDraft = draftAndErrorsPrecise.paperEntityDraft;
    errors.push(...draftAndErrorsPrecise.errors);

    if (!metadataUtils.isMetadataCompleted(paperEntityDraft)) {
      const draftAndErrorsFuzzy = await this._scrapeFuzzy(
        paperEntityDraft,
        scrapers,
        force,
      );
      paperEntityDraft = draftAndErrorsFuzzy.paperEntityDraft;
      errors.push(...draftAndErrorsFuzzy.errors);
    }
    const draftAndErrorsAdditional = await this._scrapeAdditional(
      paperEntityDraft,
      scrapers,
      force,
    );
    paperEntityDraft = draftAndErrorsAdditional.paperEntityDraft;
    errors.push(...draftAndErrorsAdditional.errors);

    return { paperEntityDraft, errors };
  }

  /**
   * Scrape from some force-clientside scrapers, such as Google Scholars, if PMS and local backups cannot scrape the metadata.
   * @param paperEntityDraft - paper entity to be scraped
   * @param scrapers - list of scraper names to be used
   * @param force - whether to force scraping
   * @returns scraped paper entity with fullfilled metadata, and errors
   */
  async scrapeClientside(
    paperEntityDraft: PaperEntity,
    scrapers: string[] = [],
    force = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    if (metadataUtils.isMetadataCompleted(paperEntityDraft)) {
      return {
        paperEntityDraft,
        errors: [],
      };
    }
    const paperEntityDraftAndErrors = await this._scrapeClientside(
      paperEntityDraft,
      scrapers,
      force,
    );

    return {
      paperEntityDraft: paperEntityDraftAndErrors.paperEntityDraft,
      errors: [...paperEntityDraftAndErrors.errors],
    };
  }

  async _scrapePrecise(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
    force: boolean = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(PRECISE_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );

    return await this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      PRECISE_SCRAPERS,
      0,
      0,
      force,
    );
  }

  async _scrapeFuzzy(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
    force = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(FUZZY_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );

    return await this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      FUZZY_SCRAPERS,
      500,
      200,
      force,
    );
  }

  async _scrapeAdditional(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
    force = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(ADDITIONAL_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );
    return this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      ADDITIONAL_SCRAPERS,
      0,
      400,
      force,
    );
  }

  async _scrapeClientside(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
    force = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(CLIENTSIDE_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );

    return this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      CLIENTSIDE_SCRAPERS,
      0,
      300,
      force,
    );
  }

  async _scrapePipeline(
    paperEntityDraft: PaperEntity,
    enabledScrapers: string[],
    scraperProps: Map<string, { breakable: boolean; mustwait: boolean }>,
    gapTime = 0,
    priority_offset = 0,
    force = false,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const errors: Error[] = [];
    return new Promise(async function (resolve, reject) {
      const q = Queue();
      q.timeout = 20000;

      let mergePriorityLevel = {
        title: 999,
        minifiedTitle: 999,
        authors: 999,
        publication: 999,
        pubTime: 999,
        pubType: 999,
        doi: 999,
        arxiv: 999,
        pages: 999,
        volume: 999,
        number: 999,
        publisher: 999,
        codes: 999,
      } as { [key: string]: number };
      const originPaperEntityDraft = new PaperEntity(paperEntityDraft);

      let mustwaitN = enabledScrapers.filter(
        (scraper) => scraperProps.get(scraper)?.mustwait,
      ).length;

      for (const scraper of enabledScrapers) {
        q.push(function () {
          return new Promise(async function (resolve, reject) {
            const scraperObj = SCRAPER_OBJS.get(scraper) as typeof Scraper;
            const scraperIndex = enabledScrapers.indexOf(scraper);

            await new Promise((resolve) =>
              setTimeout(resolve, gapTime * scraperIndex),
            );

            let scrapedPaperEntity: PaperEntity;
            try {
              const toBeScrapedPaperEntity = new PaperEntity(paperEntityDraft);
              scrapedPaperEntity = await scraperObj.scrape(
                toBeScrapedPaperEntity,
                force,
              );
            } catch (error) {
              errors.push(error as Error);
              scrapedPaperEntity = paperEntityDraft;
            }
            resolve({
              scrapedPaperEntity,
              scraper,
              scraperIndex,
            });
          });
        });
      }

      q.on(
        "success",
        function (
          result: {
            scrapedPaperEntity: PaperEntity;
            scraper: string;
            scraperIndex: number;
          },
          job,
        ) {
          const scrapedPaperEntity = result.scrapedPaperEntity;
          const { breakable, mustwait } = scraperProps.get(result.scraper)!;
          const scraperIndex = result.scraperIndex;
          const merged = metadataUtils.mergeMetadata(
            originPaperEntityDraft,
            paperEntityDraft,
            scrapedPaperEntity,
            mergePriorityLevel,
            scraperIndex + priority_offset,
          );
          paperEntityDraft = merged.paperEntityDraft;
          mergePriorityLevel = merged.mergePriorityLevel;

          if (mustwait) {
            mustwaitN -= 1;
          }

          if (
            breakable &&
            metadataUtils.isMetadataCompleted(paperEntityDraft) &&
            mustwaitN === 0
          ) {
            q.end();
          }
        },
      );

      q.on("end", function (err) {
        if (err) {
          errors.push(err);
        }
        resolve({
          paperEntityDraft,
          errors,
        });
      });

      q.on("timeout", function (next, job) {
        next();
      });

      q.start(function (err) {
        if (err) {
          errors.push(err);
        }
        resolve({
          paperEntityDraft,
          errors,
        });
      });
    });
  }
}
