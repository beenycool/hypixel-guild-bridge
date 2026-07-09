import { Auth } from './auth.js'

function connectWS(subscribeType, eventPrefix, onEvent) {
  const proto = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${globalThis.location.host}/message`
  let closedByUser = false
  let ws
  let wsReconnectTimer = null

  const connect = () => {
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      const token = Auth.getToken()
      try {
        ws.send(JSON.stringify({ type: subscribeType, token }))
      } catch {
        onEvent('error', { error: 'Failed to send subscribe' })
      }
    })
    ws.onmessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (!message || typeof message !== 'object') return
      if (message.type === 'ack') {
        if (message.success === false) onEvent('error', { error: message.error || 'Subscription rejected' })
        else onEvent('ack', message)
        return
      }
      if (typeof message.type === 'string' && message.type.startsWith(eventPrefix)) onEvent(message.type, message.data)
    }
    ws.addEventListener('close', () => {
      ws = null
      if (!closedByUser) {
        wsReconnectTimer = setTimeout(() => {
          wsReconnectTimer = null
          connect()
        }, 3000)
      }
    })
    ws.onerror = () => {
      try {
        ws.close()
      } catch {}
    }
  }

  connect()

  return {
    close: () => {
      closedByUser = true
      if (ws) ws.close()
    },
    get readyState() {
      return ws ? ws.readyState : WebSocket.CLOSED
    },
    get socket() {
      return ws
    }
  }
}

function connectRankupWS(onEvent) {
  return connectWS('subscribeRankup', 'rankup.', onEvent)
}
function connectSettingsWS(onEvent) {
  return connectWS('subscribeSettings', 'settings.', onEvent)
}

export const Ws = {
  connectWS,
  connectRankupWS,
  connectSettingsWS
}
