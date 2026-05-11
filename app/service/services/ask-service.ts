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
    mainURL?: string;
    title: string;
    authors: string;
    year: string;
    publication: string;
    quote?: string;
    quoteCandidates?: string[];
  }>;
}

interface IAskSourceContext {
  fulltext: string;
  fallbackText: string;
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
  @errorcatching("Failed to list chat models.", true, "AskService", [])
  async listChatModels(baseURL: string, forceRefresh = false): Promise<string[]> {
    const models = await this._listModels(baseURL, forceRefresh);
    return models.filter((modelID) => !this._isEmbeddingModel(modelID));
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to list embedding models.", true, "AskService", [])
  async listEmbeddingModels(
    baseURL: string,
    forceRefresh = false
  ): Promise<string[]> {
    const models = await this._listModels(baseURL, forceRefresh);
    const embeddingModels = models.filter((modelID) =>
      this._isEmbeddingModel(modelID)
    );
    if (embeddingModels.length > 0) {
      return embeddingModels;
    }
    return this._fallbackEmbeddingModels(baseURL);
  }

  private async _listModels(
    baseURL: string,
    forceRefresh = false
  ): Promise<string[]> {
    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";
    if (!apiKey) {
      return [];
    }

    const normalizedBaseURL = `${baseURL || ""}`.trim().replace(/\/+$/, "");
    if (!normalizedBaseURL) {
      return [];
    }

    const cacheKey = normalizedBaseURL.toLowerCase();
    const cache = (await PLMainAPI.preferenceService.get(
      "chatModelListCache"
    )) as Record<string, { models: string[]; updatedAt: number }>;
    const cachedEntry = cache?.[cacheKey];
    const cacheTTL = 24 * 60 * 60 * 1000;
    if (
      !forceRefresh &&
      cachedEntry &&
      Array.isArray(cachedEntry.models) &&
      cachedEntry.models.length > 0 &&
      Date.now() - cachedEntry.updatedAt < cacheTTL
    ) {
      return cachedEntry.models;
    }

    const response = await fetch(`${normalizedBaseURL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Model list API failed: ${response.status} ${await response.text()}`
      );
    }

    const body = await response.json();
    const models: string[] = Array.isArray(body?.data)
      ? body.data
          .map((item: any) => `${item?.id || ""}`.trim())
          .filter((id: string) => id.length > 0)
      : [];

    const uniqueModels = Array.from(new Set<string>(models)).sort((a, b) =>
      a.localeCompare(b)
    );
    await PLMainAPI.preferenceService.set({
      chatModelListCache: {
        ...(cache || {}),
        [cacheKey]: {
          models: uniqueModels,
          updatedAt: Date.now(),
        },
      },
    });

    return uniqueModels;
  }

  private _isEmbeddingModel(modelID: string): boolean {
    const normalized = `${modelID || ""}`.toLowerCase();
    return (
      normalized.includes("embedding") ||
      normalized.includes("text-embed") ||
      normalized.includes("bge-") ||
      normalized.includes("m3e-")
    );
  }

