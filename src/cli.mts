#!/usr/bin/env node

import { Config, Flags, md5Hex, Plugin, ServePlugin } from '@htmelt/plugin'
import cac from 'cac'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import { cyan, red, yellow } from 'kleur/colors'
import mitt, { Emitter } from 'mitt'
import * as mime from 'mrmime'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import { parse as parseURL } from 'url'
import * as uuid from 'uuid'
import * as ws from 'ws'
import { buildClientConnection } from './clientUtils.mjs'
import { copyFiles } from './copy.mjs'
import { buildRelativeStyles, findRelativeStyles } from './css.mjs'
import {
  buildEntryScripts,
  compileSeparateEntry,
  findRelativeScripts,
} from './esbuild.mjs'
import { buildHTML, parseHTML } from './html.mjs'
import {
  baseRelative,
  createDir,
  loadBundleConfig,
  lowercaseKeys,
  resolveDevMapSources,
  setsEqual,
} from './utils.mjs'

const cli = cac('htmelt')

cli
  .command('')
  .option('--watch', `[boolean]`)
  .option('--minify', `[boolean]`)
  .option('--critical', `[boolean]`)
  .option('--webext <target>', 'Override webext config')
  .action(async (flags: Flags) => {
    process.env.NODE_ENV ||= flags.watch ? 'development' : 'production'
    const config = await loadBundleConfig(flags)
    const context = await bundle(config, flags)
    if (!flags.watch) {
      context.dispose()
    }
  })

cli.parse()

type PartialBundle = {
  id: string
  hmr: boolean
  scripts: Set<string>
  importers: Plugin.Document[]
  entries?: Set<string>
  context?: esbuild.BuildContext<{ metafile: true }>
  metafile?: esbuild.Metafile
  /** Same as `metafile.inputs` but mapped with `baseRelative` */
  inputs?: string[]
}

