import {
  Config,
  Node,
  StyleReference,
  baseRelative,
  findElements,
  getAttribute,
} from '@htmelt/plugin'
import * as fs from 'fs'
import { gray, red, yellow } from 'kleur/colors'
import * as lightningCss from 'lightningcss'
import path from 'path'
import { createDir } from './utils.mjs'

export async function buildCSSFile(
  file: string,
  config: Config,
  flags: { watch?: boolean; minify?: boolean } = {}
) {
  const importer = new URL('file://' + path.resolve(file))
  const visitors = config.plugins
    .map(({ cssPlugins }) => {
      const visitors: lightningCss.Visitor<any>[] = []
      cssPlugins?.forEach(cssPlugin => {
        const visitor = cssPlugin.visitor(importer)
        if (visitor) {
          visitors.push(visitor)
        }
      })
      return visitors
    })
    .flat()

  if (!config.virtualFiles[file]) {
    console.log(yellow('⌁'), baseRelative(file))
  }

  const bundle = await lightningCss.bundleAsync({
    minify:
      flags.minify == true ||
      (flags.minify == null && config.mode != 'development'),
    sourceMap: config.mode == 'development',
    errorRecovery: true,
    visitor: visitors.length
      ? lightningCss.composeVisitors(visitors)
      : undefined,
    resolver: {
      resolve(specifier, originatingFile) {
        if (/^\.\.?(\/|$)/.test(specifier)) {
          return path.resolve(path.dirname(originatingFile), specifier)
        }
        // Assume bare imports are found in root node_modules.
        return path.resolve('node_modules', specifier)
      },
    },
    ...config.lightningCss,
    filename: file,
  })

  if (bundle.warnings.length) {
    console.warn('')
    bundle.warnings.forEach(w => {
      console.warn(red(w.type), w.message)
      console.warn(
        ' ',
        gray(
          baseRelative(w.loc.filename).slice(1) +
            ':' +
            w.loc.line +
            ':' +
            w.loc.column
        )
      )
    })
    console.warn('')
  }

  return {
    ...bundle,
    outFile: config.getBuildPath(file),
  }
}

export function findRelativeStyles(
  document: Node,
  file: string,
  config: Config
) {
  const results: StyleReference[] = []
  for (const styleNode of findStyleSheets(document)) {
    const srcAttr = styleNode.attrs.find(a => a.name === 'href')
    if (srcAttr?.value.startsWith('./')) {
      const srcPath = path.join(path.dirname(file), srcAttr.value)
      results.push({
        node: styleNode,
        srcAttr,
        srcPath,
        outPath: config.getBuildPath(srcPath),
      })
    }
  }
  return results
}

export async function buildRelativeStyles(
  styles: StyleReference[],
  config: Config,
  flags?: { watch?: boolean }
) {
  await Promise.all(
    styles.map(style =>
      buildCSSFile(style.srcPath, config, flags)
        .then(result => {
          createDir(result.outFile)
          fs.writeFileSync(result.outFile, result.code)
          if (result.map) {
            fs.writeFileSync(result.outFile + '.map', result.map)
          }
        })
        .catch(e => {
          console.error(
            'Failed to compile "%s":',
            baseRelative(style.srcPath),
            e
          )
        })
    )
  )
}

function findStyleSheets(rootNode: Node) {
  return findElements(
    rootNode,
    e => e.tagName == 'link' && getAttribute(e, 'rel') == 'stylesheet'
  )
}
