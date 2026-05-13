import { ObjectId } from "bson";
import { promises } from "fs";
import md5 from "md5-file";
import * as mupdf from "mupdf";
import { PrimaryKey, Results } from "realm";

import { errorcatching } from "@/base/error";
import { createDecorator } from "@/base/injection/injection";
import { constructFileURL, eraseProtocol, getProtocol } from "@/base/url";
import { ILogService, LogService } from "@/common/services/log-service";
import { ProcessingKey, processing } from "@/common/utils/processing";
import { OID } from "@/models/id";
import { IPaperEntityCollection, PaperEntity } from "@/models/paper-entity";
import { PaperEntityCache, ThumbnailCache } from "@/models/paper-entity-cache";
import {
  CacheDatabaseCore,
  ICacheDatabaseCore,
} from "@/service/services/database/cache-core";

import { Entity, IEntityCollection, IEntityObject } from "@/models/entity";
import { FileService, IFileService } from "./file-service";

export const ICacheService = createDecorator("cacheService");
const FULLTEXT_CACHE_VERSION = "fulltext-v2-layout";

export class CacheService {
  constructor(
    @ICacheDatabaseCore private readonly _cacheDatabaseCore: CacheDatabaseCore,
    @IFileService private readonly _fileService: FileService,
    @ILogService private readonly _logService: LogService
  ) {}

  /**
   * Initialize the database.
   * @param reinit - Whether to reinitialize the database. */
  async initialize(reinit: boolean = true) {
    await this._cacheDatabaseCore.initRealm(reinit);
  }

  // ========================
  // Read
  // ========================
  /**
   * Filter the fulltext cache of the provided papers by the given query.
   * @param query - The query to filter the fulltext cache by.
   * @param paperEntities - The paper entities to filter.
   * @returns The filtered paper entities. */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to filter fulltext cache.", true, "CacheService", [])
  async fullTextFilter(query: string, paperEntities: IEntityCollection) {
    // First check if all the paper entities are already cached.
    try {
      await this._createFullText(paperEntities);
    } catch (error) {
      this._logService.error(
        `Create fulltext cache failed`,
        error as Error,
        true,
        "CacheService"
      );
    }

    const realm = await this._cacheDatabaseCore.realm();

    const ids = realm
      .objects<PaperEntityCache>("PaperEntityCache")
      .filtered(query)
      .map((p) => p._id);

    const filteredPaperEntities = (
      paperEntities as Results<IEntityObject>
    ).filtered(`_id IN $0`, ids);

    return filteredPaperEntities;
  }

  /**
   * Get the thumbnail of the paper entity.
   * @param paperEntity - The paper entity to get the thumbnail of.
   * @returns The thumbnail of the paper entity. */
  @errorcatching("Failed to get thumbnail.", true, "CacheService", null)
  async loadThumbnail(paperEntity: Entity): Promise<ThumbnailCache | null> {
    const realm = await this._cacheDatabaseCore.realm();

    const cache = realm.objectForPrimaryKey<PaperEntityCache>(
      "PaperEntityCache",
      new ObjectId(paperEntity._id) as unknown as PrimaryKey
    );

    if (cache && cache.thumbnail) {
      return {
        blob: cache.thumbnail,
        width: cache.thumbnailWidth || 0,
        height: cache.thumbnailHeight || 0,
      };
    } else {
      return null;
    }
  }

  @processing(ProcessingKey.General)
  @errorcatching("Failed to get fulltext cache.", true, "CacheService", "")
  async loadFullText(paperEntity: Entity, validateFile = false): Promise<string> {
    const realm = await this._cacheDatabaseCore.realm();

    const cache = realm.objectForPrimaryKey<PaperEntityCache>(
      "PaperEntityCache",
      new ObjectId(paperEntity._id) as unknown as PrimaryKey
    );

    if (cache?.fulltext && !validateFile) {
      return cache.fulltext;
    }

    if (cache?.fulltext && validateFile) {
      const currentMD5 = await this._paperMainFileMD5(paperEntity);
      if (!currentMD5 || cache.md5 === this._fullTextCacheKey(currentMD5)) {
        return cache.fulltext;
      }
    }

    await this.updateFullTextCache([paperEntity]);
    const updatedCache = realm.objectForPrimaryKey<PaperEntityCache>(
      "PaperEntityCache",
      new ObjectId(paperEntity._id) as unknown as PrimaryKey
    );

    return updatedCache?.fulltext || "";
  }

  private async _paperMainFileMD5(paperEntity: Entity): Promise<string> {
    try {
      if (
        !paperEntity.defaultSup ||
        getProtocol(
          paperEntity.supplementaries[paperEntity.defaultSup]?.url || ""
        ) !== "file"
      ) {
        return "";
      }

      const filePath = eraseProtocol(
        await this._fileService.access(
          paperEntity.supplementaries[paperEntity.defaultSup].url,
          false
        )
      );

      if (!filePath || !(await promises.lstat(filePath)).isFile()) {
        return "";
      }

      return md5(filePath);
    } catch {
      return "";
    }
  }

