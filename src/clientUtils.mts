import {
  appendChild,
  createScript,
  findElement,
  Plugin,
  setTextContent,
} from '@htmelt/plugin'
import * as fs from 'fs'
import * as path from 'path'
import { Config } from '../config.mjs'
import { compileSeparateEntry } from './esbuild.mjs'
import { relative } from './utils.mjs'

const getConnectionFile = (config: Config) =>
  path.resolve(config.build, '_connection.mjs')

export async function buildClientConnection(config: Config) {
  fs.writeFileSync(
    getConnectionFile(config),
    await compileSeparateEntry('./client/connection.js', config)
  )
}

export function injectClientConnection(
  document: Plugin.Document,
  outFile: string,
  config: Config
) {
  const head = findElement(document.documentElement, e => e.tagName === 'head')!
  if (document.hmr != false) {
    const connectionFile = getConnectionFile(config)
    const hmrScript = createScript({
      src: relative(outFile, connectionFile),
    })
    appendChild(head, hmrScript)
  } else {
    const stubScript = createScript()
    setTextContent(stubScript, 'globalThis.htmelt = {export(){}}')
    appendChild(head, stubScript)
  }
}
