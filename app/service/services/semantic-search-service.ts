import { Pool } from "pg";

import fs from "fs/promises";
import path from "path";
import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { Entity } from "@/models/entity";
import { OID } from "@/models/id";
import { DatabaseCore, IDatabaseCore } from "@/service/services/database/core";
import {
  IPaperEntityRepository,
  PaperEntityRepository,
} from "../repositories/db-repository/paper-entity-repository";
import { ILogService, LogService } from "@/common/services/log-service";
import { getPublicationString } from "@/base/string";
import { CacheService, ICacheService } from "./cache-service";

export const ISemanticSearchService = createDecorator("semanticSearchService");

interface ISemanticSearchRow {
  id: string;
  title: string | null;
  abstract: string | null;
  authors: string[] | null;
  categories: string[] | null;
  year: string | null;
  publication: string | null;
  distance: number;
}

interface ILocalSemanticIndexItem {
  id: string;
  embedding: number[];
  updatedAt: string;
}

interface ILocalSemanticIndex {
  version: 1;
  embeddingModel: string;
  embeddingDimensions: number;
  papers: ILocalSemanticIndexItem[];
  searchHistory: Array<{
    query: string;
    topK: number;
    resultCount: number;
    createdAt: string;
  }>;
}

/**
 * Semantic search backed by Qwen embeddings.
 * Defaults to a local JSON vector index so packaged builds work out of the box.
 * If semanticSearchPostgresURL is configured, PostgreSQL pgvector is used instead.
 */
export class SemanticSearchService extends Eventable<{}> {
  private _pool?: Pool;
  private _poolConnectionString = "";

  constructor(
    @IDatabaseCore private readonly _databaseCore: DatabaseCore,
    @IPaperEntityRepository
    private readonly _paperEntityRepository: PaperEntityRepository,
    @ICacheService private readonly _cacheService: CacheService,
    @ILogService private readonly _logService: LogService
  ) {
    super("semanticSearchService", {});
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to run semantic search.", true, "SemanticSearch", [])
  async search(query: string, topK = 20): Promise<Entity[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    if (!(await this._isEnabled())) {
      this._logService.warn(
        "Semantic search is not configured.",
        "Configure a Qwen embedding API key.",
        true,
        "SemanticSearch"
      );
      return [];
    }

    const embedding = await this._embed(trimmedQuery);
    const rows = (await this._hasPostgresURL())
      ? await this._searchPgVector(trimmedQuery, embedding, topK)
      : await this._searchLocalVector(trimmedQuery, embedding, topK);

    const realmIds = rows
      .map((row) => row.id)
      .filter((id) => /^[a-fA-F0-9]{24}$/.test(id));

    if (realmIds.length > 0) {
      const realm = await this._databaseCore.realm();
      const realmObjects = Array.from(
        this._paperEntityRepository.loadByIds(realm, realmIds as unknown as OID[])
      );
      const byId = new Map(realmObjects.map((entity) => [`${entity._id}`, entity]));
      const ordered = realmIds
        .map((id) => byId.get(`${id}`))
        .filter((entity) => entity !== undefined) as Entity[];

      if (ordered.length > 0) {
        return ordered;
      }
    }

    return rows.map(
      (row) =>
        new Entity({
          _id: /^[a-fA-F0-9]{24}$/.test(row.id) ? (row.id as OID) : undefined,
          title: row.title || "",
          abstract: row.abstract || undefined,
          authors: (row.authors || []).join(", "),
          year: row.year || "",
          journal: row.publication || undefined,
          tags: (row.categories || []).map((name) => ({ name })),
        })
    );
  }

  @processing(ProcessingKey.General)
  @errorcatching(
    "Failed to rebuild semantic search index.",
    true,
    "SemanticSearch",
    { indexed: 0 }
  )
  async rebuildIndex(
    batchSize = 10
  ): Promise<{ indexed: number; total: number; error?: string }> {
    try {
      await this._ensureConfigured();
      if (await this._hasPostgresURL()) {
        await this._ensureSchema();
      }

      const realm = await this._databaseCore.realm();
      let paperEntities = Array.from(
        this._paperEntityRepository.load(realm, "", "addTime", "desc")
      ).map((entity) => new Entity(entity));

      if (paperEntities.length === 0) {
        paperEntities = Array.from(realm.objects<Entity>("Entity"))
          .map((entity) => new Entity(entity))
          .filter((entity) => entity.title || entity.abstract);
      }

      let indexed = 0;
      for (let i = 0; i < paperEntities.length; i += batchSize) {
        indexed += await this._indexEntities(
          paperEntities.slice(i, i + batchSize)
        );

        this._logService.progress(
          "Rebuilding semantic index...",
          paperEntities.length === 0
            ? 100
            : (indexed / paperEntities.length) * 100,
          true,
          "SemanticSearch"
        );
      }

      this._logService.info(
        "Semantic index rebuilt.",
        `${indexed} / ${paperEntities.length} paper(s) indexed.`,
        true,
        "SemanticSearch"
      );

      return { indexed, total: paperEntities.length };
    } catch (error) {
      const message = `${(error as Error).message}`;
      this._logService.error(
        "Failed to rebuild semantic search index.",
        message,
        true,
        "SemanticSearch"
      );

      return { indexed: 0, total: 0, error: message };
    }
  }

  async indexEntities(paperEntities: Entity[]): Promise<{ indexed: number }> {
    if (!(await this._isEnabled())) {
      return { indexed: 0 };
    }
    await this._ensureConfigured();
    if (await this._hasPostgresURL()) {
      await this._ensureSchema();
    }
    return { indexed: await this._indexEntities(paperEntities.map((p) => new Entity(p))) };
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to test semantic search settings.", true, "SemanticSearch", false)
  async testSettings() {
    await this._ensureConfigured();
    if (await this._hasPostgresURL()) {
      await this._ensureSchema();
    }
    await this._embed("paperlib semantic search configuration test");
    await PLMainAPI.preferenceService.set({ semanticSearchEnabled: true });
    return true;
  }

  private async _embed(query: string) {
    const embeddings = await this._embedBatch([query]);
    return embeddings[0];
  }

  private async _embedBatch(inputs: string[]) {
    if (inputs.length > 10) {
      const embeddings: number[][] = [];
      for (let i = 0; i < inputs.length; i += 10) {
        embeddings.push(...(await this._embedBatch(inputs.slice(i, i + 10))));
      }
      return embeddings;
    }

    inputs = inputs.map((input) => this._normalizeEmbeddingInput(input));

    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Missing Qwen embedding API key. Save it as password key 'qwenEmbedding' or set DASHSCOPE_API_KEY."
      );
    }

    const baseURL = `${await PLMainAPI.preferenceService.get(
      "qwenEmbeddingBaseURL"
    )}`.replace(/\/+$/, "");
    const model = `${await PLMainAPI.preferenceService.get(
      "qwenEmbeddingModel"
    )}`;
    const dimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );

