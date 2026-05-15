import { domReady } from "@/base/misc";
import { appendLoading, removeLoading } from "@/base/loading";
import { RPCBridge } from "@/base/rpc/preload-bridge";
import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge } from "electron";

domReady().then(() => {
  appendLoading();
  // Hard fallback: never keep splash forever even if renderer initialization fails.
  setTimeout(() => {
    try {
      removeLoading();
    } catch (error) {
      console.error("Failed to remove loading in preload fallback:", error);
    }
  }, 30000);
});

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = electronAPI;
}

RPCBridge();
