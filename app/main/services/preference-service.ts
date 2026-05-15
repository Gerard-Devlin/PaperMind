import ElectronStore from "electron-store";
import keytar from "keytar";
import os from "os";
import { join } from "path";

import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { cmdOrCtrl } from "@/base/shortcut";

export interface IDataViewField {
  key: string;
  enable: boolean;
  width: number;
}

export interface IPreferenceStore {
  preferenceVersion: number;
  windowSize: { height: number; width: number };

  appLibFolder: string;
  sourceFileOperation: "cut" | "copy" | "link";

  showSidebarCount: boolean;
  isSidebarCompact: boolean;

  mainTableFields: IDataViewField[];

  feedFields: IDataViewField[];

  preferedTheme: "light" | "dark" | "system";
  invertColor: boolean;
  sidebarSortBy: "name" | "count" | "color";
  sidebarSortOrder: "asce" | "desc";
  renamingFormat: "full" | "short" | "authortitle" | "custom";
  customRenamingFormat: string;

  language: string;

  enableExportReplacement: boolean;
  exportReplacement: Array<{ from: string; to: string }>;

  useSync: "none" | "official" | "realm" | "self-host";
  isFlexibleSync: boolean;
  syncAPPID: "";
  syncAPIKey: string;
  syncEmail: string;

  syncFileStorage: string;
  webdavURL: string;
  webdavUsername: string;
  webdavPassword: string;

  allowRoutineMatch: boolean;
  lastRematchTime: number;

  lastFeedRefreshTime: number;

  allowproxy: boolean;
  httpproxy: string;
  httpsproxy: string;

  lastVersion: string;
  lastDBVersion: number;

  shortcutPlugin: string;
  shortcutPreview: string;
  shortcutOpen: string;
  shortcutCopy: string;
  shortcutScrape: string;
  shortcutEdit: string;
  shortcutFlag: string;
  shortcutCopyKey: string;
  shortcutAsk: string;
  shortcutCompare: string;

  shortcutDelete: string;

  shortcutImportFrom: string;

  sidebarWidth: number;
  detailPanelWidth: number;
  mainviewSortBy: string;
  mainviewSortOrder: "desc" | "asce";
  mainviewType: string;
  mainviewShortAuthor: boolean;

  pluginLinkedFolder: string;
  quickpasteLaunchMode: "cite" | "ask" | "compare" | "graph";
  quickpasteLastAskAnswer: string;
  quickpasteComparePaperIds: string[];
  quickpasteCompareRequestAt: number;
  quickpasteLastCompareInstruction: string;
  quickpasteLastCompareResult: Record<string, any> | null;

  selectedPDFViewer: string;
  selectedPDFViewerPath: string;

  selectedCSLStyle: string;
  importedCSLStylesPath: string;

  showPresetting: boolean;
  showGuide: boolean;
  showWelcome: boolean;
  apiSetupDismissed: boolean;
  fontsize: "normal" | "large" | "larger";

  semanticSearchEnabled: boolean;
  semanticSearchPostgresURL: string;
  qwenEmbeddingBaseURL: string;
  qwenEmbeddingModel: string;
  qwenEmbeddingDimensions: number;
  qwenAskBaseURL: string;
  qwenAskModel: string;
  modelProvider: string;
  askModelProvider: string;
  tagModelProvider: string;
  embeddingModelProvider: string;
  askContextProfile: "fast" | "balanced" | "detailed";
  qwenAITagBaseURL: string;
  qwenAITagModel: string;
  chatModelListCache: Record<
    string,
    {
      models: string[];
      updatedAt: number;
    }
  >;
  qwenChatBaseURL: string;
  qwenChatModel: string;
  autoAITagging: boolean;
  arxivRecommendationKeywords: string[];
  arxivRecommendationKeywordColors: Record<string, string>;
  arxivRecommendationScoreWidth: number;
  arxivRecommendationSortBy: string;
  arxivRecommendationSortOrder: "asce" | "desc";
  startAtLogin: boolean;
  closeToTray: boolean;
}

