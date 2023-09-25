import { bundleRequire } from 'bundle-require'
import escalade from 'escalade/sync'
import * as fs from 'fs'
import * as path from 'path'

export function findConfigFile(id: string, cwd = process.cwd()) {
  const extensionRegex = /\.(json|[mc]?[tj]s)$/
  const isMatch = (name: string) => {
    const ext = path.extname(name)
    return extensionRegex.test(ext) && path.basename(name, ext) === id
  }
  const match = escalade(cwd, (_dir, names) => {
    return names.find(isMatch) || (names.includes('.git') && '/')
  })
  if (match && match !== '/') {
    return match
  }
}

export type LoadConfigResult<T> = {
  filePath: string
  dependencies: string[]
  mod: { default: T }
  loadTime: number
}

export async function loadConfigFile<T>(
  id: string,
  cwd?: string
): Promise<LoadConfigResult<T> | null> {
  const startTime = Date.now()
  const filePath = findConfigFile(id, cwd)
  if (!filePath) {
    return null
  }
  if (filePath.endsWith('.json')) {
    return {
      filePath,
      dependencies: [],
      mod: {
        default: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      },
      loadTime: Date.now() - startTime,
    }
  }
  const loadResult = await bundleRequire({
    filepath: filePath,
  })
  return {
    filePath,
    ...loadResult,
    loadTime: Date.now() - startTime,
  }
}
