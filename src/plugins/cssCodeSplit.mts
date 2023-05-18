import { Config, Plugin, baseRelative, md5Hex } from '@htmelt/plugin'
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
          loader: 'js',
          contents: getCSSInjectionScript(
            css.code.toString('utf8'),
            args.path,
            config,
            flags
          ),
        }
      })

      build.onTransform(
        { filter: /\.css$/, namespace: 'virtual' },
        async args => ({
          loader: 'js',
          code: getCSSInjectionScript(args.code, args.path, config, flags),
        })
      )
    },
  })
}

function getCSSInjectionScript(
  code: string,
  file: string,
  config: Config,
  flags: { watch?: boolean; minify?: boolean }
) {
  config.registerCssEntry?.(file, code)

  const jsArgs = [
    `"${md5Hex(file).slice(0, 12)}"`,
    '`' + (flags.minify ? '' : '\n') + code.replace(/[\\`]/g, '\\$&') + '`',
  ]

  let jsModule: string
  if (flags.watch) {
    const url = new URL(
      baseRelative(config.getBuildPath(file)),
      config.server.url
    )
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
