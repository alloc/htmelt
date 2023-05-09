import type { WebExtension } from './index.d.ts'

declare module '@htmelt/plugin/dist/importMeta.mjs' {
  export interface ImportMeta {
    platform: WebExtension.Platform
  }
}

export {}