const _defaultPreferences: IPreferenceStore = {
  preferenceVersion: 1,
  windowSize: { height: 800, width: 1440 },

  appLibFolder: join(os.homedir(), "Documents", "papermind"),
  sourceFileOperation: "copy",

  showSidebarCount: true,
  isSidebarCompact: false,

  mainTableFields: [
    { key: "type", enable: false, width: -1 },
    { key: "abstract", enable: false, width: -1 },
    { key: "defaultSup", enable: false, width: -1 },
    { key: "doi", enable: false, width: -1 },
    { key: "arxiv", enable: false, width: -1 },
    { key: "issn", enable: false, width: -1 },
    { key: "isbn", enable: false, width: -1 },
    { key: "title", enable: true, width: -1 },
    { key: "authors", enable: true, width: -1 },
    { key: "year", enable: true, width: -1 },
    { key: "month", enable: false, width: -1 },
    { key: "publication", enable: true, width: -1 },
    { key: "rating", enable: false, width: -1 },
    { key: "tags", enable: false, width: -1 },
    { key: "folders", enable: false, width: -1 },
    { key: "flag", enable: true, width: -1 },
    { key: "note", enable: false, width: -1 },
    { key: "pages", enable: false, width: -1 },
    { key: "volume", enable: false, width: -1 },
    { key: "number", enable: false, width: -1 },
    { key: "addTime", enable: true, width: -1 },
  ],

  feedFields: [
    { key: "feed", enable: false, width: -1 },
    { key: "feedTime", enable: false, width: -1 },
    { key: "title", enable: true, width: -1 },
    { key: "authors", enable: true, width: -1 },
    { key: "abstract", enable: false, width: -1 },
    { key: "publication", enable: true, width: -1 },
    { key: "pubTime", enable: true, width: -1 },
    { key: "pubType", enable: false, width: -1 },
    { key: "doi", enable: false, width: -1 },
    { key: "arxiv", enable: false, width: -1 },
    { key: "pages", enable: false, width: -1 },
    { key: "volume", enable: false, width: -1 },
    { key: "number", enable: false, width: -1 },
    { key: "publisher", enable: false, width: -1 },
    { key: "addTime", enable: true, width: -1 },
  ],

  preferedTheme: "light",
  invertColor: true,
  sidebarSortBy: "name",
  sidebarSortOrder: "asce",
  renamingFormat: "full",
  customRenamingFormat: "",

  language: "en-GB",

  enableExportReplacement: true,
  exportReplacement: [],

  useSync: "none",
  isFlexibleSync: false,
  syncAPPID: "",
  syncAPIKey: "",
  syncEmail: "",

  syncFileStorage: "local",
  webdavURL: "",
  webdavUsername: "",
  webdavPassword: "",

  allowRoutineMatch: true,
  lastRematchTime: Math.round(Date.now() / 1000),

  lastFeedRefreshTime: Math.round(Date.now() / 1000),

  allowproxy: true,
  httpproxy: "",
  httpsproxy: "",

  lastVersion: "",
  lastDBVersion: -1,

  shortcutPlugin: `${cmdOrCtrl}+Shift+I`,
  shortcutPreview: "Space",
  shortcutOpen: "Enter",
  shortcutCopy: `${cmdOrCtrl}+Shift+C`,
  shortcutScrape: `${cmdOrCtrl}+R`,
  shortcutEdit: `${cmdOrCtrl}+E`,
  shortcutFlag: `${cmdOrCtrl}+F`,
  shortcutCopyKey: `${cmdOrCtrl}+Shift+K`,
  shortcutAsk: `${cmdOrCtrl}+Shift+A`,
  shortcutCompare: `${cmdOrCtrl}+Shift+M`,

  shortcutDelete: "Delete",

  shortcutImportFrom: `${cmdOrCtrl}+O`,

  sidebarWidth: 20,
  detailPanelWidth: 75,
  mainviewSortBy: "addTime",
  mainviewSortOrder: "desc",
  mainviewType: "list",
  mainviewShortAuthor: false,

  pluginLinkedFolder: "",
  quickpasteLaunchMode: "cite",
  quickpasteLastAskAnswer: "",
  quickpasteComparePaperIds: [],
  quickpasteCompareRequestAt: 0,
  quickpasteLastCompareInstruction: "",
  quickpasteLastCompareResult: null,

  selectedPDFViewer: "default",
  selectedPDFViewerPath: "",

  selectedCSLStyle: "apa",
  importedCSLStylesPath: "",

  showPresetting: true,
  showGuide: true,
  showWelcome: true,
  apiSetupDismissed: false,
  fontsize: "normal",

  semanticSearchEnabled: false,
  semanticSearchPostgresURL: "",
  qwenEmbeddingBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenEmbeddingModel: "text-embedding-v4",
  qwenEmbeddingDimensions: 1024,
  qwenAskBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenAskModel: "qwen-plus",
  modelProvider: "qwen",
  askModelProvider: "qwen",
  tagModelProvider: "qwen",
  embeddingModelProvider: "qwen",
  askContextProfile: "fast",
  qwenAITagBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenAITagModel: "qwen-plus",
  chatModelListCache: {},
  qwenChatBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenChatModel: "qwen-plus",
  autoAITagging: true,
  arxivRecommendationKeywords: [],
  arxivRecommendationKeywordColors: {},
  arxivRecommendationScoreWidth: 12,
  arxivRecommendationSortBy: "recommendationScore",
  arxivRecommendationSortOrder: "desc",
  startAtLogin: false,
  closeToTray: true,
};

