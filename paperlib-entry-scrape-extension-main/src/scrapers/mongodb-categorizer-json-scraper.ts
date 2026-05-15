import fs from "fs";

import { PLAPI } from "paperlib-api/api";
import { PaperEntity, PaperTag, PaperFolder } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";


import { AbstractEntryScraper } from "./entry-scraper";

export interface IMongodbJSONScraperPayload {
  type: "file";
  value: string;
}


async function insert(categorizer: PaperTag | PaperFolder, allCategorizers: (PaperTag | PaperFolder)[] = [], type: "PaperTag" | "PaperFolder", parent: PaperTag | PaperFolder | null = null) {
  const categorizerObj = new (type === "PaperTag" ? PaperTag : PaperFolder)({
    "_id": categorizer["_id"]["$oid"],
    name: categorizer.name.split("/").pop(),
    color: categorizer.color,
    count: 0
  })

  // @ts-ignore
  await PLAPI.categorizerService.create(type as any, categorizerObj, parent);

  if (categorizer.hasOwnProperty("children") && categorizer["children"].length > 0) {
    for (const childId of categorizer["children"]) {
      const child = allCategorizers.find(c => c["_id"]["$oid"] === childId["$oid"]);
      if (child) {
        await insert(child, allCategorizers, type, categorizerObj);
      }
    }
  }
}


export class MongoDBCategorizerJSONEntryScraper extends AbstractEntryScraper {
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
        if (data.length > 0 && data[0].hasOwnProperty("color") && !data[0].hasOwnProperty("filter") && !data[0].hasOwnProperty("url")) {
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
    const data = JSON.parse(fs.readFileSync(urlUtils.eraseProtocol(payload.value), "utf8"));

    const isTag = payload.value.includes("PaperTag");

    const rootName = isTag ? "Tags" : "Folders";

    const rootCategorizers = data.filter((item: any) => {
      return item.name === rootName
    });
    let rootCategorizer = rootCategorizers[0];
    for (const rc of rootCategorizers) {
      if (rc.children && rc.children.length > (rootCategorizer.children ? rootCategorizer.children.length : 0)) {
        rootCategorizer = rc;
      }
    }

    await insert(rootCategorizer, data, isTag ? "PaperTag" : "PaperFolder");

    return []
  }
}
