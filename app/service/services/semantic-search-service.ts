import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { Pool } from "pg";

import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { getPublicationString } from "@/base/string";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { Entity } from "@/models/entity";
import { OID } from "@/models/id";
import { getModelProviderPreset } from "@/common/model-provider-registry";
import { DatabaseCore, IDatabaseCore } from "@/service/services/database/core";
import { ILogService, LogService } from "@/common/services/log-service";
import {
  IPaperEntityRepository,
  PaperEntityRepository,
} from "../repositories/db-repository/paper-entity-repository";
import { CacheService, ICacheService } from "./cache-service";

export const ISemanticSearchService = createDecorator("semanticSearchService");

interface ISemanticSearchRow {
  id: string;
  title: string | null;
  abstract: string | null;
  document_text: string | null;
  authors: string[] | null;
  categories: string[] | null;
  year: string | null;
  publication: string | null;
  distance: number;
}

export interface ISemanticAskResult {
  paper: Entity;
  contextText: string;
  distance: number;
}

export interface IPaperIndexedContext {
  id: string;
  title: string | null;
  abstract: string | null;
  documentText: string;
}

export interface ISemanticTextRankInput {
  id: string;
  text: string;
}

export interface ISemanticTextRankResult {
  id: string;
  score: number;
}

export interface ISemanticMultiQueryTextRankResult {
  id: string;
  scores: Record<string, number>;
}

interface IPgLikeResult<T> {
  rows: T[];
}

interface IPgLikeClient {
  query<T = any>(sql: string, params?: any[]): Promise<IPgLikeResult<T>>;
}

export class SemanticSearchService extends Eventable<{}> {
  private _pool?: Pool;
  private _poolConnectionString = "";
  private _pglite?: PGlite;
  private _pglitePath = "";

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
      : await this._searchPGliteVector(trimmedQuery, embedding, topK);

