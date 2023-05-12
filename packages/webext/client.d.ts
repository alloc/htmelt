import type { WebExtension } from './dist/types.mjs'

declare module '@htmelt/plugin/dist/importMeta.mjs' {
  export interface ImportMeta {
    platform: WebExtension.Platform
  }
}

export {}
