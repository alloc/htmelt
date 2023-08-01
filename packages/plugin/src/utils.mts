import * as http from 'http'
import * as mime from 'mrmime'
import * as path from 'path'
import type { Plugin } from './plugin.mjs'

export function fileToId(
  file: string,
  namespace = 'file',
  cwd = process.cwd()
) {
  if (namespace !== 'file') {
    return namespace + ':' + file
  }
  let id: string
  if (path.isAbsolute(file)) {
    id = path.relative(cwd, file)
    if (id.startsWith('../')) {
      return '/@fs' + file
    }
  } else {
    if (file.startsWith('../')) {
      return '/@fs' + path.resolve(cwd, file)
    }
    id = file
  }
  return '/' + id
}

export function idToFile(id: string, cwd = process.cwd()) {
  if (id.startsWith('/@fs')) {
    return id.slice(4)
  }
  if (id[0] === '/') {
    return path.resolve(cwd, id.slice(1))
  }
  const namespace = parseNamespace(id)
  return namespace ? id.slice(namespace.length + 1) : id
}

/**
 * Calling this is only necessary if you're not sure whether the
 * given `id` has a namespace or not.
 */
export function idToUri(id: string) {
  return id[0] === '/' ? id : '/' + id
}

export function uriToId(uri: string) {
  return uri.includes(':') ? uri.slice(1) : uri
}

export function uriToFile(uri: string, cwd = process.cwd()) {
  if (uri.startsWith('/@fs/')) {
    return uri.slice(4)
  }
  return path.join(cwd, uri)
}

export function parseNamespace(id: string) {
  const firstSlashIdx = id.indexOf('/')
  if (firstSlashIdx !== 0) {
    const firstColonIdx = id.indexOf(':')
    if (firstColonIdx === -1) {
      return null
    }
    if (firstSlashIdx === -1 || firstColonIdx < firstSlashIdx) {
      return id.slice(0, firstColonIdx)
    }
  }
  return null
}

export function sendFile(
  uri: string,
  response: http.ServerResponse,
  file: Plugin.VirtualFileData
): void {
  const headers = (file.headers && lowercaseKeys(file.headers)) || {}
  headers['access-control-allow-origin'] ||= '*'
  headers['cache-control'] ||= 'no-store'
  headers['content-type'] ||=
    mime.lookup(file.path || uri) || 'application/octet-stream'

  response.statusCode = 200
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value)
  }
  response.end(file.data)
}

export function lowercaseKeys<T extends object>(obj: T): T {
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key.toLowerCase()] = value
  }
  return result
}

export function isRelativePath(path: string) {
  if (path[0] !== '.') return false
  if (path[1] === '/') return true
  return path[1] === '.' && path[2] === '/'
}
