import fs from "fs";

import { PLAPI } from "paperlib-api/api";
import { PaperEntity, Feed } from "paperlib-api/model";
import { urlUtils } from "paperlib-api/utils";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IMongodbJSONScraperPayload {
  type: "file";
  value: string;
}

export class MongoDBFeedJSONEntryScraper extends AbstractEntryScraper {
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
          data[0].hasOwnProperty("url")
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

    for (const item of data) {
      const feed = new Feed({
        _id: item["_id"]["$oid"],
        color: item.color,
        name: item.name,
        url: item.url,
      });
      await PLAPI.feedService.update([feed]);
    }

    return [];
  }
}
