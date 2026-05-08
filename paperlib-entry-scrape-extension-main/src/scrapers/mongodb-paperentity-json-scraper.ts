import fs from "fs";

import { PLAPI } from "paperlib-api/api";
import { PaperEntity, PaperSmartFilter } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IMongodbJSONScraperPayload {
  type: "file";
  value: string;
}

export class MongoDBPaperEntityJSONEntryScraper extends AbstractEntryScraper {
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
      urlUtils.getFileType(payload.value) === "json"
    ) {
      const fileContent = fs.readFileSync(
        urlUtils.eraseProtocol(payload.value),
        "utf8",
      );
      if (fileContent.includes("$oid")) {
        const data = JSON.parse(fileContent);
        if (
          data.length > 0 &&
          data[0].hasOwnProperty("arxiv")
        ) {
          return true;
        }
        return false;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  static async scrape(
    payload: IMongodbJSONScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }
    const data = JSON.parse(
      fs.readFileSync(urlUtils.eraseProtocol(payload.value), "utf8"),
    );

    const alltags = await PLAPI.categorizerService.load("PaperTag" as any, "name", "asce");
    const allfolders = await PLAPI.categorizerService.load("PaperFolder" as any, "name", "asce");

    const tobeInserted: PaperEntity[] = [];

    for (const item of data) {

      const tags = alltags.filter(t => {
        return item.tags && item.tags.find((it: any) => it["$oid"] === t._id);
      }).map(t => { return { "name": t.name } });

      const folders = allfolders.filter(f => {
        return item.folders && item.folders.find((it: any) => it["$oid"] === f._id);
      }).map(f => { return { "name": f.name } });

      const entity = new PaperEntity({
        _id: item["_id"]["$oid"],
        id: item["_id"]["$oid"],
        title: item.title,
        authors: item.authors,
        doi: item.doi,
        publication: item.publication,
        publisher: item.publisher,
        pubType: item.pubType ? parseInt(item.pubType["$numberLong"]) : undefined,
        pubTime: item.pubTime,
        pages: item.pages,
        volume: item.volume,
        number: item.number,
        arxiv: item.arxiv ? (item.arxiv.startsWith("arXiv:") ? item.arxiv.substring(6) : item.arxiv) : undefined,
        mainURL: item.mainURL,
        codes: item.codes,
        note: item.note,
        rating: item.rating ? parseInt(item.rating["$numberLong"]) : 0,
        flag: item.flag,
        addTime: item.addTime ? new Date(item.addTime["$date"]) : undefined,
        tags: tags,
        folders: folders,
      });

      tobeInserted.push(entity);
    }

    await PLAPI.paperService.update(tobeInserted);
    return [];
  }
}
