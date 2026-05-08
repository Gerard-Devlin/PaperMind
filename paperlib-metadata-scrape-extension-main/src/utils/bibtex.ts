import { Cite, plugins } from "@citation-js/core";
import * as plugin from "@citation-js/plugin-bibtex";
import { PaperEntity } from "paperlib-api/model";

interface BibtexEntity {
  title: string;
  author: [{ given: string; family: string }];
  issued: {
    "date-parts": [[number]];
  };
  type: string;
  "container-title": string;
  publisher: string;
  page: string;
  volume: string;
  issue: string;
}

interface BibtexEntry {
  title: string;
  author: [{ given: string; family: string }];
  issued: {
    "date-parts": [[number]];
  };
  type: string;
  "container-title": string;
  publisher: string;
  page: string;
  volume: string;
  issue: string;
}

export function bibtex2json(bibtex: string): BibtexEntry[] {
  try {
    plugins.input.add("@bibtex/text", plugin);
    // remove all special chars in citation keys
    let bibtexComps = bibtex.trim().split("\n").filter(v => v)
    
    for (let i = 0; i < Math.min(2, bibtexComps.length); i++) {
      let line = bibtexComps[i]
      if (/^[^=]*,$/.test(line)) {
        if (line.startsWith("@")){
          const lineComp = line.split("{")
          line = lineComp[0] + "{" + lineComp[1].replace(/[^a-zA-Z0-9,]/g, "")
        } else {
          line = line.replace(/[^a-zA-Z0-9,]/g, "");
        }
      }
      bibtexComps[i] = line
    }
    bibtex = bibtexComps.join("\n")

    const csls = new Cite(bibtex);
    return csls.data;
  } catch (e) {
    console.error(e);
    return [];
  }
}

export function bibtex2paperEntityDraft(
  bibtex: BibtexEntity,
  paperEntityDraft: PaperEntity,
): PaperEntity {
  if (bibtex.title) {
    paperEntityDraft.title = bibtex.title;
  }

  if (bibtex.author) {
    const authors = bibtex.author
      .map((author) => {
        return [author.given, author.family].join(" ");
      })
      .join(", ");
    paperEntityDraft.authors = authors;
  }

  if (bibtex.issued) {
    if (bibtex.issued["date-parts"][0][0]) {
      paperEntityDraft.pubTime = `${bibtex.issued["date-parts"][0][0]}`;
    }
  }

  if (bibtex["container-title"]) {
    const publication = bibtex["container-title"];
    if (
      paperEntityDraft.publication === "" ||
      (!publication.toLowerCase().includes("arxiv") &&
        paperEntityDraft.publication.toLowerCase().includes("arxiv"))
    ) {
      paperEntityDraft.publication = publication;
    }
  }

  if (bibtex.type === "article-journal") {
    paperEntityDraft.pubType = 0;
  } else if (bibtex.type === "paper-conference" || bibtex.type === "chapter") {
    paperEntityDraft.pubType = 1;
  } else if (bibtex.type === "book") {
    paperEntityDraft.pubType = 3;
  } else {
    paperEntityDraft.pubType = 2;
  }

  if (bibtex.page) {
    paperEntityDraft.pages = `${bibtex.page}`;
  }
  if (bibtex.volume) {
    paperEntityDraft.volume = `${bibtex.volume}`;
  }
  if (bibtex.issue) {
    paperEntityDraft.setValue("number", `${bibtex.issue}`);
  }
  if (bibtex.publisher) {
    paperEntityDraft.setValue("publisher", `${bibtex.publisher}`);
  }

  return paperEntityDraft;
}

export function bibtexes2paperEntityDrafts(
  bibtexes: BibtexEntity[],
  paperEntityDrafts: PaperEntity[],
): PaperEntity | PaperEntity[] {
  try {
    // Assert bibtex and paperEntityDraft are both arrays or not
    if (Array.isArray(bibtexes) && Array.isArray(paperEntityDrafts)) {
      console.error("Bibtex and EntityDraft must be both arrays or not");
      return paperEntityDrafts;
    }
    return bibtexes.map((bib, index) => {
      return bibtex2paperEntityDraft(bib, paperEntityDrafts[index]);
    });
  } catch (e) {
    console.error(e);
    return paperEntityDrafts;
  }
}
