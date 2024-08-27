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
import path from 'path'
import { createContext } from './context.mjs'

const VIRTUAL_PREFIX = '@htmelt-unocss/'
// const SCOPE_IMPORT_RE = / from (['"])(@unocss\/scope)\1/

export default <Theme extends {} = {}>(options?: UserConfig<Theme>): Plugin =>
  config => {
    const moduleMap = new Map<string, [string, string]>()
    const { uno, filter, ready } = createContext(options)

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
          if (css === null) {
            return null
          }

          let cssPromise: Promise<string | null> | undefined
          let cssPath =
            VIRTUAL_PREFIX +
            config.getBuildPath(file, { absolute: false }) +
            '.css'

          if (css === undefined) {
            cssPromise = ready
              .then(() =>
                uno.generate(args.code, {
                  id: file,
                  preflights: false,
                })
              )
              .then(unoResult => {
                // Prepend a comment to the CSS for debugging purposes.
                const css =
                  unoResult.matched.size > 0
                    ? `/* unocss ${path.relative(config.root, file)} */\n` +
                      unoResult.css
                    : null

                if (cache) {
                  cache[file] = css
                }
                if (css === null) {
                  delete config.alias[cssPath]
                  moduleMap.delete(id)
                } else {
                  // TODO: use this for HMR updates
                  const cssHash = md5Hex(css)
                  moduleMap.set(id, [cssHash, cssPath])
                  config.watcher?.emit('change', 'virtual:' + cssPath)
                }
                return css
              })
          }

          const alias: Partial<Plugin.VirtualFile> = cssPromise
            ? { promise: cssPromise.then(css => ({ data: css || '' })) }
            : { current: { data: css! } }

          config.alias[cssPath] = { ...alias, loader: 'css' }

          // If no UnoCSS tokens were found, no import is required.
          if (cssPromise) {
            css = await cssPromise
            if (css === null) {
              return null
            }
          }

          const code = `import "${cssPath}";${args.code}`

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
