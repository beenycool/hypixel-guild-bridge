import { Auth } from './auth.js'
import { Api } from './api.js'
import { Ws } from './ws.js'
import { Ui } from './ui.js'
import { initNav } from './nav.js'
import { initStatusPolling } from './status.js'

const summaryElement = document.querySelector('#pending-summary')
const listElement = document.querySelector('#pending-list')
const bridgeSelect = document.querySelector('#bridge-select')

let currentBridgeId = null
let reviews = []

function init() {
  initNav()
  initStatusPolling()
  Ui.populateBridgeSelector(bridgeSelect, onBridgeChange)
  Ws.connectRankupWS(onWSEvent)
}

async function onBridgeChange(bridgeId) {
  currentBridgeId = bridgeId
  showLoading()
  try {
    const res = await Api.apiGet(`/api/rankup/pending?bridgeId=${encodeURIComponent(bridgeId)}`)
    reviews = res && Array.isArray(res.reviews) ? res.reviews : []
    renderAll()
  } catch (error) {
    listElement.innerHTML = ''
    Ui.showToast(`Failed to load pending reviews: ${error.message}`, 'error')
  }
}

function renderAll() {
  renderSummary()
  renderList()
}

function renderSummary() {
  if (reviews.length === 0) {
    summaryElement.innerHTML = ''
    return
  }
  const promote = reviews.filter((r) => r.action === 'promote').length
  const demote = reviews.filter((r) => r.action === 'demote').length
  const kick = reviews.filter((r) => r.action === 'kick').length

  summaryElement.innerHTML = `
      <div class="grid grid-cols-4 mb-md">
        <div class="card stat-card">
          <div class="stat-value">${reviews.length}</div>
          <div class="stat-label">Total Pending</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value text-success">${promote}</div>
          <div class="stat-label">Promote</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value text-gold">${demote}</div>
          <div class="stat-label">Demote</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value text-danger">${kick}</div>
          <div class="stat-label">Kick</div>
        </div>
      </div>
    `
}

function renderList() {
  if (reviews.length === 0) {
    listElement.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">\u2713</div>
          <div class="empty-state-text">No pending reviews. New reviews will appear here automatically.</div>
        </div>
      `
    return
  }

  listElement.innerHTML = '<div class="grid" id="pending-grid"></div>'
  const grid = document.querySelector('#pending-grid')
  for (const r of reviews) {
    grid.append(buildCard(r))
  }
}

function showLoading() {
  listElement.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>'
}

function buildCard(review) {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.reviewId = String(review.id)

  const isKick = review.action === 'kick'
  const transition = isKick
    ? `<span class="text-mono">${Ui.escapeHtml(review.currentRank || '\u2014')}</span>
         <span class="badge badge-danger">KICK</span>`
    : `<span class="text-mono">${Ui.escapeHtml(review.currentRank || '\u2014')}</span>
         <span class="text-muted">&rarr;</span>
         <span class="text-mono">${Ui.escapeHtml(review.proposedRank || '\u2014')}</span>`

  const notified = review.notifiedAt == undefined ? '' : '<span class="badge badge-info">Notified</span>'

  const avatarUrl = review.uuid ? `https://cravatar.eu/helmavatar/${review.uuid}/32.png` : ''
  const avatarHtml = avatarUrl
    ? `<img class="avatar" src="${avatarUrl}" alt="" loading="lazy" width="20" height="20" style="border-radius:50%;vertical-align:middle;margin-right:6px">`
    : ''
  card.innerHTML = `
      <div class="card-header">
        <span class="text-mono text-sm">${avatarHtml}${Ui.escapeHtml(review.name || Ui.uuidShort(review.uuid))}</span>
        ${Ui.actionBadge(review.action)}
      </div>
      <div class="card-body">
        <div class="flex-center gap-sm mb-sm text-mono">${transition}</div>
        <div class="text-sm text-secondary mb-sm">${Ui.escapeHtml(review.reason || 'No reason provided.')}</div>
      </div>
      <div class="flex flex-between mb-sm">
        <div class="flex flex-column gap-xs">
          <span class="text-xs text-muted">${Ui.formatDate(review.createdAt)}</span>
          <span class="text-xs text-muted">${Ui.formatRelativeTime(review.createdAt)}</span>
        </div>
        ${notified}
      </div>
      <div class="card-footer">
        <button class="btn btn-success btn-sm" data-action="approve">Approve</button>
        <button class="btn btn-danger btn-sm" data-action="reject">Reject</button>
      </div>
    `

  const approveButton = card.querySelector('[data-action="approve"]')
  const rejectButton = card.querySelector('[data-action="reject"]')

  approveButton.addEventListener('click', () =>
    handleReviewAction(review.id, 'approve', approveButton, rejectButton, card)
  )
  rejectButton.addEventListener('click', () =>
    handleReviewAction(review.id, 'reject', approveButton, rejectButton, card)
  )

  return card
}

async function handleReviewAction(id, action, approveButton, rejectButton, card) {
  const message =
    action === 'approve'
      ? 'Approve this review? The rank change will be executed.'
      : 'Reject this review? The proposed change will be discarded.'

  if (!Ui.confirmAction(message)) return

  approveButton.disabled = true
  rejectButton.disabled = true

  console.debug('handleReviewAction: id=%d, action=%s', id, action)
  try {
    await Api.apiPost(`/api/rankup/pending/${id}/${action}`)
    removeCard(card)
    removeFromState(id)
    Ui.showToast(`Review ${action === 'approve' ? 'approved' : 'rejected'}`, 'success')
  } catch (error) {
    approveButton.disabled = false
    rejectButton.disabled = false
    console.debug('handleReviewAction error: id=%d, action=%s, message=%s', id, action, error.message)
    Ui.showToast(`Failed to ${action} review: ${error.message}`, 'error')
  }
}

function removeCard(card) {
  if (card.parentNode) card.remove()
  if (reviews.length === 0) renderList()
}

function removeFromState(id) {
  reviews = reviews.filter((r) => r.id !== id)
  renderSummary()
}

function onWSEvent(type, data) {
  if (!data || !currentBridgeId) return

  switch (type) {
    case 'rankup.reviewAdded': {
      if (data.bridgeId !== currentBridgeId) return
      if (reviews.some((r) => r.id === data.id)) return
      reviews.unshift(data)
      renderSummary()
      prependCard(data)
      Ui.showToast(`New pending review: ${Ui.uuidShort(data.uuid)}`, 'info')
      break
    }
    case 'rankup.reviewRemoved': {
      if (data.bridgeId !== currentBridgeId) return
      const card = listElement.querySelector(`[data-review-id="${CSS.escape(String(data.id))}"]`)
      if (card) removeCard(card)
      removeFromState(data.id)
      break
    }
    case 'rankup.bridgeConfigChanged': {
      onBridgeChange(currentBridgeId)
      break
    }
  }
}

function prependCard(review) {
  let grid = document.querySelector('#pending-grid')
  if (!grid) {
    renderList()
    return
  }
  grid.insertBefore(buildCard(review), grid.firstChild)
}

const token = Auth.requireAuth()
if (token) {
  init()
} else {
  globalThis.addEventListener(
    'authsuccess',
    () => {
      init()
    },
    { once: true }
  )
}
