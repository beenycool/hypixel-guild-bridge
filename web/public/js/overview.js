import { Api } from './api.js'
import { Auth } from './auth.js'
import { initNav } from './nav.js'
import { initStatusPolling } from './status.js'
import { Ui } from './ui.js'
import { Ws } from './ws.js'

let bridges = []
let refreshTimer = null
let ws = null

const bridgeCardsElement = document.querySelector('#bridge-cards')

const setLoading = (element) => {
  element.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>'
}

const setEmpty = (element, text) => {
  element.innerHTML = `<div class="empty-state"><div class="empty-state-text">${Ui.escapeHtml(text)}</div></div>`
}

const findBridgeCard = (bridgeId) => {
  const cards = bridgeCardsElement.querySelectorAll('.card[data-bridge-id]')
  for (const c of cards) {
    if (c.dataset.bridgeId === bridgeId) return c
  }
  return null
}

const buildBridgeCard = (b) => {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.bridgeId = b.bridgeId

  const enabledBadge = b.enabled
    ? '<span class="badge badge-success">Enabled</span>'
    : '<span class="badge badge-muted">Disabled</span>'
  const reviewBadge = b.manualReview
    ? '<span class="badge badge-cyan">Manual Review</span>'
    : '<span class="badge badge-muted">Auto</span>'
  const pendingBadge = b.pendingCount > 0 ? '<span class="badge badge-warning">pending</span>' : ''

  card.innerHTML = `
      <div class="card-header">
        <h2 class="text-gold">${Ui.escapeHtml(b.bridgeId)}</h2>
        <div class="flex gap-xs">${enabledBadge}${reviewBadge}</div>
      </div>
      <div class="card-body">
        <div class="flex-column gap-sm">
          <div class="flex-between">
            <span class="stat-label">Last Check</span>
            <span class="text-sm text-mono">${Ui.escapeHtml(Ui.formatDate(b.lastCheckAt))}</span>
          </div>
          <div class="flex-between">
            <span class="stat-label">Pending Reviews</span>
            <div class="flex gap-sm">
              <span class="text-mono text-sm" data-pending-count>${b.pendingCount}</span>
              ${pendingBadge}
            </div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <button class="btn btn-primary btn-sm" data-settings-btn>Settings</button>
      </div>
    `

  card.querySelector('[data-settings-btn]').addEventListener('click', () => {
    Ui.setSelectedBridge(b.bridgeId)
    globalThis.location.href = 'settings.html'
  })

  return card
}

const renderBridgeCards = () => {
  if (bridges.length === 0) {
    setEmpty(bridgeCardsElement, 'No bridges configured')
    document.querySelector('#stat-bridges').textContent = 'No bridges configured'
    return
  }
  const grid = document.createElement('div')
  grid.className = 'grid'
  for (const b of bridges) {
    grid.append(buildBridgeCard(b))
  }
  bridgeCardsElement.innerHTML = ''
  bridgeCardsElement.append(grid)
}

const renderSummaryStats = (bridges) => {
  const totalBridges = bridges.length
  const totalPending = bridges.reduce((sum, b) => sum + (b.pendingCount || 0), 0)
  const timestamps = bridges.map((b) => b.lastCheckAt).filter(Boolean)
  const latest = timestamps.length > 0 ? new Date(Math.max(...timestamps.map((t) => new Date(t).getTime()))) : null
  const hasEnabled = bridges.some((b) => b.enabled)

  document.querySelector('#stat-bridges').textContent = totalBridges
  document.querySelector('#stat-pending').textContent = totalPending
  document.querySelector('#stat-last-check').textContent = latest
    ? Ui.formatRelativeTime(latest.toISOString())
    : '\u2014'
  const statusElement = document.querySelector('#stat-status')
  if (hasEnabled) {
    statusElement.textContent = 'Live'
    statusElement.className = 'stat-value text-success'
  } else {
    statusElement.textContent = 'Idle'
    statusElement.className = 'stat-value'
  }
}

const loadBridgeCards = async () => {
  try {
    const res = await Api.apiGet('/api/bridges')
    bridges = res && Array.isArray(res.bridges) ? res.bridges : []
    renderSummaryStats(bridges)
    renderBridgeCards()
  } catch (error) {
    setEmpty(bridgeCardsElement, `Failed to load bridges: ${error.message}`)
  }
}

const updateBridgePendingCount = (bridgeId, newCount) => {
  const b = bridges.find((x) => x.bridgeId === bridgeId)
  if (b) b.pendingCount = newCount
  const card = findBridgeCard(bridgeId)
  if (!card) return
  const countElement = card.querySelector('[data-pending-count]')
  if (!countElement) return
  countElement.textContent = newCount
  const wrapper = countElement.parentElement
  if (!wrapper) return
  let badge = wrapper.querySelector('.badge-warning')
  if (newCount > 0 && !badge) {
    badge = document.createElement('span')
    badge.className = 'badge badge-warning'
    badge.textContent = 'pending'
    wrapper.append(badge)
  } else if (newCount <= 0 && badge) {
    badge.remove()
  }
}

const onWSEvent = (type, data) => {
  if (type === 'error') {
    Ui.showToast(`WebSocket: ${data?.error || 'error'}`, 'error')
    return
  }
  switch (type) {
    case 'rankup.reviewAdded': {
      if (!data?.bridgeId) return
      const b = bridges.find((x) => x.bridgeId === data.bridgeId)
      const current = b ? b.pendingCount || 0 : 0
      updateBridgePendingCount(data.bridgeId, current + 1)
      const uuid = data.uuid ? Ui.uuidShort(data.uuid) : ''
      Ui.showToast(`New pending review: ${uuid}`, 'info')
      break
    }
    case 'rankup.reviewRemoved': {
      if (!data?.bridgeId) return
      const b = bridges.find((x) => x.bridgeId === data.bridgeId)
      const current = b ? b.pendingCount || 0 : 0
      updateBridgePendingCount(data.bridgeId, Math.max(0, current - 1))
      break
    }
    case 'rankup.bridgeConfigChanged': {
      loadBridgeCards()
      break
    }
  }
}

const cleanup = () => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (ws) {
    try {
      ws.close()
    } catch {}
  }
}

const init = async () => {
  initNav()
  initStatusPolling()
  setLoading(bridgeCardsElement)

  await loadBridgeCards()
  ws = Ws.connectRankupWS(onWSEvent)
  refreshTimer = setInterval(loadBridgeCards, 30_000)
  window.addEventListener('beforeunload', cleanup)
}

const start = () => {
  const token = Auth.requireAuth('Dashboard')
  if (token) {
    init()
  } else {
    globalThis.addEventListener('authsuccess', init, { once: true })
  }
}

start()
