import { Api } from './api.js'

const BRIDGE_KEY = 'rankup_selectedBridge'

function escapeHtml(string_) {
  if (string_ == undefined) return ''
  return String(string_)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(ts) {
  if (ts == undefined) return '\u2014'
  let t = typeof ts === 'number' ? ts : Date.parse(ts)
  if (isNaN(t)) return '\u2014'
  if (t < 1e11) t *= 1000
  const d = new Date(t)
  if (isNaN(d.getTime())) return '\u2014'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n) => String(n).padStart(2, '0')
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatRelativeTime(ts) {
  if (ts == undefined) return '\u2014'
  let t = typeof ts === 'number' ? ts : Date.parse(ts)
  if (isNaN(t)) return '\u2014'
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
  if (ms == undefined || isNaN(ms)) return '\u2014'
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
  return `<span class="badge ${cls}">${escapeHtml(action || '\u2014')}</span>`
}

function uuidShort(uuid) {
  if (!uuid) return '\u2014'
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

function showToast(message, type) {
  if (type == undefined) type = 'info'
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
  return confirm(message)
}

async function populateBridgeSelector(selectElement, onChange) {
  if (!selectElement) return
  let bridges = []
  try {
    const res = await Api.apiGet('/api/rankup/bridges')
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

export const Ui = {
  escapeHtml,
  formatDate,
  formatRelativeTime,
  formatDuration,
  actionBadge,
  uuidShort,
  showToast,
  confirmAction,
  populateBridgeSelector,
  getSelectedBridge,
  setSelectedBridge
}
