import { XMLParser } from "fast-xml-parser";

import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { Scraper, ScraperRequestType } from "./scraper";
import { isEmpty } from "@/utils/string";

const xmlParser = new XMLParser();

interface ResponseType {
  feed: {
    entry?: {
      title: string;
      author: { name: string }[] | { name: string };
      published: string;
      "arxiv:comment": string;
    };
  };
}

export class ArXivScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      !isEmpty(paperEntityDraft.arxiv) ||
      (!isEmpty(paperEntityDraft.doi) &&
      paperEntityDraft.doi.toLowerCase().includes("arxiv"))
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    let arxivID = "";
    if (paperEntityDraft.arxiv) {
      arxivID = stringUtils.formatString({
        str: paperEntityDraft.arxiv,
        removeStr: "arXiv:",
      });
    } else if (paperEntityDraft.doi) {
      arxivID = stringUtils.formatString({
        str: paperEntityDraft.doi.split("/").pop() || "",
        removeStr: "arXiv.",
      });
    }
    const scrapeURL = `https://export.arxiv.org/api/query?id_list=${arxivID}`;

    const headers = {
      "accept-encoding": "UTF-32BE",
    };

    return { scrapeURL, headers, sim_threshold: -1 };
  }

  static parsingProcess(
    rawResponse: string,
  ): PaperEntity[] {
    const parsedResponse = xmlParser.parse(rawResponse) as {
      feed: {
        entry?: {
          title: string;
          author?: { name: string }[] | { name: string };
          published: string;
          "arxiv:comment": string;
        };
      };
    };
    const arxivResponse = parsedResponse.feed.entry;

    const candidatePaperEntityDrafts: PaperEntity[] = [];
    if (arxivResponse) {
      const candidatePaperEntityDraft = new PaperEntity();
      let title = stringUtils.formatString({
        str: arxivResponse.title,
        removeNewline: true,
      });
      // replace two or more spaces with a single space
      title = title.replace(/\s{2,}/g, " ");

      const authorList = arxivResponse.author || [];
      let authors: string;
      if (Array.isArray(authorList)) {
        authors = authorList
          .map((author) => {
            return author.name.trim();
          })
          .join(", ");
      } else {
        authors = authorList.name.trim();
      }

      const pubTime = arxivResponse.published.substring(0, 4);
      candidatePaperEntityDraft.title = title;
      candidatePaperEntityDraft.authors = authors;
      candidatePaperEntityDraft.pubTime = pubTime;
      candidatePaperEntityDraft.pubType = 0;
      candidatePaperEntityDraft.publication = "arXiv";

      candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
    }
    return candidatePaperEntityDrafts;
  }
}