async function bundle(config: Config, flags: Flags) {
  if (config.deletePrev) {
    fs.rmSync(config.build, { force: true, recursive: true })
  }

  let server: import('http').Server | undefined
  if (flags.watch) {
    const servePlugins = config.plugins.filter(p => p.serve) as ServePlugin[]
    server = await installHttpServer(config, servePlugins)
    await buildClientConnection(config)
  }

  const createBuild = () => {
    const bundles = new Map<string, PartialBundle>()
    const documents: Record<string, Plugin.Document> = {}
    const scripts: Record<string, Plugin.Script> = {}

    const loadDocument = (file: string) => {
      const html = fs.readFileSync(file, 'utf8')
      const documentElement = parseHTML(html)
      const scripts = findRelativeScripts(documentElement, file, config)
      const styles = findRelativeStyles(documentElement, file, config)
      return { documentElement, scripts, styles }
    }

    const buildScripts = async (bundle: PartialBundle) => {
      const oldEntries = bundle.entries
      const newEntries = new Set([
        ...bundle.scripts,
        ...bundle.importers.flatMap(document =>
          document.scripts.map(script => script.srcPath)
        ),
      ])

      let { context } = bundle
      if (!context || !oldEntries || !setsEqual(oldEntries, newEntries)) {
        context = await buildEntryScripts([...newEntries], config, flags)
        bundle.context = context
        bundle.entries = newEntries
      }

      const { metafile } = await context.rebuild()
      bundle.metafile = metafile
      bundle.inputs = Object.keys(metafile.inputs).map(file =>
        baseRelative(file)
      )
    }

    return {
      documents,
      /**
       * Build state for standalone scripts added with the `scripts`
       * config option. Exists only in `--watch` mode.
       */
      get scripts() {
        return scripts
      },
      initialBuild: (async () => {
        const seen = new Set<string>()

        for (const entry of config.entries) {
          let { file, bundleId = 'default' } = entry
          file = path.resolve(file)

          const key = `${file}:${bundleId}`
          if (seen.has(key)) continue
          seen.add(key)

          let bundle = bundles.get(bundleId)
          if (!bundle) {
            bundle = {
              id: bundleId,
              hmr: true,
              scripts: new Set(),
              importers: [],
            }
            bundles.set(bundleId, bundle)
          }

          if (entry.hmr == false) {
            bundle.hmr = false
          }

          if (file.endsWith('.html')) {
            const document: Plugin.Document = {
              ...entry,
              ...loadDocument(file),
              file,
              bundle: bundle as Plugin.Bundle,
            }
            const uri = baseRelative(file)
            documents[uri] = document
            bundle.importers.push(document)
          } else if (/\.[mc]?[tj]sx?$/.test(file)) {
            bundle.scripts.add(file)
          } else {
            console.warn(red('⚠'), 'unsupported entry type:', file)
          }
        }

        await Promise.all([
          Promise.all(
            Array.from(bundles, async ([bundleId, bundle]) => {
              await buildScripts(bundle)
              return [bundleId, bundle as Plugin.Bundle] as const
            })
          )
            .then(Object.fromEntries<Plugin.Bundle>)
            .then(bundles => {
              config.bundles = bundles
              for (const plugin of config.plugins) {
                plugin.bundles?.(bundles)
              }
            }),
          ...Object.values(documents).map(document =>
            buildHTML(document, config, flags)
          ),
          ...config.scripts.map(srcPath => {
            console.log(yellow('⌁'), baseRelative(srcPath))
            if (flags.watch) {
              return compileSeparateEntry(srcPath, config, {
                metafile: true,
                watch: true,
              }).then(({ outputFiles, context, metafile }) => {
                const outPath = config.getBuildPath(srcPath)
                scripts[srcPath] = {
                  srcPath,
                  outPath,
                  context,
                  metafile,
                  inputs: Object.keys(metafile.inputs).map(file => {
                    config.watcher!.add(file)
                    return baseRelative(file)
                  }),
                }
                createDir(outPath)
                fs.writeFileSync(outPath, outputFiles[0].text)
              })
            }
            return compileSeparateEntry(srcPath, config).then(code => {
              const outFile = config.getBuildPath(srcPath)
              createDir(outFile)
              fs.writeFileSync(outFile, code)
            })
          }),
        ])

        if (config.copy) {
          await copyFiles(config.copy, config)
        }

        for (const plugin of config.plugins) {
          if (plugin.initialBuild) {
            await plugin.initialBuild()
          }
        }
      })(),
      async rebuildHTML(uri: string) {
        const document = documents[uri]
        if (!document) {
          // Skip HTML files not listed in `config.entries`
          return
        }

        const file = uri.startsWith('/@fs/')
          ? uri.slice(4)
          : path.join(process.cwd(), uri)

        const oldScripts = document.scripts
        Object.assign(document, loadDocument(file))

        await Promise.all([
          buildHTML(document, config, flags),
          (oldScripts.length !== document.scripts.length ||
            oldScripts.some(
              (script, i) => script.srcPath !== document.scripts[i].srcPath
            )) &&
            buildScripts(document.bundle),
        ])
      },
      async rebuildStyles() {
        await Promise.all(
          Object.values(documents).map(document =>
            buildRelativeStyles(document.styles, config, flags)
          )
        )
      },
      dispose() {
        for (const bundle of bundles.values()) {
          bundle.context?.dispose()
        }
        for (const script of Object.values(scripts)) {
          script.context.dispose()
        }
        server?.close()
        config.watcher?.close()
      },
    }
  }

  const timer = performance.now()
  const build = createBuild()
  await (config.lastBuild = build.initialBuild)
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  if (server) {
    const hmrInstances: Plugin.HmrInstance[] = []
    const clients = installWebSocketServer(server, config, hmrInstances)

    const watcher = config.watcher!
    const changedScripts = new Set<Plugin.Script>()
    const changedModules = new Set<string>()
    const changedPages = new Set<string>()

    // TODO: track failed module resolutions and only rebuild if a file
    // is added that matches one of them.
    /*watcher.on('add', async file => {
      await scheduleRebuild()
      console.log(cyan('+'), file)
    })*/

    watcher.on('change', file => {
      file = baseRelative(path.resolve(file))
      if (file.endsWith('.html')) {
        console.log(cyan('↺'), file)
        changedPages.add(file)
        requestRebuild()
      } else {
        // Any files used by scripts added in `config.scripts` will
        // trigger a full reload when changed.
        let isFullReload = false
        for (const script of Object.values(build.scripts)) {
          if (script.inputs.includes(file)) {
            changedScripts.add(script)
            isFullReload = true
          }
        }
        if (isFullReload) {
          requestRebuild()
        } else if (file.endsWith('.css') || file in config.modules!) {
          changedModules.add(file)
          requestRebuild()
        }
      }
    })

    watcher.on('unlink', file => {
      // Absolute files are typically not added to the build directory.
      if (path.isAbsolute(file)) {
        return
      }
      const outPath = config.getBuildPath(file).replace(/\.[jt]sx?$/, '.js')
      try {
        fs.rmSync(outPath)
        let outDir = path.dirname(outPath)
        while (outDir !== config.build) {
          const stats = fs.readdirSync(outDir)
          if (stats.length) break
          fs.rmSync(outDir)
          outDir = path.dirname(outDir)
        }
        console.log(red('–'), file)
      } catch {}
    })

    const requestRebuild = debounce(() => {
      config.lastBuild = rebuild()
    }, 200)

    const rebuild = async () => {
      console.clear()

      let isFullReload = changedPages.size > 0 || changedScripts.size > 0
      let stylesChanged = false

      const acceptedFiles = new Map<Plugin.HmrInstance, string[]>()
      if (!isFullReload) {
        // Any files used by a bundle with HMR disabled will trigger a
        // full reload when changed.
        const fullReloadFiles = new Set<string>()
        for (const bundle of Object.values(config.bundles)) {
          if (!bundle.hmr) {
            for (const file of bundle.inputs) {
              fullReloadFiles.add(file)
            }
          }
        }

        accept: for (let file of changedModules) {
          console.log(cyan('↺'), file)

          if (fullReloadFiles.has(file)) {
            isFullReload = true
            break
          }

          for (const hmr of hmrInstances) {
            if (hmr.accept(file)) {
              let files = acceptedFiles.get(hmr)
              if (!files) {
                acceptedFiles.set(hmr, (files = []))
              }
              files.push(file)
              continue accept
            }
          }

          if (file.endsWith('.css')) {
            stylesChanged = true
          }

          isFullReload = true
          break
        }
        if (isFullReload) {
          acceptedFiles.clear()
        }
      }

      const errors: any[] = []

      const htmlRebuildPromises = Array.from(changedPages, file =>
        build.rebuildHTML(file).catch(error => {
          errors.push(error)
        })
      )

      const scriptRebuildPromises = Array.from(changedScripts, script => {
        return script.context
          .rebuild()
          .then(({ outputFiles, metafile }) => {
            fs.writeFileSync(script.outPath, outputFiles[0].text)
            script.metafile = metafile
            script.inputs = Object.keys(metafile.inputs).map(file =>
              baseRelative(file)
            )
          })
          .catch(error => {
            errors.push(error)
          })
      })

      changedScripts.clear()
      changedModules.clear()
      changedPages.clear()

      await Promise.all([
        Promise.all(
          Array.from(acceptedFiles, async ([hmr, files]) => hmr.update(files))
        ).catch(error => {
          errors.push(error)
        }),
        ...htmlRebuildPromises,
        ...scriptRebuildPromises,
        // Rebuild all styles if a .css file is changed and no .html
        // files were also changed.
        !changedPages.size &&
          stylesChanged &&
          build.rebuildStyles().catch(error => {
            errors.push(error)
          }),
      ])

      if (errors.length) {
        const seen = new Set<string>()
        for (const error of errors) {
          if (seen.has(error.message)) continue
          seen.add(error.message)
          console.error()
          console.error(error)
        }
        console.error()
      } else if (isFullReload) {
        await Promise.all(config.plugins.map(plugin => plugin.fullReload?.()))
        await Promise.all(Array.from(clients, client => client.reload()))
      }

      console.log(yellow('watching files...'))
    }

    console.log(yellow('watching files...'))
  }

  return build
}

