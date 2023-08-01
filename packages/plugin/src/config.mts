import * as chokidar from 'chokidar'
import * as esbuild from 'esbuild'
import * as htmlMinifierTerser from '../types/html-minifier-terser'
import * as lightningCss from '../types/lightningcss'
import type { Merge } from '../types/type-fest'
import type { Plugin, PluginInstance } from './index.mjs'

export type UserConfig = {
  /**
   * The directory to crawl for HTML files.
   * @default "src"
   */
  src?: string
  /**
   * Where the build artifacts are saved.
   * @default "build"
   */
  build?: string
  /**
   * The base URL used in HTML artifacts.
   * @default "/" + this.build + "/"
   */
  base?: string
  /**
   * Where the assets directory is located.
   * @default "public"
   */
  assets?: string
  /**
   * Files to copy to the build directory. Globs are supported.
   */
  copy?: (string | Record<string, string>)[]
  /**
   * Globs to use as entry points for dynamically inserted `<script>` tags.
   */
  scripts?: string[]
  /**
   * Additional entry points to include in the build. This can be useful if you
   * want to import a module for unbundled scripting purposes.
   */
  forcedEntries?: string[]
  /**
   * Import aliases can be map to another specifier or a virtual file.
   */
  alias?: Record<string, string | Plugin.VirtualFile>
  /**
   * Watch files outside of the `src` directory.
   */
  watchFiles?: string[]
  /**
   * Passed to chokidar's `ignored` option.
   *
   * @see https://www.npmjs.com/package/chokidar#path-filtering
   */
  watchIgnore?: (string | RegExp)[]
  /**
   * Compile JS/CSS syntax to be compatible with the browsers that match
   * the given Browserslist query.
   */
  browsers?: string
  server?: RawServerConfig
  /** @see https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run */
  esbuild?: esbuild.BuildOptions
  lightningCss?: Omit<lightningCss.BundleAsyncOptions<any>, 'filename'>
  htmlMinifierTerser?: htmlMinifierTerser.Options
  isCritical?: boolean
  deletePrev?: boolean
  plugins?: Plugin[]
}

export type RawServerConfig = {
  port?: number
  https?: boolean | HttpsConfig
}

export type ServerConfig = {
  url: URL
  port: number
  https?: { cert?: string; key?: string }
}

export type HttpsConfig = {
  cert: string
  key: string
}

export interface Module {
  id: string
  imports: Set<string>
}

export type Config = Merge<
  Required<Omit<UserConfig, 'watchFiles'>>,
  ConfigAPI & {
    mode: string
    entries: Entry[]
    plugins: PluginInstance[]
    esbuild: esbuild.BuildOptions & {
      plugins: esbuild.Plugin[]
      define: Record<string, string>
    }

    ///////////////////////////
    //// Watch mode config ////
    ///////////////////////////

    /** Resolved when the most recent build is completed. */
    lastBuild?: Promise<void>

    /**
     * Every script bundle by its ID.
     *
     * Exists after the initial build is completed.
     */
    bundles: Readonly<Record<string, Plugin.Bundle>>

    /** The dev server's URL, port number, and HTTPS credentials. */
    server: ServerConfig

    /**
     * Virtual files are generated by plugins and served in watch mode.
     *
     * Keys must be absolute file paths.
     */
    virtualFiles: Readonly<Record<string, Plugin.VirtualFile>>

    /** Packages that have been linked into `node_modules` somewhere. */
    linkedPackages?: Set<string>

    /** Modules bundled for the client. Exists in watch mode only. */
    modules?: Record<string, Module>

    /**
     * Watches the filesystem so the bundler and plugins can react to
     * file changes.
     *
     * Plugins can add their own files with the `watcher.add` method and
     * handle file events with the `watcher.on` method.
     *
     * Note that `.js` files won't trigger a rebuild unless they have a
     * corresponding `Module` object in the `config.modules` map.
     */
    watcher?: chokidar.FSWatcher

    /**
     * Watch for added and removed children of specific directories.
     *
     * Behaves like the `watchDirs` API of esbuild.
     */
    relatedWatcher?: RelatedWatcher

    /** Paths and patterns that shouldn't be watched. */
    watchIgnore: IgnorePattern[]

    /**
     * Absolute paths to directories that can be accessed from dev
     * server via `/@fs/` prefix. Plugins may want to add to this.
     */
    fsAllowedDirs: Set<string>
  }
>

type IgnorePattern = Exclude<WatchOptions['ignored'], any[] | undefined>

type WatchOptions = chokidar.WatchOptions & {
  requestRebuild?: boolean
}

export interface ConfigAPI {
  setVirtualFile(filePath: string, virtualFile: Plugin.VirtualFile): void
  unsetVirtualFile(filePath: string): void
  /**
   * Watch a directory or file that exists outside the working
   * directory.
   */
  watch(
    paths: string | readonly string[],
    options?: WatchOptions
  ): chokidar.FSWatcher
  /**
   * Convert a `src` path into a `build` path.
   */
  getBuildPath(file: string): string
  /**
   * Get the `file:` URL for an absolute or relative file path. If the
   * `id` is relative and `importer` is undefined (or an `https:` URL),
   * you'll get an `https:` URL instead.
   */
  resolve(id: string, importer?: string | URL): URL
  /**
   * Similar to `resolve` but you always get a dev server URL in
   * return (i.e. never a `file:` URL).
   */
  resolveDevUrl(id: string, importer?: string | URL): URL
  /**
   * If a `.css` file isn't imported by an HTML file (eg: imported by
   * JS), it needs to be explicitly registered, or else the `cssReload`
   * plugin won't rebundle it when it or one of its dependencies is
   * changed.
   *
   * Only exists in watch mode.
   */
  registerCssEntry?(file: string, code?: string, loader?: 'js' | 'css'): void
  /**
   * Load a JS module via the esbuild pipeline and bundle any
   * dependencies that are new. Previously seen dependencies are
   * replaced with `htmelt.import` calls.
   */
  loadDevModule(entry: string): Promise<string>
  /**
   * The `config.server` property equals `null` until this is called.
   *
   * ⚠️ You likely shouldn't call this from a plugin.
   */
  loadServerConfig(): Promise<ServerConfig>
  /**
   * Update the `userConfig.server` object before the `config.server`
   * property is loaded with `loadServerConfig`.
   */
  mergeServerConfig(config: RawServerConfig): void
}

export type Entry = {
  file: string
  /**
   * If a plugin sets this, this file will be bundled separately from
   * the default bundle. This applies to JS only, but an HTML entry with
   * this property will apply it to all of its scripts.
   */
  bundleId?: string
  /**
   * Set to false to disable HMR for the bundle this entry is part of.
   */
  hmr?: boolean
}

// Keep aligned with htmelt/src/relatedWatcher.ts
export type RelatedWatcher = {
  watchFile(file: string, relatedFile: string): void
  watchDirectory(dir: string, relatedFile: string): void
  forgetRelatedFile(relatedFile: string): void
  onChange(callback: (relatedFile: string) => void): void
  close(): Promise<void>
}
