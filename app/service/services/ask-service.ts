import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { getPublicationString } from "@/base/string";
import { Entity } from "@/models/entity";
import { ILogService, LogService } from "@/common/services/log-service";
import { getModelProviderPreset } from "@/common/model-provider-registry";
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

type AskContextProfile = "fast" | "balanced" | "detailed";

interface IAskContextConfig {
  totalChars: number;
  focusedChars: number;
  maxSentences: number;
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
  async listChatModels(
    baseURL: string,
    forceRefresh = false,
    scope: "ask" | "tag" = "ask"
  ): Promise<string[]> {
    const models = await this._listModels(baseURL, forceRefresh, scope);
    return models.filter((modelID) => !this._isEmbeddingModel(modelID));
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to list embedding models.", true, "AskService", [])
  async listEmbeddingModels(
    baseURL: string,
    forceRefresh = false
  ): Promise<string[]> {
    const models = await this._listModels(baseURL, forceRefresh, "embedding");
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
    forceRefresh = false,
    scope: "ask" | "tag" | "embedding" = "ask"
  ): Promise<string[]> {
    const provider =
      scope === "embedding"
        ? getModelProviderPreset(
            `${await PLMainAPI.preferenceService.get("embeddingModelProvider")}`.trim()
          )
        : await this._getProviderPreset(scope);
    const apiKey = await this._resolveProviderAPIKey(provider.id, scope);
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

    if (normalized.includes("open.bigmodel.cn")) {
      return ["embedding-3"];
    }

    return [];
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to ask PaperMind.", true, "AskService", {
    answer: "",
    sources: [],
  })
  async ask(question: string, focusedPapers: Entity[] = []): Promise<AskAnswer> {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return { answer: "", sources: [] };
    }

