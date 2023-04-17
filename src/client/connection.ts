/// <reference lib="dom" />

const modules: Record<string, any> = {}

globalThis.htmelt = {
  modules,
  import(id) {
    const mod = modules[id]
    if (!mod) {
      throw Error('Module not found: ' + id)
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

function connect() {
  const ws = new WebSocket('wss://localhost:' + import.meta.env.HMR_PORT)
  ws.onmessage = async ({ data }) => {
    const { id, src, args } = JSON.parse(data)

    const apply: Function = (await import(src)).default
    const result = await apply(...args)

    ws.send(
      JSON.stringify({
        type: 'result',
        id,
        result,
      })
    )
  }

  let connected = false
  ws.onopen = () => {
    if (!connected) {
      console.log('[HMR] connected')
      connected = true
    }
  }
  ws.onclose = () => {
    if (connected) {
      console.log('[HMR] disconnected')
      connected = false
    }
    setTimeout(connect, 1000)
  }
  ws.onerror = () => {
    setTimeout(connect, 1000)
  }
}

connect()
