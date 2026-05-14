import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { getPublicationString } from "@/base/string";
import { getModelProviderPreset } from "@/common/model-provider-registry";
import { ILogService, LogService } from "@/common/services/log-service";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { Entity } from "@/models/entity";
import { CacheService, ICacheService } from "./cache-service";
import {
  ISemanticSearchService,
  SemanticSearchService,
} from "./semantic-search-service";

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

export type ExperimentCompareDirection = "higher" | "lower" | "neutral";
export type ExperimentCompareRowRole =
  | "proposed"
  | "baseline"
  | "ablation"
  | "other";

export interface ExperimentCompareColumn {
  id: string;
  group: string;
  label: string;
  metric?: string;
  dataset?: string;
  direction?: ExperimentCompareDirection;
}

export interface ExperimentComparePaper {
  id: string;
  title: string;
  authors: string;
  year: string;
  publication: string;
}

export interface ExperimentCompareRow {
  id: string;
  paperId: string;
  paperIndex: number;
  paperTitle: string;
  method: string;
  role: ExperimentCompareRowRole;
  setting: string;
  values: Record<string, string>;
  best: Record<string, boolean>;
  source: string;
  notes: string;
}

export interface ExperimentCompareResult {
  title: string;
  papers: ExperimentComparePaper[];
  columns: ExperimentCompareColumn[];
  rows: ExperimentCompareRow[];
  notes: string[];
  warnings: string[];
  latex: string;
  generatedAt: string;
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

const EMPTY_EXPERIMENT_COMPARE_RESULT: ExperimentCompareResult = {
  title: "Experiment Comparison",
  papers: [],
  columns: [],
  rows: [],
  notes: [],
  warnings: ["No experiment comparison was generated."],
  latex: "",
  generatedAt: "",
};

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
            `${await PLMainAPI.preferenceService.get(
              "embeddingModelProvider"
            )}`.trim()
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
  async ask(
    question: string,
    focusedPapers: Entity[] = []
  ): Promise<AskAnswer> {
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
    const baseURL = (
      askBaseURL ||
      legacyChatBaseURL ||
      provider.baseURL
    ).replace(/\/+$/, "");
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
          index < focusedCount || index < focusedCount + 4 || !contextText;
        const cachedFulltext = shouldLoadFulltext
          ? await this._cacheService.loadFullText(paper, true)
          : "";
        const fulltext = cachedFulltext || contextText;
        const searchableText = fulltext || paper.abstract || paper.note || "";
        const fallbackText = [
          paper.abstract || "",
          paper.note || "",
          searchableText,
        ]
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
    const context = paperContexts.map(({ context }) => context).join("\n\n");

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
            content: [
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
      throw new Error(
        `Qwen chat API failed: ${response.status} ${await response.text()}`
      );
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
      const quoteCandidates = (
        queriesForSource.length ? queriesForSource : [trimmedQuestion]
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

  @processing(ProcessingKey.General)
  @errorcatching(
    "Failed to compare paper experiments.",
    true,
    "AskService",
    EMPTY_EXPERIMENT_COMPARE_RESULT
  )
  async compareExperiments(
    focusedPapers: Entity[] = [],
    instruction = ""
  ): Promise<ExperimentCompareResult> {
    const papers = (focusedPapers || [])
      .map((paper) => new Entity(paper))
      .filter((paper) => paper._id)
      .slice(0, 6);

    if (papers.length < 2) {
      return {
        ...EMPTY_EXPERIMENT_COMPARE_RESULT,
        papers: this._experimentComparePapers(papers),
        warnings: ["Select at least two papers to compare experiments."],
        generatedAt: new Date().toISOString(),
      };
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
    const baseURL = (
      askBaseURL ||
      legacyChatBaseURL ||
      provider.baseURL
    ).replace(/\/+$/, "");
    const model = askModel || legacyChatModel || provider.defaultAskModel;
    const contextProfile = `${await PLMainAPI.preferenceService.get(
      "askContextProfile"
    )}` as AskContextProfile;
    const perPaperBudget = this._experimentContextBudget(contextProfile);
    const paperContexts = await Promise.all(
      papers.map(async (paper, index) => {
        const cachedFulltext = await this._cacheService.loadFullText(
          paper,
          true
        );
        const fallbackText = [
          paper.abstract ? `Abstract:\n${paper.abstract}` : "",
          paper.note ? `Notes:\n${paper.note}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const searchableText = cachedFulltext || fallbackText;
        const experimentEvidence = this._buildExperimentEvidence(
          searchableText,
          perPaperBudget
        );

        return [
          `Paper [${index + 1}]`,
          `ID: ${paper._id}`,
          `Title: ${paper.title}`,
          `Authors: ${paper.authors}`,
          `Year: ${paper.year}`,
          `Publication: ${getPublicationString(paper)}`,
          paper.abstract ? `Abstract: ${paper.abstract}` : "",
          "Experiment evidence extracted from full text:",
          experimentEvidence || searchableText.slice(0, perPaperBudget),
        ]
          .filter(Boolean)
          .join("\n");
      })
    );

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
            content: [
              "You are PaperMind Experiment Compare.",
              "Extract experimental results, baselines, datasets, metrics, settings, and sources from the provided paper context only.",
              "Return only valid JSON. Do not use markdown fences.",
              "Do not invent results. Use '-' for missing values.",
              "The provided context preserves PDF table rows with tabs and line breaks. Treat numeric table-like blocks as primary evidence.",
              "If a number is visible in a table-like block, copy it into the matching dataset/metric cell instead of using '-'.",
              "Before returning, check whether the table-like blocks contain numeric scores; an all '-' table is only acceptable when no numeric scores are visible anywhere.",
              "Prefer directly comparable dataset + metric columns, but include important paper-specific columns when needed.",
              "Keep rows in paper order, and include both proposed methods and baselines when they are present.",
              "Use concise source strings such as '[1] Table 2, Page 7' when page or table evidence is visible.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              "Build a paper-style experiment comparison table for these selected papers.",
              instruction ? `User instruction: ${instruction}` : "",
              "JSON schema:",
              JSON.stringify({
                title: "short table title",
                columns: [
                  {
                    id: "unique_ascii_id",
                    group: "Dataset or benchmark group",
                    label: "Metric/subset label",
                    metric: "metric name",
                    dataset: "dataset name",
                    direction: "higher|lower|neutral",
                  },
                ],
                rows: [
                  {
                    paperIndex: 1,
                    method: "method or baseline name",
                    role: "proposed|baseline|ablation|other",
                    setting:
                      "experimental setting such as retention ratio, split, model size",
                    values: { unique_ascii_id: "reported score or '-'" },
                    source: "[1] Table 2, Page 7",
                    notes: "short caveat or empty string",
                  },
                ],
                notes: [
                  "brief comparability notes, especially if settings differ",
                ],
                warnings: ["uncertainties or missing evidence"],
                latex: "optional booktabs tabular string",
              }),
              "Paper context:",
              paperContexts.join("\n\n---\n\n"),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Experiment compare API failed: ${
          response.status
        } ${await response.text()}`
      );
    }

    const content =
      (await response.json())?.choices?.[0]?.message?.content || "";
    try {
      const parsed = this._parseExperimentCompareJSON(content);
      return this._normalizeExperimentCompareResult(parsed, papers);
    } catch (error) {
      return {
        ...EMPTY_EXPERIMENT_COMPARE_RESULT,
        papers: this._experimentComparePapers(papers),
        warnings: [
          `Experiment compare response was not valid JSON: ${
            (error as Error).message
          }`,
        ],
        generatedAt: new Date().toISOString(),
      };
    }
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
    const sentences = this._textCandidates(normalized).filter(
      (sentence) => sentence.length >= 30
    );

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
    const candidates = this._rankQuoteCandidates(
      fulltext || fallbackText,
      query
    );
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

    const candidates = this._textCandidates(normalized).filter(
      (sentence) => sentence.length >= 24
    );

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
        const density = terms.length > 0 ? hitCount / terms.length : 0;
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
    const latinTerms =
      normalizedQuery.match(/[a-z][a-z0-9._-]*[a-z0-9]/gi) || [];
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

  private _hasTerm(
    lowerText: string,
    compactText: string,
    term: string
  ): boolean {
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
    for (
      let start = 0;
      start < normalized.length;
      start += windowChars - overlapChars
    ) {
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
    const latinTerms = (
      `${query || ""}`.toLowerCase().match(/[a-z][a-z0-9._-]*[a-z0-9]/gi) || []
    )
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
        maxChars: Math.max(
          4000,
          Math.floor(config.focusedChars / Math.max(1, focusedCount))
        ),
      };
    }

    const remainingCount = Math.max(1, totalCount - focusedCount);
    const remainingChars = Math.max(
      3000,
      config.totalChars - config.focusedChars
    );
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

  private _experimentContextBudget(profile: AskContextProfile) {
    switch (profile) {
      case "fast":
        return 22000;
      case "detailed":
        return 52000;
      case "balanced":
      default:
        return 34000;
    }
  }

  private _buildExperimentEvidence(text: string, maxChars: number) {
    const normalized = this._normalizeExperimentText(text);
    if (!normalized || normalized.length <= maxChars) {
      return normalized;
    }

    const tableBlocksBudget = Math.floor(maxChars * 0.68);
    const pageBudget = Math.floor(maxChars * 0.22);
    const excerptBudget = Math.max(
      2000,
      maxChars - tableBlocksBudget - pageBudget
    );
    const tableBlocks = this._extractExperimentTableBlocks(
      normalized,
      tableBlocksBudget
    );
    const experimentPages = this._extractExperimentPages(
      normalized,
      pageBudget
    );
    const relevantExcerpt = this._buildExperimentExcerpt(
      normalized,
      excerptBudget
    );

    return [
      tableBlocks
        ? "Detected table-like numeric experiment blocks:\n" + tableBlocks
        : "",
      experimentPages ? "High-score experiment pages:\n" + experimentPages : "",
      relevantExcerpt
        ? "Additional experiment excerpt:\n" + relevantExcerpt
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private _normalizeExperimentText(text: string) {
    return `${text || ""}`
      .replace(/\r\n/g, "\n")
      .replace(/\t+/g, "\t")
      .replace(/[ \f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private _buildExperimentExcerpt(text: string, maxChars: number) {
    const normalized = this._normalizeExperimentText(text);

    if (!normalized || normalized.length <= maxChars) {
      return normalized;
    }

    const lines = normalized.split("\n");
    const scoredLines = lines
      .map((line, index) => {
        const lower = line.toLowerCase();
        let score = 0;
        if (/\b(table|tab\.|figure|fig\.)\b/i.test(line)) score += 4;
        if (
          /\b(experiment|evaluation|benchmark|dataset|metric|baseline|ablation|result|performance)\b/i.test(
            line
          )
        )
          score += 3;
        if (
          /\b(accuracy|acc\.?|f1|auc|auroc|ap|map|bleu|rouge|meteor|cider|wer|cer|mse|mae|rmse|loss|ppl|perplexity|score|avg\.?|overall)\b/i.test(
            line
          )
        )
          score += 3;
        if (/\d+(?:\.\d+)?\s*(?:%|\u00b1|\+\/-|\/)?/.test(line)) score += 1;
        if (this._looksLikeNumericTableLine(line)) score += 5;
        if (lower.includes("page ")) score += 0.4;
        return { index, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const pickedRanges: Array<{ start: number; end: number }> = [];
    const used = new Set<number>();
    let usedChars = 0;

    for (const item of scoredLines) {
      const line = lines[item.index] || "";
      const isCaption = /\b(table|tab\.)\s*\d+/i.test(line);
      const start = Math.max(0, item.index - (isCaption ? 8 : 14));
      const end = Math.min(lines.length, item.index + (isCaption ? 120 : 42));
      let rangeChars = 0;
      for (let i = start; i < end; i += 1) {
        if (!used.has(i)) {
          rangeChars += lines[i].length + 1;
        }
      }
      if (usedChars + rangeChars > maxChars && pickedRanges.length > 0) {
        continue;
      }
      pickedRanges.push({ start, end });
      for (let i = start; i < end; i += 1) {
        if (!used.has(i)) {
          used.add(i);
          usedChars += lines[i].length + 1;
        }
      }
      if (usedChars >= maxChars) {
        break;
      }
    }

    if (pickedRanges.length === 0) {
      return normalized.slice(0, maxChars);
    }

    const mergedRanges = pickedRanges
      .sort((a, b) => a.start - b.start)
      .reduce<Array<{ start: number; end: number }>>((ranges, range) => {
        const last = ranges[ranges.length - 1];
        if (last && range.start <= last.end + 2) {
          last.end = Math.max(last.end, range.end);
        } else {
          ranges.push({ ...range });
        }
        return ranges;
      }, []);

    let excerpt = mergedRanges
      .map((range) => lines.slice(range.start, range.end).join("\n").trim())
      .filter(Boolean)
      .join("\n\n[...]\n\n");

    if (excerpt.length > maxChars) {
      excerpt = excerpt.slice(0, maxChars);
    }

    return excerpt;
  }

  private _extractExperimentTableBlocks(text: string, maxChars: number) {
    const lines = text.split("\n");
    const scoredLines = lines
      .map((line, index) => ({
        index,
        score: this._scoreExperimentTableLine(line),
      }))
      .filter((item) => item.score >= 5)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const ranges: Array<{ start: number; end: number }> = [];
    let usedChars = 0;

    for (const item of scoredLines) {
      const line = lines[item.index] || "";
      const caption = /\b(table|tab\.)\s*\d+/i.test(line);
      const numericTableLine = this._looksLikeNumericTableLine(line);
      const start = Math.max(0, item.index - (caption ? 6 : 12));
      const end = Math.min(
        lines.length,
        item.index + (caption ? 140 : numericTableLine ? 56 : 32)
      );
      const rangeChars = this._rangeChars(lines, start, end);
      if (usedChars + rangeChars > maxChars && ranges.length > 0) {
        continue;
      }
      ranges.push({ start, end });
      usedChars += rangeChars;
      if (usedChars >= maxChars) {
        break;
      }
    }

    return this._rangesToText(lines, ranges, maxChars);
  }

  private _extractExperimentPages(text: string, maxChars: number) {
    const pageMatches = [...text.matchAll(/^\[Page\s+(\d+)\]\s*$/gim)];
    if (pageMatches.length === 0) {
      return "";
    }

    const pages = pageMatches
      .map((match, index) => {
        const start = match.index || 0;
        const end =
          index + 1 < pageMatches.length
            ? pageMatches[index + 1].index || text.length
            : text.length;
        const content = text.slice(start, end).trim();
        return {
          page: match[1],
          content,
          score: this._scoreExperimentPage(content),
        };
      })
      .filter((page) => page.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.page) - Number(b.page));

    const picked: string[] = [];
    let used = 0;
    for (const page of pages) {
      const block = page.content;
      const extra = block.length + (picked.length ? 12 : 0);
      if (used + extra > maxChars && picked.length > 0) {
        continue;
      }
      picked.push(block);
      used += extra;
      if (used >= maxChars) {
        break;
      }
    }

    return picked.join("\n\n[...]\n\n").slice(0, maxChars);
  }

  private _scoreExperimentPage(page: string) {
    const lines = page.split("\n");
    let score = 0;
    for (const line of lines) {
      score += this._scoreExperimentTableLine(line);
    }
    if (/\b(table|tab\.)\s*\d+/i.test(page)) score += 12;
    if (
      /\b(mvbench|video[\s-]*mme|egoschema|videochatgpt|llava|qwen|st-llm|pllava)\b/i.test(
        page
      )
    ) {
      score += 10;
    }
    return score;
  }

  private _scoreExperimentTableLine(line: string) {
    const lower = line.toLowerCase();
    let score = 0;
    if (/\b(table|tab\.)\s*\d+/i.test(line)) score += 10;
    else if (/\b(table|tab\.)\b/i.test(line)) score += 5;
    if (
      /\b(experiment|evaluation|benchmark|dataset|metric|baseline|ablation|result|performance|comparison)\b/i.test(
        line
      )
    ) {
      score += 4;
    }
    if (
      /\b(method|model|setting|ratio|retention|tokens?|frames?|speed|flops|memory)\b/i.test(
        line
      )
    ) {
      score += 3;
    }
    if (
      /\b(mvbench|video[\s-]*mme|egoschema|videochatgpt|longvideo|mmbench|mme|seed|gqa|textvqa|pope|vqav2|okvqa|sqa|llava|qwen|pllava|st-llm)\b/i.test(
        line
      )
    ) {
      score += 5;
    }
    if (
      /\b(accuracy|acc\.?|f1|auc|auroc|ap|map|bleu|rouge|meteor|cider|wer|cer|mse|mae|rmse|loss|ppl|perplexity|score|avg\.?|overall|rel\.)\b/i.test(
        line
      )
    ) {
      score += 4;
    }
    if (this._looksLikeNumericTableLine(line)) score += 8;
    if (
      /\b(vanilla|baseline|ours|proposed|fastv|visionzip|fastvid|flashvid|prunevid)\b/i.test(
        line
      )
    ) {
      score += 4;
    }
    if (lower.includes("[page ")) score += 1;
    return score;
  }

  private _looksLikeNumericTableLine(line: string) {
    const numbers =
      line.match(/(?<![a-z])-?\d+(?:\.\d+)?(?:\s*%|\s*x)?/gi) || [];
    if (numbers.length >= 3) {
      return true;
    }

    const cells = line
      .split(/\t| {2,}/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    return (
      cells.length >= 4 &&
      numbers.length >= 2 &&
      cells.some((cell) => /[a-z][a-z0-9.+/-]*/i.test(cell))
    );
  }

  private _rangeChars(lines: string[], start: number, end: number) {
    let chars = 0;
    for (let index = start; index < end; index += 1) {
      chars += (lines[index] || "").length + 1;
    }
    return chars;
  }

  private _rangesToText(
    lines: string[],
    ranges: Array<{ start: number; end: number }>,
    maxChars: number
  ) {
    if (ranges.length === 0) {
      return "";
    }

    const mergedRanges = ranges
      .sort((a, b) => a.start - b.start)
      .reduce<Array<{ start: number; end: number }>>((merged, range) => {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end + 3) {
          last.end = Math.max(last.end, range.end);
        } else {
          merged.push({ ...range });
        }
        return merged;
      }, []);

    return mergedRanges
      .map((range) => lines.slice(range.start, range.end).join("\n").trim())
      .filter(Boolean)
      .join("\n\n[...]\n\n")
      .slice(0, maxChars);
  }

  private _parseExperimentCompareJSON(content: string) {
    const trimmed = `${content || ""}`.trim();
    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(unfenced);
    } catch {
      const start = unfenced.indexOf("{");
      const end = unfenced.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(unfenced.slice(start, end + 1));
      }
      throw new Error("Experiment compare response was not valid JSON.");
    }
  }

  private _normalizeExperimentCompareResult(
    parsed: any,
    papers: Entity[]
  ): ExperimentCompareResult {
    const paperSummaries = this._experimentComparePapers(papers);
    const rawColumns = Array.isArray(parsed?.columns) ? parsed.columns : [];
    const columns = this._normalizeExperimentColumns(rawColumns, parsed?.rows);
    const rows = this._normalizeExperimentRows(parsed?.rows, columns, papers);
    const rowsWithBest = this._markBestExperimentValues(rows, columns);
    const warnings = this._stringArray(parsed?.warnings);
    const hasReportedValue = rowsWithBest.some((row) =>
      Object.values(row.values || {}).some(
        (value) => `${value || ""}`.trim() && `${value || ""}`.trim() !== "-"
      )
    );

    if (columns.length === 0 || rowsWithBest.length === 0) {
      warnings.push(
        "No explicit experimental result table could be extracted from the selected context."
      );
    } else if (!hasReportedValue) {
      warnings.push(
        "No numeric metric values were extracted. The full-text table candidates may not have been aligned to the requested benchmarks."
      );
    }

    return {
      title:
        `${parsed?.title || "Experiment Comparison"}`.trim() ||
        "Experiment Comparison",
      papers: paperSummaries,
      columns,
      rows: rowsWithBest,
      notes: this._stringArray(parsed?.notes),
      warnings,
      latex: this._buildExperimentLatex(columns, rowsWithBest),
      generatedAt: new Date().toISOString(),
    };
  }

  private _experimentComparePapers(papers: Entity[]): ExperimentComparePaper[] {
    return papers.map((paper) => ({
      id: `${paper._id}`,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      publication: getPublicationString(paper),
    }));
  }

  private _normalizeExperimentColumns(rawColumns: any[], rawRows: any) {
    const columns: ExperimentCompareColumn[] = [];
    const seenIds = new Set<string>();

    for (let index = 0; index < rawColumns.length; index += 1) {
      const rawColumn = rawColumns[index] || {};
      let id = this._normalizeColumnId(
        rawColumn.id || rawColumn.label || `metric_${index + 1}`
      );
      if (!id || seenIds.has(id)) {
        id = `metric_${index + 1}`;
      }
      while (seenIds.has(id)) {
        id = `${id}_${index + 1}`;
      }
      seenIds.add(id);

      const label = `${rawColumn.label || rawColumn.metric || id}`.trim() || id;
      const metric = `${rawColumn.metric || label}`.trim();
      const group =
        `${rawColumn.group || rawColumn.dataset || "Results"}`.trim() ||
        "Results";
      const rawDirection = `${rawColumn.direction || ""}`.toLowerCase();
      const direction: ExperimentCompareDirection =
        rawDirection === "lower" ||
        rawDirection === "higher" ||
        rawDirection === "neutral"
          ? rawDirection
          : this._metricDirection(metric || label);

      columns.push({
        id,
        group,
        label,
        metric,
        dataset: `${rawColumn.dataset || group}`.trim(),
        direction,
      });
    }

    if (columns.length > 0 || !Array.isArray(rawRows)) {
      return columns;
    }

    const valueIds = new Set<string>();
    for (const row of rawRows) {
      for (const key of Object.keys(row?.values || {})) {
        valueIds.add(key);
      }
    }

    return [...valueIds].map((id, index) => ({
      id: this._normalizeColumnId(id) || `metric_${index + 1}`,
      group: "Results",
      label: `${id}`,
      metric: `${id}`,
      dataset: "Results",
      direction: this._metricDirection(`${id}`),
    }));
  }

  private _normalizeExperimentRows(
    rawRows: any,
    columns: ExperimentCompareColumn[],
    papers: Entity[]
  ): ExperimentCompareRow[] {
    if (!Array.isArray(rawRows)) {
      return [];
    }

    const columnIds = new Set(columns.map((column) => column.id));
    return rawRows.map((rawRow, index) => {
      const paperIndex = Math.min(
        Math.max(Number(rawRow?.paperIndex || rawRow?.paper_index || 1), 1),
        Math.max(1, papers.length)
      );
      const paper = papers[paperIndex - 1] || papers[0];
      const values: Record<string, string> = {};
      for (const column of columns) {
        const rawValue = rawRow?.values?.[column.id];
        values[column.id] =
          rawValue === undefined ||
          rawValue === null ||
          `${rawValue}`.trim() === ""
            ? "-"
            : `${rawValue}`.trim();
      }
      for (const [key, value] of Object.entries(rawRow?.values || {})) {
        const normalizedKey = this._normalizeColumnId(key);
        if (!columnIds.has(normalizedKey)) {
          continue;
        }
        values[normalizedKey] =
          value === undefined || value === null || `${value}`.trim() === ""
            ? "-"
            : `${value}`.trim();
      }

      const rawRole = `${rawRow?.role || "other"}`.toLowerCase();
      const role: ExperimentCompareRowRole =
        rawRole === "proposed" ||
        rawRole === "baseline" ||
        rawRole === "ablation" ||
        rawRole === "other"
          ? rawRole
          : "other";

      return {
        id: `row_${index + 1}`,
        paperId: `${paper?._id || ""}`,
        paperIndex,
        paperTitle: paper?.title || "",
        method: `${rawRow?.method || "Unknown"}`.trim() || "Unknown",
        role,
        setting: `${rawRow?.setting || ""}`.trim(),
        values,
        best: {},
        source: `${rawRow?.source || ""}`.trim(),
        notes: `${rawRow?.notes || ""}`.trim(),
      };
    });
  }

  private _markBestExperimentValues(
    rows: ExperimentCompareRow[],
    columns: ExperimentCompareColumn[]
  ): ExperimentCompareRow[] {
    const bestByColumn = new Map<string, number>();

    for (const column of columns) {
      const direction = column.direction || "higher";
      if (direction === "neutral") {
        continue;
      }

      let bestValue: number | null = null;
      for (const row of rows) {
        const value = this._numericExperimentValue(row.values[column.id]);
        if (value === null) {
          continue;
        }

        if (
          bestValue === null ||
          (direction === "higher" && value > bestValue) ||
          (direction === "lower" && value < bestValue)
        ) {
          bestValue = value;
        }
      }

      if (bestValue !== null) {
        bestByColumn.set(column.id, bestValue);
      }
    }

    return rows.map((row) => {
      const best: Record<string, boolean> = {};
      for (const column of columns) {
        const target = bestByColumn.get(column.id);
        const value = this._numericExperimentValue(row.values[column.id]);
        best[column.id] =
          target !== undefined &&
          value !== null &&
          Math.abs(value - target) < 1e-9;
      }
      return { ...row, best };
    });
  }

  private _buildExperimentLatex(
    columns: ExperimentCompareColumn[],
    rows: ExperimentCompareRow[]
  ) {
    if (columns.length === 0 || rows.length === 0) {
      return "";
    }

    const escapeLatex = (value: string) =>
      `${value || "-"}`
        .replace(/\\/g, "\\textbackslash{}")
        .replace(/&/g, "\\&")
        .replace(/%/g, "\\%")
        .replace(/\$/g, "\\$")
        .replace(/#/g, "\\#")
        .replace(/_/g, "\\_")
        .replace(/\{/g, "\\{")
        .replace(/\}/g, "\\}")
        .replace(/\^/g, "\\textasciicircum{}")
        .replace(/~/g, "\\textasciitilde{}");
    const align = ["l", "l", "l", ...columns.map(() => "c")].join(" ");
    const header = [
      "Paper",
      "Method",
      "Setting",
      ...columns.map((column) =>
        column.group && column.group !== column.label
          ? `${column.group} ${column.label}`
          : column.label
      ),
    ];
    const lines = [
      `\\begin{tabular}{${align}}`,
      "\\toprule",
      `${header.map(escapeLatex).join(" & ")} \\\\`,
      "\\midrule",
      ...rows.map((row) => {
        const cells = [
          `[${row.paperIndex}]`,
          row.method,
          row.setting || "-",
          ...columns.map((column) => row.values[column.id] || "-"),
        ];
        return `${cells.map(escapeLatex).join(" & ")} \\\\`;
      }),
      "\\bottomrule",
      "\\end{tabular}",
    ];
    return lines.join("\n");
  }

  private _numericExperimentValue(value: string) {
    const normalized = `${value || ""}`
      .replace(/\*\*/g, "")
      .replace(/,/g, "")
      .trim();
    if (!normalized || normalized === "-") {
      return null;
    }

    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  private _metricDirection(metric: string): ExperimentCompareDirection {
    const normalized = `${metric || ""}`.toLowerCase();
    if (
      /\b(loss|error|err|wer|cer|perplexity|ppl|mse|rmse|mae|fid|ece|latency|time|params|flops|memory)\b/.test(
        normalized
      )
    ) {
      return "lower";
    }
    return "higher";
  }

  private _normalizeColumnId(value: string) {
    const normalized = `${value || ""}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized || "";
  }

  private _stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => `${item || ""}`.trim()).filter(Boolean);
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
    const baseURL = (
      tagBaseURL ||
      legacyChatBaseURL ||
      provider.baseURL
    ).replace(/\/+$/, "");
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
            content: [
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

    const content =
      (await response.json())?.choices?.[0]?.message?.content || "[]";
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
