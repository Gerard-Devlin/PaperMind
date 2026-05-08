import { readFileSync } from "fs";
import parse from "node-html-parser";
import { PLAPI, PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IWebcontentEmbedEntryScraperPayload {
  type: "webcontent";
  value: {
    url: string;
    document: string;
    cookies: { domain: string; name: string; value: string }[];
    options?: {
      downloadPDF?: boolean;
    };
  };
}

export class WebcontentEmbedEntryScraper extends AbstractEntryScraper {
  static validPayload(payload: any) {
    if (
      !payload.hasOwnProperty("type") ||
      !payload.hasOwnProperty("value") ||
      payload.type !== "webcontent" ||
      !payload.value.hasOwnProperty("url") ||
      !payload.value.hasOwnProperty("document")
    ) {
      return false;
    }
    const urlRegExp = new RegExp("^https?://");
    const urlTest = urlRegExp.test(payload.value.url);

    if (!urlTest) {
      return false;
    }

    const root = parse(payload.value.document);

    const metaTags = root.querySelectorAll("meta");

    if (metaTags.length > 0) {
      let matched = false;
      for (const meta of metaTags) {
        if (
          meta.hasAttribute("name") &&
          meta.getAttribute("name") === "citation_title"
        ) {
          matched = true;
        } else if (
          meta.hasAttribute("name") &&
          meta.getAttribute("name") === "dc.Title"
        ) {
          matched = true;
        }  else if (
          meta.hasAttribute("name") &&
          meta.getAttribute("name") === "dc.Identifier" &&
          meta.hasAttribute("scheme") &&
          meta.getAttribute("scheme") === "doi"
        ) {
          matched = true;
        }
      }

      return matched;
    } else {
      return false;
    }
  }

  static async scrape(
    payload: IWebcontentEmbedEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    const root = parse(payload.value.document);
    let downloadURL = "";
    const metaTags = root.querySelectorAll("meta");
    if (metaTags.length > 0) {
      const entityDraft = new PaperEntity({}, true);
      let matched = false;

      const authors: string[] = [];

      let downloadPDF = true;
      if (
        payload.value.options &&
        payload.value.options.downloadPDF !== undefined
      ) {
        downloadPDF = payload.value.options.downloadPDF;
      } else {
        downloadPDF = PLExtAPI.extensionPreferenceService.get(
          "@future-scholars/paperlib-entry-scrape-extension",
          "download-pdf",
        ) as boolean;
      }

      for (const meta of metaTags) {
        if (
          meta.getAttribute("name") === "citation_title" ||
          meta.getAttribute("name") === "dc.Title"
        ) {
          entityDraft.title = meta.getAttribute("content") || "";
          matched = true;
        }
        if (
          meta.getAttribute("name") === "citation_author" ||
          meta.getAttribute("name") === "dc.Creator"
        ) {
          if (meta.getAttribute("content")) {
            authors.push(meta.getAttribute("content")!);
          }
        }
        if (
          meta.getAttribute("name") === "citation_publication_date" ||
          meta.getAttribute("name") == "dc.Date"
        ) {
          entityDraft.pubTime =
            meta.getAttribute("content")?.split("/")[0] || "";
        }
        if (
          meta.getAttribute("name") === "citation_doi" ||
          meta.getAttribute("name") === "dc.Identifier" ||
          meta.getAttribute("name") === "publication_doi"
        ) {
          if (
            meta.hasAttribute("scheme") &&
            meta.getAttribute("scheme") === "publisher-id"
          ) {
          } else {
            entityDraft.doi = meta.getAttribute("content") || "";
            matched = true;
          }
        }

        if (
          meta.getAttribute("name") === "dc.Identifier" &&
          payload.value.url.includes("adsabs.harvard.edu")
        ) {
          downloadURL = `https://ui.adsabs.harvard.edu${meta.getAttribute(
            "content",
          )}`;
        }
        if (
          meta.getAttribute("name") === "publication_doi" &&
          /\/doi\/((?:abs|abstract|full|figure|ref|citedby|book|epdf|pdf)?\/?)10.\d{4,9}\/[-._;()\/:A-Za-z0-9]+$/.test(payload.value.url)
        ) {
          const doi = meta.getAttribute("content")!;
          entityDraft.doi = doi;
          matched = true;

          downloadURL = payload.value.url.replace(
            /\/doi\/((?:abs|abstract|full|figure|ref|citedby|book|epdf|pdf)?\/?)10.\d{4,9}\/[-._;()\/:A-Za-z0-9]+$/,
            `/doi/pdf/${doi}`,
          );
        }

        if (
          meta.getAttribute("name") === "dc.Identifier" &&
          meta.hasAttribute("scheme") &&
          meta.getAttribute("scheme") === "doi" &&
          /\/doi\/((?:abs|abstract|full|figure|ref|citedby|book|epdf|pdf)?\/?)10.\d{4,9}\/[-._;()\/:A-Za-z0-9]+$/.test(payload.value.url)
        ) {
          const doi = meta.getAttribute("content")!;
          entityDraft.doi = doi;
          matched = true;

          downloadURL = payload.value.url.replace(
            /\/doi\/((?:abs|abstract|full|figure|ref|citedby|book|epdf|pdf)?\/?)10.\d{4,9}\/[-._;()\/:A-Za-z0-9]+$/,
            `/doi/pdf/${doi}`,
          );
        }

        if (meta.getAttribute("name") === "citation_pdf_url") {
          downloadURL = meta.getAttribute("content")!;
        }
      }
      if (authors.length > 0) {
        entityDraft.authors = authors
          .map((author) => {
            return author.trim();
          })
          .join(", ");
      }

      if (
        downloadPDF &&
        downloadURL.length > 0 &&
        downloadURL.startsWith("http")
      ) {
        try {
          const cookieJar: any[] = [];
          for (const cookie of payload.value.cookies) {
            cookieJar.push({
              cookieStr: `${cookie.name}=${cookie.value}; domain=${cookie.domain}`,
              currentUrl: `https://${cookie.domain}/`,
            });
          }

          let downloadedFilePath = "";
          let downloadedFilePaths = await PLExtAPI.networkTool.downloadPDFs(
            [downloadURL],
            cookieJar,
          );
          if (downloadedFilePaths.length === 0) {
            // Try download via browser extension.
            // @ts-ignore
            downloadedFilePath = await PLAPI.browserExtensionService.askBrowserExtensionDownload(downloadURL);
          } else {
            downloadedFilePath = downloadedFilePaths[0];
          }

          if (downloadedFilePath) {
            const fileContent = readFileSync(downloadedFilePath);
            if (
              fileContent.subarray(0, 5).toString() === "%PDF-" &&
              fileContent.subarray(-5).toString().includes("EOF")
            ) {
              entityDraft.mainURL = downloadedFilePath;
            }
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (!matched) {
        return [];
      } else {
        return [entityDraft];
      }
    } else {
      return [];
    }
  }
}
