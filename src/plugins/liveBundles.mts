import { Plugin } from '@htmelt/plugin'
import path from 'path'

/**
 * By default, any scripts in your HTML files are rewritten to use the
 * build directory. This plugin rewrites them to use the dev server
 * instead and rebuilds each bundle only when necessary.
 */
export const liveBundlesPlugin: Plugin = config => {
  let dirtyBundles = new Set<Plugin.Bundle>()
  let pendingBundles: Record<string, Promise<any>> = {}

  config.watcher!.on('change', file => {
    file = path.relative(process.cwd(), file)
    for (const bundle of Object.values(config.bundles)) {
      if (file in bundle.metafile.inputs) {
        dirtyBundles.add(bundle)
      }
    }
  })

  return {
    document(document) {
      for (const script of document.scripts) {
        // Since live reloading of <script> tags relies on dynamic
        // import(…) calls, only module scripts are supported.
        if (!script.isModule) {
          continue
        }
        // Rewrite <script> src to point to the dev server.
        script.srcAttr.value = new URL(
          script.srcAttr.value,
          config.server.url
        ).href
      }
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
            await (pendingBundles[bundle.id] ||= bundle.context
              .rebuild()
              .then(
                ({ metafile }) => {
                  bundle.metafile = metafile!
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
          })
        )
      }
    },
  }
}
