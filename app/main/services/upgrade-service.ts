import { app } from "electron";

import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";

export interface IUpgradeServiceState {
  checking: number;
  available: number;
  notAvailable: number;
  error: any;
  downloaded: number;
  downloading: number;
}

export const IUpgradeService = createDecorator("upgradeService");

export class UpgradeService extends Eventable<IUpgradeServiceState> {
  constructor() {
    super("upgradeService", {
      checking: 0,
      available: 0,
      notAvailable: 0,
      error: null,
      downloaded: 0,
      downloading: 0,
    });
  }

  public checkForUpdates(): void {
    this.fire({ error: "Auto update is disabled in this build." });
  }

  public currentVersion(): string {
    return app.getVersion();
  }
}
