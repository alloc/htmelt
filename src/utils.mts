import {
  findElements,
  Flags,
  getAttribute,
  getTagName,
  Node,
} from '@htmelt/plugin'
import cac from 'cac'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'

export function parseFlags(cli = cac()): Flags {
  const {
    args: pre,
    options: { '--': post, ...flags },
  } = cli.parse() as any
  flags.pre = pre
  flags.post = post
  return flags
}

export function createDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

export function relative(from: string, to: string) {
  let result = path.relative(path.dirname(from), to)
  if (!result.startsWith('.')) {
    result = './' + result
  }
  return result
}

export function findExternalScripts(rootNode: Node) {
  return findElements(
    rootNode,
    e => getTagName(e) === 'script' && !!getAttribute(e, 'src')
  )
}

export function findFreeTcpPort() {
  return new Promise<number>(resolve => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const freeTcpPort: number = (srv.address() as any).port
      srv.close(() => resolve(freeTcpPort))
    })
  })
}

export function lowercaseKeys<T extends object>(obj: T): T {
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key.toLowerCase()] = value
  }
  return result
}

export function resolveDevMapSources(
  map: any,
  root: string,
  resolveDir: string
) {
  let isOutOfRoot: (source: string) => boolean
  if (path.relative(root, resolveDir).startsWith('..')) {
    isOutOfRoot = () => true
  } else {
    const outOfRootPrefix = path.relative(resolveDir, path.dirname(root))
    isOutOfRoot = source => source.startsWith(outOfRootPrefix)
  }

  // This assumes each source is a relative path to the source file.
  map.sources = map.sources.map((source: string) => {
    if (isOutOfRoot(source)) {
      return '/@fs' + path.resolve(resolveDir, source)
    }
    return source
  })
}

export function setsEqual<T>(a: Set<T>, b: Set<T>) {
  if (a.size !== b.size) {
    return false
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false
    }
  }
  return true
}
