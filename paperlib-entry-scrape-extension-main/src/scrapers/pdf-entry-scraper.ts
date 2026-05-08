import { franc } from "franc";
import fs from "fs";
import { PLAPI, PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils, urlUtils } from "paperlib-api/utils";

import pdfworker from "../utils/pdfjs/worker";
import { AbstractEntryScraper } from "./entry-scraper";

export interface IPDFEntryScraperPayload {
  type: "file";
  value: string;
}

async function cmapProvider(name) {
  let buf = fs.readFileSync(__dirname + "/cmaps/" + name + ".bcmap");
  return {
    compressionType: 1,
    cMapData: buf,
  };
}

let fontCache = {};
async function standardFontProvider(filename) {
  if (fontCache[filename]) {
    return fontCache[filename];
  }
  let data = fs.readFileSync(__dirname + "/standard_fonts/" + filename);
  fontCache[filename] = data;
  return data;
}

export class PDFEntryScraper extends AbstractEntryScraper {
  constructor() {
    super();
  }

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
      urlUtils.getFileType(payload.value) === "pdf"
    ) {
      return true;
    } else {
      return false;
    }
  }

  private static async _scrapeByZoteroService(
    payload: IPDFEntryScraperPayload,
    paperEntityDraft: PaperEntity,
    locallyParse: boolean,
  ) {
    let buf = fs.readFileSync(urlUtils.eraseProtocol(payload.value));
    let zoteroData = await pdfworker.getRecognizerData(
      buf,
      "",
      cmapProvider,
      standardFontProvider,
    );
    zoteroData.fileName = payload.value.split("/").pop();

    const headers = {
      "Content-Type": "application/json",
    };

    zoteroData.pages = zoteroData.pages.slice(0, 2);
    // const dataStr = JSON.stringify(zoteroData);
    // if (dataStr.length > 1000) {
    //   headers["Content-Encoding"] = "gzip";
    // }

    if (!locallyParse) {
      PLAPI.logService.info("Scraping PDF by Zotero service.", "", false, "EntryScrapeExt")
      const zoteroServiceResponse = await PLExtAPI.networkTool.post(
        "https://services.zotero.org/recognizer/recognize",
        zoteroData,
        headers,
        0,
        15000,
        false,
        true,
      );

      const zoteroMetadata = zoteroServiceResponse.body;

      if (zoteroMetadata.title) {
        paperEntityDraft.setValue("title", zoteroMetadata.title);
      }
      if (zoteroMetadata.authors) {
        const authors = zoteroMetadata.authors.map(
          (author: { firstName: string; lastName: string }) => {
            return `${author.firstName} ${author.lastName}`;
          },
        );
        paperEntityDraft.setValue("authors", authors.join(", "));
      }
      if (zoteroMetadata.arxiv) {
        paperEntityDraft.setValue("arxiv", zoteroMetadata.arxiv);
      }
      if (zoteroMetadata.doi) {
        paperEntityDraft.setValue("doi", zoteroMetadata.doi);
      }
    }

    return { paperEntityDraft, pages: zoteroData.pages };
  }

  private static async _scrapeByLocal(
    paperEntityDraft: PaperEntity,
    pages: any,
  ) {
    // Get largest text
    const textData = pages[0][2][0][0][0][4];

    const sentences: {sentence: string, sentenceMaxFontSize: number}[] = [];
    for (const text of textData) {
      const wordList = text[0];
      const sentence = wordList.map((word) => word[13] + " ".repeat(word[5])).join("");
      const sentenceMaxFontSize = Math.max(...wordList.map((word) => word[4]));
      sentences.push({ sentence, sentenceMaxFontSize });
    }

    const fulltext = sentences.map((sentence) => sentence.sentence).join("\n");
    let largestSentences: string[] = []
    let largestSentenceFontSize: number = -1;
    let secondLargestSentences: string[] = []
    let secondLargestSentenceFontSize: number = -1;

    for (const sentence of sentences) {
      if (sentence.sentenceMaxFontSize > largestSentenceFontSize) {
        secondLargestSentenceFontSize = largestSentenceFontSize;
        secondLargestSentences = largestSentences;
        largestSentenceFontSize = sentence.sentenceMaxFontSize;
        largestSentences = [sentence.sentence];
      } else if (sentence.sentenceMaxFontSize === largestSentenceFontSize) {
        largestSentences.push(sentence.sentence);
      }
      else if (sentence.sentenceMaxFontSize > secondLargestSentenceFontSize) {
        secondLargestSentenceFontSize = sentence.sentenceMaxFontSize;
        secondLargestSentences = [sentence.sentence];
      } else if (sentence.sentenceMaxFontSize === secondLargestSentenceFontSize) {
        secondLargestSentences.push(sentence.sentence);
      }
    }    

    const largestText = largestSentences.join(" ");
    const secondLargestText = secondLargestSentences.join(" ");

    // Title
    const lang = franc(largestText);
    let title: string;

    if (
      largestText.length === 1 ||
      (lang !== "cmn" && lang !== "jpn" && !largestText.includes(" ")) ||
      largestText.startsWith("arXiv") || 
      largestText.toLowerCase().startsWith("journal of") ||
      largestText.toLowerCase().startsWith("proceedings of")
    ) {
      title = secondLargestText.trim();
    } else {
      title = largestText.trim();
    }
    paperEntityDraft.setValue("title", title);

    // ArXiv
    let arxivIds = fulltext.match(
      new RegExp(
        "arXiv:(\\d{4}.\\d{4,5}|[a-z\\-] (\\.[A-Z]{2})?\\/\\d{7})(v\\d )?",
        "g",
      ),
    );
    if (arxivIds) {
      arxivIds[0] = arxivIds[0].replace("arXiv:", "");
    }
    // if not start with number, should be arXiv ID before 2007
    if (
      !arxivIds ||
      (arxivIds?.length > 0 && !arxivIds[0].slice(0, 1).match(/\d/))
    ) {
      arxivIds = fulltext.match(new RegExp("arXiv:(.*/\\d{7})(v\\d )?", "g"));
    }
    if (arxivIds) {
      const arxivId = stringUtils.formatString({
        str: arxivIds[0],
        removeWhite: true,
      });
      paperEntityDraft.setValue("arxiv", arxivId);
    }

    // DOI
    const dois = fulltext.match(/10.\d{4,9}\/[-._;()\/:A-Z0-9]+/mgi);
    if (dois && dois.length > 0) {
      const doi = stringUtils.formatString({ str: dois[0], removeWhite: true });
      if (doi.endsWith(",") || doi.endsWith(".") || doi.endsWith("/")) {
        paperEntityDraft.setValue("doi", doi.slice(0, -1));
      } else {
        paperEntityDraft.setValue("doi", doi);
      }
    }

    return paperEntityDraft;
  }

  static async scrape(
    payload: IPDFEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    let paperEntityDraft = new PaperEntity({}, true);

    paperEntityDraft.setValue("mainURL", payload.value);

    const locallyParse =
      (PLExtAPI.extensionPreferenceService.get(
        "@future-scholars/paperlib-entry-scrape-extension",
        "local-pdf-parse",
      ) as boolean);
    const result = await this._scrapeByZoteroService(
      payload,
      paperEntityDraft,
      locallyParse,
    );
    paperEntityDraft = result.paperEntityDraft;

    if (!paperEntityDraft.title) {
      paperEntityDraft = await this._scrapeByLocal(
        paperEntityDraft,
        result.pages,
      );
    }
    return [paperEntityDraft];
  }
}
