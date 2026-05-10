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
import { CacheService, ICacheService } from "./cache-service";

export const IAskService = createDecorator("askService");

export interface AskAnswer {
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    authors: string;
    year: string;
    publication: string;
    quote?: string;
  }>;
}

export class AskService extends Eventable<{}> {
  constructor(
    @ISemanticSearchService
    private readonly _semanticSearchService: SemanticSearchService,
    @ICacheService private readonly _cacheService: CacheService,
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

    const results = await this._semanticSearchService.searchForAsk(
      trimmedQuestion,
      8
    );
    const paperContexts = await Promise.all(
      results.map(async ({ paper, contextText }, index) => {
        const fulltext =
          contextText || (await this._cacheService.loadFullText(paper));
        const quote = this._bestQuote(
          fulltext || paper.abstract || paper.note || "",
          trimmedQuestion
        );

        return {
          source: {
            id: `${paper._id}`,
            title: paper.title,
            authors: paper.authors,
            year: paper.year,
            publication: getPublicationString(paper),
            quote,
          },
          context: [
            `[${index + 1}] ${paper.title}`,
            `Authors: ${paper.authors}`,
            `Year: ${paper.year}`,
            `Publication: ${getPublicationString(paper)}`,
            paper.abstract ? `Abstract: ${paper.abstract}` : "",
            fulltext ? `Indexed text: ${fulltext.slice(0, 6000)}` : "",
            quote ? `Exact excerpt: "${quote}"` : "",
            paper.note ? `Note: ${paper.note}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      })
    );
    const sources = paperContexts.map(({ source }) => source);
    const context = paperContexts
      .map(({ context }) => context)
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
              [
                "You are PaperMind, a research library assistant.",
                "Answer using only the provided paper context.",
                "Start with the direct answer, then explain the evidence briefly.",
                "Answer in the same language as the question.",
                "Cite papers with bracket numbers like [1].",
                "When an exact excerpt is useful, quote one short excerpt verbatim from the provided Exact excerpt fields.",
                "If the context is insufficient, say so clearly.",
              ].join(" "),
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

  private _bestQuote(text: string, question: string) {
    const normalized = `${text || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }

    const terms = `${question || ""}`
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
    const sentences = normalized
      .split(/(?<=[.!?。！？])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 30);

    let bestSentence = sentences[0] || normalized;
    let bestScore = -1;
    for (const sentence of sentences.slice(0, 220)) {
      const lower = sentence.toLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (lower.includes(term) ? 1 : 0),
        0
      );
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    }

    return bestSentence.slice(0, 360);
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
