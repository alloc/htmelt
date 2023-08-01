import { BundleFlags, Plugin } from '@htmelt/plugin'

export type BundleInstance = {
  readonly documents: Readonly<Record<string, Plugin.Document>>
  readonly scripts: Readonly<Record<string, Plugin.Script>>
  rebuildHTML(uri: string): Promise<void>
  rebuildStyles(): Promise<void>
  dispose(): void
}

export function bundle(flags?: BundleFlags): Promise<BundleInstance>
