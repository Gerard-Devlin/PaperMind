import { PaperEntity } from "paperlib-api/model";

import { PLAPI, PLExtAPI } from "paperlib-api/api";
import { AbstractEntryScraper } from "./entry-scraper";
import { PDFEntryScraper } from "./pdf-entry-scraper";

export interface IWebcontentArXivEntryScraperPayload {
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

export class WebcontentArXivEntryScraper extends AbstractEntryScraper {
  static validPayload(payload: any) {
    if (
      !payload.hasOwnProperty("type") ||
      !payload.hasOwnProperty("value") ||
      payload.type !== "webcontent" ||
      !payload.value.hasOwnProperty("url")
    ) {
      return false;
    }
    const urlRegExp = new RegExp(
      "^https?://([^\\.]+\\.)?(arxiv\\.org|xxx\\.lanl\\.gov)/(/\\w|abs/|pdf/)",
    );
    return urlRegExp.test(payload.value.url);
  }

  static async scrape(
    payload: IWebcontentArXivEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    let downloadPDF = true;
    if (payload.value.options && payload.value.options.downloadPDF !== undefined) {
      downloadPDF = payload.value.options.downloadPDF;
    } else {
      downloadPDF =
        (PLExtAPI.extensionPreferenceService.get(
          "@future-scholars/paperlib-entry-scrape-extension",
          "download-pdf",
        ) as boolean)
    }

    const arXivID = payload.value.url.split("/")[4].replace(".pdf", "");

    if (arXivID && downloadPDF) {
      const downloadURL = `https://arxiv.org/pdf/${arXivID}.pdf`;
      PLAPI.logService.info(
        `Downloading PDF from ${downloadURL}`,
        "",
        false,
        "EntryScrapeExt",
      );

      const downloadedFilePath = await PLExtAPI.networkTool.downloadPDFs([
        downloadURL,
      ]);

      PLAPI.logService.info(
        `Downloaded PDF to ${downloadedFilePath}`,
        "",
        false,
        "EntryScrapeExt",
      );

      const entities = await PDFEntryScraper.scrape({
        type: "file",
        value: downloadedFilePath[0],
      });

      PLAPI.logService.info(
        `Parsing PDF yields ${entities.length} paper entities.`,
        "",
        false,
        "EntryScrapeExt",
      );

      return entities;
    } else {
      return [
        new PaperEntity({
          title: "",
          arxiv: arXivID,
        }),
      ];
    }
  }
}
