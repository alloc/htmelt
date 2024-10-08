import {
  CLI,
  Config,
  ConfigAPI,
  fileToId,
  Flags,
  HttpsConfig,
  loadConfigFile,
  md5Hex,
  Plugin,
  UserConfig,
} from '@htmelt/plugin'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import chokidar from 'chokidar'
import * as fs from 'fs'
import glob from 'glob'
import * as lightningCss from 'lightningcss'
import * as path from 'path'
import { importHandler } from './devServer.mjs'
import localAddress from './localAddress.mjs'
import { createRelatedWatcher } from './relatedWatcher.mjs'
import { CaseInsensitiveMap, findDirectoryUp, findFreeTcpPort } from './utils.mjs'

const env = JSON.stringify
const Glob = glob.Glob

/**
 * Load the `bundle.config.js` file from the working directory, or use
 * the `bundle` property in package.json.
 */
export async function loadBundleConfig(flags: Flags, cli?: CLI) {
  const nodeEnv = (process.env.NODE_ENV ||= 'development')

  const configResult = await loadConfigFile<UserConfig>('bundle.config')
  const userConfig = configResult?.mod.default ?? {}

  if (configResult) {
    console.log(
      'Loaded %s in %sms',
      path.relative(process.cwd(), configResult.filePath),
      configResult.loadTime
    )
  }

  const preDefaultPlugins: Plugin[] = [
    await loadPlugin(import('./plugins/alias.mjs')),
    await loadPlugin(import('./plugins/virtualFiles.mjs')),
    await loadPlugin(import('./plugins/cssCodeSplit.mjs')),
  ]
  const postDefaultPlugins: Plugin[] = []
  if (flags.watch) {
    preDefaultPlugins.push(
      await loadPlugin(
        import('./plugins/cssReload.mjs') //
      )
    )
    postDefaultPlugins.push(
      await loadPlugin(import('./plugins/liveBundles.mjs')),
      await loadPlugin(import('./plugins/devModules.mjs'))
    )
  }

  const srcDir = normalizePath(userConfig.src ?? 'src')
  const outDir = normalizePath(flags.outDir || (userConfig.build ?? 'build'))

  const srcDirPrefix = srcDir ? srcDir + '/' : srcDir
  const outDirPrefix = outDir + '/'

  const devOnlyEntries =
    (nodeEnv !== 'development' &&
      userConfig.devOnlyEntries?.map(
        glob => new Glob(srcDirPrefix + glob).minimatch
      )) ||
    []

  const entries = glob
    .sync(srcDirPrefix + '**/*.html')
    .filter(file => {
      return (
        !file.startsWith(outDirPrefix) &&
        !devOnlyEntries.some(pattern => pattern.match(file))
      )
    })
    .concat(userConfig.forcedEntries || [])
    .map(file => ({
      file,
    }))

  const plugins = preDefaultPlugins.concat(
    userConfig.plugins || [],
    postDefaultPlugins
  )

  const browsers = userConfig.browsers ?? '>=0.25%, not dead'
  const virtualFiles: Record<string, Plugin.VirtualFile> = {}

  function setRelatedFiles(
    filePath: string,
    result: { path?: string; watchFiles?: string[]; watchDirs?: string[] }
  ) {
    const relatedPath = result.path || filePath
    result.watchFiles?.forEach(watchedFile => {
      config.relatedWatcher?.watchFile(watchedFile, relatedPath)
    })
    result.watchDirs?.forEach(watchedDir => {
      config.relatedWatcher?.watchDirectory(watchedDir, relatedPath)
    })
  }

  let serverUrl: URL | undefined

  const api: ConfigAPI = {
    setVirtualFile(filePath, virtualFile) {
      this.unsetVirtualFile(filePath)
      if (virtualFile.promise) {
        virtualFile.promise.then(result => {
          if (result) {
            setRelatedFiles(filePath, result)
          }
        })
      } else if (virtualFile.current) {
        setRelatedFiles(filePath, virtualFile.current)
      }
      virtualFiles[filePath] = virtualFile
    },
    unsetVirtualFile(filePath) {
      const virtualFile = virtualFiles[filePath]
      if (!virtualFile) {
        return
      }
      if (virtualFile.promise) {
        virtualFile.promise.then(result => {
          if (result) {
            config.relatedWatcher?.forgetRelatedFile(result.path || filePath)
          }
        })
      } else if (virtualFile.current) {
        config.relatedWatcher?.forgetRelatedFile(
          virtualFile.current.path || filePath
        )
      }
      delete virtualFiles[filePath]
    },
    watch(paths, options) {
      let ignored = config.watchIgnore as Extract<
        chokidar.WatchOptions['ignored'],
        any[]
      >
      if (options?.ignored) {
        ignored = ignored.concat(options.ignored)
      }
      return chokidar.watch(paths, {
        atomic: true,
        ignoreInitial: true,
        ignorePermissionErrors: true,
        ...options,
        ignored,
      })
    },
    getBuildPath(file, opts = {}) {
      let outFile = file

      const wasAbsolute = path.isAbsolute(file)
      if (wasAbsolute) {
        file = path.relative(process.cwd(), file)
      }

      const src = config.src.replace(/^\.\//, '') + '/'
      if (file.startsWith(src)) {
        outFile = file.replace(src, config.build + '/')
      } else {
        // If a file exists outside the working directory, only its basename is
        // used in the file's build path.
        outFile = path.join(
          config.build,
          file.startsWith('..') ? path.basename(file) : file
        )
      }

      // Absolute path in, absolute path out
      if (opts.absolute || (wasAbsolute && opts.absolute !== false)) {
        outFile = path.join(process.cwd(), outFile)
      }

      // Replace .jsx/.tsx with .js
      outFile = outFile.replace(/\.([cm]?)(?:jsx|tsx?)$/, '.$1js')

      // Add a content hash if content was provided
      if (opts.content != null) {
        const contentHash = md5Hex(opts.content).slice(0, 8).toUpperCase()
        outFile = outFile.replace(/(\.[^./]+)$/, '.' + contentHash + '$1')
      }

      return outFile
    },
    resolveDevUrl(id, importer) {
      let url = config.resolve(id, importer)
      if (url.protocol === 'file:') {
        url = new URL(fileToId(url.pathname), serverUrl)
      }
      return url
    },
    resolve(id, importer = serverUrl) {
      if (typeof importer === 'string') {
        importer = new URL(importer, 'file:')
      }
      if (id[0] === '/' && importer?.protocol === 'file:') {
        return new URL('file://' + process.cwd() + id)
      }
      return new URL(id, importer)
    },
    mergeServerConfig(config) {
      userConfig.server = {
        ...userConfig.server,
        ...config,
      }
    },
    async loadServerConfig() {
      const serverConfig = userConfig.server || {}
      const https =
        serverConfig.https != true
          ? serverConfig.https || undefined
          : ({} as HttpsConfig)

      let port = flags.port ?? (serverConfig.port || 0)
      if (port == 0) {
        port = await findFreeTcpPort()
      }

      const protocol = https ? 'https' : 'http'
      const host = flags.host
        ? localAddress(flags.host === true ? 'public' : flags.host)
        : 'localhost'

      const url = (serverUrl = new URL(`${protocol}://${host}:${port}`))

      config.esbuild.define['import.meta.env.DEV_URL'] = env(url)
      config.esbuild.define['import.meta.env.HMR_URL'] = env(
        (https ? 'wss' : 'ws') + `://${host}:${port}`
      )

      config.server = {
        ...serverConfig,
        handler: undefined,
        handlerContext: undefined,
        https,
        port,
        url,
      }

      if (serverConfig.handler) {
        config.server.handlerContext = await importHandler(
          serverConfig.handler,
          config
        )
      }

      return config.server
    },
    // Set by the internal ./plugins/devModules.mjs plugin.
    // Not available during plugin setup.
    loadDevModule: null!,
  }

  const config: Config = {
    assets: 'public',
    deletePrev: false,
    ...userConfig,
    gitRoot: findDirectoryUp(process.cwd(), ['.git']),
    mode: nodeEnv,
    src: srcDir,
    build: outDir,
    base:
      flags.base ??
      userConfig.base ??
      '/' + path.relative(process.cwd(), outDir) + '/',
    entries,
    plugins: [],
    bundles: undefined!,
    virtualFiles,
    browsers,
    modules: undefined,
    watcher: undefined,
    watchIgnore: [
      '**/{node_modules,.git,.DS_Store}',
      '**/{node_modules,.git}/**',
      ...(userConfig.watchIgnore || []),
    ],
    linkedPackages: flags.watch ? findLinkedPackages(process.cwd()) : undefined,
    fsAllowedDirs: new Set(),
    copy: userConfig.copy || [],
    alias: userConfig.alias || {},
    scripts: userConfig.scripts || [],
    htmlMinifierTerser: userConfig.htmlMinifierTerser || {},
    esbuild: {
      ...userConfig.esbuild,
      plugins: userConfig.esbuild?.plugins || [],
      target: userConfig.esbuild?.target ?? browserslistToEsbuild(browsers),
      define: {
        ...userConfig.esbuild?.define,
        'process.env.NODE_ENV': env(nodeEnv),
        'import.meta.env.DEV': env(nodeEnv != 'production'),
        'import.meta.env.DEV_URL': 'undefined',
        'import.meta.env.HMR_URL': 'undefined',
      },
    },
    lightningCss: {
      ...userConfig.lightningCss,
      targets:
        userConfig.lightningCss?.targets ??
        lightningCss.browserslistToTargets(browserslist(browsers)),
    },
    server: null!,
    ...api,
  }

  if (flags.watch) {
    config.modules = new CaseInsensitiveMap()
    config.watcher = config.watch([srcDir, ...(userConfig.watchFiles || [])])
    config.relatedWatcher = createRelatedWatcher(config)
  }

  await Promise.all(
    plugins.map(async setup => {
      const plugin = await setup(config, flags)
      if (plugin) {
        config.plugins.push(plugin)
      }
    })
  )

  if (cli) {
    for (const plugin of config.plugins) {
      plugin.commands?.(cli)
    }
  }

  return config
}

async function loadPlugin(plugin: Promise<any>) {
  const module = await plugin
  return module.default ? module.default : Object.values(module)[0]
}

// This function adds all linked packages to the watcher
// so that the watcher will detect changes in these packages.
function findLinkedPackages(root: string, linkedPackages = new Set<string>()) {
  const nodeModulesDir = path.join(root, 'node_modules')
  try {
    const nodeModules = fs
      .readdirSync(nodeModulesDir)
      .flatMap(name =>
        name[0] === '@'
          ? fs
              .readdirSync(path.join(nodeModulesDir, name))
              .map(scopedName => path.join(name, scopedName))
          : name
      )

    // Do a breadth-first search for linked packages.
    const queue: string[] = []
    for (const name of nodeModules) {
      const dependencyDir = path.join(nodeModulesDir, name)
      const resolvedDependencyDir = fs.realpathSync(dependencyDir)
      if (
        resolvedDependencyDir !== dependencyDir &&
        !resolvedDependencyDir.includes('node_modules') &&
        !linkedPackages.has(resolvedDependencyDir) &&
        path.relative(root, resolvedDependencyDir).startsWith('..')
      ) {
        queue.push(resolvedDependencyDir)
        linkedPackages.add(resolvedDependencyDir)
      }
    }
    for (const root of queue) {
      findLinkedPackages(root, linkedPackages)
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  return linkedPackages
}

function normalizePath(p: string) {
  p = path.normalize(p)
  return p === './' ? '' : p.replace(/\/$/, '')
}
