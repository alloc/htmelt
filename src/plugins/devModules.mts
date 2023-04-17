import { Module, Plugin } from '@htmelt/plugin'
import * as esbuild from 'esbuild'
import { ESTree, parse } from 'meriyah'
import { nebu, Node as NebuNode, Plugin as NebuPlugin } from 'nebu'
import { dirname } from 'path'
import { compileSeparateEntry } from '../esbuild.mjs'
import { appendInlineSourceMap } from '../sourceMaps.mjs'
import { baseRelative, resolveDevMapSources } from '../utils.mjs'
import importGlobPlugin from './importGlob/index.mjs'
import metaUrlPlugin from './importMetaUrl.mjs'

export const devModulesPlugin: Plugin = async config => {
  const modules = config.modules!

  const esbuildDevModules: esbuild.Plugin = {
    name: 'dev-modules',
    setup(build) {
      build.onTransform({ loaders: ['js'] }, async args => {
        const program = parse(args.code, {
          next: true,
          ranges: true,
          module: true,
        })

        const resolutions = new Map<ESTree.ImportDeclaration, string>()

        await Promise.all(
          program.body.map(async node => {
            if (node.type !== 'ImportDeclaration') {
              return
            }
            const id = node.source.value as string
            const resolved = await build.resolve(id, {
              kind: 'import-statement',
              importer: args.path,
              resolveDir: dirname(args.path),
            })
            resolutions.set(node, resolved.path)
          })
        )

        const nebuDevModules: NebuPlugin = {
          Program(program) {
            for (const node of program.body) {
              if (node.isImportDeclaration()) {
                let resolvedId = resolutions.get(node.n)
                if (resolvedId === undefined) {
                  continue
                }

                resolvedId = baseRelative(resolvedId)
                if (!(resolvedId in modules)) {
                  continue
                }

                if (
                  node.specifiers.length === 1 &&
                  node.specifiers[0].isImportNamespaceSpecifier()
                ) {
                  const localName = node.specifiers[0].local.name
                  node.replace(
                    `const ${localName} = htmelt.import("${resolvedId}")`
                  )
                } else {
                  const specifiers = (
                    node.specifiers as (
                      | NebuNode.ImportSpecifier
                      | NebuNode.ImportDefaultSpecifier
                    )[]
                  ).map(specifier => {
                    const exported = specifier.isImportDefaultSpecifier()
                      ? 'default'
                      : specifier.imported.name
                    return (
                      exported +
                      (exported !== specifier.local.name
                        ? ': ' + specifier.local.name
                        : '')
                    )
                  })
                  node.replace(
                    `const {${specifiers.join(
                      ', '
                    )}} = htmelt.import("${resolvedId}")`
                  )
                }
              }
              // Remove any export declarations, since we want to avoid
              // re-exports from being bundled and the `htmelt.export`
              // calls should have already been added.
              else if (
                node.isExportAllDeclaration() ||
                node.isExportNamedDeclaration() ||
                node.isExportDefaultDeclaration()
              ) {
                node.remove()
              }
            }
          },
        }

        const result = nebu.process(args.code, {
          filename: args.path,
          ast: program,
          sourceMap: true,
          sourceMapHiRes: true,
          plugins: [nebuDevModules],
        })

        return {
          code: result.js,
          map: result.map,
        }
      })
    },
  }

  config.loadDevModule = async entry => {
    const sourceRoot = dirname(entry)
    const {
      outputFiles: [mapFile, jsFile],
    } = await compileSeparateEntry(entry, config, {
      format: 'esm',
      outfile: entry.replace(/\.\w+$/, '.' + Date.now() + '$&'),
      sourcemap: true,
      sourceRoot,
      plugins: [
        ...config.esbuild.plugins,
        metaUrlPlugin(),
        importGlobPlugin(),
        esbuildDevModules,
      ],
    })

    const map = JSON.parse(mapFile.text)
    resolveDevMapSources(map, process.cwd(), sourceRoot)
    map.sourceRoot = undefined

    return appendInlineSourceMap(jsFile.text, map)
  }

  config.esbuild.plugins.push({
    name: 'dev-exports',
    setup(build) {
      type State = {
        module: Module
        resolutions: Map<
          ESTree.ExportAllDeclaration | ESTree.ExportNamedDeclaration,
          string
        >
      }

      const nebuDevExports: NebuPlugin<State> = {
        Program(program, { module, resolutions }) {
          const exports: Export[] = []

          for (let node of program.body) {
            if (node.isImportDeclaration()) {
              module.imports.add(node.source.value as string)
            } else if (node.isExportNamedDeclaration()) {
              if (node.source) {
                const resolvedId = resolutions.get(node.n)
                if (!resolvedId) {
                  continue
                }
                const aliases = node.specifiers.map(specifier => [
                  specifier.exported.name,
                  specifier.local.name,
                ])
                exports.push({
                  from: baseRelative(resolvedId),
                  aliases: Object.fromEntries(aliases),
                })
                continue
              }
              if (node.declaration) {
                node = node.declaration
                if (node.isVariableDeclaration()) {
                  for (const decl of node.declarations) {
                    const { name } = decl.id as NebuNode.Identifier
                    if (node.kind === 'const') {
                      exports.push([name, name])
                    } else {
                      exports.push({
                        name,
                        get: jsonAccessor(name),
                      })
                    }
                  }
                } else {
                  const name = node.id!.name
                  exports.push([name, name])
                }
                continue
              }
              exports.push({
                values: Object.fromEntries(
                  node.specifiers.map(specifier => [
                    specifier.exported.name,
                    jsonAccessor(specifier.local.name),
                  ])
                ),
              })
            } else if (node.isExportDefaultDeclaration()) {
              node.before('let __default;')
              node.declaration.before(`__default = `)
              exports.push(['default', '__default'])
            } else if (node.isExportAllDeclaration()) {
              const resolvedId = resolutions.get(node.n)
              if (resolvedId) {
                exports.push({
                  from: baseRelative(resolvedId),
                })
              }
            }
          }

          if (exports.length === 0) {
            return
          }

          program.push(
            'body',
            `\nhtmelt.export("${module.id}", [` +
              exports.map(stringifyExport).join(',') +
              '])'
          )
        },
      }

      build.onTransform({ loaders: ['js', 'jsx'] }, async args => {
        const id = baseRelative(args.initialPath || args.path)

        const program = parse(args.code, {
          next: true,
          ranges: true,
          module: true,
          jsx: args.loader === 'jsx',
        })

        const resolutions = new Map<
          ESTree.ExportAllDeclaration | ESTree.ExportNamedDeclaration,
          string
        >()

        await Promise.all(
          program.body.map(async node => {
            if (
              (node.type !== 'ExportAllDeclaration' &&
                node.type !== 'ExportNamedDeclaration') ||
              !node.source
            ) {
              return
            }
            const id = node.source.value as string
            const resolved = await build.resolve(id, {
              kind: 'import-statement',
              importer: args.path,
              resolveDir: dirname(args.path),
            })
            resolutions.set(node, resolved.path)
          })
        )

        const result = nebu.process(args.code, {
          ast: program,
          filename: args.path,
          sourceMap: true,
          sourceMapHiRes: true,
          plugins: [nebuDevExports],
          state: {
            module: (modules[id] = {
              id,
              imports: new Set(),
            }),
            resolutions,
          },
        })

        return {
          code: result.js,
          map: result.map,
        }
      })
    },
  })

  return {}
}

function jsonAccessor(name: string) {
  return new Function('', 'return () => ' + name)()
}

// This must align with `htmelt.Export` in ../../client.d.ts
type Export =
  | { from: string; aliases?: Record<string, string> }
  | { values: Record<string, () => any> }
  | { name: string; get: () => any }
  | [name: string, value: any]

function stringifyExport(e: Export) {
  if (Array.isArray(e)) {
    return '[' + JSON.stringify(e[0]) + ',' + e[1] + ']'
  }
  if ('from' in e) {
    return JSON.stringify(e)
  }
  if ('values' in e) {
    return (
      '{values:{' +
      Object.entries(e.values)
        .map(([name, get]) => JSON.stringify(name) + ':' + get.toString())
        .join(',') +
      '}}'
    )
  }
  return '{name:' + JSON.stringify(e.name) + ',get:' + e.get.toString() + '}'
}
