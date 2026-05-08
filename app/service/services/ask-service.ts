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
      (await PLMainAPI.preferenceService.getPassword("askAPIKey")) ||
      process.env.OPENAI_API_KEY ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";
    if (!apiKey) {
      throw new Error("Ask API key is missing.");
    }

    const baseURL = `${await PLMainAPI.preferenceService.get(
      "askAPIBaseURL"
    )}`.replace(/\/+$/, "");
    const model = `${await PLMainAPI.preferenceService.get("askModel")}`;

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
      throw new Error(`Ask API failed: ${response.status} ${await response.text()}`);
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
  }): Promise<string[]> {
    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("askAPIKey")) ||
      process.env.OPENAI_API_KEY ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";
    if (!apiKey) {
      return [];
    }

    const baseURL = `${await PLMainAPI.preferenceService.get(
      "askAPIBaseURL"
    )}`.replace(/\/+$/, "");
    const model = `${await PLMainAPI.preferenceService.get("askModel")}`;

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
              "Return only a JSON array of 3 to 6 short research tags. No markdown.",
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
          .filter(Boolean)
          .slice(0, 6);
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
