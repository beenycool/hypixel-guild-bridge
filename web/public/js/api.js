'use strict'
window.AppApi = (function () {
  async function apiFetch(path, options = {}) {
    const token = window.AppAuth ? window.AppAuth.getToken() : localStorage.getItem('rankup_token')
    const headers = Object.assign({}, options.headers || {})
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
      options = Object.assign({}, options, { body: JSON.stringify(options.body) })
    }
    const res = await fetch(path, Object.assign({}, options, { headers }))
    if (res.status === 401) {
      if (window.AppAuth) {
        window.AppAuth.clearToken()
        window.AppAuth.showAuthOverlay()
      }
      throw new Error('Unauthorized')
    }
    const json = await res.json()
    if (json && json.success === false) {
      const err = new Error(json.error && json.error.message ? json.error.message : 'Request failed')
      err.code = json.error && json.error.code ? json.error.code : 'UNKNOWN'
      throw err
    }
    return json && json.success === true ? json.data : json
  }

  async function apiGet(path) {
    return apiFetch(path, { method: 'GET' })
  }
  async function apiPost(path, body) {
    return apiFetch(path, { method: 'POST', body })
  }
  async function apiPut(path, body) {
    return apiFetch(path, { method: 'PUT', body })
  }
  async function apiDelete(path) {
    return apiFetch(path, { method: 'DELETE' })
  }

  return { apiFetch, apiGet, apiPost, apiPut, apiDelete }
})()