function _migrate(
  store: ElectronStore<IPreferenceStore>,
  preferenceVersion: number
) {
  // Versions:
  // 0: PaperMind < 3.0.0
  // 1: PaperMind >= 3.0.0-beta.1
  // 2: PaperMind >= 3.0.0-beta.4
  const prevVersion = store.has("preferenceVersion")
    ? store.get("preferenceVersion")
    : 0;

  if (prevVersion === 0) {
    // If there is no key in existing store, set the default value
    for (const key of Object.keys(_defaultPreferences)) {
      if (!store.has(key)) {
        store.set(key, _defaultPreferences[key]);
      }
    }

    // depracated scrapers, downloaders etc.
    for (const key of Object.keys(store.store)) {
      if (!_defaultPreferences.hasOwnProperty(key)) {
        try {
          store.delete(key as keyof IPreferenceStore);
        } catch (e) {}
      }
    }
  }

  const legacyDefaultFolder = join(os.homedir(), "Documents", "paperlib");
  if (
    !store.has("appLibFolder") ||
    store.get("appLibFolder") === legacyDefaultFolder
  ) {
    store.set("appLibFolder", _defaultPreferences.appLibFolder);
  }

  if (prevVersion <= 1) {
    // depracated data field settings.
    const keyMap = {
      title: [null, "mainTitleWidth", "feedTitleWidth"],
      authors: [null, "mainAuthorsWidth", "feedAuthorsWidth"],
      pubTime: ["showMainYear", "mainYearWidth", "feedYearWidth"],
      publication: [
        "showMainPublication",
        "mainPublicationWidth",
        "feedPublicationWidth",
      ],
      pubType: ["showMainPubType", "mainPubTypeWidth", "feedPubTypeWidth"],
      rating: ["showMainRating", "mainRatingWidth", "feedRatingWidth"],
      flag: ["showMainFlag", "mainFlagWidth", null],
      tags: ["showMainTag", "mainTagWidth", null],
      folders: ["showMainFolder", "mainFolderWidth", null],
      note: ["showMainNote", "mainNoteWidth", null],
      addTime: ["showMainAddTime", "mainAddTimeWidth", "feedAddTimeWidth"],
    };

    const mainTableFields: IDataViewField[] = [];
    const feedFields: IDataViewField[] = [];

    for (const [key, defaultMainTableFields] of Object.entries(
      _defaultPreferences.mainTableFields
    )) {
      const [preShowKey, preMainWidthKey, preFeedWidthKey] = keyMap[key] || [
        null,
        null,
        null,
      ];

      const enable =
        preShowKey && key !== "title" && key! == "authors"
          ? (store.get(preShowKey) as boolean)
          : true;

      if (preMainWidthKey !== null) {
        defaultMainTableFields["width"] = store.get(preMainWidthKey) || -1;
        defaultMainTableFields["enable"] = enable;

        store.delete(preMainWidthKey as any);
      }
      mainTableFields.push(defaultMainTableFields);
    }

    for (const [key, defaultFeedFields] of Object.entries(
      _defaultPreferences.feedFields
    )) {
      const [preShowKey, preMainWidthKey, preFeedWidthKey] = keyMap[key] || [
        null,
        null,
        null,
      ];

      const enable =
        preShowKey && key !== "title" && key! == "authors"
          ? (store.get(preShowKey) as boolean)
          : true;

      if (preFeedWidthKey !== null) {
        defaultFeedFields["width"] = store.get(preFeedWidthKey) || -1;
        defaultFeedFields["enable"] = enable;

        store.delete(preFeedWidthKey as any);
      }

      feedFields.push(defaultFeedFields);

      if (preShowKey !== null) {
        store.delete(preShowKey as any);
      }
    }

    store.set("mainTableFields", mainTableFields);
    store.set("feedFields", feedFields);
  }
  // TODO: migrate from 1 to 2
  const currentSortBy = store.get("mainviewSortBy");
  if (currentSortBy === "pubTime") {
    store.set("mainviewSortBy", "year");
  }

  // Backward compatibility: split Ask and AI-tag model configs from legacy qwenChat* keys.
  if (!store.has("qwenAskBaseURL")) {
    store.set(
      "qwenAskBaseURL",
      (store.get("qwenChatBaseURL") as string) ||
        _defaultPreferences.qwenAskBaseURL
    );
  }
  if (!store.has("qwenAskModel")) {
    store.set(
      "qwenAskModel",
      (store.get("qwenChatModel") as string) || _defaultPreferences.qwenAskModel
    );
  }
  if (!store.has("askContextProfile")) {
    store.set("askContextProfile", _defaultPreferences.askContextProfile);
  }
  if (!store.has("modelProvider")) {
    store.set("modelProvider", _defaultPreferences.modelProvider);
  }
  if (!store.has("askModelProvider")) {
    store.set("askModelProvider", _defaultPreferences.askModelProvider);
  }
  if (!store.has("tagModelProvider")) {
    store.set("tagModelProvider", _defaultPreferences.tagModelProvider);
  }
  if (!store.has("embeddingModelProvider")) {
    store.set(
      "embeddingModelProvider",
      _defaultPreferences.embeddingModelProvider
    );
  }
  if (!store.has("qwenAITagBaseURL")) {
    store.set(
      "qwenAITagBaseURL",
      (store.get("qwenChatBaseURL") as string) ||
        _defaultPreferences.qwenAITagBaseURL
    );
  }
  if (!store.has("qwenAITagModel")) {
    store.set(
      "qwenAITagModel",
      (store.get("qwenChatModel") as string) ||
        _defaultPreferences.qwenAITagModel
    );
  }
  if (!store.has("chatModelListCache")) {
    store.set("chatModelListCache", {});
  }
  if (!store.has("shortcutCompare")) {
    store.set("shortcutCompare", _defaultPreferences.shortcutCompare);
  }
  if (!store.has("quickpasteLastCompareInstruction")) {
    store.set(
      "quickpasteLastCompareInstruction",
      _defaultPreferences.quickpasteLastCompareInstruction
    );
  }
  if (!store.has("quickpasteLastCompareResult")) {
    store.set(
      "quickpasteLastCompareResult",
      _defaultPreferences.quickpasteLastCompareResult
    );
  }
  if (!store.has("quickpasteComparePaperIds")) {
    store.set(
      "quickpasteComparePaperIds",
      _defaultPreferences.quickpasteComparePaperIds
    );
  }
  if (!store.has("quickpasteCompareRequestAt")) {
    store.set(
      "quickpasteCompareRequestAt",
      _defaultPreferences.quickpasteCompareRequestAt
    );
  }
  if (!store.has("arxivRecommendationKeywords")) {
    store.set(
      "arxivRecommendationKeywords",
      _defaultPreferences.arxivRecommendationKeywords
    );
  }
  if (!store.has("arxivRecommendationKeywordColors")) {
    store.set(
      "arxivRecommendationKeywordColors",
      _defaultPreferences.arxivRecommendationKeywordColors
    );
  }
  if (!store.has("arxivRecommendationScoreWidth")) {
    store.set(
      "arxivRecommendationScoreWidth",
      _defaultPreferences.arxivRecommendationScoreWidth
    );
  }
  if (!store.has("arxivRecommendationSortBy")) {
    store.set(
      "arxivRecommendationSortBy",
      _defaultPreferences.arxivRecommendationSortBy
    );
  }
  if (!store.has("arxivRecommendationSortOrder")) {
    store.set(
      "arxivRecommendationSortOrder",
      _defaultPreferences.arxivRecommendationSortOrder
    );
  }

  store.set("preferenceVersion", preferenceVersion);

  return store;
}

