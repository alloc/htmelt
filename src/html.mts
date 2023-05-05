import {
  appendChild,
  Config,
  createElement,
  findElement,
  ParentNode,
  Plugin,
} from '@htmelt/plugin'
import Critters from 'critters'
import * as fs from 'fs'
import { minify } from 'html-minifier-terser'
import { yellow } from 'kleur/colors'
import { parse, parseFragment, serialize } from 'parse5'
import { injectClientConnection } from './clientUtils.mjs'
import { buildRelativeStyles } from './css.mjs'
import { baseRelative, createDir } from './utils.mjs'

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

let critters: Critters

export async function buildHTML(
  document: Plugin.Document,
  config: Config,
  flags: { watch?: boolean; critical?: boolean }
) {
  console.log(yellow('⌁'), baseRelative(document.file))
  const outFile = config.getBuildPath(document.file)
  try {
    await buildRelativeStyles(document.styles, config, flags)
  } catch (e) {
    console.error(e)
    return
  }

  for (const plugin of config.plugins) {
    const hook = plugin.document
    if (hook) {
      await hook(document)
    }
  }

  for (const script of document.scripts) {
    let outPath = config.getBuildPath(script.srcPath)
    outPath = baseRelative(outPath)
    if (!flags.watch) {
      outPath = outPath.replace('/' + config.build + '/', config.base)
    }
    script.srcAttr.value = outPath
  }

  if (flags.watch) {
    injectClientConnection(document, outFile, config)
  }

  let html = serialize(document.documentElement)

  if (!flags.watch) {
    try {
      html = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        ...config.htmlMinifierTerser,
      })
    } catch (e) {
      console.error(e)
    }

    if (flags.critical) {
      try {
        const isPartical = !html.startsWith('<!DOCTYPE html>')
        critters ||= new Critters({
          path: config.build,
          logLevel: 'silent',
        })
        html = await critters.process(html)
        // fix critters jsdom
        if (isPartical) {
          html = html.replace(/<\/?(html|head|body)>/g, '')
        }
      } catch (err) {
        console.error(err)
      }
    }
  }

  createDir(outFile)
  fs.writeFileSync(outFile, html)

  return html
}