    const provider = await this._getProviderPreset("ask");
    const apiKey = await this._resolveProviderAPIKey(provider.id, "ask");
    if (!apiKey) {
      throw new Error("Model provider API key is missing.");
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
    const baseURL = (askBaseURL || legacyChatBaseURL || provider.baseURL).replace(
      /\/+$/,
      ""
    );
    const model = askModel || legacyChatModel || provider.defaultAskModel;
    const contextProfile = `${await PLMainAPI.preferenceService.get(
      "askContextProfile"
    )}` as AskContextProfile;
    const contextConfig = this._askContextConfig(contextProfile);

    const semanticResults = await this._semanticSearchService.searchForAsk(
      trimmedQuestion,
      12
    );
    const focusedResults = (focusedPapers || [])
      .map((paper) => new Entity(paper))
      .filter((paper) => paper._id)
      .map((paper) => ({
        paper,
        contextText: "",
        distance: -1,
      }));
    const seenPaperIds = new Set<string>();
    const results = [...focusedResults, ...semanticResults]
      .filter(({ paper }) => {
        const id = `${paper._id}`;
        if (!id || seenPaperIds.has(id)) {
          return false;
        }
        seenPaperIds.add(id);
        return true;
      })
      .slice(0, 14);
    const focusedCount = focusedResults.length;
    const sourceContexts = new Map<string, IAskSourceContext>();
    const paperContexts = await Promise.all(
      results.map(async ({ paper, contextText }, index) => {
        const shouldLoadFulltext =
          index < focusedCount ||
          index < focusedCount + 4 ||
          !contextText;
        const cachedFulltext = shouldLoadFulltext
          ? await this._cacheService.loadFullText(paper, true)
          : "";
        const fulltext = cachedFulltext || contextText;
        const searchableText = fulltext || paper.abstract || paper.note || "";
        const fallbackText =
          [paper.abstract || "", paper.note || "", searchableText]
            .filter(Boolean)
            .join(" ");
        const quote = this._bestQuote(searchableText, trimmedQuestion);
        const excerptBudget = this._contextBudget(
          contextConfig,
          index,
          focusedCount,
          results.length
        );
        const relevantExcerpt = this._buildRelevantExcerpt(
          searchableText,
          trimmedQuestion,
          excerptBudget.maxChars,
          contextConfig.maxSentences
        );
        sourceContexts.set(`${paper._id}`, {
          fulltext: searchableText,
          fallbackText,
        });

        return {
          source: {
            id: `${paper._id}`,
            mainURL: paper.defaultSup
              ? paper.supplementaries?.[paper.defaultSup]?.url || ""
              : "",
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

    const terms = this._queryTerms(question);
    const sentences = this._textCandidates(normalized)
      .filter((sentence) => sentence.length >= 30);

    let bestSentence = sentences[0] || normalized.slice(0, 360);
    let bestScore = -1;
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      const compact = this._compactForMatch(sentence);
      const score = terms.reduce(
        (sum, term) => sum + (this._hasTerm(lower, compact, term) ? 1 : 0),
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

    const terms = this._queryTerms(query);

    const candidates = this._textCandidates(normalized)
      .filter((sentence) => sentence.length >= 24);

    const ranked = candidates
      .map((sentence, idx) => {
        const lower = sentence.toLowerCase();
        const compact = this._compactForMatch(sentence);
        const hitCount = terms.reduce(
          (sum, term) => sum + (this._hasTerm(lower, compact, term) ? 1 : 0),
          0
        );
        const numericHitCount = terms
          .filter((term) => /\d/.test(term))
          .reduce(
            (sum, term) => sum + (this._hasTerm(lower, compact, term) ? 1 : 0),
            0
          );
        const tableSignal =
          /(^|\s)(table|tab\.|benchmark|dataset|videomme|video-mme|score|accuracy|acc\.?|avg\.?|overall)(\s|$|:)/i.test(
            sentence
          ) || /\d+(?:\.\d+)?\s*%/.test(sentence)
            ? 1
            : 0;
        const density =
          terms.length > 0 ? hitCount / terms.length : 0;
        const lengthPenalty = Math.abs(sentence.length - 180) / 280;
        const score =
          hitCount * 2 +
          numericHitCount * 2.5 +
          tableSignal * 0.8 +
          density -
          lengthPenalty -
          idx * 0.0002;
        return { sentence: sentence.slice(0, 360), score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 240);

    return ranked.map((item) => item.sentence);
  }

  private _queryTerms(query: string): string[] {
    const normalizedQuery = `${query || ""}`.toLowerCase();
    const rawTerms = normalizedQuery
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
    const latinTerms = normalizedQuery.match(/[a-z][a-z0-9._-]*[a-z0-9]/gi) || [];
    const numericTerms = normalizedQuery.match(/\d+(?:\.\d+)?%?/g) || [];

    const expanded = new Set<string>();
    for (const term of [...rawTerms, ...latinTerms, ...numericTerms]) {
      expanded.add(term);
      const compact = this._compactForMatch(term);
      if (compact.length >= 2) {
        expanded.add(compact);
      }
    }

    return [...expanded];
  }

  private _compactForMatch(text: string): string {
    return `${text || ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "");
  }

  private _hasTerm(lowerText: string, compactText: string, term: string): boolean {
    if (!term) {
      return false;
    }

    return (
      lowerText.includes(term) ||
      compactText.includes(this._compactForMatch(term))
    );
  }

  private _textCandidates(text: string): string[] {
    const normalized = `${text || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }

    const sentenceCandidates = normalized
      .split(/(?<=[.!?。！？])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const windowCandidates: string[] = [];
    const windowChars = 900;
    const overlapChars = 240;
    for (let start = 0; start < normalized.length; start += windowChars - overlapChars) {
      let end = Math.min(start + windowChars, normalized.length);
      if (end < normalized.length) {
        const boundary = normalized.lastIndexOf(" ", end);
        if (boundary > start + 280) {
          end = boundary;
        }
      }
      const chunk = normalized.slice(start, end).trim();
      if (chunk) {
        windowCandidates.push(chunk);
      }
      if (end >= normalized.length) {
        break;
      }
    }

    const seen = new Set<string>();
    return [...sentenceCandidates, ...windowCandidates].filter((candidate) => {
      const key = candidate.slice(0, 240);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private _buildRelevantExcerpt(
    text: string,
    query: string,
    maxChars = 12000,
    maxSentences = 80
  ): string {
    const normalized = `${text || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }

    const priorityCandidates = this._keywordNeighborhoods(
      normalized,
      query,
      Math.min(maxChars, 8000)
    );
    const candidates = this._rankQuoteCandidates(normalized, query).slice(
      0,
      Math.max(10, maxSentences)
    );
    const picked: string[] = [];
    const seen = new Set<string>();
    let used = 0;

    for (const sentence of [...priorityCandidates, ...candidates]) {
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

  private _keywordNeighborhoods(
    text: string,
    query: string,
    maxChars: number
  ): string[] {
    const latinTerms = (`${query || ""}`.toLowerCase().match(
      /[a-z][a-z0-9._-]*[a-z0-9]/gi
    ) || [])
      .map((term) => this._compactForMatch(term))
      .filter((term) => term.length >= 3);

    if (latinTerms.length === 0) {
      return [];
    }

    const compactChars: string[] = [];
    const originalIndexes: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i].toLowerCase();
      if (/[a-z0-9\u4e00-\u9fa5]/i.test(char)) {
        compactChars.push(char);
        originalIndexes.push(i);
      }
    }

    const compactText = compactChars.join("");
    const neighborhoods: string[] = [];
    let usedChars = 0;

    for (const term of Array.from(new Set(latinTerms))) {
      let searchFrom = 0;
      let hits = 0;
      while (hits < 3) {
        const compactIndex = compactText.indexOf(term, searchFrom);
        if (compactIndex < 0) {
          break;
        }

        const originalIndex = originalIndexes[compactIndex] || 0;
        const start = Math.max(0, originalIndex - 900);
        const end = Math.min(text.length, originalIndex + 1600);
        const excerpt = text.slice(start, end).trim();
        if (excerpt) {
          const extra = excerpt.length + (neighborhoods.length ? 1 : 0);
          if (usedChars + extra > maxChars) {
            return neighborhoods;
          }
          neighborhoods.push(excerpt);
          usedChars += extra;
        }

        searchFrom = compactIndex + term.length;
        hits += 1;
      }
    }

    return neighborhoods;
  }

  private _contextBudget(
    config: IAskContextConfig,
    index: number,
    focusedCount: number,
    totalCount: number
  ) {
    if (index < focusedCount) {
      return {
        maxChars: Math.max(4000, Math.floor(config.focusedChars / Math.max(1, focusedCount))),
      };
    }

    const remainingCount = Math.max(1, totalCount - focusedCount);
    const remainingChars = Math.max(3000, config.totalChars - config.focusedChars);
    return {
      maxChars: Math.max(1800, Math.floor(remainingChars / remainingCount)),
    };
  }

  private _askContextConfig(profile: AskContextProfile): IAskContextConfig {
    switch (profile) {
      case "fast":
        return { totalChars: 10000, focusedChars: 7000, maxSentences: 45 };
      case "detailed":
        return { totalChars: 60000, focusedChars: 42000, maxSentences: 220 };
      case "balanced":
      default:
        return { totalChars: 24000, focusedChars: 16000, maxSentences: 120 };
    }
  }

  private async _getProviderPreset(scope: "ask" | "tag") {
    const key = scope === "tag" ? "tagModelProvider" : "askModelProvider";
    const providerID = `${await PLMainAPI.preferenceService.get(key)}`.trim();
    return getModelProviderPreset(providerID);
  }

  private async _resolveProviderAPIKey(
    providerID: string,
    scope: "ask" | "tag" | "embedding"
  ) {
    const scopedKey = await PLMainAPI.preferenceService.getPassword(
      `modelProviderApiKey:${scope}:${providerID}`
    );
    const providerKey = await PLMainAPI.preferenceService.getPassword(
      `modelProviderApiKey:${providerID}`
    );
    return (
      providerKey ||
      scopedKey ||
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.OPENAI_API_KEY ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      ""
    );
  }

  async suggestTags(paper: {
    title: string;
    authors?: string;
    year?: string;
    publication?: string;
    abstract?: string;
    existingTags?: string[];
  }): Promise<string[]> {
    const provider = await this._getProviderPreset("tag");
    const apiKey = await this._resolveProviderAPIKey(provider.id, "tag");
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
    const baseURL = (tagBaseURL || legacyChatBaseURL || provider.baseURL).replace(
      /\/+$/,
      ""
    );
    const model = tagModel || legacyChatModel || provider.defaultAskModel;

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
