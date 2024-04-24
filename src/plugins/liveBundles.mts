import { Plugin } from '@htmelt/plugin'
import path from 'path'
import { toBundleInputs } from '../bundle.mjs'
import { updateRelatedWatcher } from '../relatedWatcher.mjs'

/**
 * This plugin tracks changes to JavaScript modules that were bundled by
 * ESBuild. If a dev server request is made for a file that changed since the
 * last build, the plugin will rebuild the bundle before the dev server fulfills
 * the request.
 */
export const liveBundlesPlugin: Plugin = config => {
  let dirtyBundles = new Set<Plugin.Bundle>()
  let pendingBundles: Record<string, Promise<any>> = {}

  config.watcher!.on('change', file => {
    if (!config.bundles) {
      return // Still initializing.
    }
    file = path.relative(process.cwd(), file)
    for (const bundle of Object.values(config.bundles)) {
      if (file in bundle.metafile.inputs) {
        dirtyBundles.add(bundle)
      }
    }
  })

  async function rebundle(bundle: Plugin.Bundle) {
    return (pendingBundles[bundle.id] ||= bundle.context
      .rebuild()
      .then(
        ({ metafile }) => {
          updateRelatedWatcher(
            config.relatedWatcher!,
            metafile,
            bundle.metafile
          )
          bundle.metafile = metafile
          bundle.inputs = toBundleInputs(metafile)
          dirtyBundles.delete(bundle)
        },
        error => {
          console.error(
            'Error rebuilding bundle "%s": %s',
            bundle.id,
            error.message
          )
        }
      )
      .then(() => {
        delete pendingBundles[bundle.id]
      }))
  }

  return {
    async fullReload() {
      // If a full reload is impending, rebuild any dirty bundles first,
      // so the build directory is up-to-date.
      await Promise.all(Array.from(dirtyBundles, rebundle))
    },
    async serve(req) {
      const uri = req.pathname
      const file = uri.startsWith('/@fs/')
        ? uri.slice(4)
        : path.join(process.cwd(), uri)

      const fileRelativeToRoot = path.relative(process.cwd(), file)
      if (!fileRelativeToRoot.startsWith('..')) {
        // Rebuild any bundles that generate the requested file.
        await Promise.all(
          Array.from(dirtyBundles, async bundle => {
            if (!(fileRelativeToRoot in bundle.metafile.outputs)) {
              return
            }
            // This will write to the filesystem so the dev server can
            // read the updated file and respond to the request.
            await rebundle(bundle)
          })
        )
      }
    },
  }
}
