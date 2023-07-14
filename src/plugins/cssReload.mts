import {
  Config,
  CssPlugin,
  fileToId,
  idToFile,
  idToUri,
  md5Hex,
  parseNamespace,
  Plugin,
} from '@htmelt/plugin'
import fs from 'fs'
import svgToDataUri from 'mini-svg-data-uri'
import path from 'path'
import { buildCSSFile } from '../css.mjs'

type CSSEntry = {
  hash: string
  loader: 'css' | 'js'
}

export const cssReloadPlugin: Plugin = (config, flags) => {
  const cssEntries = new Map<string, CSSEntry>()

  config.registerCssEntry = (id, code, loader = 'css') => {
    if (!cssEntries.has(id)) {
      cssEntries.set(id, {
        hash: code != null ? md5Hex(code) : '',
        loader,
      })
    }
  }

  return {
    cssPlugins: [inlineSvgUrls(config)],
    document({ styles }) {
      const buildPrefix = '/' + config.build + '/'
      styles.forEach(style => {
        const srcAttr = style.srcAttr.value
        if (srcAttr.startsWith(buildPrefix)) {
          const devUrl = config.resolveDevUrl(srcAttr)
          style.srcAttr.value = devUrl.href

          // TODO: get file hash
          cssEntries.set(fileToId(style.srcPath), {
            hash: '',
            loader: 'css',
          })
        }
      })
    },
    hmr(clients) {
      return {
        accept: file => file.endsWith('.css'),
        async update(files) {
          // If every updated file is an entry, only update them. Otherwise, update every single
          // entry, since we don't currently track dependencies.
          const dirtyFiles = files.some(file => !cssEntries.has(file))
            ? Array.from(cssEntries.keys())
            : files

          const updates: [uri: string][] = []
          await Promise.all(
            Array.from(dirtyFiles, async (id, i) => {
              let uri: string | undefined
              let outFile: Plugin.VirtualFile | undefined

              const file = idToFile(id)
              const namespace = parseNamespace(id)

              let alias: string | Plugin.VirtualFile | undefined
              if (namespace && /^@?[a-z0-9]/i.test(file)) {
                alias = config.alias[file]
                if (alias && typeof alias !== 'string') {
                  outFile = alias
                }
              } else if (path.isAbsolute(file)) {
                console.log('[cssReload] reading virtual file', file)
                outFile = config.virtualFiles[file]
              }

              if (outFile) {
                uri = alias ? idToUri(id) : fileToId(config.getBuildPath(file))
              } else if (path.isAbsolute(file) && fs.existsSync(file)) {
                const result = await buildCSSFile(file, config, flags)
                const cssText = result.code.toString('utf8')
                const entry = cssEntries.get(id)!
                const hash = md5Hex(cssText)
                if (entry.hash !== hash) {
                  entry.hash = hash
                  uri = fileToId(config.getBuildPath(file))
                  outFile = {
                    loader: 'css',
                    current: { data: cssText },
                  }
                }
              } else {
                cssEntries.delete(id)
              }

              if (uri && outFile && outFile.loader === 'css') {
                // Tell the client to reload this file.
                updates[i] = [uri]

                console.log('[cssReload] updating virtual file', uri)

                // Cache the latest version under the dev server URI.
                config.setVirtualFile(uri, outFile)
              }
            })
          )

          for (const update of updates) {
            if (!update) continue
            await Promise.all(
              Array.from(clients, client =>
                client.evaluateModule('./client/cssReload.mjs', update)
              )
            )
          }
        },
      }
    },
  }
}

function inlineSvgUrls(config: Config): CssPlugin {
  return {
    visitor: importer => ({
      Url(node) {
        if (!/^[./]/.test(node.url)) {
          return // Ignore external URLs.
        }
        if (node.url.endsWith('.svg')) {
          const svgFile = config.resolve(node.url, importer)
          const svgText = fs.readFileSync(svgFile, 'utf8')
          return {
            url: svgToDataUri(svgText),
            loc: node.loc,
          }
        }
      },
    }),
  }
}
