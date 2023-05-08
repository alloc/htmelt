#!/usr/bin/env node

import { Flags } from '@htmelt/plugin'
import cac from 'cac'
import { bundle } from './bundle.mjs'
import { loadBundleConfig } from './config.mjs'

const cli = cac('htmelt')

cli
  .command('')
  .option('--watch', `[boolean]`)
  .option('--minify', `[boolean]`)
  .option('--critical', `[boolean]`)
  .option('--webext <target>', 'Override webext config')
  .action(async (flags: Flags) => {
    process.env.NODE_ENV ||= flags.watch ? 'development' : 'production'
    const config = await loadBundleConfig(flags)
    const context = await bundle(config, flags)
    if (!flags.watch) {
      context.dispose()
    }
  })

cli.parse()