async function installHttpServer(config: Config, servePlugins: ServePlugin[]) {
  let createServer: typeof import('http').createServer
  let serverOptions: import('https').ServerOptions | undefined
  if (config.server.https) {
    createServer = (await import('https')).createServer
    serverOptions = config.server.https
    if (!serverOptions.cert) {
      const cert = await getCertificate('node_modules/.htmelt/self-signed')
      serverOptions.cert = cert
      serverOptions.key = cert
    }
  } else {
    createServer = (await import('http')).createServer
    serverOptions = {}
  }

  // The dev server allows access to files within these directories.
  const fsAllowRE = new RegExp(
    `^/(${[config.build, config.assets].join('|')})/`
  )

  const server = createServer(serverOptions, async (req, response) => {
    const request = Object.assign(req, parseURL(req.url!)) as Plugin.Request
    request.searchParams = new URLSearchParams(request.search || '')

    let file: Plugin.VirtualFileData | null = null
    for (const plugin of servePlugins) {
      file = (await plugin.serve(request, response)) || null
      if (response.headersSent) return
      if (file) break
    }

    // If no plugin handled the request, check the virtual filesystem.
    if (!file) {
      let uri = request.pathname
      let filePath: string

      let virtualFile = config.virtualFiles[uri]
      if (virtualFile) {
        if (typeof virtualFile == 'function') {
          virtualFile = virtualFile(request)
        }
        file = await virtualFile
      }

      const isFileRequest = uri.startsWith('/@fs/')
      if (isFileRequest) {
        filePath = uri.slice(4)
      } else {
        filePath = path.join(process.cwd(), uri)
      }

      // If no virtual file exists, check the local filesystem.
      if (!file) {
        let isAllowed = false
        if (isFileRequest) {
          for (const dir of config.fsAllowedDirs) {
            if (!path.relative(dir, filePath).startsWith('..')) {
              isAllowed = true
              break
            }
          }
        } else {
          isAllowed = fsAllowRE.test(uri)
        }
        if (isAllowed) {
          try {
            file = {
              data: fs.readFileSync(filePath),
            }
          } catch {}
        }
      }

      if (file && uri.endsWith('.map')) {
        const map = JSON.parse(file.data.toString('utf8'))
        resolveDevMapSources(map, process.cwd(), path.dirname(filePath))
        file.data = JSON.stringify(map)
      }
    }

    if (file) {
      const headers = (file.headers && lowercaseKeys(file.headers)) || {}
      headers['access-control-allow-origin'] ||= '*'
      headers['cache-control'] ||= 'no-store'
      headers['content-type'] ||=
        mime.lookup(file.path || request.pathname) || 'application/octet-stream'

      response.statusCode = 200
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value)
      }
      response.end(file.data)
      return
    }

    console.log(red('404: %s'), req.url)
    response.statusCode = 404
    response.end()
  })

  server.listen(config.server.port, () => {
    console.log(
      cyan('%s server listening on port %s'),
      config.server.url.protocol.slice(0, -1),
      config.server.port
    )
  })

  return server
}

