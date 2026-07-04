'use strict'
;(function () {
  const TOKEN_KEY = 'rankup_token'

  ;(function () {
    const parameters = new URLSearchParams(globalThis.location.search)
    const urlToken = parameters.get('token')
    if (urlToken) {
      try {
        localStorage.setItem(TOKEN_KEY, urlToken)
        parameters.delete('token')
        const cleanUrl =
          globalThis.location.pathname +
          (parameters.toString() ? '?' + parameters.toString() : '') +
          globalThis.location.hash
        globalThis.history.replaceState({}, '', cleanUrl)
        if (globalThis.AppAuth) globalThis.AppAuth.fetchPermission()
      } catch {}
    }
  })()
  ;(function () {
    if (globalThis.AppAuth && globalThis.AppAuth.getToken()) {
      globalThis.AppAuth.fetchPermission()
    }
  })()

  globalThis.App = Object.assign(
    {},
    globalThis.AppAuth || {},
    globalThis.AppApi || {},
    globalThis.AppWs || {},
    globalThis.AppUi || {},
    {
      PAGES: ['overview', 'rules', 'pending', 'history', 'settings'],
      WS_RECONNECT_DELAY: 3000
    }
  )

  if (globalThis.AppUi?.injectNav) {
    const origInjectNav = globalThis.AppUi.injectNav
    globalThis.AppUi.injectNav = function (activePage) {
      origInjectNav(activePage)
      updateStatusIndicator('connecting')
      fetchBotStatus()
    }
  }

  async function fetchBotStatus() {
    try {
      const status = await globalThis.AppApi.apiGet('/api/status')
      const mcConnected = status.minecraft
        ? status.minecraft.some(function (index) {
            return index.connected
          })
        : false
      const dcConnected = status.discord ? status.discord.connected : false
      const element = document.querySelector('#bot-status')
      if (!element) return
      if (mcConnected && dcConnected) {
        element.className = 'status-indicator status-online'
        element.title = 'All connected'
      } else {
        element.className = 'status-indicator status-connecting'
        element.title =
          'MC: ' + (mcConnected ? '\u2713' : '\u2717') + ' Discord: ' + (dcConnected ? '\u2713' : '\u2717')
      }
    } catch {}
  }

  function updateStatusIndicator(state) {
    const element = document.querySelector('#bot-status')
    if (!element) return
    element.className = 'status-indicator status-' + state
    element.title = state === 'online' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected'
  }

  setInterval(fetchBotStatus, 30_000)
})()
