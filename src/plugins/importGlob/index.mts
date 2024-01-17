import type { RelatedWatcher } from '@htmelt/plugin'
import type { Plugin } from 'esbuild'
import { resolve } from 'path'
import { OnGlobImport, transformGlob } from './transformGlob.mjs'

const createPlugin = (watcher?: RelatedWatcher): Plugin => {
  return {
    name: 'esbuild-plugin-import-glob',
    setup(build) {
      build.onTransform({ loaders: ['js', 'jsx'] }, async args => {
        let onGlobImport: OnGlobImport | undefined
        if (watcher) {
          const importer = args.initialPath || args.path
          onGlobImport = glob => {
            const rootDirs = new Set<string>()
            const globs = Array.isArray(glob) ? glob : [glob]
            for (const glob of globs) {
              const parts = glob.split('/')
              const globStarIdx = parts.findIndex(p => p.includes('*'))
              const rootDir = parts.slice(0, globStarIdx).join('/')
              rootDirs.add(resolve(importer, '..', rootDir))
            }
            for (const rootDir of rootDirs) {
              watcher.watchDirectory(rootDir, importer)
            }
          }
        }

        return transformGlob(args.code, {
          path: args.path,
          jsx: args.loader === 'jsx',
          onGlobImport,
        })
      })
    },
  }
}

export default createPlugin
