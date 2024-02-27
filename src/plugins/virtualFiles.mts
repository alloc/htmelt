import type { Config, Plugin } from '@htmelt/plugin'
import * as esbuild from 'esbuild'
import * as mime from 'mrmime'
import { removePathSuffix } from '../utils.mjs'

const virtualFilePlugin: Plugin = config => {
  config.esbuild.plugins.push({
    name: 'virtual-files',
    setup(build) {
      // Allow virtual files to be imported.
      build.onResolve({ filter: /^\// }, args => {
        const id = removePathSuffix(args.path)
        if (config.virtualFiles[id]) {
          return { path: args.path, namespace: 'virtual' }
        }
      })

      const load = async (args: esbuild.OnLoadArgs) => {
        const virtualFile = args.pluginData || config.virtualFiles[args.path]
        const file = await loadVirtualFile(virtualFile, args.path, config)
        if (file && file.data !== '') {
          return {
            loader: virtualFile.loader,
            contents: file.data,
          }
        }
      }

      // Load virtual files.
      build.onLoad({ namespace: 'virtual', filter: /^/ }, load)

      // Allow virtual overrides of real files.
      build.onLoad({ filter: /^/ }, load)
    },
  })
}

export default virtualFilePlugin

export async function loadVirtualFile(
  file: Plugin.VirtualFile | null | undefined,
  path: string,
  config: Config,
  request?: Plugin.Request | null
) {
  if (!file) {
    return null
  }

  const result = file.request
    ? await file.request(request || createFauxRequest(path, config))
    : file.promise
    ? await file.promise
    : file.current || null

  if (result) {
    if (file.promise) {
      file.promise = undefined
      file.current = result
    }
    if (file.loader !== 'file') {
      result.headers ||= {}
      result.headers['content-type'] = mime.lookup(file.loader)!
    }
  }

  return result
}

const objectProps = Object.getOwnPropertyNames(Object.prototype).concat(
  'toJSON'
)
const urlProps = Object.getOwnPropertyNames(URL.prototype).filter(
  p => !objectProps.includes(p)
) as (keyof URL)[]

export function createFauxRequest(
  path: string,
  config: Config
): Plugin.Request {
  const url = new URL(path, config.server?.url || 'file:')
  return {
    ...Object.fromEntries(urlProps.map(prop => [prop, url[prop]])),
    method: 'GET',
    headers: {},
    query: null,
    url: path,
  } satisfies Partial<Plugin.Request> as any
}
