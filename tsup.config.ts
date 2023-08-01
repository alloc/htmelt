import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.mts',
    'src/cli.mts',
    'src/client/connection.ts',
    'src/client/cssReload.ts',
  ],
  format: ['esm'],
})
