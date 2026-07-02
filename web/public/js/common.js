'use strict'
;(function () {
  const TOKEN_KEY = 'rankup_token'

  ;(function () {
    const params = new URLSearchParams(globalThis.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      try {
        localStorage.setItem(TOKEN_KEY, urlToken)
        const cleanUrl = globalThis.location.pathname + globalThis.location.hash
        globalThis.history.replaceState({}, '', cleanUrl)
        if (window.AppAuth) window.AppAuth.fetchPermission()
      } catch {}
    }
  })()
  ;(function () {
    if (window.AppAuth && window.AppAuth.getToken()) {
      window.AppAuth.fetchPermission()
    }
  })()

  globalThis.App = Object.assign(
    {},
    window.AppAuth || {},
    window.AppApi || {},
    window.AppWs || {},
    window.AppUi || {},
    {
      PAGES: ['overview', 'rules', 'pending', 'history', 'settings'],
      WS_RECONNECT_DELAY: 3000
    }
  )

  if (window.AppUi && window.AppUi.injectNav) {
    const origInjectNav = window.AppUi.injectNav
    window.AppUi.injectNav = function (activePage) {
      origInjectNav(activePage)
      updateStatusIndicator('connecting')
      fetchBotStatus()
    }
  }

  async function fetchBotStatus() {
    try {
      const status = await window.AppApi.apiGet('/api/status')
      const mcConnected = status.minecraft
        ? status.minecraft.some(function (i) {
            return i.connected
          })
        : false
      const dcConnected = status.discord ? status.discord.connected : false
      const el = document.getElementById('bot-status')
      if (!el) return
      if (mcConnected && dcConnected) {
        el.className = 'status-indicator status-online'
        el.title = 'All connected'
      } else {
        el.className = 'status-indicator status-connecting'
        el.title = 'MC: ' + (mcConnected ? '\u2713' : '\u2717') + ' Discord: ' + (dcConnected ? '\u2713' : '\u2717')
      }
    } catch {}
  }

  function updateStatusIndicator(state) {
    const el = document.getElementById('bot-status')
    if (!el) return
    el.className = 'status-indicator status-' + state
    el.title = state === 'online' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected'
  }

  setInterval(fetchBotStatus, 30000)
})()
