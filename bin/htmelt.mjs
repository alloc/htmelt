#!/usr/bin/env node
import { spawn } from 'child_process'

function spawnCLI() {
  const env = { ...process.env }
  const cliPath = new URL('../dist/cli.mjs', import.meta.url).pathname
  const cliProc = spawn('node', [cliPath, ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
  })
  cliProc.once('close', (code, signal) => {
    if (code !== 0 && signal == null) {
      spawnCLI()
    }
  })
}

spawnCLI()
