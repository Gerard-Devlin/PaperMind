import fs from "fs";

import { PLAPI } from "paperlib-api/api";
import { PaperEntity, PaperSmartFilter } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";


import { AbstractEntryScraper } from "./entry-scraper";

export interface IMongodbJSONScraperPayload {
  type: "file";
  value: string;
}


async function insert(smartfilter: PaperSmartFilter, allSmartFilters: PaperSmartFilter[] = [], parent: PaperSmartFilter | null = null) {
  const smartfilterObj = new PaperSmartFilter({
    "_id": smartfilter["_id"]["$oid"],
    name: smartfilter.name.split("/").pop(),
    color: smartfilter.color,
    filter: smartfilter.filter
  })

  // @ts-ignore
  await PLAPI.smartFilterService.update("PaperSmartFilter", smartfilterObj, parent);

  if (smartfilter.hasOwnProperty("children") && smartfilter["children"].length > 0) {
    for (const childId of smartfilter["children"]) {
      const child = allSmartFilters.find(c => c["_id"]["$oid"] === childId["$oid"]);
      if (child) {
        await insert(child, allSmartFilters, smartfilterObj);
      }
    }
  }
}


export class MongoDBSmartFilterJSONEntryScraper extends AbstractEntryScraper {
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
        if (data.length > 0 && data[0].hasOwnProperty("color") && data[0].hasOwnProperty("filter")) {
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

    const rootName = "SmartFilters";

    const roots = data.filter((item: any) => {
      return item.name === rootName
    });
    let root = roots[0];
    for (const r of roots) {
      if (r.children && r.children.length > (root.children ? root.children.length : 0)) {
        root = r;
      }
    }

    await insert(root, data);

    return []
  }
}
