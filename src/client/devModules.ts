const modules: Record<string, any> = {}

const missingImports = localStorage.getItem('missingImports')?.split(',') || []

globalThis.htmelt = {
  modules,
  import(id) {
    const mod = modules[id]
    if (!mod) {
      if (!missingImports.includes(id)) {
        missingImports.push(id)
        localStorage.setItem('missingImports', missingImports.join(','))
        location.reload()
      }
      throw Error('Module not found: ' + id)
    }
    if (missingImports.includes(id)) {
      missingImports.splice(missingImports.indexOf(id), 1)
      localStorage.setItem('missingImports', missingImports.join(','))
    }
    return mod.exports
  },
  export(id, rawExports) {
    const mod: any = (modules[id] = { exports: {}, rawExports })
    for (const rawExport of rawExports) {
      if (Array.isArray(rawExport)) {
        const [name, value] = rawExport
        mod.exports[name] = value
      } else if ('from' in rawExport) {
        Object.setPrototypeOf(
          mod.exports,
          new Proxy(Object.getPrototypeOf(mod.exports), {
            get(prototype, key: string) {
              const fromModule = modules[rawExport.from]
              if (!fromModule) {
                throw Error('Module not found: ' + rawExport.from)
              }
              if (rawExport.aliases) {
                key = rawExport.aliases[key] ?? key
              }
              const value = fromModule.exports[key]
              if (value !== undefined) {
                return value
              }
              return prototype[key]
            },
          })
        )
      } else if ('values' in rawExport) {
        for (const [name, get] of Object.entries(rawExport.values)) {
          Object.defineProperty(mod.exports, name, { get })
        }
      } else if ('name' in rawExport) {
        const { name, get } = rawExport
        Object.defineProperty(mod.exports, name, { get })
      }
    }
  },
}
