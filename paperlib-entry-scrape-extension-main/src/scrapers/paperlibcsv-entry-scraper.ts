import fs from "fs";

import { PLAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";
import ObjectId from "bson-objectid";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IPaperlibCSVEntryScraperPayload {
  type: "file";
  value: string;
}

export class PaperlibCSVEntryScraper extends AbstractEntryScraper {
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
      if (firstLine.includes("id,addTime,title,authors,publication,pubTime,pubType,doi,arxiv,mainURL,supURLs,rating,tags,folders,flag,note,codes,pages,volume,number,publisher,")) {
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
  static async scrape(
    payload: IPaperlibCSVEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    const data = fs.readFileSync(urlUtils.eraseProtocol(payload.value), "utf8");
    let dataList = data.split("\n");

    const keys = dataList[0].split(',');
    const values = dataList.slice(1).map((line) => {
      if (line) {
        const vs: string[] = []
        if (line.includes(`","{`)) {
          const lineBeforeCode = line.split(`,"{`)[0];
          const lineAfterCode = line.split(`}","`)[1];
          vs.push(...lineBeforeCode.split('","'));
          vs.push(`{${line.split(`,"{`)[1].split(`}","`)[0]}}`);
          vs.push(...lineAfterCode.split('","'));
        } else {
          vs.push(...line.split('","'));
        }


        return vs.reduce((acc, v, i) => {
          v = v.replace(/^"|"$/g, '');
          acc[keys[i]] = v === '""' ? "" : v;
          return acc;
        }, {} as any);
      }
    });

    let paperEntityDrafts: PaperEntity[] = [];
    for (const value of values) {
      try {
        if (value) {
          const paperEntityDraft = new PaperEntity({}, false);
          paperEntityDraft.setValue("_id", value.id);
          paperEntityDraft.setValue("id", value.id);
          paperEntityDraft.setValue("addTime", new Date(value.addTime));

          paperEntityDraft.setValue("title", value.title);
          paperEntityDraft.authors = value.authors;
          paperEntityDraft.publication = value.publication;
          paperEntityDraft.pubTime = value.pubTime;
          paperEntityDraft.pubType = parseInt(value.pubType);
          paperEntityDraft.doi = value.doi
          paperEntityDraft.arxiv = value.arxiv;
          paperEntityDraft.mainURL = value.mainURL;
          paperEntityDraft.supURLs = value.supURLs.split(";").filter((url: string) => url !== "");
          paperEntityDraft.rating = parseInt(value.rating);
          paperEntityDraft.tags = value.tags.split(";").filter((t: string) => t !== "").map((tag: string) => { return { _id: new ObjectId(), name: tag } });
          paperEntityDraft.folders = value.folders.split(";").filter((t: string) => t !== "").map((folder: string) => { return { _id: new ObjectId(), name: folder } });
          paperEntityDraft.flag = value.flag === "true";
          paperEntityDraft.note = value.note;
          paperEntityDraft.codes = value.codes !== "" ? value.codes.split(";") : [];
          paperEntityDraft.pages = value.pages;
          paperEntityDraft.volume = value.volume;
          paperEntityDraft.number = value.number;
          paperEntityDraft.publisher = value.publisher;

          paperEntityDrafts.push(paperEntityDraft);
        }
      } catch (e) {
        PLAPI.logService.error(
          "Cannot parse Paperlib CSV file",
          e as Error,
          true,
          "EntryScrapeExt",
        );
      }
    }
    return paperEntityDrafts;
  }
}
