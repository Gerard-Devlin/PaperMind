import parse from "node-html-parser";
import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { AbstractEntryScraper } from "./entry-scraper";

export interface IWebcontentCNKIEntryScraperPayload {
  type: "webcontent";
  value: {
    url: string;
    document: string;
    cookies: string;
  };
}

export class WebcontentCNKIEntryScraper extends AbstractEntryScraper {
  static validPayload(payload: any) {
    if (
      !payload.hasOwnProperty("type") ||
      !payload.hasOwnProperty("value") ||
      payload.type !== "webcontent" ||
      !payload.value.hasOwnProperty("url")
    ) {
      return false;
    }
    const urlRegExp = new RegExp("^https?://kns.cnki.net/KCMS/detail");
    return urlRegExp.test(payload.value.url);
  }

  static async scrape(
    payload: IWebcontentCNKIEntryScraperPayload,
  ): Promise<PaperEntity[]> {
    if (!this.validPayload(payload)) {
      return [];
    }

    const url = payload.value.url;

    const urlParams = new URLSearchParams(url.split("?")[1]);
    const filename = urlParams.get("filename") || "";
    const dbname = urlParams.get("dbname") || "";

    const refRequestUrl = "https://kns.cnki.net/kns8/manage/ShowExport";
    const refRequestFormData = {
      filename: filename,
      dbname: dbname,
      displaymode: "Refworks",
      ordertype: "desc",
    };

    const response = await PLExtAPI.networkTool.postForm(
      refRequestUrl,
      refRequestFormData as any,
    );

    const root = parse(response.body);
    const refwork = root.querySelector("li")?.innerHTML;

    if (refwork) {
      const lines = refwork.split("<br>");
      if (lines.length === 0) {
        return [];
      } else {
        const paperEntityDraft = new PaperEntity({}, true);

        const authorList: string[] = [];

        let isDissertation = false;
        let isPatent = false;
        let isStandard = false;
        let patentID = "";

        for (const line of lines) {
          if (line.startsWith("T1")) {
            paperEntityDraft.title = line.slice(3);
          } else if (
            line.startsWith("A1") ||
            line.startsWith(
              "A2" || line.startsWith("A3") || line.startsWith("A4"),
            )
          ) {
            const aList = line
              .slice(3)
              .split(";")
              .map((author) => author.trim());
            authorList.push(...aList);
          } else if (line.startsWith("YR")) {
            paperEntityDraft.pubTime = line.slice(3);
          } else if (line.startsWith("JF")) {
            paperEntityDraft.publication = line.slice(3);
          } else if (line.startsWith("PB")) {
            paperEntityDraft.publisher = line.slice(3);
          } else if (line.startsWith("RT")) {
            const type = line.slice(3);
            if (type === "Dissertation/Thesis") {
              isDissertation = true;
            } else if (type === "Patent") {
              isPatent = true;
            } else if (type === "Standard") {
              isStandard = true;
            }

            let typeIdx;
            if (type === "Journal Article") {
              typeIdx = 0;
            } else if (type === "Conference Proceeding") {
              typeIdx = 1;
            } else if (type === "Book") {
              typeIdx = 3;
            } else {
              typeIdx = 2;
            }
            paperEntityDraft.pubType = typeIdx;
          } else if (line.startsWith("OP")) {
            paperEntityDraft.pages = line.slice(3);
          } else if (line.startsWith("vo")) {
            paperEntityDraft.volume = line.slice(3);
          } else if (line.startsWith("IS")) {
            paperEntityDraft.number = line.slice(3);
          } else if (line.startsWith("FD")) {
            paperEntityDraft.pubTime = line.slice(3, 7);
          } else if (line.startsWith("ID")) {
            patentID = line.slice(3);
          }
        }

        if (isDissertation || isStandard) {
          paperEntityDraft.publication = paperEntityDraft.publisher;
        }

        if (isPatent) {
          paperEntityDraft.publication = patentID;
        }

        paperEntityDraft.setValue(
          "authors",
          authorList.filter((a) => a).join(", "),
        );

        if (paperEntityDraft.title === "") {
          return [];
        }

        return [paperEntityDraft];
      }
    }

    return [];
  }
}
