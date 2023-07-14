import { Plugin } from '@htmelt/plugin'
import fs from 'fs'
import { ESTree, parse } from 'meriyah'
import { Node, nebu } from 'nebu'
import path from 'path'
import serialize from 'serialize-javascript'
import vm from 'vm'
import { PreVal } from './types.mjs'

export default (): Plugin => config => {
  config.esbuild.plugins.push({
    name: 'preval',
    setup(build) {
      build.onTransform({ loaders: ['js'] }, async args => {
        if (!findPreval(args.code)) {
          return null
        }

        const program = parse(args.code, {
          next: true,
          ranges: true,
          module: true,
        })

        const importer = args.path
        const resolveDir = path.dirname(importer)
        const watchFiles: string[] = []
        const watchDirs: string[] = []

        const context: PreVal = {
          file: args.path,
          fs: {
            readFile(file) {
              file = path.resolve(resolveDir, file)
              watchFiles.push(file)
              try {
                return fs.readFileSync(file, 'utf8')
              } catch {}
            },
            listFiles(dir) {
              dir = path.resolve(resolveDir, dir)
              watchDirs.push(dir)
              try {
                return fs.readdirSync(dir)
              } catch {}
            },
          },
          async load(id, options) {
            const resolved = await build.resolve(id, {
              kind: 'entry-point',
              ...options,
              importer,
              resolveDir,
            })

            if (resolved.namespace === 'file') {
              watchFiles.push(resolved.path)
            }

            const loadResult = await build.load(resolved)

            if (loadResult.watchFiles) {
              watchFiles.push(...loadResult.watchFiles)
            }
            if (loadResult.watchDirs) {
              watchDirs.push(...loadResult.watchDirs)
            }

            return loadResult.contents as any
          },
          path,
          process,
        }

        const calls: ESTree.CallExpression[] = []
        nebu.walk(program, {
          CallExpression(node) {
            const callee = node.callee as ESTree.Node
            if (Node.isIdentifier(callee) && callee.name === 'preval') {
              calls.push(node)
            }
          },
        })

        const resolvedCalls = new Map(
          await Promise.all(
            calls.map(async call => {
              const line = args.code.slice(0, call.start).split('\n').length
              const fn = call.arguments[0]
              const preval = vm.runInThisContext(
                '(' + args.code.slice(fn.start, fn.end) + ')',
                {
                  filename: args.path,
                  lineOffset: line - 1,
                }
              )
              try {
                const value = await preval(context)
                return [call, value] as const
              } catch (error: any) {
                error.message = `${args.path}:${line}: ${error.message}`
                throw error
              }
            })
          )
        )

        const result = nebu.process(args.code, {
          filename: args.path,
          ast: program,
          sourceMap: true,
          sourceMapHiRes: true,
          plugins: [
            {
              CallExpression(node) {
                if (resolvedCalls.has(node.n)) {
                  const result = resolvedCalls.get(node.n)
                  node.replace('(' + serialize(result) + ')')
                }
              },
            },
          ],
        })

        return {
          code: result.js,
          map: result.map,
          watchFiles,
          watchDirs,
        }
      })
    },
  })
}

// Return true if a match exists with no leading period or hash.
function findPreval(code: string) {
  const prevalRE = /([.#]?)\bpreval\(/g
  for (const match of code.matchAll(prevalRE)) {
    if (match[1] === '') {
      return true
    }
  }
  return false
}
