import { Api } from './api.js'
import { Auth } from './auth.js'
import { initNav } from './nav.js'
import { initStatusPolling } from './status.js'
import { Ui } from './ui.js'
import { Ws } from './ws.js'

const TABLE_BODY_ID = 'history-table-body'
const LOAD_MORE_ID = 'load-more-btn'
const REFRESH_ID = 'refresh-btn'
const BRIDGE_SELECT_ID = 'bridge-select'
const COUNT_ID = 'history-count'

const PAGE_SIZE = 50

let currentBridge = null
let currentLimit = PAGE_SIZE
let entries = []
let hasMore = false
let isLoading = false
let ws = null

function init() {
  initNav()
  initStatusPolling()

  document.getElementById(REFRESH_ID).addEventListener('click', onRefresh)
  document.getElementById(LOAD_MORE_ID).addEventListener('click', onLoadMore)

  Ui.populateBridgeSelector(document.getElementById(BRIDGE_SELECT_ID), onBridgeChange)

  ws = Ws.connectRankupWS(onWSEvent)
}

function onBridgeChange(bridgeId) {
  currentBridge = bridgeId
  currentLimit = PAGE_SIZE
  entries = []
  hasMore = false
  fetchHistory()
}

async function fetchHistory() {
  if (!currentBridge) return
  setLoading(true)
  try {
    const res = await Api.apiGet(
      `/api/rankup/history?bridgeId=${encodeURIComponent(currentBridge)}&limit=${currentLimit}`
    )
    entries = res && Array.isArray(res.history) ? [...res.history] : []
    hasMore = entries.length >= currentLimit
    render()
  } catch (error) {
    Ui.showToast(`Failed to load history: ${error.message}`, 'error')
    entries = []
    hasMore = false
    render()
  } finally {
    setLoading(false)
  }
}

function setLoading(loading) {
  isLoading = loading
  if (loading && entries.length === 0) {
    const body = document.getElementById(TABLE_BODY_ID)
    body.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>'
  }
  const loadMoreButton = document.getElementById(LOAD_MORE_ID)
  if (loadMoreButton) {
    loadMoreButton.disabled = loading
    loadMoreButton.textContent = loading ? 'Loading...' : 'Load More'
  }
  const refreshButton = document.getElementById(REFRESH_ID)
  if (refreshButton) refreshButton.disabled = loading
}

function render() {
  const body = document.getElementById(TABLE_BODY_ID)
  if (entries.length === 0) {
    body.innerHTML = '<div class="empty-state"><div class="empty-state-text">No history entries yet</div></div>'
    toggleLoadMore(false)
    return
  }

  const sorted = [...entries].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const rows = sorted.map(renderRow).join('')

  body.innerHTML =
    `<div class="text-sm text-muted mb-sm" id="${COUNT_ID}">Showing ${sorted.length} entries</div>` +
    '<table class="table">' +
    '<thead><tr>' +
    '<th>Date</th><th>Player</th><th>Action</th><th>Rank Change</th><th>Triggered By</th>' +
    '</tr></thead>' +
    `<tbody>${rows}</tbody>` +
    '</table>'

  toggleLoadMore(hasMore)
}

function rowInnerHTML(entry) {
  const dateCell =
    `<div>${Ui.escapeHtml(Ui.formatDate(entry.createdAt))}</div>` +
    `<div class="text-xs text-muted">${Ui.escapeHtml(Ui.formatRelativeTime(entry.createdAt))}</div>`
  const avatarUrl = entry.uuid ? `https://cravatar.eu/helmavatar/${entry.uuid}/32.png` : ''
  const avatarHtml = avatarUrl
    ? `<img class="avatar" src="${avatarUrl}" alt="" loading="lazy" width="18" height="18" style="border-radius:50%;vertical-align:middle;margin-right:4px">`
    : ''
  const playerCell = `<span class="text-mono text-sm">${avatarHtml}${Ui.escapeHtml(entry.name || Ui.uuidShort(entry.uuid))}</span>`
  const actionCell = Ui.actionBadge(entry.action)
  const rankCell = renderRankChange(entry)
  const triggerCell = `<span class="text-mono text-sm text-secondary">${Ui.escapeHtml(entry.triggeredBy || '\u2014')}</span>`

  return (
    `<td>${dateCell}</td>` +
    `<td class="table-mono">${playerCell}</td>` +
    `<td>${actionCell}</td>` +
    `<td class="table-mono">${rankCell}</td>` +
    `<td>${triggerCell}</td>`
  )
}

