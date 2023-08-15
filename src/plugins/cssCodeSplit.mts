import { Config, fileToId, idToUri, md5Hex, Plugin } from '@htmelt/plugin'
import { esbuildBundles } from '../bundle/context.mjs'
import { buildCSSFile } from '../css.mjs'

/**
 * This plugin allows importing `.css` files from JavaScript. When
 * imported, a JS module is generated that will inject a `<style>` tag
 * into the document.
 */
export const cssCodeSplit: Plugin = (config, flags) => {
  config.esbuild.plugins.push({
    name: 'esbuild-plugin-inline-css',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async args => {
        const css = await buildCSSFile(args.path, config, flags)
        return {
          loader: 'css',
          contents: css.code,
        }
      })

      build.onTransform({ filter: /\.css$/ }, args => {
        if (new URLSearchParams(args.suffix).has('raw')) {
          return null
        }
        if (!flags.watch) {
          // TODO: identify dynamically imported chunks
          const bundle = esbuildBundles.get(build.initialOptions)
          if (bundle) {
            bundle.injectedStyles ||= []
            bundle.injectedStyles.push(args.code)
            return {
              loader: 'js',
              code: 'export {}',
            }
          }
        }
        return {
          loader: 'js',
          code: getCSSInjectionScript(
            args.code,
            args.path,
            args.namespace,
            config,
            flags
          ),
        }
      })
    },
  })
}

function getCSSInjectionScript(
  code: string,
  file: string,
  namespace: string,
  config: Config,
  flags: { watch?: boolean; minify?: boolean }
) {
  const id = fileToId(file, namespace)
  config.registerCssEntry?.(id, code, 'js')

  const jsArgs = [
    `"${md5Hex(file).slice(0, 12)}"`,
    '`' + (flags.minify ? '' : '\n') + code.replace(/[\\`]/g, '\\$&') + '`',
  ]

  let jsModule: string
  if (flags.watch) {
    const id = fileToId(
      namespace === 'file' ? config.getBuildPath(file) : file,
      namespace
    )
    const url = new URL(idToUri(id), config.server.url)
    jsModule = `(${injectStyleTag_DEV})(${jsArgs}, "${url.href}")`
  } else {
    jsModule = `(${injectStyleTag})(${jsArgs})`
  }

  return jsModule
}

declare const document: {
  getElementById: (id: string) => any
  createElement: (tag: string) => any
  head: {
    appendChild: (node: any) => void
  }
}

const injectStyleTag = (id: string, css: string) => {
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = css
    document.head.appendChild(style)
  }
}

// This version adds a `data-href` attribute to the style tag, which is
// used by the HMR client to update the style tag.
const injectStyleTag_DEV = (id: string, css: string, href: string) => {
  let style = document.getElementById(id)
  if (style) {
    style.textContent = css
  } else {
    style = document.createElement('style')
    style.id = id
    style.textContent = css
    style.dataset.href = href
    document.head.appendChild(style)
  }
}
