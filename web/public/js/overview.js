'use strict'
;(function () {
  let bridges = []
  let history = []
  let refreshTimer = null
  let ws = null

  const bridgeCardsElement = document.querySelector('#bridge-cards')
  const recentActivityElement = document.querySelector('#recent-activity')
  const systemStatusElement = document.querySelector('#system-status')
  const runCheckButton = document.querySelector('#run-check-btn')

  const activeBridgeId = () => {
    const sel = App.getSelectedBridge()
    if (sel) return sel
    return bridges.length > 0 ? bridges[0].bridgeId : null
  }

  const setLoading = (element) => {
    element.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>'
  }

  const setEmpty = (element, text) => {
    element.innerHTML = `<div class="empty-state"><div class="empty-state-text">${App.escapeHtml(text)}</div></div>`
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
        <h2 class="text-gold">${App.escapeHtml(b.bridgeId)}</h2>
        <div class="flex gap-xs">${enabledBadge}${reviewBadge}</div>
      </div>
      <div class="card-body">
        <div class="flex-column gap-sm">
          <div class="flex-between">
            <span class="stat-label">Last Check</span>
            <span class="text-sm text-mono">${App.escapeHtml(App.formatDate(b.lastCheckAt))}</span>
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
        <button class="btn btn-secondary btn-sm" data-select-btn>Select</button>
      </div>
    `

    card.querySelector('[data-select-btn]').addEventListener('click', () => {
      App.setSelectedBridge(b.bridgeId)
      globalThis.location.href = 'rankup-pending.html'
    })

    return card
  }

  const renderBridgeCards = () => {
    if (bridges.length === 0) {
      setEmpty(bridgeCardsElement, 'No bridges configured')
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

  const loadBridgeCards = async () => {
    try {
      const res = await App.apiGet('/api/rankup/bridges')
      bridges = res && Array.isArray(res.bridges) ? res.bridges : []
      renderBridgeCards()
    } catch (error) {
      setEmpty(bridgeCardsElement, `Failed to load bridges: ${error.message}`)
    }
  }

  const renderRecentActivity = () => {
    if (history.length === 0) {
      setEmpty(recentActivityElement, 'No recent activity')
      return
    }
    const rows = history
      .map((entry) => {
        const action = App.actionBadge(entry.action)
        const uuid = `<span class="uuid">${App.escapeHtml(entry.name || App.uuidShort(entry.uuid))}</span>`
        const rankChange = `<span class="text-mono text-xs">${App.escapeHtml(entry.fromRank || '—')} → ${App.escapeHtml(entry.toRank || '—')}</span>`
        const relTime = `<span class="text-muted text-xs">${App.escapeHtml(App.formatRelativeTime(entry.createdAt))}</span>`
        return `
        <div class="flex-between gap-md">
          <div class="flex gap-sm">${action}${uuid}${rankChange}</div>
          <div>${relTime}</div>
        </div>
      `
      })
      .join('')
    recentActivityElement.innerHTML = `<div class="flex-column gap-sm">${rows}</div>`
  }

  const loadRecentActivity = async () => {
    const bridgeId = activeBridgeId()
    if (!bridgeId) {
      setEmpty(recentActivityElement, 'Select a bridge to view activity')
      return
    }
    setLoading(recentActivityElement)
    try {
      const res = await App.apiGet(`/api/rankup/history?bridgeId=${encodeURIComponent(bridgeId)}&limit=5`)
      history = res && Array.isArray(res.history) ? res.history : []
      renderRecentActivity()
    } catch (error) {
      setEmpty(recentActivityElement, `Failed to load activity: ${error.message}`)
    }
  }

  const renderSystemStatus = (status) => {
    const runningBadge = status.running
      ? '<span class="badge badge-success">Running</span>'
      : '<span class="badge badge-muted">Idle</span>'
    systemStatusElement.innerHTML = `
      <div class="flex-column gap-md">
        <div class="flex-between">
          <span class="stat-label">Check Running</span>
          ${runningBadge}
        </div>
        <div class="flex-between">
          <span class="stat-label">Last Check</span>
          <span class="text-sm text-mono">${App.escapeHtml(App.formatDate(status.lastCheckAt))}</span>
        </div>
        <div class="flex-between">
          <span class="stat-label">Next Check</span>
          <span class="text-sm text-mono">${App.escapeHtml(App.formatDate(status.nextCheckAt))}</span>
        </div>
      </div>
    `
  }

  const loadSystemStatus = async () => {
    const bridgeId = activeBridgeId()
    if (!bridgeId) {
      setEmpty(systemStatusElement, 'Select a bridge to view status')
      return
    }
    setLoading(systemStatusElement)
    try {
      const res = await App.apiGet(`/api/rankup/status?bridgeId=${encodeURIComponent(bridgeId)}`)
      renderSystemStatus(res || {})
    } catch (error) {
      setEmpty(systemStatusElement, `Failed to load status: ${error.message}`)
    }
  }

  const onRunCheck = async () => {
    const bridgeId = activeBridgeId()
    if (!bridgeId) {
      App.showToast('Select a bridge first', 'error')
      return
    }
    const originalText = runCheckButton.textContent
    runCheckButton.disabled = true
    runCheckButton.textContent = 'Running...'
    try {
      await App.apiPost('/api/rankup/run-check', { bridgeId })
      App.showToast('Check started', 'success')
      setTimeout(loadBridgeCards, 2000)
    } catch (error) {
      App.showToast(`Check failed: ${error.message}`, 'error')
    } finally {
      runCheckButton.disabled = false
      runCheckButton.textContent = originalText
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
      App.showToast(`WebSocket: ${data?.error || 'error'}`, 'error')
      return
    }
    switch (type) {
      case 'rankup.reviewAdded': {
        if (!data?.bridgeId) return
        const b = bridges.find((x) => x.bridgeId === data.bridgeId)
        const current = b ? b.pendingCount || 0 : 0
        updateBridgePendingCount(data.bridgeId, current + 1)
        const uuid = data.uuid ? App.uuidShort(data.uuid) : ''
        App.showToast(`New pending review: ${uuid}`, 'info')

        break
      }
      case 'rankup.reviewRemoved': {
        if (!data?.bridgeId) return
        const b = bridges.find((x) => x.bridgeId === data.bridgeId)
        const current = b ? b.pendingCount || 0 : 0
        updateBridgePendingCount(data.bridgeId, Math.max(0, current - 1))

        break
      }
      case 'rankup.historyAppended': {
        if (!data?.bridgeId) return
        const sel = activeBridgeId()
        if (data.bridgeId !== sel) return
        history.unshift(data)
        history = history.slice(0, 5)
        renderRecentActivity()

        break
      }
      case 'rankup.bridgeConfigChanged': {
        loadBridgeCards()

        break
      }
      // No default
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
    App.injectNav('overview')
    setLoading(bridgeCardsElement)
    setLoading(recentActivityElement)
    setLoading(systemStatusElement)
    runCheckButton.addEventListener('click', onRunCheck)

    // Check Player
    const checkInput = document.querySelector('#check-player-input')
    const checkBtn = document.querySelector('#check-player-btn')
    const checkResult = document.querySelector('#check-player-result')

    if (checkBtn && checkInput && checkResult) {
      const doCheck = async () => {
        const username = checkInput.value.trim()
        if (!username) {
          checkResult.innerHTML = '<div class="text-sm text-muted">Enter a username first.</div>'
          return
        }
        const bridgeId = activeBridgeId()
        if (!bridgeId) {
          checkResult.innerHTML = '<div class="text-sm text-danger">No bridge selected.</div>'
          return
        }
        checkResult.innerHTML = '<div class="loading-spinner"></div>'
        try {
          const data = await App.apiGet(
            `/api/rankup/check-player?bridgeId=${encodeURIComponent(bridgeId)}&username=${encodeURIComponent(username)}`
          )
          const actionBadges = {
            none: '<span class="badge badge-muted">No Action</span>',
            promote: '<span class="badge badge-success">PROMOTE</span>',
            demote: '<span class="badge badge-danger">DEMOTE</span>',
            kick: '<span class="badge badge-danger">KICK</span>',
            notify: '<span class="badge badge-warning">NOTIFY</span>'
          }
          const badge = actionBadges[data.action] || '<span class="badge badge-muted">Unknown</span>'
          checkResult.innerHTML =
            '<div class="card" style="padding: var(--space-sm);">' +
            `<div class="grid grid-cols-2 gap-sm">` +
            `<div><span class="stat-label">Player</span><div class="text-sm">${App.escapeHtml(data.username || username)}</div></div>` +
            `<div><span class="stat-label">Current Rank</span><div class="text-sm">${App.escapeHtml(data.currentRank)}</div></div>` +
            `<div><span class="stat-label">Weekly GEXP</span><div class="text-sm">${Number(data.weeklyGexp).toLocaleString()}</div></div>` +
            `<div><span class="stat-label">Days in Guild</span><div class="text-sm">${data.daysInGuild}</div></div>` +
            `<div><span class="stat-label">Result</span><div class="text-sm">${badge}</div></div>` +
            (data.targetRank
              ? `<div><span class="stat-label">Target Rank</span><div class="text-sm">${App.escapeHtml(data.targetRank)}</div></div>`
              : '') +
            `</div>` +
            (data.reason ? `<div class="mt-xs text-xs text-muted">${App.escapeHtml(data.reason)}</div>` : '') +
            `</div>`
        } catch (error) {
          checkResult.innerHTML = `<div class="text-sm text-danger">${App.escapeHtml(error.message)}</div>`
        }
      }

      checkBtn.addEventListener('click', doCheck)
      checkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doCheck()
      })
    }

    await loadBridgeCards()
    loadRecentActivity()
    loadSystemStatus()
    ws = App.connectRankupWS(onWSEvent)
    refreshTimer = setInterval(loadBridgeCards, 30_000)
    window.addEventListener('beforeunload', cleanup)
  }

  const start = () => {
    const token = App.requireAuth()
    if (token) {
      init()
    } else {
      globalThis.addEventListener('authsuccess', init, { once: true })
    }
  }

  start()
})()
