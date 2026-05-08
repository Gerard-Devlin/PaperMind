import parse from "node-html-parser";
import { PLAPI, PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IWebcontentIEEEEntryScraperPayload {
  type: "webcontent";
  value: {
    url: string;
    document: string;
    cookies: { domain: string; name: string; value: string }[];
    options?: {
      downloadPDF?: boolean;
    }
  };
}

export class WebcontentIEEEEntryScraper extends AbstractEntryScraper {
  static validPayload(payload: any) {
    if (
      !payload.hasOwnProperty("type") ||
      !payload.hasOwnProperty("value") ||
      payload.type !== "webcontent" ||
      !payload.value.hasOwnProperty("url") ||
      !payload.value.hasOwnProperty("document") ||
      !payload.value.hasOwnProperty("cookies")
    ) {
      return false;
    }
    return /^https?:\/\/ieeexplore\.ieee\.org\/(?:abstract\/)?document/.test(payload.value.url);
  }

  static async scrape(
    payload: IWebcontentIEEEEntryScraperPayload,
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

    const root = parse(payload.value.document);
    const metaNodes = root.querySelectorAll("script");
    const meta = metaNodes.find((node) =>
      node.rawText.includes("xplGlobal.document.metadata"),
    );
    if (meta) {
      const entityDraft = new PaperEntity({}, true);
      const metaStr = meta.rawText;

      const title = metaStr.match(/"title":"(.*?)",/);
      if (title) {
        entityDraft.title = title[1];
      }
      const publication = metaStr.match(/"publicationTitle":"(.*?)",/);
      if (publication) {
        entityDraft.publication = publication[1];
      }
      const doi = metaStr.match(/"doi":"(.*?)",/);
      if (doi) {
        entityDraft.doi = doi[1];
      }
      const publicationYear = metaStr.match(/"publicationYear":"(.*?)",/);
      if (publicationYear) {
        entityDraft.pubTime = publicationYear[1];
      }

      const firstName = metaStr.matchAll(/"firstName":"(.*?)",/g);
      const lastName = metaStr.matchAll(/"lastName":"(.*?)",/g);

      let firstNamesList: string[] = [];
      let lastNamesList: string[] = [];
      for (const match of firstName) {
        firstNamesList.push(match[1]);
      }
      for (const match of lastName) {
        lastNamesList.push(match[1]);
      }
      entityDraft.authors = firstNamesList
        .map((firstName, index) => {
          return `${firstName} ${lastNamesList[index]}`;
        })
        .join(", ");
      
      if (downloadPDF) {
        const pdfPath = metaStr.match(/"pdfPath":"(.*?)",/);
        const pdfAccessNode1 = root.querySelector(".pdf-btn-link");
        const pdfAccessNode2 = root.querySelector(".xpl-btn-pdf");
        if (pdfPath && (pdfAccessNode1 || pdfAccessNode2)) {
          const url = `https://ieeexplore.ieee.org${pdfPath[1].replace(
            "iel7",
            "ielx7",
          )}`;

          const cookieJar: any[] = [];
          for (const cookie of payload.value.cookies) {
            cookieJar.push({
              cookieStr: `${cookie.name}=${cookie.value}; domain=${cookie.domain}`,
              currentUrl: `https://${cookie.domain}/`,
            });
          }
          try {
            let filename = url.split("/").pop() as string;
            if (!filename.endsWith(".pdf")) {
              filename += ".pdf";
            }
            
            const targetUrl = await PLExtAPI.networkTool.downloadPDFs(
              [url],
              cookieJar as any,
            );
            if (targetUrl.length > 0) {
              entityDraft.mainURL = targetUrl[0];
            }
          } catch (e) {
            PLAPI.logService.error(
              "Failed to download PDF from IEEE",
              e as Error,
              true,
              "EntryScrapeExt",
            );
          }
        }
      } else {
        entityDraft.note = `<md>\n[URL](${payload.value.url})`;
      }

      return [entityDraft];
    } else {
      return [];
    }
  }
}
