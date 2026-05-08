import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { metadataUtils, stringUtils } from "paperlib-api/utils";
import stringSimilarity from "string-similarity";

export interface ScraperRequestType {
  scrapeURL: string;
  headers: Record<string, string>;
  content?: Record<string, any>;
  sim_threshold: number;
}

export class Scraper {
  // Check if the  paperEntityDraft contains enough information to scrape. (NOT enable or not by user preference)
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !metadataUtils.isMetadataCompleted(paperEntityDraft);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    return { scrapeURL: "", headers: {}, sim_threshold: 0.95 };
  }

  static parsingProcess(
    rawResponse: string,
  ): PaperEntity[] {
    return [];
  }

  static _mergingProcess(
    paperEntityDraft: PaperEntity,
    candidatePaperEntityDraft: PaperEntity,
  ): PaperEntity {
    for (const key in candidatePaperEntityDraft) {
      if (key === "publication" && ["arXiv", "CoRR"].includes(candidatePaperEntityDraft[key]) && paperEntityDraft[key] !== "") {
        continue
      }

      if (candidatePaperEntityDraft[key]) {
        paperEntityDraft[key] = candidatePaperEntityDraft[key];
      }
    }
    return paperEntityDraft;
  }

  static _matchingString(
    title: string,
    authors: string,
    includeAuthors: boolean,
  ) {
    const plainTitle = stringUtils.formatString({
      str: title,
      removeWhite: true,
      removeSymbol: true,
      removeNewline: true,
      lowercased: true,
    });

    if (!includeAuthors) {
      return plainTitle;
    }

    const plainAuthors = stringUtils.formatString({
      str: authors,
      removeWhite: true,
      removeSymbol: true,
      lowercased: true,
    }).slice(0, 10);
    return `${plainTitle}${plainAuthors}`;
  }

  static matchingProcess(
    paperEntityDraft: PaperEntity,
    candidatePaperEntityDrafts: PaperEntity[],
    sim_threshold: number,
  ): PaperEntity {
    if (candidatePaperEntityDrafts.length === 0) {
      return paperEntityDraft;
    }

    if (sim_threshold === -1) {
      // Return the first candidate metadata draft
      return this._mergingProcess(paperEntityDraft, candidatePaperEntityDrafts[0]);
    }

    const matchIncludeAuthors = paperEntityDraft.authors !== "";
    const matchTerm = this._matchingString(
      paperEntityDraft.title,
      paperEntityDraft.authors,
      matchIncludeAuthors,
    );

    if (sim_threshold === 1) {
      // Exact match
      for (const candidatePaperEntityDraft of candidatePaperEntityDrafts) {
        const candidateMatchTerm = this._matchingString(
          candidatePaperEntityDraft.title,
          candidatePaperEntityDraft.authors,
          matchIncludeAuthors,
        );
        if (matchTerm === candidateMatchTerm) {
          return this._mergingProcess(paperEntityDraft, candidatePaperEntityDraft);
        }
      }
    } else {
      for (const candidatePaperEntityDraft of candidatePaperEntityDrafts) {
        // NOTE: If same authors and same year, tolerate more differences with 0.8 factor
        if (
          paperEntityDraft.authors === candidatePaperEntityDraft.authors &&
          paperEntityDraft.pubTime === candidatePaperEntityDraft.pubTime
        ) {
          sim_threshold = 0.8 * sim_threshold;
        }

        const candidateMatchTerm = this._matchingString(
          candidatePaperEntityDraft.title,
          candidatePaperEntityDraft.authors,
          matchIncludeAuthors,
        );
        const sim = stringSimilarity.compareTwoStrings(matchTerm, candidateMatchTerm);

        if (sim > sim_threshold) {
          return this._mergingProcess(paperEntityDraft, candidatePaperEntityDraft);
        }
      }
    }

    return paperEntityDraft;
  }

  static async scrape(paperEntityDraft: PaperEntity, force = false): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers, sim_threshold } = this.preProcess(paperEntityDraft);

    const response = await PLExtAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      10000,
      false,
      false
    );
    const candidatePaperEntityDrafts = this.parsingProcess(response.body);

    const updatedPaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      sim_threshold,
    );

    return updatedPaperEntityDraft;
  }
}
