import { readFileSync } from "fs";

import { bibtex2json, BibtexEntity, bibtex2paperEntityDraft } from "@/utils/bibtex";
import { PaperEntity } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IBibTexEntryScraperPayload {
  type: "file";
  value: string;
}

export class BibTexEntryScraper extends AbstractEntryScraper {
  static validPayload(payload: any): boolean {
    if (
      !payload.hasOwnProperty("type") ||
      !payload.hasOwnProperty("value") ||
      payload.type !== "file"
    ) {
      return false;
    }
    if (
      (urlUtils.getProtocol(payload.value) === "file" ||
        urlUtils.getProtocol(payload.value) === "") &&
      urlUtils.getFileType(payload.value) === "bib"
    ) {
      return true;
    } else {
      return false;
    }
  }
  static async scrape(
    payload: IBibTexEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    const bibtexStr = readFileSync(
      urlUtils.eraseProtocol(payload.value),
      "utf8",
    );

    const bibtexes = bibtex2json(bibtexStr);
    const paperEntityDrafts: PaperEntity[] = [];
    for (const bibtex of bibtexes) {
      let paperEntityDraft = new PaperEntity({}, true);
      paperEntityDraft = bibtex2paperEntityDraft(bibtex, paperEntityDraft);
      paperEntityDrafts.push(paperEntityDraft);
    }
    return paperEntityDrafts;
  }
}