export const IPreferenceService = createDecorator("preferenceService");

export const PREFERENCE_VERSION: number = 2;

/**
 * Preference service.
 * It is a wrapper of ElectronStore with responsive states.
 */
export class PreferenceService extends Eventable<IPreferenceStore> {
  private readonly _store: ElectronStore<IPreferenceStore>;

  constructor() {
    let _store: ElectronStore<IPreferenceStore>;

    _store = new ElectronStore<IPreferenceStore>({});
    _store = _migrate(_store, PREFERENCE_VERSION);

    super("preferenceService", JSON.parse(JSON.stringify(_store.store)));

    this._store = _store;
  }

  /**
   * Get the value of the preference
   * @param key - Key of the preference
   * @returns Value of the preference
   */
  @errorcatching("Failed to get preference.", true, "PrefService", null)
  get(key: keyof IPreferenceStore) {
    if (this._store.has(key)) {
      return this._store.get(key);
    } else {
      const patch = {};
      patch[key] = _defaultPreferences[key];
      this.set(patch);
      return _defaultPreferences[key];
    }
  }

  /**
   * Set the value of the preference
   * @param patch - Patch object
   */
  @errorcatching("Failed to set preference.", true, "PrefService")
  set(patch: Partial<IPreferenceStore>) {
    this._store.set(patch);
    this.fire(patch);
  }

  /**
   * Get the password
   * @param key - Key of the password
   * @returns Password
   */
  @errorcatching("Failed to get password.", true, "PrefService", null)
  async getPassword(key: string) {
    return (
      (await keytar.getPassword("papermind", key)) ||
      (await keytar.getPassword("paperlib", key))
    );
  }

  /**
   * Set the password
   * @param key - Key of the password
   * @param pwd - Password
   */
  @errorcatching("Failed to set password.", true, "PrefService")
  async setPassword(key: string, pwd: string) {
    await keytar.setPassword("papermind", key, pwd);
  }
}