    return this._rowsToEntities(rows);
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to retrieve RAG context.", true, "SemanticSearch", [])
  async searchForAsk(query: string, topK = 8): Promise<ISemanticAskResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || !(await this._isEnabled())) {
      return [];
    }

    const embedding = await this._embed(trimmedQuery);
    const rows = (await this._hasPostgresURL())
      ? await this._searchPgVector(trimmedQuery, embedding, topK)
      : await this._searchPGliteVector(trimmedQuery, embedding, topK);
    const papers = await this._rowsToEntities(rows);
    const byId = new Map(papers.map((paper) => [`${paper._id}`, paper]));

    return rows
      .map((row) => {
        const paper = byId.get(row.id);
        if (!paper) {
          return null;
        }

        return {
          paper,
          contextText: row.document_text || "",
          distance: row.distance,
        };
      })
      .filter((item): item is ISemanticAskResult => item !== null);
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to rank texts by semantic relevance.", true, "SemanticSearch", [])
  async rankTextsByQuery(
    query: string,
    items: ISemanticTextRankInput[]
  ): Promise<ISemanticTextRankResult[]> {
    const trimmedQuery = `${query || ""}`.trim();
    const candidates = (items || []).filter(
      (item) => `${item.id || ""}`.trim() && `${item.text || ""}`.trim()
    );

    if (!trimmedQuery || candidates.length === 0 || !(await this._isEnabled())) {
      return [];
    }

    const embeddings = await this._embedBatch([
      trimmedQuery,
      ...candidates.map((item) => item.text),
    ]);
    const queryEmbedding = embeddings[0];

    return candidates
      .map((item, index) => ({
        id: item.id,
        score: this._cosineSimilarity(queryEmbedding, embeddings[index + 1]),
      }))
      .sort((a, b) => b.score - a.score);
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to rank texts by semantic relevance.", true, "SemanticSearch", [])
  async rankTextsByQueries(
    queries: Record<string, string>,
    items: ISemanticTextRankInput[]
  ): Promise<ISemanticMultiQueryTextRankResult[]> {
    const queryEntries = Object.entries(queries || {})
      .map(([key, value]) => [key, `${value || ""}`.trim()] as [string, string])
      .filter(([key, value]) => key && value);
    const candidates = (items || []).filter(
      (item) => `${item.id || ""}`.trim() && `${item.text || ""}`.trim()
    );

    if (
      queryEntries.length === 0 ||
      candidates.length === 0 ||
      !(await this._isEnabled())
    ) {
      return [];
    }

    const embeddings = await this._embedBatch([
      ...queryEntries.map(([, value]) => value),
      ...candidates.map((item) => item.text),
    ]);
    const queryEmbeddings = embeddings.slice(0, queryEntries.length);
    const itemEmbeddings = embeddings.slice(queryEntries.length);

    return candidates.map((item, itemIndex) => {
      const scores: Record<string, number> = {};
      queryEntries.forEach(([key], queryIndex) => {
        scores[key] = this._cosineSimilarity(
          queryEmbeddings[queryIndex],
          itemEmbeddings[itemIndex]
        );
      });
      return { id: item.id, scores };
    });
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to retrieve paper indexed contexts.", true, "SemanticSearch", [])
  async getPaperIndexedContexts(ids: string[]): Promise<IPaperIndexedContext[]> {
    const normalizedIds = Array.from(
      new Set(
        (ids || [])
          .map((id) => `${id || ""}`.trim())
          .filter(Boolean)
      )
    );
    if (normalizedIds.length === 0) {
      return [];
    }

    const rows = await this._queryPaperRowsByIds(normalizedIds);
    return rows.map((row) => ({
      id: `${row.id}`,
      title: row.title || null,
      abstract: row.abstract || null,
      documentText: row.document_text || "",
    }));
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
      } else {
        await this._ensurePGliteSchema();
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
    } else {
      await this._ensurePGliteSchema();
    }

    return {
      indexed: await this._indexEntities(paperEntities.map((p) => new Entity(p))),
    };
  }

  @processing(ProcessingKey.General)
  @errorcatching(
    "Failed to test semantic search settings.",
    true,
    "SemanticSearch",
    false
  )
  async testSettings() {
    await this._ensureConfigured();
    if (await this._hasPostgresURL()) {
      await this._ensureSchema();
    } else {
      await this._ensurePGliteSchema();
    }
    await this._embed("papermind semantic search configuration test");
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

    const provider = await this._getProviderPreset("embedding");
    const apiKey = await this._resolveProviderAPIKey(provider.id, "embedding");

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

    const resolvedBaseURL = (baseURL || provider.baseURL).replace(/\/+$/, "");
    const resolvedModel = model || provider.defaultEmbeddingModel;
    const response = await fetch(`${resolvedBaseURL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
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

    const provider = await this._getProviderPreset("embedding");
    const apiKey = await this._resolveProviderAPIKey(provider.id, "embedding");

    return Boolean(apiKey);
  }

  private async _hasPostgresURL() {
    const connectionString =
      `${await PLMainAPI.preferenceService.get("semanticSearchPostgresURL")}` ||
      process.env.PAPERMIND_SEMANTIC_PG_URL ||
      "";

    return Boolean(connectionString.trim());
  }

  private async _searchPGliteVector(
    query: string,
    embedding: number[],
    topK: number
  ): Promise<ISemanticSearchRow[]> {
    const db = await this._getPGlite();
    await this._ensurePGliteSchema();

    const vectorText = `[${embedding.join(",")}]`;
    const dimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );
    const model = `${await PLMainAPI.preferenceService.get(
      "qwenEmbeddingModel"
    )}`;

    const result = await db.query<ISemanticSearchRow>(
      `
      WITH ranked AS (
        SELECT
          p.id::text AS id,
          p.title,
          p.abstract,
          p.document_text,
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
      )
      SELECT * FROM ranked
      ORDER BY ranked.distance ASC
      `,
      [vectorText, topK]
    );

    await db.query(
      `
      INSERT INTO search_history (
        query,
        top_k,
        embedding_model,
        embedding_dimensions,
        result_count,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
      `,
      [query, topK, model, dimensions, result.rows.length]
    );

    return result.rows;
  }

  private async _rowsToEntities(rows: ISemanticSearchRow[]) {
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
        .filter((entity) => entity !== undefined)
        .map((entity) => new Entity(entity as Entity));

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

  private async _searchPgVector(query: string, embedding: number[], topK: number) {
    const pool = await this._getPool();
    await this._ensureSchema();

    const vectorText = `[${embedding.join(",")}]`;
    const dimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );
    const model = `${await PLMainAPI.preferenceService.get(
      "qwenEmbeddingModel"
    )}`;

    const result = await pool.query<ISemanticSearchRow>(
      `
      WITH ranked AS (
        SELECT
          p.id::text AS id,
          p.title,
          p.abstract,
          p.document_text,
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
      [vectorText, topK, query, model, dimensions]
    );

    return result.rows;
  }

  private async _queryPaperRowsByIds(ids: string[]): Promise<ISemanticSearchRow[]> {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
    const sql = `
      SELECT
        p.id::text AS id,
        p.title,
        p.abstract,
        p.document_text,
        COALESCE(p.year::text, '') AS year,
        COALESCE(p.publication, p.journal, p.booktitle, '') AS publication,
        array_remove(array_agg(DISTINCT a.name), NULL) AS authors,
        array_remove(array_agg(DISTINCT c.name), NULL) AS categories,
        0::float AS distance
      FROM papers p
      LEFT JOIN paper_authors pa ON pa.paper_id = p.id
      LEFT JOIN authors a ON a.id = pa.author_id
      LEFT JOIN paper_categories pc ON pc.paper_id = p.id
      LEFT JOIN categories c ON c.id = pc.category_id
      WHERE p.id IN (${placeholders})
      GROUP BY p.id
    `;

    if (await this._hasPostgresURL()) {
      const pool = await this._getPool();
      const result = await pool.query<ISemanticSearchRow>(sql, ids);
      return result.rows;
    }

    const db = await this._getPGlite();
    await this._ensurePGliteSchema();
    const result = await db.query<ISemanticSearchRow>(sql, ids);
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
    const provider = await this._getProviderPreset("embedding");
    const apiKey = await this._resolveProviderAPIKey(provider.id, "embedding");

    if (!apiKey) {
      throw new Error("Model provider API key is missing.");
    }
  }

  private async _getProviderPreset(scope: "embedding") {
    const providerID = `${await PLMainAPI.preferenceService.get(
      "embeddingModelProvider"
    )}`.trim();
    return getModelProviderPreset(providerID);
  }

  private async _resolveProviderAPIKey(
    providerID: string,
    scope: "embedding"
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

  private async _ensureSchema() {
    const pool = await this._getPool();
    await this._ensureSchemaOnClient(pool);
  }

  private async _ensurePGliteSchema() {
    const db = await this._getPGlite();
    await this._ensureSchemaOnClient(db);
  }

  private async _ensureSchemaOnClient(client: IPgLikeClient) {
    const dimensions = Number(
      await PLMainAPI.preferenceService.get("qwenEmbeddingDimensions")
    );
    if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) {
      throw new Error(`Invalid embedding dimensions: ${dimensions}`);
    }

    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`
      CREATE TABLE IF NOT EXISTS papers (
        id text PRIMARY KEY,
        title text NOT NULL,
        abstract text,
        document_text text,
        year text,
        publication text,
        journal text,
        booktitle text,
        embedding vector(${dimensions}),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      ALTER TABLE papers
      ADD COLUMN IF NOT EXISTS document_text text
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS authors (
        id bigserial PRIMARY KEY,
        name text NOT NULL UNIQUE
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id bigserial PRIMARY KEY,
        name text NOT NULL UNIQUE
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS paper_authors (
        paper_id text NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        author_id bigint NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
        PRIMARY KEY (paper_id, author_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS paper_categories (
        paper_id text NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (paper_id, category_id)
      )
    `);
    await client.query(`
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
    await client.query(
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
    const embeddings = await Promise.all(
      documents.map((document) => this._embedFullDocument(document))
    );

    if (await this._hasPostgresURL()) {
      const pool = await this._getPool();
      return this._upsertEmbeddingsToClient(pool, entities, documents, embeddings);
    }

    const db = await this._getPGlite();
    return this._upsertEmbeddingsToClient(db, entities, documents, embeddings);
  }

  private async _upsertEmbeddingsToClient(
    client: IPgLikeClient,
    entities: Entity[],
    documents: string[],
    embeddings: number[][]
  ) {
    let indexed = 0;

    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      const embedding = embeddings[i];
      const publication = getPublicationString(entity);

      await client.query(
        `
        INSERT INTO papers (
          id,
          title,
          abstract,
          document_text,
          year,
          publication,
          journal,
          booktitle,
          embedding,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, now())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          abstract = EXCLUDED.abstract,
          document_text = EXCLUDED.document_text,
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
          documents[i] || null,
          entity.year || null,
          publication || null,
          entity.journal || null,
          entity.booktitle || null,
          `[${embedding.join(",")}]`,
        ]
      );

      await client.query("DELETE FROM paper_authors WHERE paper_id = $1", [
        `${entity._id}`,
      ]);
      await client.query("DELETE FROM paper_categories WHERE paper_id = $1", [
        `${entity._id}`,
      ]);

      for (const author of this._splitAuthors(entity.authors)) {
        const authorResult = await client.query<{ id: number }>(
          `
          INSERT INTO authors (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [author]
        );
        await client.query(
          `
          INSERT INTO paper_authors (paper_id, author_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [`${entity._id}`, authorResult.rows[0].id]
        );
      }

      for (const category of this._categories(entity)) {
        const categoryResult = await client.query<{ id: number }>(
          `
          INSERT INTO categories (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [category]
        );
        await client.query(
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

    // Keep full text for indexing context. Embedding is computed via chunking
    // in _embedFullDocument to avoid short-context truncation.
    return this._normalizeDocumentText(
      [metadata, fulltext || ""].filter(Boolean).join("\n\n")
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

  private _normalizeDocumentText(input: string) {
    const normalized = `${input || ""}`
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return "Untitled paper";
    }

    // Keep a high but bounded limit for DB/storage stability.
    return normalized.slice(0, 200000);
  }

  private async _embedFullDocument(document: string): Promise<number[]> {
    const chunks = this._splitForEmbedding(document);
    const vectors = await this._embedBatch(chunks);
    return this._meanPoolEmbeddings(vectors);
  }

  private _splitForEmbedding(document: string): string[] {
    const normalized = `${document || ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return ["Untitled paper"];
    }

    const maxChunkChars = 6000;
    const overlapChars = 600;
    const chunks: string[] = [];

    let start = 0;
    while (start < normalized.length) {
      let end = Math.min(start + maxChunkChars, normalized.length);
      if (end < normalized.length) {
        const boundary = normalized.lastIndexOf(" ", end);
        if (boundary > start + 1000) {
          end = boundary;
        }
      }
      chunks.push(normalized.slice(start, end));
      if (end >= normalized.length) {
        break;
      }
      start = Math.max(0, end - overlapChars);
    }

    return chunks.slice(0, 64);
  }

  private _meanPoolEmbeddings(vectors: number[][]): number[] {
    if (vectors.length === 0) {
      return [];
    }
    const dim = vectors[0].length;
    const pooled = new Array<number>(dim).fill(0);
    for (const vector of vectors) {
      for (let i = 0; i < dim; i += 1) {
        pooled[i] += Number(vector[i] || 0);
      }
    }
    for (let i = 0; i < dim; i += 1) {
      pooled[i] /= vectors.length;
    }
    return pooled;
  }

  private _cosineSimilarity(a: number[], b: number[]) {
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    const length = Math.min(a.length, b.length);

    for (let i = 0; i < length; i += 1) {
      const av = Number(a[i] || 0);
      const bv = Number(b[i] || 0);
      dot += av * bv;
      aNorm += av * av;
      bNorm += bv * bv;
    }

    if (aNorm === 0 || bNorm === 0) {
      return 0;
    }

    return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
  }

  private async _getPGlite() {
    const appLibFolder = `${await PLMainAPI.preferenceService.get(
      "appLibFolder"
    )}`;
    const dbPath = path.join(appLibFolder, "semantic-db");

    if (!this._pglite || this._pglitePath !== dbPath) {
      if (this._pglite) {
        await this._pglite.close();
      }
      this._pglite = await PGlite.create({
        dataDir: dbPath,
        extensions: { vector },
      });
      this._pglitePath = dbPath;
    }

    return this._pglite;
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