  private _fallbackEmbeddingModels(baseURL: string): string[] {
    const normalized = `${baseURL || ""}`.toLowerCase();

    if (normalized.includes("dashscope.aliyuncs.com")) {
      return ["text-embedding-v4", "text-embedding-v3"];
    }

    if (normalized.includes("api.openai.com")) {
      return [
        "text-embedding-3-large",
        "text-embedding-3-small",
        "text-embedding-ada-002",
      ];
    }

    if (normalized.includes("deepseek.com")) {
      return [];
    }

    return [];
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

    const askBaseURL = `${await PLMainAPI.preferenceService.get(
      "qwenAskBaseURL"
    )}`.trim();
    const askModel = `${await PLMainAPI.preferenceService.get(
      "qwenAskModel"
    )}`.trim();
    const legacyChatBaseURL = `${await PLMainAPI.preferenceService.get(
      "qwenChatBaseURL"
    )}`.trim();
    const legacyChatModel = `${await PLMainAPI.preferenceService.get(
      "qwenChatModel"
    )}`.trim();
    const baseURL = (askBaseURL || legacyChatBaseURL).replace(/\/+$/, "");
    const model = askModel || legacyChatModel;

    const results = await this._semanticSearchService.searchForAsk(
      trimmedQuestion,
      8
    );
    const sourceContexts = new Map<string, IAskSourceContext>();
    const paperContexts = await Promise.all(
      results.map(async ({ paper, contextText }, index) => {
        const fulltext =
          contextText || (await this._cacheService.loadFullText(paper));
        const searchableText = fulltext || paper.abstract || paper.note || "";
        const fallbackText =
          [paper.abstract || "", paper.note || "", searchableText]
            .filter(Boolean)
            .join(" ");
        const quote = this._bestQuote(searchableText, trimmedQuestion);
        const relevantExcerpt = this._buildRelevantExcerpt(
          searchableText,
          trimmedQuestion,
          12000
        );
        sourceContexts.set(`${paper._id}`, {
          fulltext: searchableText,
          fallbackText,
        });

        return {
          source: {
            id: `${paper._id}`,
            mainURL: paper.mainURL || "",
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
            relevantExcerpt ? `Indexed text: ${relevantExcerpt}` : "",
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
    const answer = body?.choices?.[0]?.message?.content || "";
    const citationQueryList = this._extractCitationQueryList(answer);
    const refinedSources = sources.map((source, idx) => {
      const context = sourceContexts.get(source.id);
      const citationIdx = idx + 1;
      const queriesForSource = citationQueryList
        .filter((item) => item.idx === citationIdx)
        .map((item) => item.query)
        .filter(Boolean);

      const usedQuotesForSource = new Set<string>();
      const quoteCandidates = (queriesForSource.length
        ? queriesForSource
        : [trimmedQuestion]
      )
        .map((query) =>
          this._selectDistinctQuote(
            context?.fulltext || "",
            context?.fallbackText || "",
            query,
            usedQuotesForSource
          )
        )
        .filter(Boolean);

      const refinedQuote = quoteCandidates[0] || source.quote || "";
      if (refinedQuote) {
        usedQuotesForSource.add(refinedQuote);
      }
      return {
        ...source,
        quote: refinedQuote || source.quote || "",
        quoteCandidates,
      };
    });

    return {
      answer,
      sources: refinedSources,
    };
  }

  private _extractCitationQueryList(
    answer: string
  ): Array<{ idx: number; query: string }> {
    const citationQueries: Array<{ idx: number; query: string }> = [];
    const normalized = `${answer || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return citationQueries;
    }

    const segments = normalized
      .split(/(?<=[.!?。！？])\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments) {
      const matches = [...segment.matchAll(/\[(\d+)\]/g)];
      if (!matches.length) {
        continue;
      }
      const query = segment.replace(/\[(\d+)\]/g, "").trim();
      for (const match of matches) {
        const idx = Number(match[1]);
        if (!idx) {
          continue;
        }
        citationQueries.push({ idx, query });
      }
    }

    return citationQueries;
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

    let bestSentence = sentences[0] || normalized.slice(0, 360);
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

  private _selectDistinctQuote(
    fulltext: string,
    fallbackText: string,
    query: string,
    usedQuotes: Set<string>
  ): string {
    const candidates = this._rankQuoteCandidates(fulltext || fallbackText, query);
    for (const candidate of candidates) {
      if (!usedQuotes.has(candidate)) {
        return candidate;
      }
    }

    if (fallbackText) {
      const fallbackCandidates = this._rankQuoteCandidates(fallbackText, query);
      for (const candidate of fallbackCandidates) {
        if (!usedQuotes.has(candidate)) {
          return candidate;
        }
      }
    }

    return candidates[0] || "";
  }

  private _rankQuoteCandidates(text: string, query: string): string[] {
    const normalized = `${text || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }

    const terms = `${query || ""}`
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);

    const sentences = normalized
      .split(/(?<=[.!?。！？])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 24)
      .slice(0, 260);

    const ranked = sentences
      .map((sentence, idx) => {
        const lower = sentence.toLowerCase();
        const hitCount = terms.reduce(
          (sum, term) => sum + (lower.includes(term) ? 1 : 0),
          0
        );
        const density =
          terms.length > 0 ? hitCount / terms.length : 0;
        const lengthPenalty = Math.abs(sentence.length - 140) / 220;
        const score = hitCount * 2 + density - lengthPenalty - idx * 0.0008;
        return { sentence: sentence.slice(0, 360), score };
      })
      .sort((a, b) => b.score - a.score);

    return ranked.map((item) => item.sentence);
  }

  private _buildRelevantExcerpt(
    text: string,
    query: string,
    maxChars = 12000
  ): string {
    const normalized = `${text || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }

    const candidates = this._rankQuoteCandidates(normalized, query).slice(0, 80);
    const picked: string[] = [];
    const seen = new Set<string>();
    let used = 0;

    for (const sentence of candidates) {
      const clean = `${sentence || ""}`.trim();
      if (!clean || seen.has(clean)) {
        continue;
      }
      const extra = clean.length + (picked.length ? 1 : 0);
      if (used + extra > maxChars) {
        break;
      }
      picked.push(clean);
      seen.add(clean);
      used += extra;
    }

    if (picked.length > 0) {
      return picked.join(" ");
    }

    return normalized.slice(0, maxChars);
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

    const tagBaseURL = `${await PLMainAPI.preferenceService.get(
      "qwenAITagBaseURL"
    )}`.trim();
    const tagModel = `${await PLMainAPI.preferenceService.get(
      "qwenAITagModel"
    )}`.trim();
    const legacyChatBaseURL = `${await PLMainAPI.preferenceService.get(
      "qwenChatBaseURL"
    )}`.trim();
    const legacyChatModel = `${await PLMainAPI.preferenceService.get(
      "qwenChatModel"
    )}`.trim();
    const baseURL = (tagBaseURL || legacyChatBaseURL).replace(/\/+$/, "");
    const model = tagModel || legacyChatModel;

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