    const response = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: inputs.length === 1 ? inputs[0] : inputs,
        dimensions,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Qwen embedding API failed: ${response.status} ${await response.text()}`
      );
    }

    const body = await response.json();
    const embeddings = body?.data?.map((item: { embedding: number[] }) => item.embedding);
    if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) {
      throw new Error("Qwen embedding API returned no embedding vector.");
    }

    return embeddings.map((embedding: number[]) =>
      embedding.map((value) => Number(value))
    );
  }

  private async _isEnabled() {
    if (await PLMainAPI.preferenceService.get("semanticSearchEnabled")) {
      return true;
    }

    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";

    return Boolean(apiKey);
  }

  private async _hasPostgresURL() {
    const connectionString =
      `${await PLMainAPI.preferenceService.get("semanticSearchPostgresURL")}` ||
      process.env.PAPERMIND_SEMANTIC_PG_URL ||
      "";

    return Boolean(connectionString.trim());
  }

  private async _searchLocalVector(
    query: string,
    embedding: number[],
    topK: number
  ): Promise<ISemanticSearchRow[]> {
    const index = await this._loadLocalIndex();
    const ranked = index.papers
      .map((paper) => ({
        id: paper.id,
        distance: this._cosineDistance(embedding, paper.embedding),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK);

    index.searchHistory.unshift({
      query,
      topK,
      resultCount: ranked.length,
      createdAt: new Date().toISOString(),
    });
    index.searchHistory = index.searchHistory.slice(0, 200);
    await this._saveLocalIndex(index);

    const realm = await this._databaseCore.realm();
    const ids = ranked
      .map((row) => row.id)
      .filter((id) => /^[a-fA-F0-9]{24}$/.test(id)) as unknown as OID[];
    const realmObjects =
      ids.length > 0
        ? Array.from(this._paperEntityRepository.loadByIds(realm, ids))
        : [];
    const byId = new Map(realmObjects.map((entity) => [`${entity._id}`, entity]));

    const rows: ISemanticSearchRow[] = [];
    for (const row of ranked) {
        const entity = byId.get(row.id);
        if (!entity) {
          continue;
        }

        rows.push({
          id: row.id,
          title: entity.title,
          abstract: entity.abstract || null,
          authors: this._splitAuthors(entity.authors),
          categories: this._categories(entity),
          year: entity.year || null,
          publication: getPublicationString(entity) || null,
          distance: row.distance,
        });
    }

    return rows;
  }

  private async _searchPgVector(query: string, embedding: number[], topK: number) {
    const pool = await this._getPool();
    const vector = `[${embedding.join(",")}]`;
    const dimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );
    const model = `${await PLMainAPI.preferenceService.get(
      "qwenEmbeddingModel"
    )}`;

    await this._ensureSchema();

    const result = await pool.query<ISemanticSearchRow>(
      `
      WITH ranked AS (
        SELECT
          p.id::text AS id,
          p.title,
          p.abstract,
          COALESCE(p.year::text, '') AS year,
          COALESCE(p.publication, p.journal, p.booktitle, '') AS publication,
          array_remove(array_agg(DISTINCT a.name), NULL) AS authors,
          array_remove(array_agg(DISTINCT c.name), NULL) AS categories,
          p.embedding <=> $1::vector AS distance
        FROM papers p
        LEFT JOIN paper_authors pa ON pa.paper_id = p.id
        LEFT JOIN authors a ON a.id = pa.author_id
        LEFT JOIN paper_categories pc ON pc.paper_id = p.id
        LEFT JOIN categories c ON c.id = pc.category_id
        WHERE p.embedding IS NOT NULL
        GROUP BY p.id
        ORDER BY p.embedding <=> $1::vector
        LIMIT $2
      ),
      history AS (
        INSERT INTO search_history (
          query,
          top_k,
          embedding_model,
          embedding_dimensions,
          result_count,
          created_at
        )
        SELECT $3, $2, $4, $5, COUNT(*), now()
        FROM ranked
        RETURNING id
      )
      SELECT ranked.*
      FROM ranked, history
      ORDER BY ranked.distance ASC
      `,
      [vector, topK, query, model, dimensions]
    );

    return result.rows;
  }

  private async _getPool() {
    const connectionString =
      `${await PLMainAPI.preferenceService.get("semanticSearchPostgresURL")}` ||
      process.env.PAPERMIND_SEMANTIC_PG_URL ||
      "";

    if (!connectionString) {
      throw new Error(
        "Missing PostgreSQL connection string. Set semanticSearchPostgresURL or PAPERMIND_SEMANTIC_PG_URL."
      );
    }

    if (!this._pool || this._poolConnectionString !== connectionString) {
      await this._pool?.end();
      this._pool = new Pool({ connectionString });
      this._poolConnectionString = connectionString;
    }

    return this._pool;
  }

  private async _ensureConfigured() {
    const apiKey =
      (await PLMainAPI.preferenceService.getPassword("qwenEmbedding")) ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.QWEN_API_KEY ||
      "";

    if (!apiKey) {
      throw new Error("Qwen embedding API key is missing.");
    }
  }

  private async _ensureSchema() {
    const pool = await this._getPool();
    const dimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );
    if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) {
      throw new Error(`Invalid embedding dimensions: ${dimensions}`);
    }

    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS papers (
        id text PRIMARY KEY,
        title text NOT NULL,
        abstract text,
        year text,
        publication text,
        journal text,
        booktitle text,
        embedding vector(${dimensions}),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS authors (
        id bigserial PRIMARY KEY,
        name text NOT NULL UNIQUE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id bigserial PRIMARY KEY,
        name text NOT NULL UNIQUE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS paper_authors (
        paper_id text NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        author_id bigint NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
        PRIMARY KEY (paper_id, author_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS paper_categories (
        paper_id text NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (paper_id, category_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS search_history (
        id bigserial PRIMARY KEY,
        query text NOT NULL,
        top_k integer NOT NULL,
        embedding_model text NOT NULL,
        embedding_dimensions integer NOT NULL,
        result_count integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS papers_embedding_hnsw_idx ON papers USING hnsw (embedding vector_cosine_ops)"
    );
  }

  private async _indexEntities(entities: Entity[]) {
    if (entities.length === 0) {
      return 0;
    }

    const documents = await Promise.all(
      entities.map((entity) => this._documentText(entity))
    );
    const embeddings = await this._embedBatch(documents);

    if (!(await this._hasPostgresURL())) {
      return await this._upsertLocalEmbeddings(entities, embeddings);
    }

    const pool = await this._getPool();
    let indexed = 0;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const embedding = embeddings[i];
      const publication = getPublicationString(entity);

      await pool.query(
        `
        INSERT INTO papers (
          id,
          title,
          abstract,
          year,
          publication,
          journal,
          booktitle,
          embedding,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, now())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          abstract = EXCLUDED.abstract,
          year = EXCLUDED.year,
          publication = EXCLUDED.publication,
          journal = EXCLUDED.journal,
          booktitle = EXCLUDED.booktitle,
          embedding = EXCLUDED.embedding,
          updated_at = now()
        `,
        [
          `${entity._id}`,
          entity.title,
          entity.abstract || null,
          entity.year || null,
          publication || null,
          entity.journal || null,
          entity.booktitle || null,
          `[${embedding.join(",")}]`,
        ]
      );

      await pool.query("DELETE FROM paper_authors WHERE paper_id = $1", [
        `${entity._id}`,
      ]);
      await pool.query("DELETE FROM paper_categories WHERE paper_id = $1", [
        `${entity._id}`,
      ]);

      for (const author of this._splitAuthors(entity.authors)) {
        const authorResult = await pool.query<{ id: number }>(
          `
          INSERT INTO authors (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [author]
        );
        await pool.query(
          `
          INSERT INTO paper_authors (paper_id, author_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [`${entity._id}`, authorResult.rows[0].id]
        );
      }

      for (const category of this._categories(entity)) {
        const categoryResult = await pool.query<{ id: number }>(
          `
          INSERT INTO categories (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [category]
        );
        await pool.query(
          `
          INSERT INTO paper_categories (paper_id, category_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [`${entity._id}`, categoryResult.rows[0].id]
        );
      }

      indexed += 1;
    }

    return indexed;
  }

  private async _documentText(entity: Entity) {
    const fulltext = await this._cacheService.loadFullText(entity);
    const metadata = [
      entity.title,
      entity.authors,
      entity.year,
      getPublicationString(entity),
      entity.abstract,
      entity.note,
      this._categories(entity).join(", "),
    ]
      .filter(Boolean)
      .join("\n");

    return this._normalizeEmbeddingInput(
      [metadata, fulltext ? fulltext.slice(0, 12000) : ""]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  private _normalizeEmbeddingInput(input: string) {
    const normalized = `${input || ""}`
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return "Untitled paper";
    }

    return normalized.slice(0, 8000);
  }

  private async _upsertLocalEmbeddings(
    entities: Entity[],
    embeddings: number[][]
  ) {
    const index = await this._loadLocalIndex();
    const byId = new Map(index.papers.map((paper) => [paper.id, paper]));

    for (let i = 0; i < entities.length; i += 1) {
      byId.set(`${entities[i]._id}`, {
        id: `${entities[i]._id}`,
        embedding: embeddings[i],
        updatedAt: new Date().toISOString(),
      });
    }

    index.embeddingModel = `${await PLMainAPI.preferenceService.get(
      "qwenEmbeddingModel"
    )}`;
    index.embeddingDimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );
    index.papers = [...byId.values()];
    await this._saveLocalIndex(index);

    return entities.length;
  }

  private async _loadLocalIndex(): Promise<ILocalSemanticIndex> {
    const filePath = await this._localIndexPath();

    try {
      const index = JSON.parse(await fs.readFile(filePath, "utf8"));
      return {
        version: 1,
        embeddingModel: index.embeddingModel || "",
        embeddingDimensions: Number(index.embeddingDimensions || 0),
        papers: Array.isArray(index.papers) ? index.papers : [],
        searchHistory: Array.isArray(index.searchHistory)
          ? index.searchHistory
          : [],
      };
    } catch {
      return {
        version: 1,
        embeddingModel: "",
        embeddingDimensions: 0,
        papers: [],
        searchHistory: [],
      };
    }
  }

  private async _saveLocalIndex(index: ILocalSemanticIndex) {
    const filePath = await this._localIndexPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(index)}\n`, "utf8");
  }

  private async _localIndexPath() {
    const appLibFolder = `${await PLMainAPI.preferenceService.get(
      "appLibFolder"
    )}`;
    return path.join(appLibFolder, "semantic-index.json");
  }

  private _cosineDistance(a: number[], b: number[]) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const length = Math.min(a.length, b.length);

    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 1;
    }

    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private _splitAuthors(authors: string) {
    return authors
      .split(/\s*,\s*|\s+and\s+/i)
      .map((author) => author.trim())
      .filter(Boolean);
  }

  private _categories(entity: Entity) {
    return [...(entity.tags || []), ...(entity.folders || [])]
      .map((category) => category.name?.trim())
      .filter((name): name is string => Boolean(name));
  }
}

