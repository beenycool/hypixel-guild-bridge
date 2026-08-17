import { Auth } from './auth.js'

async function apiFetch(path, options = {}) {
  const token = Auth.getToken()
  const headers = Object.assign({}, options.headers || {})
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    options = Object.assign({}, options, { body: JSON.stringify(options.body) })
  }
  const res = await fetch(path, Object.assign({}, options, { headers }))
  if (res.status === 401) {
    Auth.clearToken()
    Auth.showAuthOverlay()
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    let errorMessage = 'HTTP ' + res.status
    try {
      const errorJson = await res.json()
      if (errorJson?.error?.message) errorMessage = errorJson.error.message
      else if (errorJson?.error) errorMessage = errorJson.error
    } catch {}
    throw new Error(errorMessage)
  }
  const json = await res.json()
  if (json?.success === false) {
    const error = new Error(json.error?.message ? json.error.message : 'Request failed')
    error.code = json.error?.code ? json.error.code : 'UNKNOWN'
    throw error
  }
  return json?.success === true ? json.data : json
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

export const Api = {
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  apiDelete
}
