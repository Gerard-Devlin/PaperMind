import fs from "fs";

import { PLAPI } from "paperlib-api/api";
import { PaperEntity, PaperTag } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";
import { NodeHtmlMarkdown } from 'node-html-markdown'


import { AbstractEntryScraper } from "./entry-scraper";

export interface IZoteroCSVEntryScraperPayload {
  type: "file";
  value: string;
}

export class ZoteroCSVEntryScraper extends AbstractEntryScraper {
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
      urlUtils.getFileType(payload.value) === "csv"
    ) {
      // read first line
      const fileContent = fs.readFileSync(
        urlUtils.eraseProtocol(payload.value),
        "utf8",
      );
      const firstLine = fileContent.split("\n")[0];
      if (firstLine.includes("Item Type")) {
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
  static async scrape(
    payload: IZoteroCSVEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    const data = fs.readFileSync(urlUtils.eraseProtocol(payload.value), "utf8");
    let dataList = data.split("\n");

    const keys = dataList[0].split('","');
    const values = dataList.slice(1).map((line) => {
      if (line) {
        const vs = line.split('","');
        return vs.reduce((acc, v, i) => {
          acc[keys[i]] = v === '""' ? "" : v;
          return acc;
        }, {} as any);
      }
    });

    let paperEntityDrafts: PaperEntity[] = [];

    const nhm = new NodeHtmlMarkdown();

    for (const value of values) {
      try {
        if (value) {
          const paperEntityDraft = new PaperEntity({}, true);
          paperEntityDraft.setValue("title", value.Title);
          if (value.Author) {
            const authors = value.Author.split(";")
              .map((author: string) => {
                if (author.trim()) {
                  const first_last = author.split(",").map((author: string) => {
                    return author.trim();
                  });
                  first_last.reverse();
                  return first_last.join(" ");
                }
              })
              .join(", ");
            paperEntityDraft.authors = authors;
          }
          paperEntityDraft.publication = value["Publication Title"];
          paperEntityDraft.pubTime = value["Publication Year"];
          paperEntityDraft.doi = value["DOI"];
          paperEntityDraft.addTime = new Date(value["Date Added"]);
          const pubType = [
            "journalArticle",
            "conferencePaper",
            "others",
            "book",
          ].indexOf(value["Item Type"]);
          paperEntityDraft.pubType = pubType > -1 ? pubType : 2;
          const attachments = value["File Attachments"].split(";").map((url: string) => url.trim());

          // find PDF file in attachments
          let mainURL = "";
          let supURLs: string[] = [];

          for (const attachment of attachments) {
            if (attachment.endsWith(".pdf") && !mainURL) {
              mainURL = attachment;
            } else {
              supURLs.push(attachment);
            }
          }

          if (mainURL) {
            if (mainURL.endsWith(".pdf")) {
              paperEntityDraft.mainURL = mainURL;
            } else {
              supURLs.push(mainURL);
            }
          }
          if (supURLs.length > 0) {
            paperEntityDraft.supURLs = supURLs;
          }
          paperEntityDraft.pages = value["Pages"];
          paperEntityDraft.volume = value["Volume"];
          paperEntityDraft.number = value["Issue"];
          paperEntityDraft.publisher = value["Publisher"];
          const note = nhm.translate(value["Notes"]);
          if (note) {
            paperEntityDraft.note = `<md>\n${note}`;
          }

          const tagsList = [...value["Manual Tags"].split(";").map((tag: string) => tag.trim()), ...value["Automatic Tags"].split(";").map((tag: string) => tag.trim())]
          const tags = Array.from(new Set<string>(tagsList)).filter((tag: string) => tag.trim());
          paperEntityDraft.tags = tags.map((tag: string) => {
            return new PaperTag({
              name: tag,
            }, true);
          })

          paperEntityDrafts.push(paperEntityDraft);
        }
      } catch (e) {
        PLAPI.logService.error(
          "Cannot parse Zotero CSV file",
          e as Error,
          true,
          "EntryScrapeExt",
        );
      }
    }

    return paperEntityDrafts;
  }
}
