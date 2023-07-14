import { Config, esbuild } from '@htmelt/plugin'
import path from 'path'

export type RelatedWatcher = ReturnType<typeof createRelatedWatcher>

/**
 * This watches a file or directory (its child list) and passes any related file(s) to listeners.
 * This is used to emulate ESBuild's `watchFiles` and `watchDirs` APIs.
 */
export function createRelatedWatcher(config: Config) {
  const dirWatcher = config.watch([], { depth: 0, ignoreInitial: true })
  const fileWatcher = config.watch([], { depth: 1, ignoreInitial: true })
  const relatedFiles = new Map<string, Set<string>>()

  return {
    watchFile(file: string, relatedFile: string) {
      console.log('File %s watched by %s', file, relatedFile)
      fileWatcher.add(file)
      addToMappedSet(relatedFiles, file, relatedFile)
    },
    watchDirectory(dir: string, relatedFile: string) {
      console.log('Directory %s watched by %s', dir, relatedFile)
      dirWatcher.add(dir)
      addToMappedSet(relatedFiles, dir, relatedFile)
    },
    forgetRelatedFile(file: string) {
      relatedFiles.forEach((files, watchedPath) => {
        if (files.delete(file) && !files.size) {
          relatedFiles.delete(watchedPath)
          fileWatcher.unwatch(watchedPath)
          dirWatcher.unwatch(watchedPath)
        }
      })
    },
    onChange(callback: (relatedFile: string) => void) {
      const onAddOrUnlink = (file: string) => {
        let related = relatedFiles.get(file)
        related?.forEach(callback)
        related = relatedFiles.get(path.dirname(file))
        related?.forEach(callback)
      }
      fileWatcher.on('change', file => {
        let related = relatedFiles.get(file)
        related?.forEach(callback)
      })
      dirWatcher
        .on('add', onAddOrUnlink)
        .on('unlink', onAddOrUnlink)
        .on('addDir', onAddOrUnlink)
        .on('unlinkDir', onAddOrUnlink)
    },
    async close() {
      await dirWatcher.close()
      await fileWatcher.close()
    },
  }
}

function addToMappedSet<Key, Value>(
  map: Map<Key, Set<Value>>,
  key: Key,
  value: Value
) {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

export function updateRelatedWatcher(
  relatedWatcher: RelatedWatcher,
  metafile: esbuild.Metafile,
  oldMetafile?: esbuild.Metafile
) {
  const newRelatedFiles = new Set<string>()

  metafile.watchFiles.forEach((relatedFiles, file) => {
    relatedFiles.forEach(relatedFile => {
      relatedWatcher.watchFile(file, relatedFile)
      newRelatedFiles.add(relatedFile)
    })
  })

  metafile.watchDirs.forEach((relatedFiles, dir) => {
    relatedFiles.forEach(relatedFile => {
      relatedWatcher.watchDirectory(dir, relatedFile)
      newRelatedFiles.add(relatedFile)
    })
  })

  if (oldMetafile) {
    const oldRelatedFiles = new Set<string>()
    oldMetafile.watchFiles.forEach(files => {
      files.forEach(file => oldRelatedFiles.add(file))
    })
    oldMetafile.watchDirs.forEach(files => {
      files.forEach(file => oldRelatedFiles.add(file))
    })
    oldRelatedFiles.forEach(file => {
      if (!newRelatedFiles.has(file)) {
        relatedWatcher.forgetRelatedFile(file)
      }
    })
  }
}
