import {
  findElements,
  Flags,
  getAttribute,
  getTagName,
  LeadingArgv,
  Node,
  TrailingArgv,
} from '@htmelt/plugin'
import cac from 'cac'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'

export function parseFlags(cli = cac()) {
  const {
    args: pre,
    options: { '--': post, ...flags },
  } = cli.parse() as {
    args: string[]
    options: Flags &
      LeadingArgv &
      TrailingArgv & {
        '--': string[]
      }
  }
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
    if (!source.includes(':') && isOutOfRoot(source)) {
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

/**
 * Remove `?` query string suffix from a string.
 */
export function removePathSuffix(str: string) {
  const suffixStart = str.indexOf('?')
  if (suffixStart === -1) {
    return str
  }
  return str.slice(0, suffixStart)
}

/**
 * Starting from `fromDir`, find the first directory that contains any of the
 * `targetFiles`. Stop searching if one of `stopDirs` is encountered.
 */
export function findDirectoryUp(
  fromDir: string,
  targetFiles: string[],
  stopDirs?: Set<string>
) {
  const homeDir = os.homedir()
  const cwd = process.cwd()

  let dir = fromDir
  while (true) {
    if (
      dir === '/' ||
      dir === homeDir ||
      cwd.startsWith(dir + '/') ||
      stopDirs?.has(dir)
    ) {
      return null
    }
    const files = fs.readdirSync(dir)
    if (files.some(file => targetFiles.includes(file))) {
      break
    }
    dir = path.dirname(dir)
  }

  return dir
}

export class CaseInsensitiveMap<V> extends Map<string, V> {
  get(key: string) {
    return super.get(key.toLowerCase())
  }
  set(key: string, value: V) {
    return super.set(key.toLowerCase(), value)
  }
  has(key: string) {
    return super.has(key.toLowerCase())
  }
  delete(key: string) {
    return super.delete(key.toLowerCase())
  }
}

export async function findNodeModule(
  fromDir: string,
  modulePath: string,
  stopDir: string
) {
  let currentDir = fromDir
  while (true) {
    const potentialPath = path.join(currentDir, 'node_modules', modulePath)
    if (
      await fs.promises.access(potentialPath).then(
        () => true,
        () => false
      )
    ) {
      return potentialPath
    }
    if (currentDir === stopDir) {
      return null
    }
    currentDir = path.dirname(currentDir)
  }
}
