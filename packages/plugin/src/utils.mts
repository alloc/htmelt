import path from 'path'

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
