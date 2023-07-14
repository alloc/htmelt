import { Plugin } from '@htmelt/plugin'

export const aliasPlugin: Plugin = config => {
  config.esbuild.plugins.push({
    name: 'alias',
    setup(build) {
      build.onResolve({ filter: /^@?[a-z0-9]/i }, async args => {
        let id = args.path
        let suffix = ''

        const suffixStart = id.indexOf('?')
        if (suffixStart !== -1) {
          suffix = id.slice(suffixStart)
          id = id.slice(0, suffixStart)
        }

        const parts = id.split('/')
        for (let i = 0; i < parts.length; i++) {
          const aliasedId = parts.slice(0, parts.length - i).join('/')
          const alias = config.alias[aliasedId]
          if (alias) {
            if (typeof alias === 'string') {
              const resolvedId = [alias]
                .concat(parts.slice(parts.length - i))
                .join('/')
              return build.resolve(resolvedId + suffix, {
                kind: args.kind,
                importer: args.importer,
                resolveDir: args.resolveDir,
                pluginData: args.pluginData,
              })
            }
            if (i === 0) {
              return {
                path: aliasedId,
                namespace: 'virtual',
                pluginData: alias,
                suffix,
              }
            }
            return null
          }
        }
      })
    },
  })
}