  private _fullTextCacheKey(md5String: string) {
    return md5String ? `${FULLTEXT_CACHE_VERSION}:${md5String}` : "";
  }

  // ========================
  // Create and Update
  // ========================
  private async _createFullText(paperEntities: IEntityCollection) {
    const realm = await this._cacheDatabaseCore.realm();

    // 1. Pick out the entities that are not in the cache
    const ids = paperEntities.map((p: Entity) => p._id);

    const existObjs = realm
      .objects<PaperEntityCache>("PaperEntityCache")
      .filtered("_id IN $0", ids);
    const existObjIds = existObjs.map((e) => e._id);

    let noCachePaperEntities: IEntityCollection = [];
    if (paperEntities instanceof Realm.Results) {
      noCachePaperEntities = paperEntities.filtered(
        `NOT (_id IN $0)`,
        existObjIds
      );
    } else {
      const existObjStrIds = existObjIds.map((id) => `${id}`);
      noCachePaperEntities = paperEntities.filter(
        (p) => !existObjStrIds.includes(`${p._id}`)
      );
    }
    // 2. Update the cache
    const createPromise = async (paperEntity: Entity) => {
      try {
        if (
          !paperEntity.defaultSup ||
          getProtocol(
            paperEntity.supplementaries[paperEntity.defaultSup].url
          ) !== "file"
        ) {
          return;
        }

        const url = paperEntity.supplementaries[paperEntity.defaultSup].url;
        const fulltext = await this._getPDFText(url);
        const md5String = await md5(
          eraseProtocol(await this._fileService.access(url, false))
        );
        realm.safeWrite(() => {
          realm.create<PaperEntityCache>("PaperEntityCache", {
            _id: new ObjectId(paperEntity._id),
            _partition: "",
            fulltext: fulltext,
            md5: this._fullTextCacheKey(md5String),
          });
        });
      } catch (err) {
        this._logService.error(
          "Failed to create fulltext cache",
          err as Error,
          false,
          "CacheService"
        );
      }
    };
    await Promise.all(
      noCachePaperEntities.map((p: Entity) => createPromise(p))
    );
  }

  private async _getPDFText(url: string): Promise<string> {
    try {
      if (!url) {
        return "";
      }

      const pdfBuffer = await promises.readFile(
        constructFileURL(
          url,
          true,
          false,
          (await PLMainAPI.preferenceService.get("appLibFolder")) as string
        )
      );
      const pdf = mupdf.Document.openDocument(pdfBuffer as any, "application/pdf");

      const pages: string[] = [];

      for (let i = 0; i < pdf.countPages(); i++) {
        const page = pdf.loadPage(i);
        const json = JSON.parse(
          page.toStructuredText("preserve-whitespace").asJSON()
        );
        const lines = this._structuredTextLines(json);
        pages.push([`[Page ${i + 1}]`, ...this._layoutLines(lines)].join("\n"));
      }

      return pages.join("\n\n");
    } catch (error) {
      this._logService.error(
        "Failed to read fulltext of PDF",
        error as Error,
        false,
        "CacheService"
      );

      return "";
    }
  }

  private _structuredTextLines(json: any): Array<{
    text: string;
    x: number;
    y: number;
  }> {
    const lines: Array<{ text: string; x: number; y: number }> = [];

    for (const block of json?.blocks || []) {
      const blockBox = block?.bbox || block?.bounds || [0, 0, 0, 0];
      for (const line of block?.lines || []) {
        const lineText = `${line?.text || ""}`.replace(/\s+/g, " ").trim();
        if (!lineText) {
          continue;
        }

        const lineBox = line?.bbox || line?.bounds || blockBox;
        lines.push({
          text: lineText,
          x: Number(lineBox?.[0] || blockBox?.[0] || 0),
          y: Number(lineBox?.[1] || blockBox?.[1] || 0),
        });
      }
    }

    return lines.sort((lineA, lineB) => {
      const yDiff = lineA.y - lineB.y;
      if (Math.abs(yDiff) > 3) {
        return yDiff;
      }

      return lineA.x - lineB.x;
    });
  }

  private _layoutLines(
    lines: Array<{ text: string; x: number; y: number }>
  ): string[] {
    const rows: Array<Array<{ text: string; x: number; y: number }>> = [];
    const rowTolerance = 4;

    for (const line of lines) {
      const currentRow = rows[rows.length - 1];
      if (
        currentRow &&
        Math.abs(currentRow[0].y - line.y) <= rowTolerance
      ) {
        currentRow.push(line);
      } else {
        rows.push([line]);
      }
    }

    return rows
      .map((row) =>
        row
          .sort((lineA, lineB) => lineA.x - lineB.x)
          .map((line) => line.text)
          .join("\t")
          .trim()
      )
      .filter(Boolean);
  }

