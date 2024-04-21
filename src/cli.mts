#!/usr/bin/env node

import { BundleFlags, CLI } from '@htmelt/plugin'
import cac from 'cac'
import { bundle } from './bundle.mjs'
import { loadBundleConfig } from './config.mjs'
import { parseFlags } from './utils.mjs'

const cli = cac('htmelt')
  .option('-o, --outDir <dir>', `[string] set the build directory`)
  .option('--watch', `[boolean]`)
  .option('--host [host]', `[string|boolean]`)
  .option('--port <port>', `[number]`)

const commands: CLI['commands'] = {
  default: cli
    .command('')
    .option('--base <path>', `[string]`)
    .option('--deletePrev', `[boolean]`)
    .option('--minify', `[boolean]`),
}

const flags = parseFlags(cli)
process.env.NODE_ENV ||= flags.watch ? 'development' : 'production'

loadBundleConfig(flags, {
  commands,
  command(rawName, description, config) {
    return (commands[rawName] = cli.command(rawName, description, config))
  },
}).then(config => {
  commands.default.action(async (flags: BundleFlags) => {
    const context = await bundle(config, flags)
    if (!flags.watch) {
      context.dispose()
    }
  })

  cli.parse()
})
