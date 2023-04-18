#!/usr/bin/env node

import {
  Config,
  Entry,
  Flags,
  HmrPlugin,
  md5Hex,
  ParentNode,
  Plugin,
  ScriptReference,
  ServePlugin,
} from '@htmelt/plugin'
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
import {
  buildEntryScripts,
  compileSeparateEntry,
  findRelativeScripts,
} from './esbuild.mjs'
import { buildHTML, parseHTML } from './html.mjs'
import {
  baseRelative,
  createDir,
  isEqualUnordered,
  loadBundleConfig,
  lowercaseKeys,
  resolveDevMapSources,
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
    await bundle(config, flags)
  })

cli.parse()

type EntryMetadata = {
  document: ParentNode
  scripts: ScriptReference[]
  bundle: ScriptBundle
}

type ScriptBundle = {
  id: string
  hmr: boolean
  scripts: Set<string>
  importers: Set<Entry>
  context?: esbuild.BuildContext
  metafile?: esbuild.Metafile
}

async function bundle(config: Config, flags: Flags) {
  if (config.deletePrev) {
    fs.rmSync(config.build, { force: true, recursive: true })
  }

  const scriptBundles = new Map<string, ScriptBundle>()

  let server: import('http').Server | undefined
  if (flags.watch) {
    const servePlugins = config.plugins.filter(p => p.serve) as ServePlugin[]
    server = await installHttpServer(config, servePlugins, scriptBundles)
  }

  const build = async () => {
    const htmlEntries = new Map<Entry, EntryMetadata>()
    const scriptEntriesByBundle = new Map<ScriptBundle, string[]>()

    const seen = new Set<string>()
    for (const entry of config.entries) {
      const { file, bundleId = 'default' } = entry

      const key = `${file}:${bundleId}`
      if (seen.has(key)) continue
      seen.add(key)

      let bundle = scriptBundles.get(bundleId)
      if (!bundle) {
        bundle = {
          id: bundleId,
          hmr: true,
          scripts: new Set(),
          importers: new Set(),
        }
        scriptBundles.set(bundleId, bundle)
      } else if (!scriptEntriesByBundle.has(bundle)) {
        scriptEntriesByBundle.set(bundle, [...bundle.scripts])
        bundle.scripts.clear()
        bundle.hmr = true
      }

      if (entry.hmr == false) {
        bundle.hmr = false
      }

      if (file.endsWith('.html')) {
        const html = fs.readFileSync(file, 'utf8')
        const document = parseHTML(html)
        const scripts = findRelativeScripts(document, file, config)
        htmlEntries.set(entry, { document, scripts, bundle })
        bundle.importers.add(entry)
        for (const script of scripts) {
          bundle.scripts.add(script.srcPath)
        }
      } else if (/\.[mc]?[tj]sx?$/.test(file)) {
        bundle.scripts.add(path.resolve(file))
      } else {
        console.warn(red('⚠'), 'unsupported entry type:', file)
      }
    }

    await Promise.all([
      Promise.all(
        Array.from(scriptBundles, async ([bundleId, bundle]) => {
          const oldEntries = scriptEntriesByBundle.get(bundle)
          const newEntries = [...bundle.scripts]
          if (!bundle.context || isEqualUnordered(oldEntries!, newEntries)) {
            bundle.context = await buildEntryScripts(newEntries, config, flags)
          }

          const { metafile } = await bundle.context!.rebuild()
          bundle.metafile = metafile!

          return [bundleId, bundle as Plugin.Bundle] as const
        })
      )
        .then(Object.fromEntries<Plugin.Bundle>)
        .then(bundles => {
          for (const plugin of config.plugins) {
            plugin.bundles?.(bundles)
          }
        }),
      ...Array.from(htmlEntries, ([entry, { document, scripts, bundle }]) =>
        buildHTML(entry, document, scripts, config, flags)
      ),
      ...config.scripts.map(async entry => {
        console.log(yellow('⌁'), baseRelative(entry))
        return compileSeparateEntry(entry, config).then(async code => {
          const outFile = config.getBuildPath(entry)
          await createDir(outFile)
          fs.writeFileSync(outFile, code)
        })
      }),
    ])

    if (config.copy) {
      await copyFiles(config.copy, config)
    }
  }

  const timer = performance.now()
  await (config.lastBuild = build())
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  if (flags.watch) {
    await buildClientConnection(config)
  }

  for (const plugin of config.plugins) {
    if (!plugin.buildEnd) continue
    await plugin.buildEnd(false)
  }

  if (server) {
    const hmrInstances: Plugin.HmrInstance[] = []

    const hmrPlugins = config.plugins.filter(p => p.hmr) as HmrPlugin[]
    const clients = installWebSocketServer(
      server,
      config,
      hmrPlugins,
      hmrInstances
    )

    const watcher = config.watcher!
    const changedFiles = new Set<string>()

    // TODO: track failed module resolutions and only rebuild if a file
    // is added that matches one of them.
    /*watcher.on('add', async file => {
      await scheduleRebuild()
      console.log(cyan('+'), file)
    })*/

    watcher.on('change', async file => {
      file = baseRelative(path.resolve(file))
      if (file in config.modules!) {
        changedFiles.add(file)
        await requestRebuild()
      }
    })

    watcher.on('unlink', async file => {
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

      let isFullReload = false
      const fullReloadFiles = new Set<string>()
      for (const bundle of scriptBundles.values()) {
        if (!bundle.hmr) {
          for (const srcPath in bundle.metafile!.inputs) {
            fullReloadFiles.add(srcPath)
          }
        }
      }

      const acceptedFiles = new Map<Plugin.HmrInstance, string[]>()
      accept: for (let file of changedFiles) {
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
        isFullReload = true
        break
      }

      changedFiles.clear()
      await Promise.all(
        Array.from(acceptedFiles, ([hmr, files]) => hmr.update(files))
      )

      try {
        config.events.emit('will-rebuild', { isFullReload })
        const timer = performance.now()
        await build()
        config.events.emit('rebuild', { isFullReload })

        for (const plugin of config.plugins) {
          if (!plugin.buildEnd) continue
          await plugin.buildEnd(true)
        }

        console.log(
          cyan('build complete in %sms'),
          (performance.now() - timer).toFixed(2)
        )

        if (isFullReload) {
          await Promise.all(Array.from(clients, client => client.reload()))
        }
      } catch (e: any) {
        console.error(e)
      }

      console.log(yellow('watching files...'))
    }

    console.log(yellow('watching files...'))
  }
}

async function installHttpServer(
  config: Config,
  servePlugins: ServePlugin[],
  scriptBundles: Map<string, ScriptBundle>
) {
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

    scriptBundles
    await config.lastBuild

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
  hmrPlugins: HmrPlugin[],
  hmrInstances: Plugin.HmrInstance[]
) {
  const events = mitt()
  const clients = new Set<Plugin.Client>()
  const requests: Record<string, Function> = {}

  const context: Plugin.ClientSet = clients as any
  context.on = events.on.bind(events) as any

  hmrPlugins.forEach(plugin => {
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