function installWebSocketServer(
  server: import('http').Server,
  config: Config,
  hmrInstances: Plugin.HmrInstance[]
) {
  const events = mitt()
  const clients = new Set<Plugin.Client>()
  const requests: Record<string, Function> = {}

  const context: Plugin.ClientSet = clients as any
  context.on = events.on.bind(events) as any

  config.plugins.forEach(plugin => {
    if (!plugin.hmr) return
    const instance = plugin.hmr(context)
    if (instance) {
      hmrInstances.push(instance)
    }
  })

  const evaluate = (client: Client, src: string, args: any[] = []) => {
    return new Promise<any>(resolve => {
      const id = uuid.v4()
      requests[id] = resolve
      client.pendingRequests.add(id)
      client.socket.send(
        JSON.stringify({
          id,
          src: new URL(src, config.server.url).href,
          args,
        })
      )
    })
  }

  const compiledModules = new Map<string, Plugin.VirtualFileData>()
  const runningModules = new Map<string, number>()

  class Client {
    readonly pendingRequests = new Set<string>()
    constructor(readonly socket: ws.WebSocket) {
      return Object.assign(
        Object.setPrototypeOf(mitt(), Client.prototype),
        this
      )
    }
    evaluate(expr: string) {
      const path = `/${md5Hex(expr)}.js`
      config.virtualFiles[path] ||= {
        data: `export default () => ${expr}`,
      }
      return evaluate(this, path)
    }
    async evaluateModule(file: string | URL, args?: any[]) {
      const moduleUrl =
        typeof file === 'string' ? new URL(file, import.meta.url) : file
      const mtime = fs.statSync(moduleUrl).mtimeMs

      const path = `/${md5Hex(moduleUrl.href)}.${mtime}.js`
      if (config.virtualFiles[path] == null) {
        let compiled = compiledModules.get(moduleUrl.href)
        if (compiled?.mtime != mtime) {
          const entry = decodeURIComponent(moduleUrl.pathname)
          const data = await compileSeparateEntry(entry, config, {
            format: 'esm',
          })
          compiledModules.set(
            moduleUrl.href,
            (compiled = {
              path: moduleUrl.pathname,
              mtime,
              data,
            })
          )
        }
        config.virtualFiles[path] = compiled
      }

      let parallelCount = runningModules.get(path) || 0
      runningModules.set(path, parallelCount + 1)

      const result = await evaluate(this, path, args)

      parallelCount = runningModules.get(path)!
      runningModules.set(path, --parallelCount)
      if (parallelCount == 0) {
        delete config.virtualFiles[path]
      }

      return result
    }
    getURL() {
      return this.evaluate('location.href')
    }
    reload() {
      return this.evaluate('location.reload()')
    }
  }

  interface Client extends Emitter<Plugin.ClientEvents> {}

  const wss = new ws.WebSocketServer({ server })
  wss.on('connection', socket => {
    const client = new Client(socket)
    client.on('*', (type, event) => {
      events.emit(type as any, event)
    })
    clients.add(client)
    socket.on('close', () => {
      for (const id of client.pendingRequests) {
        requests[id](null)
        delete requests[id]
      }
      clients.delete(client)
    })
    socket.on('message', data => {
      const event = JSON.parse(data.toString())
      if (event.type == 'result') {
        client.pendingRequests.delete(event.id)
        requests[event.id](event.result)
        delete requests[event.id]
      } else {
        event.client = client
        client.emit(event.type, event)
        events.emit(event.type, event)
      }
    })
    events.emit('connect', {
      type: 'connect',
      client,
    })
  })

  return clients
}

async function getCertificate(cacheDir: string) {
  const cachePath = path.join(cacheDir, '_cert.pem')
  try {
    const stat = fs.statSync(cachePath)
    const content = fs.readFileSync(cachePath, 'utf8')
    if (Date.now() - stat.ctime.valueOf() > 30 * 24 * 60 * 60 * 1000) {
      throw 'Certificate is too old'
    }
    return content
  } catch {
    const content = (
      await import('./https/createCertificate.mjs')
    ).createCertificate()
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(cachePath, content)
    } catch {}
    return content
  }
}
