import './devModules'

function connect() {
  const ws = new WebSocket(import.meta.env.HMR_URL)
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
  let reconnecting = false
  const reconnect = () => {
    if (!reconnecting) {
      reconnecting = true
      setTimeout(connect, 1000)
    }
  }
  ws.onerror = reconnect
  ws.onclose = () => {
    if (connected) {
      console.log('[HMR] disconnected')
      connected = false
    }
    reconnect()
  }
}

connect()