  /**
   * Update the fulltext cache of the provided paper entities.
   * @param paperEntities - The paper entities to update the fulltext cache of.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to update fulltext cache.", true, "CacheService")
  async updateFullTextCache(paperEntities: IEntityCollection) {
    const realm = await this._cacheDatabaseCore.realm();

    const updatePromise = async (paperEntity: Entity) => {
      try {
        if (
          !paperEntity.defaultSup ||
          getProtocol(
            paperEntity.supplementaries[paperEntity.defaultSup].url
          ) !== "file"
        ) {
          return;
        }
        const url = paperEntity.supplementaries[paperEntity.defaultSup].url;

        const filePath = eraseProtocol(
          await this._fileService.access(url, false)
        );

        if (!filePath) {
          return;
        }

        let md5String = "";
        if (filePath && (await promises.lstat(filePath)).isFile()) {
          md5String = await md5(filePath);
        }

        const fulltext = await this._getPDFText(url);
        return realm.safeWrite(() => {
          const objects = realm
            .objects<PaperEntityCache>("PaperEntityCache")
            .filtered("_id == $0", new ObjectId(paperEntity._id));
          const object = objects[0] || null;

        const cacheKey = this._fullTextCacheKey(md5String);
        if (object && object.md5 === cacheKey) {
          return;
        } else if (object) {
          object.fulltext = fulltext;
          object.md5 = cacheKey;
        } else {
            realm.create<PaperEntityCache>(
              "PaperEntityCache",
              {
                _id: new ObjectId(paperEntity._id),
                _partition: "",
                fulltext: fulltext,
                md5: cacheKey,
              },
              Realm.UpdateMode.Modified
            );
          }
        });
      } catch (err) {
        this._logService.error(
          "Failed to update fulltext cache",
          err as Error,
          false,
          "CacheService"
        );
      }
    };

    await Promise.all(paperEntities.map((p: Entity) => updatePromise(p)));
  }

  /**
   * Update the thumbnail cache
   * @param paperEntity - PaperEntity
   * @param thumbnailCache - Cache of thumbnail
   */
  @errorcatching("Failed to update thumbnail cache.", true, "CacheService")
  async updateThumbnailCache(
    paperEntity: Entity,
    thumbnailCache: ThumbnailCache
  ) {
    const realm = await this._cacheDatabaseCore.realm();

    realm.safeWrite(() => {
      const objects = realm
        .objects<PaperEntityCache>("PaperEntityCache")
        .filtered("_id == $0", new ObjectId(paperEntity._id));
      const object = objects[0] || null;

      if (object) {
        object.thumbnail = thumbnailCache.blob;
        object.thumbnailWidth = thumbnailCache.width;
        object.thumbnailHeight = thumbnailCache.height;
      } else {
        realm.create<PaperEntityCache>("PaperEntityCache", {
          _id: new ObjectId(paperEntity._id),
          _partition: "",
          fulltext: "",
          thumbnail: thumbnailCache.blob,
          thumbnailWidth: thumbnailCache.width,
          thumbnailHeight: thumbnailCache.height,
          md5: "",
        });
      }
    });
  }

  /**
   * Update the cache of the provided paper entities.
   * @param paperEntities - The paper entities.
   * @returns
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to update cache.", true, "CacheService")
  async updateCache(paperEntities: IEntityCollection) {
    await this.updateFullTextCache(paperEntities);
    for (const paperEntity of paperEntities) {
      await this.updateThumbnailCache(paperEntity, {
        blob: new ArrayBuffer(0),
        width: 0,
        height: 0,
      });
    }
  }

  // ========================
  // Delete
  // ========================
  /**
   * Delete the cache of the provided paper entity ids.
   * @param ids - The ids of the paper entities to delete the cache of.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to delete cache.", true, "CacheService")
  async delete(ids: OID[]) {
    const realm = await this._cacheDatabaseCore.realm();

    const entitiesCache = realm
      .objects<PaperEntityCache>("PaperEntityCache")
      .filtered(
        "_id IN $0",
        ids.map((id) => new ObjectId(id))
      );

    realm.safeWrite(() => {
      realm.delete(entitiesCache);
    });
  }

  /**
   * Clear the cache.
   */
  @processing(ProcessingKey.General)
  @errorcatching("Failed to clear cache.", true, "CacheService")
  async clear() {
    const realm = await this._cacheDatabaseCore.realm();
    realm.safeWrite(() => {
      realm.delete(realm.objects<PaperEntityCache>("PaperEntityCache"));
    });
  }
}
