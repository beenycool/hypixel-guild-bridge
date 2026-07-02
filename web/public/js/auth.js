'use strict'
window.AppAuth = (function () {
  const TOKEN_KEY = 'rankup_token'
  const BRIDGE_KEY = 'rankup_selectedBridge'
  const PERMISSION_KEY = 'rankup_permission'

  function getToken() {
    return localStorage.getItem(TOKEN_KEY)
  }
  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token)
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
    clearPermission()
  }

  function getPermission() {
    return localStorage.getItem(PERMISSION_KEY)
  }
  function setPermission(perm) {
    localStorage.setItem(PERMISSION_KEY, perm)
  }
  function clearPermission() {
    localStorage.removeItem(PERMISSION_KEY)
  }

  async function fetchPermission() {
    const token = getToken()
    if (!token) {
      clearPermission()
      return
    }
    try {
      const data = await window.AppApi.apiFetch('/api/auth/check')
      if (data && data.permission) {
        setPermission(data.permission)
      } else {
        clearPermission()
      }
    } catch {
      clearPermission()
    }
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
      fetchPermission()
      hideAuthOverlay()
      globalThis.dispatchEvent(new CustomEvent('authsuccess', { detail: { token: value } }))
    }
    button.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
    })
  }

  function disconnect() {
    clearToken()
    globalThis.location.reload()
  }

  return {
    getToken,
    setToken,
    clearToken,
    getPermission,
    setPermission,
    clearPermission,
    fetchPermission,
    requireAuth,
    hideAuthOverlay,
    showAuthOverlay,
    disconnect
  }
})()
