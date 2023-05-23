import {
  Config,
  ParentNode,
  ScriptReference,
  baseRelative,
  getAttribute,
} from '@htmelt/plugin'
import * as esbuild from 'esbuild'
import { wrapPlugins } from 'esbuild-extra'
import { readFileSync, writeFileSync } from 'fs'
import { yellow } from 'kleur/colors'
import * as path from 'path'
import importGlobPlugin from './plugins/importGlob/index.mjs'
import metaUrlPlugin from './plugins/importMetaUrl.mjs'
import { findExternalScripts } from './utils.mjs'

export async function compileSeparateEntry(
  file: string,
  config: Config,
  options?: Omit<esbuild.BuildOptions, 'sourcemap' | 'metafile'>
): Promise<string>

export async function compileSeparateEntry<
  Options extends esbuild.BuildOptions & { watch?: boolean }
>(
  file: string,
  config: Config,
  options: Options & ({ metafile: true } | { sourcemap: true })
): Promise<
  esbuild.BuildResult<Options & { write: false }> &
    (Options['watch'] extends true
      ? { context: esbuild.BuildContext<Options & { write: false }> }
      : unknown)
>

export async function compileSeparateEntry(
  file: string,
  config: Config,
  { watch, ...options }: esbuild.BuildOptions & { watch?: boolean } = {}
): Promise<any> {
  const filePath = decodeURIComponent(new URL(file, import.meta.url).pathname)

  const esbuildOptions = wrapPlugins({
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

  let result: esbuild.BuildResult<typeof esbuildOptions> & {
    context?: esbuild.BuildContext
  }

  if (watch) {
    const context = await esbuild.context(esbuildOptions)
    result = await context.rebuild()
    result.context = context
  } else {
    result = await esbuild.build(esbuildOptions)
  }

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
      results.push({
        node: scriptNode,
        srcAttr,
        srcPath,
        outPath: config.getBuildPath(srcPath),
        isModule: getAttribute(scriptNode, 'type') === 'module',
      })
    }
  }
  return results
}

export function buildEntryScripts(
  standaloneScripts: Set<string>,
  importedScripts: Set<string>,
  config: Config,
  flags: { watch?: boolean; minify?: boolean } = {}
) {
  const scripts = [...standaloneScripts, ...importedScripts]
  for (const srcPath of scripts) {
    console.log(yellow('⌁'), baseRelative(srcPath))
  }

  // Since we can't prevent a standalone script from sharing a module
  // with an imported script (well, without duplicating code...), we
  // need to prepend its output chunk with a stub `htmelt` object, which
  // ensures a standalone script won't crash on `htmelt.export` calls.
  const standaloneScriptPlugin: esbuild.Plugin = {
    name: 'htmelt/standaloneScripts',
    setup(build) {
      if (!flags.watch || !standaloneScripts.size) {
        return
      }
      let stubPath: string | undefined
      build.onEnd(({ metafile }) => {
        for (let [outFile, output] of Object.entries(metafile!.outputs)) {
          if (!output.entryPoint) continue

          const entry = path.resolve(output.entryPoint)
          if (!standaloneScripts.has(entry)) continue

          if (!stubPath) {
            stubPath = path.join(config.build, 'htmelt-stub.js')
            writeFileSync(stubPath, 'globalThis.htmelt = {export(){}};')
          }

          let stubImportId = path.relative(path.dirname(outFile), stubPath)
          if (stubImportId[0] !== '.') {
            stubImportId = './' + stubImportId
          }

          outFile = path.resolve(outFile)
          let code = readFileSync(outFile, 'utf8')
          code = `import "${stubImportId}"; ` + code
          writeFileSync(outFile, code)
        }
      })
    },
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
      write: true,
      bundle: true,
      splitting: true,
      treeShaking: !flags.watch,
      ignoreAnnotations: flags.watch,
      plugins: [
        ...(config.esbuild.plugins || []),
        metaUrlPlugin(),
        importGlobPlugin(),
        standaloneScriptPlugin,
      ],
    })
  )
}
