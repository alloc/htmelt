import * as chokidar from 'chokidar'
import * as esbuild from 'esbuild'
import { EventEmitter } from 'events'
import { Merge } from 'type-fest'
import * as htmlMinifierTerser from '../types/html-minifier-terser'
import * as lightningCss from '../types/lightningcss'
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
  server?: ServerConfig
  /** @see https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run */
  webext?: boolean | WebExtension.Config
  esbuild?: esbuild.BuildOptions
  lightningCss?: Omit<lightningCss.BundleAsyncOptions<any>, 'filename'>
  htmlMinifierTerser?: htmlMinifierTerser.Options
  isCritical?: boolean
  deletePrev?: boolean
  plugins?: Plugin[]
}

export type ServerConfig = {
  port?: number
  https?: boolean | { cert: string; key: string }
}

export namespace WebExtension {
  export type Config = {
    artifactsDir?: string
    /**
     * Copy the `webextension-polyfill` file into your build directory,
     * then inject it into your extension.
     */
    polyfill?: boolean
    run?: RunOptions
  }

  export type RunTarget = 'firefox-desktop' | 'firefox-android' | 'chromium'

  export type RunOptions = {
    target?: RunTarget | RunTarget[]
    startUrl?: string | string[]
    firefox?: FirefoxRunOptions
    chromium?: ChromiumRunOptions
    reload?: boolean
    keepProfileChanges?: boolean
  }

  export type FirefoxRunOptions = {
    binary?: 'firefox' | 'beta' | 'nightly' | 'deved' | (string & {})
    profile?: string
    keepProfileChanges?: boolean
    devtools?: boolean
    browserConsole?: boolean
    preInstall?: boolean
    args?: string[]
  }

  export type ChromiumRunOptions = {
    binary?: string
    profile?: string
    keepProfileChanges?: boolean
    args?: string[]
  }
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
    events: EventEmitter
    esbuild: esbuild.BuildOptions & {
      plugins: esbuild.Plugin[]
      define: Record<string, string>
    }
    webext?: WebExtension.Config

    ///////////////////////////
    //// Watch mode config ////
    ///////////////////////////

    /** Resolved when the most recent build is completed. */
    lastBuild?: Promise<void>

    /** The dev server's URL, port number, and HTTPS credentials. */
    server: {
      url: URL
      port: number
      https?: { cert?: string; key?: string }
    }

    /** Virtual files are generated by plugins and served in watch mode. */
    virtualFiles: Record<string, Plugin.VirtualFile>

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
  registerCssEntry?(file: string, code?: string): void
  /**
   * Load a JS module via the esbuild pipeline and bundle any
   * dependencies that are new. Previously seen dependencies are
   * replaced with `htmelt.import` calls.
   */
  loadDevModule(entry: string): Promise<string>
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
