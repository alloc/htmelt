import {
  Config,
  getAttribute,
  ParentNode,
  ScriptReference,
} from '@htmelt/plugin'
import * as esbuild from 'esbuild'
import { wrapPlugins } from 'esbuild-extra'
import { yellow } from 'kleur/colors'
import * as path from 'path'
import importGlobPlugin from './plugins/importGlob/index.mjs'
import metaUrlPlugin from './plugins/importMetaUrl.mjs'
import { baseRelative, findExternalScripts } from './utils.mjs'

export async function compileSeparateEntry(
  file: string,
  config: Config,
  options?: Omit<esbuild.BuildOptions, 'sourcemap' | 'metafile'>
): Promise<string>

export async function compileSeparateEntry(
  file: string,
  config: Config,
  options?: esbuild.BuildOptions & ({ sourcemap: true } | { metafile: true })
): Promise<esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] }>

export async function compileSeparateEntry(
  file: string,
  config: Config,
  options: esbuild.BuildOptions = {}
) {
  const filePath = decodeURIComponent(new URL(file, import.meta.url).pathname)

  const result = await esbuild.build(
    wrapPlugins({
      ...config.esbuild,
      ...options,
      format: options.format ?? 'iife',
      plugins:
        options.plugins ||
        config.esbuild.plugins?.filter(p => p.name !== 'dev-exports'),
      sourcemap:
        options.sourcemap ?? (config.mode == 'development' ? 'inline' : false),
      bundle: true,
      write: false,
      entryPoints: [filePath],
    })
  )

  if (options.sourcemap === true || options.metafile === true) {
    return result
  }
  return result.outputFiles[0].text
}

export function findRelativeScripts(
  document: ParentNode,
  file: string,
  config: Config
) {
  const results: ScriptReference[] = []
  for (const scriptNode of findExternalScripts(document)) {
    const srcAttr = scriptNode.attrs.find(a => a.name === 'src')
    if (srcAttr?.value.startsWith('./')) {
      const srcPath = path.join(path.dirname(file), srcAttr.value)
      const outPath = config.getBuildPath(srcPath)
      srcAttr.value = baseRelative(outPath)
      results.push({
        node: scriptNode,
        srcAttr,
        srcPath,
        outPath,
        isModule: getAttribute(scriptNode, 'type') === 'module',
      })
    }
  }
  return results
}

export function buildEntryScripts(
  scripts: string[],
  config: Config,
  flags: { watch?: boolean; write?: boolean; minify?: boolean } = {}
) {
  for (const srcPath of scripts) {
    console.log(yellow('⌁'), baseRelative(srcPath))
  }
  return esbuild.context(
    wrapPlugins({
      format: 'esm',
      charset: 'utf8',
      sourcemap: flags.watch,
      minify: !flags.watch && flags.minify != false,
      ...config.esbuild,
      entryPoints: scripts,
      outbase: config.src,
      outdir: config.build,
      metafile: true,
      write: flags.write != false,
      bundle: true,
      splitting: true,
      treeShaking: !flags.watch,
      plugins: [
        ...(config.esbuild.plugins || []),
        metaUrlPlugin(),
        importGlobPlugin(),
      ],
    })
  )
}
