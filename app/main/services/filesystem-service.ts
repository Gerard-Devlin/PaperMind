import { errorcatching } from "@/base/error";
import { createDecorator } from "@/base/injection/injection";
import { eraseProtocol } from "@/base/url";
import {
  BrowserWindow,
  IpcMainEvent,
  OpenDialogReturnValue,
  app,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const IFileSystemService = createDecorator("fileSystemService");

export class FileSystemService {
  constructor() {
    ipcMain.on(
      "getSystemPath",
      (
        event: IpcMainEvent,
        key:
          | "home"
          | "appData"
          | "userData"
          | "sessionData"
          | "temp"
          | "exe"
          | "module"
          | "desktop"
          | "documents"
          | "downloads"
          | "music"
          | "pictures"
          | "videos"
          | "recent"
          | "logs"
          | "crashDumps"
      ) => {
        event.returnValue = app.getPath(key);
      }
    );
  }

  /**
   * Get the path of the given key.
   * @param {string} key - The key to get the path of.
   * @returns {string} - The path of the given key.
   */
  @errorcatching("Failed to get system path.", true, "FileSystemService")
  getSystemPath(
    key:
      | "home"
      | "appData"
      | "userData"
      | "sessionData"
      | "temp"
      | "exe"
      | "module"
      | "desktop"
      | "documents"
      | "downloads"
      | "music"
      | "pictures"
      | "videos"
      | "recent"
      | "logs"
      | "crashDumps",
    windowId: string
  ): string {
    return app.getPath(key);
  }

  /**
   * Show a file picker.
   * @returns {Promise<OpenDialogReturnValue>} The result of the file picker.
   */
  @errorcatching("Failed to show file picker.", true, "FileSystemService")
  showFilePicker(
    props?: Array<
      | "openDirectory"
      | "multiSelections"
      | "showHiddenFiles"
      | "createDirectory"
      | "promptToCreate"
      | "noResolveAliases"
      | "treatPackageAsDirectory"
      | "dontAddToRecent"
    >
  ): Promise<OpenDialogReturnValue> {
    const properties: Array<
      | "openFile"
      | "openDirectory"
      | "multiSelections"
      | "showHiddenFiles"
      | "createDirectory"
      | "promptToCreate"
      | "noResolveAliases"
      | "treatPackageAsDirectory"
      | "dontAddToRecent"
    > = ["openFile"];
    if (props) {
      properties.push(...props);
    }
    return dialog.showOpenDialog({
      properties,
    });
  }

  /**
   * Show a folder picker.
   * @returns {Promise<OpenDialogReturnValue>} The result of the folder picker.
   */
  @errorcatching("Failed to show folder picker.", true, "FileSystemService")
  showFolderPicker(): Promise<OpenDialogReturnValue> {
    return dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
  }

  /**
   * Preview a file.
   * @param {string} fileURL - The URL of the file to preview.
   */
  @errorcatching("Failed to preview file.", true, "FileSystemService")
  preview(fileURL: string) {
    if (process.platform === "darwin") {
      BrowserWindow.getFocusedWindow()?.previewFile(eraseProtocol(fileURL));
    }
  }

  /**
   * Write some text to a file.
   * @param {string} filePath The path of the file to write to.
   * @param {string} text The text to write to the file.
   * @returns {void} Nothing.
   */
  @errorcatching("Failed to write to file.", true, "FileSystemService")
  writeToFile(filePath: string, text: string): void {
    writeFileSync(filePath, text);
  }

  /**
   * Render a self-contained HTML document to PDF and let the user choose where to save it.
   */
  @errorcatching("Failed to save PDF.", true, "FileSystemService", "")
  async saveHTMLAsPDF(html: string, defaultFileName = "PaperMind Compare.pdf") {
    const fileName = defaultFileName.toLowerCase().endsWith(".pdf")
      ? defaultFileName
      : `${defaultFileName}.pdf`;
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save PDF",
      defaultPath: fileName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) {
      return "";
    }

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    try {
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      );
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        landscape: true,
        pageSize: "A4",
      });
      writeFileSync(filePath, pdf);
      return filePath;
    } finally {
      window.destroy();
    }
  }

  startDrag(filePaths: string[]) {
    BrowserWindow.getFocusedWindow()?.webContents.startDrag({
      file: "",
      files: filePaths,
      icon:
        process.env.NODE_ENV === "development"
          ? path.resolve(
              fileURLToPath(new URL("../public/pdf.png", import.meta.url))
            )
          : path.resolve(fileURLToPath(new URL("pdf.png", import.meta.url))),
    });
  }

  /**
   * Show the URL in Finder / Explorer.
   * @param url - URL to show
   */
  @errorcatching("Failed to show the URL in Finder.", true, "FileService")
  async showInFinder(url: string) {
    shell.showItemInFolder(path.normalize(url));
  }

  /**
   * Open the URL in the default browser.
   * @param url - URL to open
   */
  openExternal(url: string) {
    shell.openExternal(url);
  }

  /**
   * Open the path in the default file manager.
   * @param url - Path to open
   */
  openPath(url: string) {
    shell.openPath(url);
  }
}
