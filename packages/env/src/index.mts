import { Plugin } from '@htmelt/plugin'
import dotenv from 'dotenv'
import fs from 'fs/promises'
import { ESTree, parse } from 'meriyah'
import { nebu, Node } from 'nebu'
import path from 'path'
import serialize from 'serialize-javascript'

export default (): Plugin => config => {
  config.esbuild.plugins.push({
    name: '@htmelt/env',
    setup(build) {
      build.onTransform({ loaders: ['js'] }, async args => {
        if (!hasMatchingCall(args.code)) {
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

        const calls: ESTree.CallExpression[] = []
        nebu.walk(program, {
          CallExpression(node) {
            const callee = node.callee as ESTree.Node
            if (Node.isIdentifier(callee) && callee.name === 'inlinedEnvFile') {
              calls.push(node)
            }
          },
        })

        type ResolvedCall = readonly [
          node: ESTree.CallExpression,
          result:
            | { variables: Record<string, string> }
            | { variables?: undefined; error: any }
        ]

        const resolvedCalls = new Map(
          await Promise.all(
            calls.map(async (call): Promise<ResolvedCall> => {
              const arg1 = call.arguments[0]
              if (!Node.isLiteral(arg1) || typeof arg1.value !== 'string') {
                return [call, { error: new Error('Argument must be a string') }]
              }

              const resolvedArg = path.resolve(resolveDir, arg1.value)
              try {
                const parentDir = (await isDirectory(resolvedArg))
                  ? resolvedArg
                  : path.dirname(resolvedArg)

                // Always watch the parent folder, so any added/removed env
                // files are detected.
                watchDirs.push(parentDir)

                const fileName =
                  resolvedArg === parentDir
                    ? '.env'
                    : path.basename(resolvedArg)

                const files = [path.resolve(parentDir, fileName)]

                if (!files[0].endsWith(config.mode)) {
                  const parentFiles = await fs.readdir(parentDir)
                  if (parentFiles.includes(`${fileName}.${config.mode}`)) {
                    files.push(
                      path.resolve(parentDir, `${fileName}.${config.mode}`)
                    )
                  }
                }

                const variables: Record<string, any> = {}
                for (const file of files) {
                  try {
                    Object.assign(
                      variables,
                      dotenv.parse(await fs.readFile(file, 'utf8'))
                    )
                    watchFiles.push(file)
                  } catch {}
                }

                return [call, { variables }] as const
              } catch (error: any) {
                const line = args.code.slice(0, call.start).split('\n').length
                error.message = `${args.path}:${line}: ${error.message}`
                return [call, { error }] as const
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
                let result = resolvedCalls.get(node.n)
                if (!result) {
                  return
                }
                if (!result.variables) {
                  console.error(result.error)
                  result = { variables: {} }
                }
                node.replace('(' + serialize(result.variables) + ')')
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
function hasMatchingCall(code: string) {
  const expressionRegex = /([.#]?)\binlinedEnvFile\(/g
  for (const match of code.matchAll(expressionRegex)) {
    if (match[1] === '') {
      return true
    }
  }
  return false
}

async function isDirectory(path: string) {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}
