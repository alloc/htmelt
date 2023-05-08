#!/usr/bin/env node

import { CLI } from '@htmelt/plugin'
import cac from 'cac'
import { bundle } from './bundle.mjs'
import { loadBundleConfig } from './config.mjs'
import { parseFlags } from './utils.mjs'

const cli = cac('htmelt')
const commands: CLI['commands'] = {
  default: cli
    .command('')
    .option('--watch', `[boolean]`)
    .option('--minify', `[boolean]`)
    .option('--critical', `[boolean]`),
}

const flags = parseFlags()
process.env.NODE_ENV ||= flags.watch ? 'development' : 'production'

loadBundleConfig(flags, {
  commands,
  command(rawName, description, config) {
    return (commands[rawName] = cli.command(rawName, description, config))
  },
}).then(config => {
  commands.default.action(async () => {
    const context = await bundle(config, flags)
    if (!flags.watch) {
      context.dispose()
    }
  })

  cli.parse()
})
