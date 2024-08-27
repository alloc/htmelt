import * as chokidar from 'chokidar'
import * as esbuild from 'esbuild'
import * as http from 'http'
import * as htmlMinifierTerser from '../types/html-minifier-terser'
import * as lightningCss from '../types/lightningcss'
import type { Merge } from '../types/type-fest'
import type { Plugin, PluginInstance } from './index.mjs'

export type UserConfig = {
  /**
   * The root directory of the project.
   *
   * If not defined, the dirname of the config file is used. If no config file
   * is found, the current working directory is used.
   */
  root?: string
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
   * Entry points matching these patterns are excluded from production builds.
   */
  devOnlyEntries?: string[]
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
  deletePrev?: boolean
  plugins?: Plugin[]
}

export type RawServerConfig = {
  port?: number
  https?: boolean | HttpsConfig
  /**
   * In development mode, you can have the dev server import your API server's
   * request handler directly. This is useful for testing your API server
   * without having to run it separately.
   */
  handler?: {
    /**
     * The module path to your API server's request handler factory. The factory
     * is always passed `"development"` even if you set `config.mode` or
     * `NODE_ENV` to something else.
     *
     * It must point to a JavaScript or TypeScript module whose default export
     * is a function like this:
     *
     *     (env?: 'development') => (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
     */
    entry: string
    /**
     * Prevent bundling of any modules whose resolved ID is matched by any of
     * the given strings or regular expressions. Only the full module paths are
     * matched against for regular expressions, while strings are matched
     * against each directory segment after the workspace root.
     *
     * This is useful for pre-compiled packages that live in your workspace
     * outside of a `node_modules` directory.
     *
     * Note that `node_modules` and files outside the workspace root are always
     * externalized.
     */
    external?: (string | RegExp)[]
  }
}

export type RequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => Promise<void> | void

export type ServerConfig = {
  url: URL
  port: number
  https?: { cert?: string; key?: string }
  handler?: RequestHandler
  handlerContext?: esbuild.BuildContext
}

export type HttpsConfig = {
  cert: string
  key: string
}

export interface Module {
  id: string
  imports: Set<string>
}

// These properties aren't needed past the config-loading phase.
type OmittedUserProps = 'devOnlyEntries' | 'forcedEntries' | 'watchFiles'

export type Config = Merge<
  Required<Omit<UserConfig, OmittedUserProps>>,
  ConfigAPI & {
    gitRoot: string | null
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

    /**
     * Modules bundled for the client. Exists in watch mode only.
     *
     * Implemented with case-insensitive keys to align with Esbuild.
     */
    modules?: Map<string, Module>

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
   *
   * To include a content hash, pass the content with the `content` option.
   */
  getBuildPath(
    file: string,
    options?: { content?: string | Buffer; absolute?: boolean }
  ): string
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
