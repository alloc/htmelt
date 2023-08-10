import {
  Config,
  Emitter,
  md5Hex,
  mitt,
  parseNamespace,
  Plugin,
  sendFile,
  ServePlugin,
  uriToFile,
  uriToId,
} from '@htmelt/plugin'
import * as fs from 'fs'
import { cyan, red } from 'kleur/colors'
import * as path from 'path'
import { parse as parseURL } from 'url'
import * as uuid from 'uuid'
import * as ws from 'ws'
import { compileSeparateEntry } from './esbuild.mjs'
import { loadVirtualFile } from './plugins/virtualFiles.mjs'
import { resolveDevMapSources } from './utils.mjs'

export async function installHttpServer(
  config: Config,
  servePlugins: ServePlugin[]
) {
  const { url, port, https } = await config.loadServerConfig()

  let createServer: typeof import('https').createServer
  let cert: string | undefined
  let key: string | undefined
  if (https) {
    createServer = (await import('https')).createServer
    if (https.cert) {
      cert = https.cert
      key = https.key
    } else {
      key = cert = await getCertificate('node_modules/.htmelt/self-signed')
    }
  } else {
    createServer = (await import('http')).createServer as any
  }

  // The dev server allows access to files within these directories.
  const fsAllowRE = new RegExp(
    `^/(${[config.build, config.assets].join('|')})/`
  )

  const loadFile = async (uri: string, request: Plugin.Request) => {
    const id = uriToId(uri)
    const namespace = parseNamespace(id)
    const filePath = !namespace ? uriToFile(uri) : null

    let virtualFile = config.virtualFiles[uri]
    if (!virtualFile) {
      if (filePath) {
        virtualFile = config.virtualFiles[filePath]
      } else if (namespace) {
        // Namespaced IDs can be aliased to virtual files.
        const rawId = id.slice(namespace.length + 1)
        const alias = config.alias[rawId]
        if (typeof alias !== 'string') {
          virtualFile = alias
        }
      }
    }

    let file: Plugin.VirtualFileData | null = null
    if (virtualFile) {
      file = await loadVirtualFile(virtualFile, uri, config, request)
      if (file) {
        if (file.watchFiles) {
          // TODO
        }
      }
    }

    // If no virtual file exists, check the local filesystem.
    if (!file && filePath) {
      let isAllowed = false
      if (uri.startsWith('/@fs/')) {
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
            path: filePath,
            data: fs.readFileSync(filePath),
          }
        } catch {}
      }
    }

    if (file && uri.endsWith('.map')) {
      const map = JSON.parse(file.data.toString('utf8'))
      resolveDevMapSources(
        map,
        process.cwd(),
        filePath ? path.dirname(filePath) : process.cwd()
      )
      file.data = JSON.stringify(map)
    }

    return file
  }

  const server = createServer({ cert, key }, async (req, response) => {
    const request = Object.assign(req, parseURL(req.url!)) as Plugin.Request
    request.searchParams = new URLSearchParams(request.search || '')

    let file: Plugin.VirtualFileData | null = null
    for (const plugin of servePlugins) {
      file = (await plugin.serve(request, response)) || null
      if (response.headersSent) return
      if (file) break
    }

    // If no plugin handled the request, check the virtual filesystem.
    const filePath = request.pathname
    if (!file) {
      file = await loadFile(filePath, request)

      if (!file && !filePath.startsWith('/@fs/')) {
        const buildPath = path.posix.join('/', config.build, filePath)
        file = await loadFile(buildPath, request)

        if (!file && !buildPath.endsWith('/')) {
          file = await loadFile(buildPath + '.html', request)
        }

        if (!file) {
          const indexPath = path.posix.join(buildPath, 'index.html')
          file = await loadFile(indexPath, request)
        }
      }

      if (file?.path?.endsWith('.html') && config.server.allowHosts) {
        const hosts = config.server.allowHosts.join(' ')
        file.headers = {
          ...file.headers,
          'Content-Security-Policy': `default-src 'self' ${hosts}`,
        }
      }
    }

    if (file) {
      sendFile(request.pathname, response, file)
    } else {
      console.log(red('404: %s'), req.url)
      response.statusCode = 404
      response.end()
    }
  })

  server.listen(port, () => {
    console.log(
      cyan('%s server listening on port %s'),
      url.protocol.slice(0, -1),
      port
    )
  })

  return server
}

export function installWebSocketServer(
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
      if (!config.virtualFiles[path]) {
        config.setVirtualFile(path, {
          loader: 'js',
          current: { data: `export default () => ${expr}` },
        })
      }
      return evaluate(this, path)
    }
    async evaluateModule(file: string | URL, args?: any[]) {
      const moduleUrl =
        typeof file === 'string' ? new URL(file, import.meta.url) : file
      const mtime = fs.statSync(moduleUrl).mtimeMs

      const path = `/${md5Hex(moduleUrl.href)}.${mtime}.js`
      if (!config.virtualFiles[path]) {
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
        config.setVirtualFile(path, {
          loader: 'js',
          current: compiled,
        })
      }

      let parallelCount = runningModules.get(path) || 0
      runningModules.set(path, parallelCount + 1)

      const result = await evaluate(this, path, args)

      parallelCount = runningModules.get(path)!
      runningModules.set(path, --parallelCount)
      if (parallelCount == 0) {
        config.unsetVirtualFile(path)
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
