import type { BundleFlags } from '@htmelt/plugin'

export async function bundle(flags: BundleFlags = {}) {
  const { loadBundleConfig } = await import('./config.mjs')
  const { bundle } = await import('./bundle.mjs')

  const config = await loadBundleConfig(flags)
  return bundle(config, flags)
}
