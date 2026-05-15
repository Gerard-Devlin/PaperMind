declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

declare module "*.png?asset" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*?modulePath" {
  const path: string;
  export default path;
}
