import { appendChild, createScript, findElement, Plugin } from '@htmelt/plugin'
import * as fs from 'fs'
import * as path from 'path'
import { Config } from '../config.mjs'
import { compileSeparateEntry } from './esbuild.mjs'
import { relative } from './utils.mjs'

const getConnectionFile = (config: Config) =>
  path.resolve(config.build, '_connection.mjs')

export async function buildClientConnection(config: Config) {
  fs.mkdirSync(config.build, { recursive: true })
  fs.writeFileSync(
    getConnectionFile(config),
    await compileSeparateEntry('./client/connection.mjs', config)
  )
}

export function injectClientConnection(
  document: Plugin.Document,
  outFile: string,
  config: Config
) {
  const head = findElement(document.documentElement, e => e.tagName === 'head')!
  const connectionFile = getConnectionFile(config)
  if (document.hmr != false) {
    appendChild(
      head,
      createScript({
        src: relative(config.build, connectionFile).slice(1),
      })
    )
  } else {
    const stubFile = connectionFile.replace(/\.\w+$/, '_stub$&')
    fs.writeFileSync(stubFile, 'globalThis.htmelt = {export(){}}')
    appendChild(
      head,
      createScript({
        src: relative(config.build, stubFile).slice(1),
      })
    )
  }
}