function renderRow(entry) {
  return `<tr data-entry-id="${Ui.escapeHtml(String(entry.id))}">${rowInnerHTML(entry)}</tr>`
}

function renderRankChange(entry) {
  const from = entry.fromRank
  const to = entry.toRank
  const action = entry.action
  const fromHtml = (r) => `<span class="text-mono">${Ui.escapeHtml(r)}</span>`
  const dash = '<span class="text-muted">\u2014</span>'

  if (action === 'kick') {
    const fromPart = from ? `${fromHtml(from)} ` : ''
    return `${fromPart}<span class="text-danger">\u2192</span> <span class="text-danger text-mono">KICKED</span>`
  }

  if (action === 'notify') {
    if (!from) return dash
    return `${fromHtml(from)} <span class="badge badge-cyan">notified</span>`
  }

  if (action === 'reject') {
    const rank = from || to
    if (!rank) return dash
    return `<del class="text-mono text-muted">${Ui.escapeHtml(rank)}</del> <span class="badge badge-muted">rejected</span>`
  }

  if (action === 'promote') {
    if (!from && !to) return dash
    return `${fromHtml(from || '\u2014')} <span class="text-success">\u2192</span> <span class="text-mono">${Ui.escapeHtml(to || '\u2014')}</span>`
  }

  if (action === 'demote') {
    if (!from && !to) return dash
    return `${fromHtml(from || '\u2014')} <span class="text-warning">\u2192</span> <span class="text-mono">${Ui.escapeHtml(to || '\u2014')}</span>`
  }

  if (!from && !to) return dash
  return `${fromHtml(from || '\u2014')} <span class="text-cyan">\u2192</span> <span class="text-mono">${Ui.escapeHtml(to || '\u2014')}</span>`
}

function updateCount(n) {
  const element = document.getElementById(COUNT_ID)
  if (element) element.textContent = `Showing ${n} entries`
}

function toggleLoadMore(show) {
  const button = document.getElementById(LOAD_MORE_ID)
  if (!button) return
  button.classList.toggle('hidden', !show)
}

function fadeInRow(tr) {
  if (tr?.animate) {
    tr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease' })
  }
}

function prependRow(entry) {
  const body = document.getElementById(TABLE_BODY_ID)
  const table = body.querySelector('table')

  if (!table) {
    render()
    const newTable = body.querySelector('table')
    fadeInRow(newTable?.querySelector('tbody tr'))
    return
  }

  const tbody = table.querySelector('tbody')
  const tr = document.createElement('tr')
  tr.dataset.entryId = String(entry.id)
  tr.innerHTML = rowInnerHTML(entry)
  if (tbody.firstChild) tbody.insertBefore(tr, tbody.firstChild)
  else tbody.append(tr)
  fadeInRow(tr)
  updateCount(entries.length)
}

async function onLoadMore() {
  if (isLoading) return
  currentLimit += PAGE_SIZE
  await fetchHistory()
}

async function onRefresh() {
  if (isLoading) return
  await fetchHistory()
  if (!isLoading) Ui.showToast('Refreshed', 'success')
}

function onWSEvent(type, data) {
  if (type === 'rankup.historyAppended') {
    if (!data) return
    const eventBridge = data.bridgeId || data.entry?.bridgeId
    if (eventBridge !== currentBridge) return
    const entry = data.entry || data
    if (entry?.id == undefined) return
    if (entries.some((e) => e.id === entry.id)) return
    entries.push(entry)
    prependRow(entry)
    Ui.showToast(`New entry: ${entry.action} for ${Ui.uuidShort(entry.uuid)}`, 'info')
    return
  }

  if (type === 'error') {
    Ui.showToast(data?.error || 'WebSocket error', 'error')
  }
}

const token = Auth.requireAuth('Rankup History')
if (token) {
  init()
} else {
  globalThis.addEventListener('authsuccess', init, { once: true })
}
