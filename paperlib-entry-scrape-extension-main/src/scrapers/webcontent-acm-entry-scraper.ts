import parse from "node-html-parser";
import { PaperEntity } from "paperlib-api/model";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IWebcontentACMEntryScraperPayload {
  type: "webcontent";
  value: {
    url: string;
    document: string;
    cookies: string;
    options?: {
      downloadPDF?: boolean;
    }
  };
}

export class WebcontentACMEntryScraper extends AbstractEntryScraper {
  static validPayload(payload: any) {
    if (
      !payload.hasOwnProperty("type") ||
      !payload.hasOwnProperty("value") ||
      payload.type !== "webcontent" ||
      !payload.value.hasOwnProperty("url")
    ) {
      return false;
    }
    return /https:\/\/dl\.acm\.org\/doi/.test(payload.value.url);
  }

  static async scrape(
    payload: IWebcontentACMEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }
    
    const doc = parse(payload.value.document);
    const title = doc.querySelector("#skip-to-main-content > main > article > header > div > h1")?.text || "";

    const entity = new PaperEntity({
      title: title,
    });
    
    if (title) {
      return [entity];
    } else {
      return [];
    } 
  }
}
