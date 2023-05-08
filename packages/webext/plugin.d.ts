import type { WebExtension } from './index.d.ts'

declare module '@htmelt/plugin' {
  export interface PluginInstance {
    webext?: {
      manifest?: WebExtension.ManifestHook
    }
  }
  export interface Flags {
    platform?: WebExtension.Platform
  }
}

export {}
