'use strict'
;(function () {
  let currentBridgeId = null
  let guildRanks = []
  let currentRules = null
  let channelTagInput = null
  let excludedRanksTagInput = null
  let excludedPlayersTagInput = null
  let savedSnapshot = ''
  let isDirty = false
  let isSaving = false
  let ws = null
  let listenersAttached = false

  const esc = (s) => App.escapeHtml(s)
  const number_ = (n) => {
    const v = Number(n)
    return isNaN(v) ? 0 : v
  }
  const DEMOTION_ACTIONS = ['demote', 'kick', 'notify']

  function normalizeRules(r) {
    r = r || {}
    return {
      enabled: !!r.enabled,
      manualReview: !!r.manualReview,
      notificationCooldown: number_(r.notificationCooldown),
      notificationChannelIds: Array.isArray(r.notificationChannelIds) ? r.notificationChannelIds.map(String) : [],
      promotionRules: Array.isArray(r.promotionRules)
        ? r.promotionRules.map((p) => ({
            targetRank: p.targetRank || '',
            minWeeklyGexp: number_(p.minWeeklyGexp),
            minDaysInGuild: number_(p.minDaysInGuild),
            minOnlineHours: number_(p.minOnlineHours)
          }))
        : [],
      demotionRules: Array.isArray(r.demotionRules)
        ? r.demotionRules.map((d) => ({
            fromRank: d.fromRank || '',
            action: DEMOTION_ACTIONS.includes(d.action) ? d.action : 'notify',
            targetRank: d.targetRank || '',
            maxWeeklyGexp: number_(d.maxWeeklyGexp),
            gracePeriod: number_(d.gracePeriod)
          }))
        : [],
      excludedRanks: Array.isArray(r.excludedRanks) ? r.excludedRanks.map(String) : [],
      excludedPlayers: Array.isArray(r.excludedPlayers) ? r.excludedPlayers.map(String) : []
    }
  }

  function rankSelect(field, value) {
    const ranks = [...guildRanks]
    if (value && !ranks.includes(value)) ranks.push(value)
    if (ranks.length > 0) {
      const options = ranks
        .map((rk) => `<option value="${esc(rk)}"${rk === value ? ' selected' : ''}>${esc(rk)}</option>`)
        .join('')
      return `<select class="select" data-field="${field}">${options}</select>`
    }
    return `<input class="input" data-field="${field}" value="${esc(value || '')}" placeholder="Rank name" />`
  }

  function promotionRowHTML(rule) {
    const r = rule || {}
    return `<tr>
      <td>${rankSelect('targetRank', r.targetRank || '')}</td>
      <td><input type="number" class="input" data-field="minWeeklyGexp" min="0" value="${number_(r.minWeeklyGexp)}" /></td>
      <td><input type="number" class="input" data-field="minDaysInGuild" min="0" value="${number_(r.minDaysInGuild)}" /></td>
      <td><input type="number" class="input" data-field="minOnlineHours" min="0" value="${number_(r.minOnlineHours)}" /></td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" title="Remove">✕</button></td>
    </tr>`
  }

  function demotionRowHTML(rule) {
    const r = rule || {}
    const action = r.action || 'notify'
    const options = DEMOTION_ACTIONS.map(
      (a) => `<option value="${a}"${a === action ? ' selected' : ''}>${a}</option>`
    ).join('')
    return `<tr>
      <td>${rankSelect('fromRank', r.fromRank || '')}</td>
      <td><select class="select" data-field="action">${options}</select></td>
      <td>${rankSelect('targetRank', r.targetRank || '')}</td>
      <td><input type="number" class="input" data-field="maxWeeklyGexp" min="0" value="${number_(r.maxWeeklyGexp)}" /></td>
      <td><input type="number" class="input" data-field="gracePeriod" min="0" value="${number_(r.gracePeriod)}" /></td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" title="Remove">✕</button></td>
    </tr>`
  }

  function placeholderRow(cols, message) {
    return `<tr data-placeholder><td colspan="${cols}" class="text-center text-muted text-sm">${esc(message)}</td></tr>`
  }

  function buildRankSuggestions() {
    if (guildRanks.length === 0) return ''
    const chips = guildRanks
      .map(
        (r) =>
          `<span class="badge badge-muted cursor-pointer" data-action="add-excluded-rank" data-rank="${esc(r)}">+ ${esc(r)}</span>`
      )
      .join(' ')
    return `<div class="mt-sm text-xs text-muted">Quick add: ${chips}</div>`
  }

  function buildRulesHTML(r) {
    const promoRows =
      (r.promotionRules || []).map(promotionRowHTML).join('') ||
      placeholderRow(5, 'No promotion rules configured. Click "Add Promotion Rule" to create one.')
    const demoRows =
      (r.demotionRules || []).map(demotionRowHTML).join('') ||
      placeholderRow(6, 'No demotion rules configured. Click "Add Demotion Rule" to create one.')
    return `
    <div class="card">
      <div class="card-header">General Settings</div>
      <div class="card-body">
        <div class="form-group">
          <div class="flex-between">
            <span class="form-label">Rankup Automation Enabled</span>
            <label class="toggle"><input type="checkbox" id="cfg-enabled"${r.enabled ? ' checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
        </div>
        <div class="form-group">
          <div class="flex-between">
            <div class="flex-column gap-xs">
              <span class="form-label">Manual Review Mode</span>
              <span class="form-hint">When enabled, rank changes require approval before execution</span>
            </div>
            <label class="toggle"><input type="checkbox" id="cfg-manualReview"${r.manualReview ? ' checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notification Cooldown (hours)</label>
          <input type="number" class="input" id="cfg-cooldown" min="0" value="${number_(r.notificationCooldown)}" />
          <div class="form-hint">Minimum hours between notifications for the same player</div>
        </div>
        <div class="form-group">
          <label class="form-label">Notification Channels</label>
          <div id="tag-channels-host"></div>
          <div class="form-hint">Discord channel IDs to send notifications to</div>
        </div>
      </div>
    </div>
    <div class="card mt-md">
      <div class="card-header">Promotion Rules</div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Target Rank</th><th>Min Weekly GEXP</th><th>Min Days in Guild</th><th>Min Online Hours</th><th></th></tr>
            </thead>
            <tbody id="promo-tbody">${promoRows}</tbody>
          </table>
        </div>
        <button class="btn btn-secondary btn-sm mt-sm" data-action="add-promotion">+ Add Promotion Rule</button>
      </div>
    </div>
    <div class="card mt-md">
      <div class="card-header">Demotion Rules</div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>From Rank</th><th>Action</th><th>Target Rank</th><th>Max Weekly GEXP</th><th>Grace Period (days)</th><th></th></tr>
            </thead>
            <tbody id="demo-tbody">${demoRows}</tbody>
          </table>
        </div>
        <button class="btn btn-secondary btn-sm mt-sm" data-action="add-demotion">+ Add Demotion Rule</button>
      </div>
    </div>
    <div class="card mt-md">
      <div class="card-header">Exclusions</div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Excluded Ranks</label>
          <div id="tag-excluded-ranks-host"></div>
          <div class="form-hint">Ranks that should not be affected by automation</div>
          ${buildRankSuggestions()}
        </div>
        <div class="form-group">
          <label class="form-label">Excluded Players</label>
          <div id="tag-excluded-players-host"></div>
          <div class="form-hint">Player UUIDs that should not be affected</div>
        </div>
      </div>
    </div>
    <div class="flex-between mt-md">
      <span id="dirty-indicator"></span>
      <div class="flex gap-sm">
        <button class="btn btn-secondary" id="discard-btn" disabled>Discard</button>
        <button class="btn btn-primary" id="save-btn" disabled>Save Changes</button>
      </div>
    </div>`
  }

  function createTagInput(initial, placeholder, onChange) {
    const tags = []
    const host = document.createElement('div')
    host.className = 'tag-input'

    const field = document.createElement('input')
    field.className = 'tag-input-field'
    field.type = 'text'
    field.placeholder = placeholder

    function render() {
      while (host.firstChild && host.firstChild !== field) host.firstChild.remove()
      for (const t of tags) {
        const tag = document.createElement('span')
        tag.className = 'tag'
        const label = document.createElement('span')
        label.textContent = t
        const rm = document.createElement('span')
        rm.className = 'tag-remove'
        rm.textContent = '✕'
        rm.addEventListener('click', () => {
          const index = tags.indexOf(t)
          if (index !== -1) {
            tags.splice(index, 1)
            render()
            if (onChange) onChange()
          }
        })
        tag.append(label)
        tag.append(rm)
        field.before(tag)
      }
    }

    function addTag(value) {
      const v = String(value == undefined ? '' : value).trim()
      if (!v) return
      if (tags.includes(v)) return
      tags.push(v)
      render()
      if (onChange) onChange()
    }

    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        addTag(field.value)
        field.value = ''
      } else if (e.key === 'Backspace' && field.value === '' && tags.length > 0) {
        tags.pop()
        render()
        if (onChange) onChange()
      }
    })

    host.append(field)
    for (const t of initial || []) tags.push(String(t))
    render()

    return {
      el: host,
      getTags: () => [...tags],
      addTag
    }
  }

  function showLoading() {
    document.querySelector('#rules-content').innerHTML =
      '<div class="loading"><div class="loading-spinner"></div></div>'
  }

  function showEmptyState(message) {
    document.querySelector('#rules-content').innerHTML =
      `<div class="empty-state"><div class="empty-state-text">${esc(message)}</div></div>`
  }

  function showError(e) {
    document.querySelector('#rules-content').innerHTML =
      `<div class="empty-state"><div class="empty-state-text">Failed to load rules: ${esc(e?.message || String(e))}</div></div>`
  }

  function applyDemotionTargetStates() {
    for (const tr of document.querySelectorAll('#demo-tbody tr')) {
      const action = tr.querySelector('[data-field="action"]')
      const target = tr.querySelector('[data-field="targetRank"]')
      if (action && target) target.disabled = action.value !== 'demote'
    }
  }

  function readPromotionRows() {
    const rows = document.querySelectorAll('#promo-tbody tr:not([data-placeholder])')
    return [...rows].map((tr) => {
      const get = (f) => {
        const element = tr.querySelector(`[data-field="${f}"]`)
        return element ? element.value : ''
      }
      return {
        targetRank: get('targetRank'),
        minWeeklyGexp: number_(get('minWeeklyGexp')),
        minDaysInGuild: number_(get('minDaysInGuild')),
        minOnlineHours: number_(get('minOnlineHours'))
      }
    })
  }

  function readDemotionRows() {
    const rows = document.querySelectorAll('#demo-tbody tr:not([data-placeholder])')
    return [...rows].map((tr) => {
      const get = (f) => {
        const element = tr.querySelector(`[data-field="${f}"]`)
        return element ? element.value : ''
      }
      const action = get('action') || 'notify'
      const rule = {
        fromRank: get('fromRank'),
        action,
        maxWeeklyGexp: number_(get('maxWeeklyGexp')),
        gracePeriod: number_(get('gracePeriod'))
      }
      if (action === 'demote') rule.targetRank = get('targetRank')
      return rule
    })
  }

  function collectFormState() {
    const enabledElement = document.querySelector('#cfg-enabled')
    const manualElement = document.querySelector('#cfg-manualReview')
    const cooldownElement = document.querySelector('#cfg-cooldown')
    return {
      enabled: enabledElement ? enabledElement.checked : false,
      manualReview: manualElement ? manualElement.checked : false,
      notificationCooldown: cooldownElement ? number_(cooldownElement.value) : 0,
      notificationChannelIds: channelTagInput ? channelTagInput.getTags() : [],
      promotionRules: readPromotionRows(),
      demotionRules: readDemotionRows(),
      excludedRanks: excludedRanksTagInput ? excludedRanksTagInput.getTags() : [],
      excludedPlayers: excludedPlayersTagInput ? excludedPlayersTagInput.getTags() : []
    }
  }

  function serializeForm() {
    return JSON.stringify(collectFormState())
  }

  function checkDirty() {
    if (isSaving) return
    if (!document.querySelector('#save-btn')) return
    isDirty = serializeForm() !== savedSnapshot
    updateDirtyUI()
  }

  function updateDirtyUI() {
    const saveButton = document.querySelector('#save-btn')
    const discardButton = document.querySelector('#discard-btn')
    const ind = document.querySelector('#dirty-indicator')
    if (isSaving) {
      if (saveButton) {
        saveButton.disabled = true
        saveButton.textContent = 'Saving...'
      }
      if (discardButton) discardButton.disabled = true
      if (ind) ind.innerHTML = '<span class="badge badge-info">Saving...</span>'
      return
    }
    if (isDirty) {
      if (saveButton) {
        saveButton.disabled = false
        saveButton.textContent = 'Save Changes'
      }
      if (discardButton) discardButton.disabled = false
      if (ind) ind.innerHTML = '<span class="badge badge-warning">Unsaved changes</span>'
    } else {
      if (saveButton) {
        saveButton.disabled = true
        saveButton.textContent = 'Save Changes'
      }
      if (discardButton) discardButton.disabled = true
      if (ind) ind.innerHTML = '<span class="badge badge-success">All changes saved</span>'
    }
  }

  function renderRules(rules) {
    const content = document.querySelector('#rules-content')
    content.innerHTML = buildRulesHTML(rules)

    channelTagInput = createTagInput(rules.notificationChannelIds || [], 'Channel ID…', checkDirty)
    document.querySelector('#tag-channels-host').append(channelTagInput.el)

    excludedRanksTagInput = createTagInput(rules.excludedRanks || [], 'Rank name…', checkDirty)
    document.querySelector('#tag-excluded-ranks-host').append(excludedRanksTagInput.el)

    excludedPlayersTagInput = createTagInput(rules.excludedPlayers || [], 'Player UUID…', checkDirty)
    document.querySelector('#tag-excluded-players-host').append(excludedPlayersTagInput.el)

    applyDemotionTargetStates()

    isDirty = false
    savedSnapshot = serializeForm()
    updateDirtyUI()
  }

  function addPromotionRow() {
    const tbody = document.querySelector('#promo-tbody')
    if (!tbody) return
    const ph = tbody.querySelector('[data-placeholder]')
    if (ph) ph.remove()
    const tr = document.createElement('tr')
    tr.innerHTML = promotionRowHTML({
      targetRank: guildRanks[0] || '',
      minWeeklyGexp: 0,
      minDaysInGuild: 0,
      minOnlineHours: 0
    })
    tbody.append(tr)
    checkDirty()
  }

  function addDemotionRow() {
    const tbody = document.querySelector('#demo-tbody')
    if (!tbody) return
    const ph = tbody.querySelector('[data-placeholder]')
    if (ph) ph.remove()
    const tr = document.createElement('tr')
    tr.innerHTML = demotionRowHTML({
      fromRank: guildRanks[0] || '',
      action: 'demote',
      targetRank: '',
      maxWeeklyGexp: 0,
      gracePeriod: 7
    })
    tbody.append(tr)
    applyDemotionTargetStates()
    checkDirty()
  }

  function removeRow(button) {
    const tr = button.closest('tr')
    const tbody = tr?.parentNode
    if (!tr || !tbody) return
    tr.remove()
    if (!tbody.querySelector('tr:not([data-placeholder])')) {
      const cols = tbody.id === 'promo-tbody' ? 5 : 6
      tbody.innerHTML = placeholderRow(cols, 'No rules configured.')
    }
    checkDirty()
  }

  async function saveRules() {
    if (!currentBridgeId || isSaving) return
    if (!document.querySelector('#save-btn')) return
    isSaving = true
    updateDirtyUI()
    try {
      const config = collectFormState()
      await App.apiPut(`/api/rankup/rules?bridgeId=${encodeURIComponent(currentBridgeId)}`, config)
      currentRules = config
      savedSnapshot = serializeForm()
      isDirty = false
      updateDirtyUI()
      App.showToast('Rules saved successfully', 'success')
    } catch (error) {
      App.showToast(`Failed to save: ${error?.message || String(error)}`, 'error')
    } finally {
      isSaving = false
      updateDirtyUI()
    }
  }

  function attachDelegatedListeners() {
    const content = document.querySelector('#rules-content')

    content.addEventListener('input', () => {
      checkDirty()
    })

    content.addEventListener('change', (e) => {
      const t = e.target
      if (t?.dataset?.field === 'action') {
        const tr = t.closest('tr')
        const target = tr?.querySelector('[data-field="targetRank"]')
        if (target) target.disabled = t.value !== 'demote'
      }
      checkDirty()
    })

    content.addEventListener('click', (e) => {
      if (e.target.closest('#save-btn')) {
        void saveRules()
        return
      }
      if (e.target.closest('#discard-btn')) {
        if (isDirty && !isSaving && currentRules) renderRules(currentRules)
        return
      }
      const button = e.target.closest('[data-action]')
      if (!button) return
      const action = button.dataset.action
      switch (action) {
        case 'add-promotion': {
          addPromotionRow()
          break
        }
        case 'add-demotion': {
          addDemotionRow()
          break
        }
        case 'delete': {
          removeRow(button)
          break
        }
        case 'add-excluded-rank': {
          const rank = button.dataset.rank
          if (rank && excludedRanksTagInput) excludedRanksTagInput.addTag(rank)

          break
        }
        // No default
      }
    })
  }

  async function onBridgeChange(bridgeId) {
    if (!bridgeId) {
      showEmptyState('No bridge selected.')
      return
    }
    if (isDirty && currentBridgeId && bridgeId !== currentBridgeId) {
      const ok = App.confirmAction('You have unsaved changes. Switch bridge and discard them?')
      if (!ok) {
        const sel = document.querySelector('#bridge-select')
        if (sel) sel.value = currentBridgeId
        App.setSelectedBridge(currentBridgeId)
        return
      }
    }
    currentBridgeId = bridgeId
    isDirty = false
    showLoading()
    try {
      const [ranksRes, rulesRes] = await Promise.all([
        App.apiGet(`/api/rankup/guild-ranks?bridgeId=${encodeURIComponent(bridgeId)}`),
        App.apiGet(`/api/rankup/rules?bridgeId=${encodeURIComponent(bridgeId)}`)
      ])
      guildRanks = Array.isArray(ranksRes?.ranks) ? ranksRes.ranks.map(String) : []
      console.debug(`[Rules] Guild ranks response for bridge ${bridgeId}:`, ranksRes)
      console.debug(`[Rules] Processed guildRanks (${guildRanks.length}):`, guildRanks)
      if (guildRanks.length === 0) {
        console.warn(`[Rules] No guild ranks returned for bridge ${bridgeId} — rank inputs will be free-text`)
      }
      currentRules = normalizeRules(rulesRes)
      renderRules(currentRules)
    } catch (error) {
      currentRules = null
      showError(error)
    }
  }

  function handleWSEvent(type, data) {
    if (type === 'error') {
      App.showToast(`WebSocket: ${data?.error || 'error'}`, 'error')
      return
    }
    if (type === 'rankup.bridgeConfigChanged') {
      if (!data || data.bridgeId !== currentBridgeId) return
      if (isDirty) {
        App.showToast('Config changed externally. You have unsaved changes — reload to get latest.', 'info')
      } else {
        App.showToast('Config changed externally, reloading...', 'info')
        void onBridgeChange(currentBridgeId)
      }
    }
  }

  async function loadInitialBridge() {
    showEmptyState('Select a bridge to view rules.')
    await App.populateBridgeSelector(document.querySelector('#bridge-select'), onBridgeChange)
    if (!currentBridgeId) showEmptyState('No bridge available. Configure a bridge first.')
  }

  function bootstrap() {
    App.injectNav('rules')
    if (!listenersAttached) {
      attachDelegatedListeners()
      listenersAttached = true
    }
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    ws = App.connectRankupWS(handleWSEvent)
    if (currentBridgeId) {
      void onBridgeChange(currentBridgeId)
    } else {
      void loadInitialBridge()
    }
  }

  function init() {
    const token = App.requireAuth()
    if (token) bootstrap()
  }

  globalThis.addEventListener('authsuccess', () => {
    bootstrap()
  })
  init()
})()
