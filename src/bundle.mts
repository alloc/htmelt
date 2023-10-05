import {
  BundleFlags,
  Config,
  fileToId,
  parseNamespace,
  Plugin,
  ScriptReference,
  ServePlugin,
} from '@htmelt/plugin'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import glob from 'glob'
import { cyan, red, yellow } from 'kleur/colors'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import { promisify } from 'util'
import { PartialBundle } from './bundle/types.mjs'
import { buildClientConnection } from './clientUtils.mjs'
import { copyFiles } from './copy.mjs'
import { buildRelativeStyles, findRelativeStyles } from './css.mjs'
import {
  buildEntryScripts,
  compileSeparateEntry,
  findRelativeScripts,
} from './esbuild.mjs'
import { buildHTML, parseHTML } from './html.mjs'
import { updateRelatedWatcher } from './relatedWatcher.mjs'
import { createDir, setsEqual } from './utils.mjs'

export async function bundle(config: Config, flags: BundleFlags) {
  if (flags.deletePrev ?? config.deletePrev) {
    fs.rmSync(config.build, { force: true, recursive: true })
  }

  flags.minify ??= config.mode != 'development'

  let server: import('http').Server | undefined
  if (flags.watch) {
    const { installHttpServer } = await import('./devServer.mjs')

    const servePlugins = config.plugins.filter(p => p.serve) as ServePlugin[]
    server = await installHttpServer(config, servePlugins)

    await buildClientConnection(config)
  }

  const createBuild = () => {
    const bundles = new Map<string, PartialBundle>()
    const documents: Record<string, Plugin.Document> = {}
    const scripts: Record<string, Plugin.Script> = {}

    const loadDocument = (file: string) => {
      const html = fs.readFileSync(file, 'utf8')
      const documentElement = parseHTML(html)
      const scripts = findRelativeScripts(documentElement, file, config)
      const styles = findRelativeStyles(documentElement, file, config)
      return { documentElement, scripts, styles }
    }

    const buildScripts = async (bundle: PartialBundle) => {
      const oldEntries = bundle.entries
      const newEntries = new Set(bundle.scripts)

      type MutableScriptReference = ScriptReference & { outPath: string }

      // Take the scripts of every document that imports this bundle and then
      // build them together for optimal code sharing.
      const scripts = new Set<MutableScriptReference>(
        bundle.importers.flatMap(document => {
          for (const script of document.scripts) {
            newEntries.add(script.srcPath)
          }
          return document.scripts
        })
      )

      let { context } = bundle

      // Skip the build if the script paths haven't changed.
      if (!context || !oldEntries || !setsEqual(oldEntries, newEntries)) {
        context = await buildEntryScripts(
          newEntries,
          bundle.scripts.size > 0 && (entry => bundle.scripts.has(entry)),
          config,
          flags,
          bundle
        )
        bundle.context = context
        bundle.entries = newEntries
      }

      const { metafile } = await context.rebuild()
      bundle.metafile = metafile
      bundle.inputs = toBundleInputs(metafile)

      if (!flags.watch) {
        const outPaths = Object.keys(metafile.outputs).reduce(
          (outPaths, outPath) => {
            const srcPath = metafile.outputs[outPath].entryPoint
            if (srcPath != null) {
              outPaths[path.resolve(srcPath)] = path.resolve(outPath)
            }
            return outPaths
          },
          {} as Record<string, string>
        )

        for (const script of scripts) {
          script.outPath = outPaths[script.srcPath]
        }
      }

      return bundle as Plugin.Bundle
    }

    return {
      documents,
      /**
       * Build state for standalone scripts added with the `scripts`
       * config option. Exists only in `--watch` mode.
       */
      get scripts() {
        return scripts
      },
      initialBuild: (async () => {
        const seen = new Set<string>()

        for (const entry of config.entries) {
          let { file, bundleId = 'default' } = entry
          file = path.resolve(file)

          const key = `${file}:${bundleId}`
          if (seen.has(key)) continue
          seen.add(key)

          let bundle = bundles.get(bundleId)
          if (!bundle) {
            bundle = {
              id: bundleId,
              hmr: true,
              scripts: new Set(),
              importers: [],
            }
            bundles.set(bundleId, bundle)
          }

          if (entry.hmr == false) {
            bundle.hmr = false
          }

          if (file.endsWith('.html')) {
            const document: Plugin.Document = {
              ...entry,
              ...loadDocument(file),
              file,
              bundle: bundle as Plugin.Bundle,
            }
            const id = fileToId(file)
            documents[id] = document
            bundle.importers.push(document)
          } else if (/\.[mc]?[tj]sx?$/.test(file)) {
            bundle.scripts.add(file)
          } else {
            console.warn(red('⚠'), 'unsupported entry type:', file)
          }
        }

        let isolatedScripts: string[] | undefined
        if (config.scripts) {
          const matches = await Promise.all(
            config.scripts.map(p => promisify(glob)(p))
          )
          isolatedScripts = Array.from(new Set(matches.flat()), p =>
            path.resolve(p)
          )
        } else {
          isolatedScripts = []
        }

        const bundlePromises: Record<string, Promise<any>> = {}
        const bundlesPromise = Promise.all(
          Array.from(bundles, async ([bundleId, bundle]) => {
            await (bundlePromises[bundleId] = buildScripts(bundle))
            if (config.relatedWatcher) {
              updateRelatedWatcher(config.relatedWatcher, bundle.metafile!)
            }

            return [bundleId, bundle as Plugin.Bundle] as const
          })
        ).then(Object.fromEntries<Plugin.Bundle>)

        await Promise.all([
          bundlesPromise.then(async bundles => {
            config.bundles = bundles
            await Promise.all(
              config.plugins.map(plugin => plugin.bundles?.(bundles))
            )
          }),
          ...Object.values(documents).map(document =>
            bundlePromises[document.bundle.id].then(() =>
              buildHTML(document, config, flags)
            )
          ),
          ...isolatedScripts.map(srcPath => {
            console.log(yellow('⌁'), fileToId(srcPath))
            if (flags.watch) {
              return compileSeparateEntry(srcPath, config, {
                metafile: true,
                watch: true,
              }).then(({ outputFiles, context, metafile }) => {
                const inputs = toBundleInputs(metafile, config.watcher)
                const outPath = config.getBuildPath(srcPath)

                scripts[srcPath] = {
                  srcPath,
                  outPath,
                  context,
                  metafile,
                  inputs,
                }

                createDir(outPath)
                fs.writeFileSync(outPath, outputFiles[0].text)
                updateRelatedWatcher(config.relatedWatcher!, metafile)
              })
            }
            return compileSeparateEntry(srcPath, config).then(code => {
              const outFile = config.getBuildPath(srcPath)
              createDir(outFile)
              fs.writeFileSync(outFile, code)
            })
          }),
        ])

        if (config.copy) {
          await copyFiles(config.copy, config)
        }

        for (const plugin of config.plugins) {
          if (plugin.initialBuild) {
            await plugin.initialBuild()
          }
        }
      })(),
      async rebuildHTML(uri: string) {
        const document = documents[uri]
        if (!document) {
          // Skip HTML files not listed in `config.entries`
          return
        }

        const file = uri.startsWith('/@fs/')
          ? uri.slice(4)
          : path.join(process.cwd(), uri)

        const oldScripts = document.scripts
        const oldMetafile = document.bundle.metafile

        Object.assign(document, loadDocument(file))

        await Promise.all([
          buildHTML(document, config, flags),
          (oldScripts.length !== document.scripts.length ||
            oldScripts.some(
              (script, i) => script.srcPath !== document.scripts[i].srcPath
            )) &&
            buildScripts(document.bundle).then(bundle => {
              updateRelatedWatcher(
                config.relatedWatcher!,
                bundle.metafile,
                oldMetafile
              )
            }),
        ])
      },
      async rebuildStyles() {
        await Promise.all(
          Object.values(documents).map(document =>
            buildRelativeStyles(document.styles, config, flags)
          )
        )
      },
      dispose() {
        for (const bundle of bundles.values()) {
          bundle.context?.dispose()
        }
        for (const script of Object.values(scripts)) {
          script.context.dispose()
        }
        server?.close()
        config.watcher?.close()
      },
    }
  }

  const timer = performance.now()
  const build = createBuild()
  await (config.lastBuild = build.initialBuild)
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  if (server) {
    const { installWebSocketServer } = await import('./devServer.mjs')

    const hmrInstances: Plugin.HmrInstance[] = []
    const clients = installWebSocketServer(server, config, hmrInstances)

    const watcher = config.watcher!
    const changedScripts = new Set<Plugin.Script>()
    const changedModules = new Set<string>()
    const changedPages = new Set<string>()

    // Trigger a rebuild when a related file is changed.
    config.relatedWatcher?.onChange(relatedFile => {
      if (parseNamespace(relatedFile)) {
        watcher.emit('change', relatedFile)
      } else {
        console.log('Touching file:', relatedFile)
        fs.utimesSync(relatedFile, new Date(), new Date())
      }
    })

    // TODO: track failed module resolutions and only rebuild if a file
    // is added that matches one of them.
    /*watcher.on('add', async file => {
      await scheduleRebuild()
      console.log(cyan('+'), file)
    })*/

    // This listener supports absolute file paths, files relative to the working
    // directory, and namespaced IDs. So if a virtual file is changed, you can
    // call…
    //     config.watcher.add("virtual:some/generated/module.js")
    // …to reload the bundle or send HMR updates.
    watcher.on('change', file => {
      const namespace = parseNamespace(file)
      const id = namespace ? file : fileToId(path.resolve(file))

      if (id.endsWith('.html')) {
        console.log(cyan('↺'), id)
        changedPages.add(id)
        requestRebuild()
      } else {
        // Any files used by scripts added in `config.scripts` will
        // trigger a full reload when changed.
        let isFullReload = false
        for (const script of Object.values(build.scripts)) {
          if (script.inputs.includes(id)) {
            changedScripts.add(script)
            isFullReload = true
          }
        }
        if (isFullReload) {
          requestRebuild()
        } else if (id.endsWith('.css') || config.modules!.has(id)) {
          changedModules.add(id)
          requestRebuild()
        }
      }
    })

    watcher.on('unlink', file => {
      const namespace = parseNamespace(file)
      config.relatedWatcher?.forgetRelatedFile(
        namespace ? file : path.resolve(file)
      )

      // Absolute files are typically not added to the build directory.
      if (path.isAbsolute(file)) {
        return
      }

      const outPath = config.getBuildPath(file).replace(/\.[jt]sx?$/, '.js')
      try {
        fs.rmSync(outPath)
        let outDir = path.dirname(outPath)
        while (outDir !== config.build) {
          const stats = fs.readdirSync(outDir)
          if (stats.length) break
          fs.rmSync(outDir)
          outDir = path.dirname(outDir)
        }
        console.log(red('–'), file)
      } catch {}
    })

    const requestRebuild = debounce(() => {
      config.lastBuild = rebuild()
    }, 200)

    const rebuild = async () => {
      // console.clear()

      let isFullReload = changedPages.size > 0 || changedScripts.size > 0
      let stylesChanged = false

      const acceptedFiles = new Map<Plugin.HmrInstance, string[]>()
      if (!isFullReload) {
        // Any files used by a bundle with HMR disabled will trigger a
        // full reload when changed.
        const fullReloadFiles = new Set<string>()
        for (const bundle of Object.values(config.bundles)) {
          if (!bundle.hmr) {
            for (const file of bundle.inputs) {
              fullReloadFiles.add(file)
            }
          }
        }

        accept: for (let file of changedModules) {
          console.log(cyan('↺'), file)

          if (file.endsWith('.css')) {
            stylesChanged = true
          }

          if (fullReloadFiles.has(file)) {
            isFullReload = true
            break
          }

          for (const hmr of hmrInstances) {
            if (hmr.accept(file)) {
              let files = acceptedFiles.get(hmr)
              if (!files) {
                acceptedFiles.set(hmr, (files = []))
              }
              console.log('HMR accepted file:', file)
              files.push(file)
              continue accept
            }
          }

          isFullReload = true
          break
        }
        if (isFullReload) {
          acceptedFiles.clear()
        }
      }

      const errors: any[] = []

      const htmlRebuildPromises = Array.from(changedPages, file =>
        build.rebuildHTML(file).catch(error => {
          errors.push(error)
        })
      )

      const scriptRebuildPromises = Array.from(changedScripts, script => {
        return script.context
          .rebuild()
          .then(({ outputFiles, metafile }) => {
            fs.writeFileSync(script.outPath, outputFiles[0].text)
            script.metafile = metafile
            script.inputs = toBundleInputs(metafile)
          })
          .catch(error => {
            errors.push(error)
          })
      })

      changedScripts.clear()
      changedModules.clear()
      changedPages.clear()

      await Promise.all([
        Promise.all(
          Array.from(acceptedFiles, async ([hmr, files]) => hmr.update(files))
        ).catch(error => {
          errors.push(error)
        }),
        ...htmlRebuildPromises,
        ...scriptRebuildPromises,
        // Rebuild all styles if a .css file is changed at the same time that a
        // full reload was triggered, since the .css file may be imported by a
        // page/script that changed.
        isFullReload &&
          stylesChanged &&
          build.rebuildStyles().catch(error => {
            errors.push(error)
          }),
      ])

      if (errors.length) {
        const seen = new Set<string>()
        for (const error of errors) {
          if (seen.has(error.message)) continue
          seen.add(error.message)
          console.error()
          console.error(error)
        }
        console.error()
      } else if (isFullReload) {
        await Promise.all(config.plugins.map(plugin => plugin.fullReload?.()))
        await Promise.all(Array.from(clients, client => client.reload()))
      }

      console.log(yellow('watching files...'))
    }

    console.log(yellow('watching files...'))
  }

  return build
}

export function toBundleInputs(
  metafile: esbuild.Metafile,
  watcher?: { add(file: string): void }
) {
  return Object.keys(metafile.inputs).map(file => {
    // Virtual files have a namespace prefix.
    if (file.includes(':')) {
      return file
    }
    watcher?.add(file)
    return fileToId(file)
  })
}
