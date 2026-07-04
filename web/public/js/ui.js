'use strict'
globalThis.AppUi = (function () {
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
    return globalThis.confirm(message)
  }

  function injectNav(activePage) {
    const navHost = document.querySelector('#app-nav')
    if (!navHost) return
    const permission = globalThis.AppAuth ? globalThis.AppAuth.getPermission() : null
    const brand = 'Rankup'

    const navSections = [
      {
        label: 'Main',
        items: [
          { name: 'Overview', href: 'index.html', key: 'overview' },
          { name: 'Pending', href: 'rankup-pending.html', key: 'pending' },
          { name: 'History', href: 'rankup-history.html', key: 'history' },
          { name: 'Leaderboard', href: 'leaderboard.html', key: 'leaderboard' }
        ]
      },
      {
        label: 'Guild',
        items: [
          { name: 'Guild', href: 'guild.html', key: 'guild' },
          { name: 'Player', href: 'player.html', key: 'player' },
          { name: 'Punishments', href: 'punishments.html', key: 'punishments' },
          { name: 'Inactivity', href: 'inactivity.html', key: 'inactivity' }
        ]
      },
      { label: 'System', items: [{ name: 'Status', href: 'status.html', key: 'status' }] }
    ]
    if (permission === 'owner' || permission === 'admin') {
      navSections[2].items.push({ name: 'Settings', href: 'settings.html', key: 'settings' })
    }

    let navHTML = `<nav class="nav">`
    navHTML += `<a class="nav-brand" href="index.html">${escapeHtml(brand)}</a>`
    navHTML += `<button class="nav-toggle" id="nav-toggle" aria-label="Toggle navigation">\u2630</button>`
    navHTML += `<div class="nav-items">`
    for (const section of navSections) {
      navHTML += `<div class="nav-section-label">${escapeHtml(section.label)}</div>`
      for (const it of section.items) {
        const cls = activePage === it.key ? 'nav-item active' : 'nav-item'
        navHTML += `<a class="nav-link ${cls}" href="${it.href}">${escapeHtml(it.name)}</a>`
      }
    }
    navHTML += `</div>`
    navHTML += `<div class="nav-right">`
    navHTML += `<span id="bot-status" class="status-indicator status-unknown" title="Connecting...">\u25CF</span>`
    navHTML += `<button class="btn btn-secondary btn-sm" id="app-nav-disconnect">Disconnect</button>`
    navHTML += `</div>`
    navHTML += `</nav>`
    navHost.innerHTML = navHTML

    const button = navHost.querySelector('#app-nav-disconnect')
    if (button) {
      button.addEventListener('click', () => {
        if (globalThis.AppAuth) globalThis.AppAuth.disconnect()
      })
    }

    const toggle = navHost.querySelector('#nav-toggle')
    const itemsContainer = navHost.querySelector('.nav-items')
    if (toggle && itemsContainer) {
      toggle.addEventListener('click', () => {
        itemsContainer.classList.toggle('open')
      })
      document.addEventListener('click', (e) => {
        if (!navHost.contains(e.target)) itemsContainer.classList.remove('open')
      })
    }
  }

  async function populateBridgeSelector(selectElement, onChange) {
    if (!selectElement) return
    let bridges = []
    try {
      const res = await globalThis.AppApi.apiGet('/api/rankup/bridges')
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

  return {
    escapeHtml,
    formatDate,
    formatRelativeTime,
    formatDuration,
    actionBadge,
    uuidShort,
    showToast,
    confirmAction,
    injectNav,
    populateBridgeSelector,
    getSelectedBridge,
    setSelectedBridge
  }
})()
