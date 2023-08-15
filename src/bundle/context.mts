import { esbuild } from '@htmelt/plugin'
import { PartialBundle } from './types.mjs'

export const esbuildBundles = new Map<esbuild.BuildOptions, PartialBundle>()
