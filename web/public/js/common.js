'use strict'
;(function () {
  // Auto-auth from URL token
  ;(function () {
    const params = new URLSearchParams(globalThis.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      try {
        localStorage.setItem('rankup_token', urlToken)
        const cleanUrl = globalThis.location.pathname + globalThis.location.hash
        globalThis.history.replaceState({}, '', cleanUrl)
      } catch {
        // localStorage may not be available
      }
    }
  })()
  const TOKEN_KEY = 'rankup_token'
  const BRIDGE_KEY = 'rankup_selectedBridge'

  let wsReconnectTimer = null

  function getToken() {
    return localStorage.getItem(TOKEN_KEY)
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token)
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
  }

  function hideAuthOverlay() {
    const overlay = document.querySelector('#app-auth-overlay')
    if (overlay) overlay.remove()
  }

  function requireAuth() {
    const token = getToken()
    if (token) return token
    showAuthOverlay()
    return null
  }

  function showAuthOverlay() {
    hideAuthOverlay()

    const overlay = document.createElement('div')
    overlay.id = 'app-auth-overlay'
    overlay.className = 'auth-overlay'

    overlay.innerHTML =
      '<div class="auth-card">' +
      '<h2>Rankup</h2>' +
      '<p>Enter your access token to continue</p>' +
      '<div class="auth-error" id="app-auth-error"></div>' +
      '<input type="password" class="input auth-input" id="app-auth-input" placeholder="access token" autocomplete="off" />' +
      '<button class="btn btn-primary auth-btn" id="app-auth-btn">Connect</button>' +
      '</div>'

    document.body.append(overlay)

    const input = overlay.querySelector('#app-auth-input')
    const button = overlay.querySelector('#app-auth-btn')
    const errorElement = overlay.querySelector('#app-auth-error')

    input.focus()

    const submit = () => {
      const value = input.value.trim()
      if (!value) {
        errorElement.textContent = 'Token cannot be empty.'
        return
      }
      setToken(value)
      hideAuthOverlay()
      globalThis.dispatchEvent(new CustomEvent('authsuccess', { detail: { token: value } }))
    }

    button.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
    })
  }

  async function apiFetch(path, options = {}) {
    const token = getToken()
    const headers = Object.assign({}, options.headers || {})
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'

    const res = await fetch(path, Object.assign({}, options, { headers }))

    if (res.status === 401) {
      clearToken()
      showAuthOverlay()
      throw new Error('Unauthorized')
    }

    return res
  }

  async function _parseOrThrow(res) {
    let body = null
    try {
      body = await res.json()
    } catch {
      body = null
    }

    if (!res.ok) {
      const message = body?.error ? body.error : res.statusText || `HTTP ${res.status}`
      console.debug('apiFetch failed: url=%s, status=%d, body=%o', res.url, res.status, body)
      throw new Error(message)
    }

    return body
  }

  async function apiGet(path) {
    const res = await apiFetch(path, { method: 'GET' })
    return _parseOrThrow(res)
  }

  async function apiPost(path, body) {
    const res = await apiFetch(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return _parseOrThrow(res)
  }

  async function apiPut(path, body) {
    const res = await apiFetch(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return _parseOrThrow(res)
  }

  async function apiDelete(path) {
    const res = await apiFetch(path, { method: 'DELETE' })
    return _parseOrThrow(res)
  }

  function connectWS(subscribeType, eventPrefix, onEvent) {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = null
    }

    const proto = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${globalThis.location.host}/message`

    let closedByUser = false
    let ws

    const connect = () => {
      ws = new WebSocket(url)

      ws.addEventListener('open', () => {
        try {
          ws.send(JSON.stringify({ type: subscribeType, token: getToken() }))
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
          if (message.success === false) {
            onEvent('error', { error: message.error || 'Subscription rejected' })
          }
          return
        }

        if (typeof message.type === 'string' && message.type.startsWith(eventPrefix)) {
          onEvent(message.type, message.data)
        }
      }

      ws.addEventListener('close', () => {
        ws = null
        if (!closedByUser) {
          wsReconnectTimer = setTimeout(() => {
            wsReconnectTimer = null
            connect()
          }, App.WS_RECONNECT_DELAY)
        }
      })

      ws.onerror = () => {
        try {
          ws.close()
        } catch {}
      }
    }

    connect()

    const wrapped = {
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
    return wrapped
  }

  function connectRankupWS(onEvent) {
    return connectWS('subscribeRankup', 'rankup.', onEvent)
  }

  function connectSettingsWS(onEvent) {
    return connectWS('subscribeSettings', 'settings.', onEvent)
  }

  function injectNav(activePage) {
    const navHost = document.querySelector('#app-nav')
    if (!navHost) return

    const brand = 'Rankup'
    const items = [
      { name: 'Overview', href: 'index.html', key: 'overview' },
      { name: 'Pending', href: 'rankup-pending.html', key: 'pending' },
      { name: 'History', href: 'rankup-history.html', key: 'history' },
      { name: 'Settings', href: 'settings.html', key: 'settings' }
    ]

    let navHTML = `<nav class="nav">`
    navHTML += `<a class="nav-brand" href="index.html">${escapeHtml(brand)}</a>`
    navHTML += `<div class="nav-items">`
    for (const it of items) {
      const cls = activePage === it.key ? 'nav-item active' : 'nav-item'
      navHTML += `<a class="nav-link ${cls}" href="${it.href}">${escapeHtml(it.name)}</a>`
    }
    navHTML += `</div>`
    navHTML += `<div class="nav-right"><button class="btn btn-secondary btn-sm" id="app-nav-disconnect">Disconnect</button></div>`
    navHTML += `</nav>`

    navHost.innerHTML = navHTML

    const button = navHost.querySelector('#app-nav-disconnect')
    if (button) {
      button.addEventListener('click', () => {
        clearToken()
        globalThis.location.reload()
      })
    }
  }

  async function populateBridgeSelector(selectElement, onChange) {
    if (!selectElement) return
    let bridges = []
    try {
      const res = await apiGet('/api/rankup/bridges')
      bridges = res && Array.isArray(res.bridges) ? res.bridges : []
    } catch (error) {
      selectElement.innerHTML = '<option value="">(failed to load)</option>'
      showToast(`Failed to load bridges: ${error.message}`, 'error')
      return
    }

    if (bridges.length === 0) {
      selectElement.innerHTML = '<option value="">(no bridges)</option>'
      return
    }

    const stored = localStorage.getItem(BRIDGE_KEY)
    let initial = stored
    selectElement.innerHTML = ''
    let hasStored = false
    for (const b of bridges) {
      const opt = document.createElement('option')
      opt.value = b.bridgeId
      opt.textContent = b.bridgeId
      if (b.bridgeId === stored) {
        opt.selected = true
        hasStored = true
      }
      selectElement.append(opt)
    }
    if (hasStored) {
      selectElement.value = initial
    } else {
      initial = bridges[0].bridgeId
      selectElement.value = initial
    }

    localStorage.setItem(BRIDGE_KEY, initial)

    selectElement.addEventListener('change', () => {
      const value = selectElement.value
      localStorage.setItem(BRIDGE_KEY, value)
      if (onChange) onChange(value)
    })

    if (onChange) {
      try {
        onChange(initial)
      } catch (error) {
        console.error(error)
      }
    }
  }

  function getSelectedBridge() {
    return localStorage.getItem(BRIDGE_KEY)
  }

  function setSelectedBridge(id) {
    localStorage.setItem(BRIDGE_KEY, id)
  }

  function formatDate(ts) {
    if (ts == undefined) return '—'
    let t = typeof ts === 'number' ? ts : Date.parse(ts)
    if (isNaN(t)) return '—'
    if (t < 1e11) t *= 1000
    const d = new Date(t)
    if (isNaN(d.getTime())) return '—'
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const pad = (n) => String(n).padStart(2, '0')
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function formatRelativeTime(ts) {
    if (ts == undefined) return '—'
    let t = typeof ts === 'number' ? ts : Date.parse(ts)
    if (isNaN(t)) return '—'
    if (t < 1e11) t *= 1000
    const diff = Date.now() - t
    const sec = Math.floor(diff / 1000)
    if (sec < 30) return 'just now'
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day}d ago`
    const mon = Math.floor(day / 30)
    if (mon < 12) return `${mon}mo ago`
    const yr = Math.floor(day / 365)
    return `${yr}y ago`
  }

  function formatDuration(ms) {
    if (ms == undefined || isNaN(ms)) return '—'
    let msValue = Math.abs(Number(ms))
    const sec = Math.floor(msValue / 1000)
    const days = Math.floor(sec / 86_400)
    const hr = Math.floor((sec % 86_400) / 3600)
    const min = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const parts = []
    if (days > 0) parts.push(`${days}d`)
    if (hr > 0) parts.push(`${hr}h`)
    if (min > 0) parts.push(`${min}m`)
    if (parts.length === 0) parts.push(`${s}s`)
    return parts.join(' ')
  }

  function escapeHtml(string_) {
    if (string_ == undefined) return ''
    return String(string_)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function actionBadge(action) {
    const map = {
      promote: 'badge-success',
      demote: 'badge-warning',
      kick: 'badge-danger',
      notify: 'badge-cyan',
      reject: 'badge-muted',
      manual_update: 'badge-info'
    }
    const cls = map[action] || 'badge-muted'
    return `<span class="badge ${cls}">${escapeHtml(action || '—')}</span>`
  }

  function uuidShort(uuid) {
    if (!uuid) return '—'
    const s = String(uuid)
    if (s.length <= 11) return s
    return s.slice(0, 8) + '...'
  }

  function ensureToastContainer() {
    let c = document.querySelector('.toast-container')
    if (!c) {
      c = document.createElement('div')
      c.className = 'toast-container'
      document.body.append(c)
    }
    return c
  }

  function showToast(message, type = 'info') {
    const container = ensureToastContainer()
    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.textContent = message
    container.append(toast)

    const remove = () => {
      toast.classList.add('fade-out')
      setTimeout(() => {
        if (toast.parentNode) toast.remove()
      }, 220)
    }

    setTimeout(remove, 4000)

    toast.addEventListener('click', remove)
  }

  function confirmAction(message) {
    return globalThis.confirm(message)
  }

  globalThis.App = {
    PAGES: ['overview', 'rules', 'pending', 'history', 'settings'],
    WS_RECONNECT_DELAY: 3000,

    getToken,
    setToken,
    clearToken,
    requireAuth,
    hideAuthOverlay,

    apiFetch,
    apiGet,
    apiPost,
    apiPut,
    apiDelete,

    connectRankupWS,
    connectSettingsWS,

    injectNav,
    populateBridgeSelector,
    getSelectedBridge,
    setSelectedBridge,

    formatDate,
    formatRelativeTime,
    formatDuration,
    escapeHtml,
    actionBadge,
    uuidShort,
    showToast,
    confirmAction
  }
})()
