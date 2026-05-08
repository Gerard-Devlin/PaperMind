import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { getPublicationString } from "@/base/string";
import { ILogService, LogService } from "@/common/services/log-service";
import {
  ISemanticSearchService,
  SemanticSearchService,
} from "./semantic-search-service";

export const IAskService = createDecorator("askService");

export interface AskAnswer {
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    authors: string;
    year: string;
    publication: string;
  }>;
}

export class AskService extends Eventable<{}> {
  constructor(
    @ISemanticSearchService
    private readonly _semanticSearchService: SemanticSearchService,
    @ILogService private readonly _logService: LogService
  ) {
    super("askService", {});
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to ask PaperMind.", true, "AskService", {
    answer: "",
    sources: [],
  })
  async ask(question: string): Promise<AskAnswer> {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return { answer: "", sources: [] };
    }

    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";
    if (!apiKey) {
      throw new Error("Qwen API key is missing.");
    }

    const baseURL = `${await PLMainAPI.preferenceService.get(
      "qwenChatBaseURL"
    )}`.replace(/\/+$/, "");
    const model = `${await PLMainAPI.preferenceService.get("qwenChatModel")}`;

    const papers = await this._semanticSearchService.search(trimmedQuestion, 8);
    const sources = papers.map((paper) => ({
      id: `${paper._id}`,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      publication: getPublicationString(paper),
    }));
    const context = papers
      .map((paper, index) =>
        [
          `[${index + 1}] ${paper.title}`,
          `Authors: ${paper.authors}`,
          `Year: ${paper.year}`,
          `Publication: ${getPublicationString(paper)}`,
          paper.abstract ? `Abstract: ${paper.abstract}` : "",
          paper.note ? `Note: ${paper.note}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are PaperMind, a research library assistant. Answer using the provided paper context. Cite papers with bracket numbers like [1]. If the context is insufficient, say so clearly.",
          },
          {
            role: "user",
            content: `Question:\n${trimmedQuestion}\n\nPaper context:\n${context}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Qwen chat API failed: ${response.status} ${await response.text()}`);
    }

    const body = await response.json();
    return {
      answer: body?.choices?.[0]?.message?.content || "",
      sources,
    };
  }

  async suggestTags(paper: {
    title: string;
    authors?: string;
    year?: string;
    publication?: string;
    abstract?: string;
    existingTags?: string[];
  }): Promise<string[]> {
    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";
    if (!apiKey) {
      return [];
    }

    const baseURL = `${await PLMainAPI.preferenceService.get(
      "qwenChatBaseURL"
    )}`.replace(/\/+$/, "");
    const model = `${await PLMainAPI.preferenceService.get("qwenChatModel")}`;

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              [
                "Return only a JSON array of 0 to 1 broad English research area tags. No markdown.",
                "If existingTags is not empty, choose a tag from existingTags whenever possible.",
                "If existingTags already covers the paper reasonably, return only that existing tag.",
                "Avoid narrow method names, dataset names, benchmark names, paper-specific phrases, and near-duplicate tags.",
                "Each tag should be 1 to 3 words and useful across multiple papers in a small research library.",
              ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify(paper),
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const content = (await response.json())?.choices?.[0]?.message?.content || "[]";
    try {
      const parsed = JSON.parse(content.replace(/^```json|```$/g, "").trim());
      if (Array.isArray(parsed)) {
        return parsed
          .map((tag) => `${tag}`.trim())
          .filter((tag) => tag.length > 0 && tag.length <= 40)
          .slice(0, 1);
      }
    } catch (error) {
      this._logService.warn(
        "Failed to parse AI tags.",
        `${(error as Error).message}`,
        false,
        "AskService"
      );
    }

    return [];
  }
}
