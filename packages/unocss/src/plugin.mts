import {
  createElement,
  fileToId,
  findElement,
  getTagName,
  md5Hex,
  parseNamespace,
  Plugin,
  prepend,
  serialize,
  setTextContent,
} from '@htmelt/plugin'
import type { UserConfig } from '@unocss/core'
import { existsSync } from 'fs'
import path from 'path'
import { createContext } from './context.mjs'

const VIRTUAL_PREFIX = '@htmelt-unocss/'
// const SCOPE_IMPORT_RE = / from (['"])(@unocss\/scope)\1/

export default <Theme extends {} = {}>(options?: UserConfig<Theme>): Plugin =>
  config => {
    const moduleMap = new Map<string, [string, string]>()
    const { uno, filter } = createContext(options)

    let cache: Record<string, string | null> | undefined
    if (config.watcher) {
      cache = {}
      config.watcher.on('change', file => {
        if (!parseNamespace(file)) {
          file = path.resolve(file)
        }
        delete cache![file]
      })
    }

    config.alias['unocss/preflight.css'] = {
      loader: 'css',
      async request() {
        const { css } = await uno.generate('')
        return { data: css }
      },
    }

    config.esbuild.plugins.push({
      name: 'unocss:esbuild',
      setup(build) {
        build.onTransform({ loaders: ['tsx', 'jsx'] }, async args => {
          if (!filter(args.code, args.path)) {
            return null
          }

          const file = args.path
          const id = fileToId(file)

          let css = cache?.[file]
          if (css === undefined) {
            const unoResult = await uno.generate(args.code, {
              id: file,
              preflights: false,
            })
            css = unoResult.matched.size > 0 ? unoResult.css : null
          }
          if (css === null) {
            if (cache) {
              cache[file] = null
            }
            moduleMap.delete(id)
            return null
          }

          // Prepend a comment to the CSS for debugging purposes.
          css = `/* unocss ${path.relative(process.cwd(), file)} */\n` + css

          let code: string | undefined
          let cssPath = args.path.replace(/\.([jt]sx?)$/, '.css')
          let watchFiles: string[] | undefined

          // If a CSS file exists for this JS module, simply append the
          // generated CSS to it instead of creating a separate virtual file.
          // Before loading the CSS file, we should unset any previous virtual
          // file from this plugin.
          if (existsSync(cssPath)) {
            config.unsetVirtualFile(cssPath)
            const promise = build
              .load({
                path: cssPath,
                suffix: '?raw',
              })
              .then(loadResult => ({
                data: String(loadResult.contents).replace(/\n*$/, '\n\n') + css,
              }))

            watchFiles = [cssPath]
            config.setVirtualFile(cssPath, {
              loader: 'css',
              promise,
            })
          } else {
            cssPath = `${VIRTUAL_PREFIX}${md5Hex(file)}.css`
            config.alias[cssPath] = {
              loader: 'css',
              current: { data: css },
            }
            code = `import "${cssPath}";${args.code}`
            cssPath = 'virtual:' + cssPath
          }

          if (config.watcher && moduleMap.has(id)) {
            config.watcher.emit('change', cssPath)
          }
          if (cache) {
            cache[file] = css
          }

          // TODO: use this for HMR updates
          const cssHash = md5Hex(css)
          moduleMap.set(id, [cssHash, cssPath])

          if (code == null) {
            return {
              watchFiles,
            }
          }

          return {
            code,
            map: null,
          }
        })
      },
    })

    return {
      async document({ file, documentElement, bundle }) {
        const headTag = findElement(
          documentElement,
          node => getTagName(node) === 'head'
        )
        if (!headTag) {
          throw Error('No <head> tag found in document: ' + file)
        }
        const html = serialize(documentElement)
        const { css, matched } = await uno.generate(html, {
          id: file,
        })
        if (!matched.size && !bundle.inputs.some(id => moduleMap.has(id))) {
          return // no tokens were matched
        }
        const styleTag = createElement('style', { type: 'text/css' })
        setTextContent(styleTag, css)
        prepend(headTag, styleTag)
      },
    }
  }
