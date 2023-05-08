import path from 'path'

export function baseRelative(file: string, cwd = process.cwd()) {
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
