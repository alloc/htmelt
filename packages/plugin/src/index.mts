import * as esbuild from 'esbuild'
import * as http from 'http'
import type { Emitter } from 'mitt'
import type { Attribute, Element, ParentNode } from 'parse5'
import type { Promisable } from 'type-fest'
import type { UrlWithStringQuery } from 'url'
import * as lightningCss from '../types/lightningcss'
import type { Config, Entry, WebExtension } from './config.mjs'
import type { Flags } from './flags.mjs'

export * from '@rollup/pluginutils'
export { default as md5Hex } from 'md5-hex'
export * from 'mitt'
export { default as mitt } from 'mitt'
export * from 'parse5'
export * from './config.mjs'
export * from './flags.mjs'
export * from './parse5/utils.mjs'

export interface Plugin {
  (config: Config, flags: Flags): Promisable<PluginInstance>
}

export interface PluginInstance {
  /**
   * Called after esbuild has finished bundling the entry scripts found
   * within all of your HTML files.
   */
  bundles?: Plugin.BundlesHook
  cssPlugins?: CssPlugin[]
  document?: Plugin.DocumentHook
  hmr?: Plugin.HmrHook
  initialBuild?: Plugin.InitialBuildHook
  fullReload?: Plugin.FullReloadHook
  serve?: Plugin.ServeHook
  /**
   * Must return `true` if changes are made to the `manifest` object.
   */
  webext?: Plugin.WebExtHook
}

export namespace Plugin {
  export type ServeHook = (
    request: Request,
    response: http.ServerResponse
  ) => Promisable<VirtualFileData | void>

  export type DocumentHook = (document: Document) => Promisable<void>

  export type InitialBuildHook = () => Promisable<void>

  export type FullReloadHook = () => Promisable<void>

  export type BundlesHook = (bundle: Record<string, Bundle>) => void

  export type HmrHook = (clients: ClientSet) => HmrInstance | void

  export type WebExtHook = (
    manifest: any,
    webextConfig: WebExtension.Config
  ) => Promisable<boolean>

  export interface Request extends http.IncomingMessage, UrlWithStringQuery {
    url: string
    path: string
    pathname: string
    searchParams: URLSearchParams
  }

  export interface HmrInstance {
    /**
     * Return true to prevent full reload.
     */
    accept(file: string): boolean | void
    update(files: string[]): Promisable<void>
  }

  export interface ClientSet extends ReadonlySet<Client> {
    on(type: 'connect', handler: (event: ClientEvent) => void): void
    on(type: string, handler: (event: ClientEvent) => void): void
  }

  export interface Client extends Emitter<ClientEvents> {
    evaluate: <T = any>(expr: string) => Promise<T>
    evaluateModule: <T = any>(file: string | URL, args: any[]) => Promise<T>
    getURL: () => Promise<string>
    reload: () => void
  }

  /**
   * Plugins can extend this via "interface declaration merging" with
   * `declare module` syntax, so they can emit custom events on HMR
   * clients.
   */
  export interface ClientEvents extends Record<string | symbol, unknown> {
    'webext:uuid': { protocol: string; host: string }
  }

  export interface ClientEvent extends Record<string, any> {
    type: string
    client: Client
  }

  export type VirtualFileData = {
    path?: string
    mtime?: number
    headers?: Record<string, number | string | readonly string[]>
    data: string | Buffer
  }

  export type VirtualFile =
    | ((request: Request) => Promisable<VirtualFileData | null>)
    | Promisable<VirtualFileData | null>

  export interface Document extends Entry {
    documentElement: ParentNode
    scripts: ScriptReference[]
    styles: StyleReference[]
    bundle: Bundle
  }

  /**
   * A collection entry `<script>` tags that are bundled together.
   */
  export interface Bundle {
    id: string
    /**
     * Set this to false in the `bundles` plugin hook if you want to
     * force full reloads when an input file in this bundle is changed.
     */
    hmr: boolean
    scripts: Set<string>
    importers: Document[]
    context: esbuild.BuildContext<{ metafile: true }>
    metafile: esbuild.Metafile
    /** Same as `metafile.inputs` but mapped with `baseRelative` */
    inputs: string[]
  }

  /**
   * Standalone scripts are defined via the `scripts` config option.
   */
  export interface Script {
    srcPath: string
    outPath: string
    context: esbuild.BuildContext<{ write: false; metafile: true }>
    metafile: esbuild.Metafile
    /** Same as `metafile.inputs` but mapped with `baseRelative` */
    inputs: string[]
  }
}

export interface ServePlugin {
  serve: Exclude<PluginInstance['serve'], undefined>
}

export interface HmrPlugin {
  hmr: Exclude<PluginInstance['hmr'], undefined>
}

export interface CssPlugin {
  visitor: (importer: URL) => lightningCss.Visitor<any> | null
}

export interface StyleReference {
  readonly node: Element
  readonly srcAttr: Attribute
  readonly srcPath: string
  readonly outPath: string
}

export interface ScriptReference {
  readonly node: Element
  readonly srcAttr: Attribute
  readonly srcPath: string
  readonly outPath: string
  readonly isModule: boolean
}
