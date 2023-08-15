import {
  appendChild,
  Config,
  createElement,
  fileToId,
  findElement,
  ParentNode,
  parse,
  parseFragment,
  Plugin,
  ScriptReference,
  serialize,
  setTextContent,
  StyleReference,
} from '@htmelt/plugin'
import * as fs from 'fs'
import { minify } from 'html-minifier-terser'
import { yellow } from 'kleur/colors'
import * as lightningCss from 'lightningcss'
import { injectClientConnection } from './clientUtils.mjs'
import { buildRelativeStyles } from './css.mjs'
import { createDir } from './utils.mjs'

export function parseHTML(html: string) {
  const document = (
    html.includes('<!DOCTYPE html>') || html.includes('<html')
      ? parse(html)
      : parseFragment(html)
  ) as ParentNode

  if (!findElement(document, e => e.tagName == 'head')) {
    const head = createElement('head')
    appendChild(document, head)
  }
  if (!findElement(document, e => e.tagName == 'body')) {
    const body = createElement('body')
    appendChild(document, body)
  }

  return document
}

export async function buildHTML(
  document: Plugin.Document,
  config: Config,
  flags: { watch?: boolean; minify?: boolean }
) {
  console.log(yellow('⌁'), fileToId(document.file))
  const outFile = config.getBuildPath(document.file)
  try {
    await buildRelativeStyles(document.styles, config, flags)
  } catch (e) {
    console.error(e)
    return
  }

  if (document.bundle.injectedStyles) {
    const minifyResult = lightningCss.transform({
      code: Buffer.from(document.bundle.injectedStyles.join('\n')),
      filename: document.file + '.css',
      minify: true,
    })

    const css = minifyResult.code.toString()
    const style = createElement('style')
    setTextContent(style, css)

    const head = findElement(
      document.documentElement,
      e => e.tagName === 'head'
    )!
    appendChild(head, style)
  }

  const buildSrcAttr = (ref: ScriptReference | StyleReference) => {
    let src = fileToId(ref.outPath)
    if (!flags.watch) {
      src = src.replace('/' + config.build + '/', config.base)
    }
    ref.srcAttr.value = src
  }

  document.scripts.forEach(buildSrcAttr)
  document.styles.forEach(buildSrcAttr)

  for (const plugin of config.plugins) {
    const hook = plugin.document
    if (hook) {
      await hook(document)
    }
  }

  if (flags.watch) {
    injectClientConnection(document, outFile, config)
  }

  let html = serialize(document.documentElement)

  if (!flags.watch) {
    if (flags.minify !== false) {
      try {
        html = await minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          ...config.htmlMinifierTerser,
        })
      } catch (e) {
        console.error(e)
      }
    }
  }

  createDir(outFile)
  fs.writeFileSync(outFile, html)

  return html
}
