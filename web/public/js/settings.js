'use strict'
;(function () {
  let currentBridgeId = null
  let currentCategory = null
  let rawData = null
  let savedSnapshot = ''
  let isDirty = false
  let isSaving = false
  let isLoading = false
  let ws = null
  let listenersAttached = false
  const channelNameMap = new Map()
  const tagInputRegistry = new Map()

  const esc = (s) => App.escapeHtml(s)
  const num = (n) => {
    const v = Number(n)
    return isNaN(v) ? 0 : v
  }
  const str = (s, d = '') => (s == null ? d : String(s))
  const bool = (s, d = false) => (s == null ? d : !!s)
  const arr = (a) => (Array.isArray(a) ? a.map(String) : [])

  // Pretty names for skyblock event keys (kept in sync with src/utility/skyblock-calendar.ts)
  const SKYBLOCK_EVENT_NAMES = {
    BANK_INTEREST: 'Bank Interest',
    ELECTION_BOOTH_OPENS: 'Election Booth Opens',
    ELECTION_OVER: 'Election Over',
    FALLEN_STAR_CULT: 'Cult of the Fallen Star',
    FEAR_MONGERER: 'Fear Mongerer',
    JERRYS_WORKSHOP: "Jerry's Workshop",
    SEASON_OF_JERRY: 'Season of Jerry',
    HOPPITY_HUNT: "Hoppity's Hunt"
  }

  // ---- Category schema -----------------------------------------------------
  // Each field has a `t` (type) and render/read behaviour.
  //   boolean  -> toggle row
  //   number   -> numeric input row (min/max optional)
  //   text     -> text input row (max optional char cap)
  //   tag      -> tag-input array of strings (channelLabel = true resolves via channelNameMap)
  //   preset   -> select row with `options` [{label,value}] or `optionsFrom` key on root response
  //   section   -> embedded subsection with `.title` and `.children` field list
  //   msglist   -> list of message strings with add/edit/delete
  //   link      -> displays a link card (no save)
  //   danger    -> red action row that calls a configured handler
  const CATEGORIES = [
    {
      key: 'channels',
      name: 'Channels',
      icon: '#',
      description: 'Discord channels used by this bridge for communication and logging.',
      fields: [
        {
          id: 'publicChannelIds',
          t: 'tag',
          label: 'Public Channels',
          hint: 'Where members can interact (max 5).',
          placeholder: 'Channel ID…',
          max: 5,
          channelLabel: true
        },
        {
          id: 'officerChannelIds',
          t: 'tag',
          label: 'Officer Channels',
          hint: 'Where officers manage the bridge (max 5).',
          placeholder: 'Channel ID…',
          max: 5,
          channelLabel: true
        },
        {
          id: 'loggerChannelIds',
          t: 'tag',
          label: 'Logger Channels',
          hint: 'Audit log destinations (max 5).',
          placeholder: 'Channel ID…',
          max: 5,
          channelLabel: true
        }
      ]
    },
    {
      key: 'instances',
      name: 'Minecraft Instances',
      icon: '⛏',
      description: 'Minecraft bot instances this bridge should connect to.',
      fields: [
        {
          id: 'minecraftInstances',
          t: 'tag',
          label: 'Instance Names',
          hint: 'Names of Minecraft instances from config.yaml (max 10).',
          placeholder: 'instance-name…',
          max: 10
        }
      ]
    },
    {
      key: 'staffRoles',
      name: 'Staff Roles',
      icon: '★',
      description: 'Discord roles that gate access to bridge commands.',
      fields: [
        {
          id: 'helperRoleIds',
          t: 'tag',
          label: 'Helper Roles',
          hint: 'Lowest privilege tier (max 5).',
          placeholder: 'Role ID…',
          max: 5,
          channelLabel: true
        },
        {
          id: 'officerRoleIds',
          t: 'tag',
          label: 'Officer Roles',
          hint: 'Mid-tier privileged roles (max 5).',
          placeholder: 'Role ID…',
          max: 5,
          channelLabel: true
        },
        {
          id: 'ownerRoleIds',
          t: 'tag',
          label: 'Owner Roles',
          hint: 'Full administrative access (max 5).',
          placeholder: 'Role ID…',
          max: 5,
          channelLabel: true,
          warning: true
        }
      ]
    },
    {
      key: 'discordSettings',
      name: 'Discord Settings',
      icon: '⚙',
      description: 'Core Discord-side behaviour for this bridge.',
      fields: [
        {
          id: 'alwaysReply',
          t: 'boolean',
          label: 'Always Reply',
          hint: 'Reply to every message even if it is not a command.'
        },
        {
          id: 'enforceVerification',
          t: 'boolean',
          label: 'Enforce Verification',
          hint: 'Require members to be verified before they can use commands.'
        },
        {
          id: 'minecraftTextImages',
          t: 'boolean',
          label: 'Minecraft Text Images',
          hint: 'Render Minecraft text as images in Discord.'
        },
        {
          id: 'language',
          t: 'preset',
          label: 'Language',
          optionsFrom: 'availableLanguages',
          fallbackOptions: [{ label: 'en', value: 'en' }]
        }
      ]
    },
    {
      key: 'minecraftEvents',
      name: 'Minecraft Events',
      icon: '✦',
      description: 'Online/offline tracking and randomized chatter for the Minecraft side.',
      fields: [
        {
          id: 'memberOnline',
          t: 'boolean',
          label: 'Member Online',
          hint: 'Announce when a guild member comes online.'
        },
        {
          id: 'memberOffline',
          t: 'boolean',
          label: 'Member Offline',
          hint: 'Announce when a guild member goes offline.'
        },
        {
          id: 'persistOnlineOffline',
          t: 'boolean',
          label: 'Persist Online/Offline',
          hint: 'Keep offline/online messages in the channel.'
        },
        {
          t: 'section',
          title: 'When NOT Persisted',
          condition: (data) => !bool(data.persistOnlineOffline),
          children: [
            {
              id: 'deleteAfterSeconds',
              t: 'number',
              label: 'Delete After (seconds)',
              hint: '1–43200',
              min: 1,
              max: 43200
            },
            { id: 'maxEvents', t: 'number', label: 'Max Events', hint: '1–1000', min: 1, max: 1000 }
          ]
        },
        {
          t: 'section',
          title: 'Random Chatter',
          children: [
            { id: 'chatterEnabled', t: 'boolean', label: 'Enable Random Chatter' },
            { id: 'chatterIntervalMinutes', t: 'number', label: 'Interval (minutes)', min: 1, max: 1440 },
            { id: 'chatterMinOnlinePlayers', t: 'number', label: 'Min Online Players', min: 1, max: 100 },
            {
              id: 'chatterUseBotName',
              t: 'boolean',
              label: 'Use Bot Name',
              hint: 'Send chatter under the bot account rather than a fake name.'
            },
            {
              id: 'chatterMessages',
              t: 'msglist',
              label: 'Chatter Messages',
              hint: 'Up to 20 messages. One will be picked at random each interval.'
            },
            {
              id: 'chatterAntiRepeatLength',
              t: 'number',
              label: 'Anti-Repeat Length',
              hint: 'Avoid repeating a recent message within N chars (0–50).',
              min: 0,
              max: 50
            },
            {
              id: 'chatterQuietWindowMinutes',
              t: 'number',
              label: 'Quiet Window (minutes)',
              hint: 'Pause chatter shortly after real chat activity (0–60).',
              min: 0,
              max: 60
            }
          ]
        }
      ]
    },
    {
      key: 'skyblockEvents',
      name: 'Skyblock Events',
      icon: '☀',
      description: 'Reminders for scheduled Skyblock events.',
      fields: [
        {
          id: 'enabled',
          t: 'boolean',
          label: 'Skyblock Events Enabled',
          hint: 'Master toggle for Skyblock reminders.'
        },
        {
          t: 'section',
          title: 'Reminders',
          children: [
            { id: 'darkAuctionReminder', t: 'boolean', label: 'Dark Auction Reminder' },
            { id: 'starfallCultReminder', t: 'boolean', label: 'Starfall Cult Reminder' }
          ]
        },
        {
          t: 'section',
          title: 'Per-Event Reminders',
          children: Object.keys(SKYBLOCK_EVENT_NAMES).map((key) => ({
            id: `event_${key}`,
            t: 'boolean',
            label: SKYBLOCK_EVENT_NAMES[key] || key,
            sourceKey: key
          }))
        }
      ]
    },
    {
      key: 'qualityOfLife',
      name: 'Quality of Life',
      icon: '✿',
      description: 'Reactions, mute announcements, and other niceties.',
      fields: [
        {
          t: 'section',
          title: 'Guild Reactions',
          children: [
            { id: 'guildJoinReaction', t: 'boolean', label: 'Guild Join Reaction' },
            { id: 'guildLeaveReaction', t: 'boolean', label: 'Guild Leave Reaction' },
            { id: 'guildKickReaction', t: 'boolean', label: 'Guild Kick Reaction' },
            {
              id: 'joinDiscordReaction',
              t: 'preset',
              label: 'Join Discord Reaction',
              options: [
                { label: '👍 Thumbs Up', value: 'thumbsup' },
                { label: '👎 Thumbs Down', value: 'thumbsdown' }
              ],
              allowEmpty: true
            },
            {
              id: 'leaveDiscordReaction',
              t: 'preset',
              label: 'Leave Discord Reaction',
              options: [
                { label: '👍 Thumbs Up', value: 'thumbsup' },
                { label: '👎 Thumbs Down', value: 'thumbsdown' }
              ],
              allowEmpty: true
            }
          ]
        },
        {
          id: 'announcePlayerMuted',
          t: 'boolean',
          label: 'Announce Player Muted',
          hint: 'Post a message when a player is muted in Minecraft.'
        }
      ]
    },
    {
      key: 'customMessages',
      name: 'Custom Messages',
      icon: '✎',
      description: 'Override the default announcement and chatter text.',
      fields: [
        {
          t: 'section',
          title: 'Guild Reaction Messages',
          children: [
            { id: 'joinMessages', t: 'msglist', label: 'Join Messages', hint: 'Random one sent per guild join.' },
            { id: 'leaveMessages', t: 'msglist', label: 'Leave Messages', hint: 'Random one sent per guild leave.' },
            { id: 'kickMessages', t: 'msglist', label: 'Kick Messages', hint: 'Random one sent per guild kick.' }
          ]
        },
        {
          t: 'section',
          title: 'Skyblock Reminder Messages',
          children: [
            { id: 'darkAuctionReminderText', t: 'text', label: 'Dark Auction Reminder Text', max: 1000 },
            { id: 'starfallCultReminderText', t: 'text', label: 'Starfall Cult Reminder Text', max: 1000 }
          ]
        },
        {
          t: 'section',
          title: 'Other Reminder Messages',
          children: [{ id: 'announcePlayerMutedText', t: 'text', label: 'Announce Player Muted Text', max: 1000 }]
        }
      ]
    },
    {
      key: 'moderation',
      name: 'Moderation',
      icon: '⚠',
      description: 'Heat-based punishments, immune users, and the profanity filter.',
      fields: [
        {
          t: 'section',
          title: 'Heat Punishments',
          children: [
            {
              id: 'heatPunishmentsEnabled',
              t: 'boolean',
              label: 'Enable Heat Punishments',
              hint: 'When off, no kicks/mutes are issued for heat.'
            },
            {
              id: 'heatKicksPerDay',
              t: 'number',
              label: 'Kicks Per Day',
              hint: '0 falls back to global default.',
              min: 0
            },
            {
              id: 'heatMutesPerDay',
              t: 'number',
              label: 'Mutes Per Day',
              hint: '0 falls back to global default.',
              min: 0
            }
          ]
        },
        {
          t: 'section',
          title: 'Immunity List',
          children: [
            {
              id: 'immuneDiscordUserIds',
              t: 'tag',
              label: 'Immune Discord Users',
              hint: 'User IDs exempt from moderation.',
              placeholder: 'User ID…',
              max: 100,
              channelLabel: true
            },
            {
              id: 'immuneMojangPlayers',
              t: 'tag',
              label: 'Immune Mojang Players',
              hint: 'Player UUIDs exempt from moderation.',
              placeholder: 'Player UUID…',
              max: 100
            }
          ]
        },
        {
          t: 'section',
          title: 'Profanity Filter',
          children: [
            {
              id: 'profanityFilterEnabled',
              t: 'boolean',
              label: 'Enable Profanity Filter',
              hint: '0 falls back to global default.'
            },
            {
              id: 'profanityList',
              t: 'link',
              label: 'Profanity List',
              description: 'Manage the global profanity list with the /profanity Discord command.',
              href: null,
              icon: '✎'
            }
          ]
        }
      ]
    },
    {
      key: 'chatCommands',
      name: 'Chat Commands',
      icon: '⌘',
      description: 'In-game chat commands and passthrough configuration.',
      fields: [
        {
          id: 'commandsEnabled',
          t: 'boolean',
          label: 'Enable Chat Commands',
          hint: 'Master toggle for in-game commands (falls back to global).'
        },
        {
          id: 'chatCommandPrefix',
          t: 'text',
          label: 'Chat Command Prefix',
          hint: '0–2 characters. Empty falls back to global.',
          max: 2
        },
        {
          id: 'passthroughPrefix',
          t: 'text',
          label: 'Passthrough Prefix',
          hint: '0–2 characters. Empty means no passthrough.',
          max: 2
        },
        {
          id: 'passthroughCommands',
          t: 'tag',
          label: 'Passthrough Commands',
          hint: 'Commands forwarded verbatim (max 20).',
          placeholder: 'command…',
          max: 20
        },
        {
          id: 'insultMode',
          t: 'preset',
          label: 'Insult Mode',
          options: [
            { label: 'Normal', value: 'normal' },
            { label: 'Custom', value: 'custom' }
          ]
        }
      ]
    },
    {
      key: 'rankup',
      name: 'Rankup Automation',
      icon: '↑',
      description: 'Rank-up rules are managed in the dedicated Rankup Rules editor.',
      fields: [
        {
          t: 'link',
          label: 'Open Rankup Rules Editor',
          description:
            'Configure promotion/demotion rules, excluded ranks/players, manual review mode, and notification channels in the full rules editor.',
          href: 'rankup-rules.html',
          icon: '↑'
        }
      ]
    },
    {
      key: 'dangerZone',
      name: 'Danger Zone',
      icon: '☠',
      danger: true,
      description: 'Irreversible actions. Proceed with caution.',
      fields: [
        {
          t: 'danger',
          id: 'deleteBridge',
          label: 'Delete Bridge',
          hint: 'Removes all configuration and data for this bridge. This cannot be undone.',
          buttonText: 'Delete this Bridge',
          confirm:
            'Are you sure you want to permanently delete this bridge and all of its settings? This cannot be undone.'
        }
      ]
    }
  ]

  // ---- Utilities -----------------------------------------------------------

  function setWSStatus(state, label) {
    const el = document.querySelector('#ws-status')
    if (!el) return
    el.classList.remove('connecting', 'disconnected')
    if (state === 'connecting') el.classList.add('connecting')
    else if (state === 'disconnected') el.classList.add('disconnected')
    const text = el.querySelector('.ws-status-text')
    if (text && label) text.textContent = label
  }

  function rebuildChannelNameMap(payload) {
    channelNameMap.clear()
    const list = payload?.channels
    if (Array.isArray(list)) {
      for (const c of list) {
        if (c && c.id != null && c.name) channelNameMap.set(String(c.id), c.name)
      }
    } else if (list && typeof list === 'object') {
      for (const [id, name] of Object.entries(list)) {
        if (name) channelNameMap.set(String(id), String(name))
      }
    }
  }

  function categoryData(catKey) {
    const cats = (rawData && rawData.categories) || {}
    return cats[catKey] || {}
  }

  function fieldValue(data, field) {
    if (field.t === 'tag' || field.t === 'msglist') return arr(data[field.id])
    if (field.t === 'boolean') return bool(data[field.id])
    if (field.t === 'number') return num(data[field.id])
    if (field.t === 'text' || field.t === 'preset') return str(data[field.id], field.allowEmpty ? '' : '')
    return data[field.id]
  }

  // ---- Sidebar --------------------------------------------------------------

  function renderSidebar() {
    const host = document.querySelector('#settings-nav')
    if (!host) return
    host.innerHTML = ''
    for (const cat of CATEGORIES) {
      const li = document.createElement('li')
      li.className =
        'settings-nav-item' + (cat.danger ? ' danger' : '') + (currentCategory === cat.key ? ' active' : '')
      li.dataset.cat = cat.key
      li.innerHTML = `<span class="settings-nav-icon">${esc(cat.icon)}</span><span>${esc(cat.name)}</span>`
      li.addEventListener('click', () => selectCategory(cat.key))
      host.append(li)
    }
  }

  // ---- Panel: per-field renderers ------------------------------------------

  function fieldRowHTML(field, value, data) {
    const id = field.id
    const hint = field.hint ? `<span class="settings-row-hint">${esc(field.hint)}</span>` : ''
    const warning = field.warning ? ` <span class="badge badge-warning" title="High privilege">⚠</span>` : ''
    const labelHTML = `<span class="settings-row-name">${esc(field.label)}${warning}</span>${hint}`

    let control = ''
    switch (field.t) {
      case 'boolean':
        control = `<label class="toggle"><input type="checkbox" data-field="${esc(id)}"${value ? ' checked' : ''} /><span class="toggle-slider"></span></label>`
        break
      case 'number':
        control = `<input type="number" class="input" data-field="${esc(id)}" value="${esc(value)}"${field.min != null ? ` min="${field.min}"` : ''}${field.max != null ? ` max="${field.max}"` : ''} />`
        break
      case 'text':
        control = `<input type="text" class="input" data-field="${esc(id)}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}"${field.max ? ` maxlength="${field.max}"` : ''} />`
        break
      case 'preset': {
        const options = collectPresetOptions(field)
        const optsHtml =
          (field.allowEmpty ? '<option value="">(default)</option>' : '') +
          options
            .map(
              (o) => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`
            )
            .join('')
        control = `<select class="select" data-field="${esc(id)}">${optsHtml}</select>`
        break
      }
      case 'tag':
        control = `<div data-tag-host="${esc(id)}"></div>`
        break
      case 'msglist':
        control = `<div data-msglist-host="${esc(id)}"></div>`
        break
      case 'link':
        control = '' // rendered as full-width card by renderLinkCard
        break
      case 'danger':
        control = `<button class="btn btn-danger btn-sm" data-danger="${esc(id)}">${esc(field.buttonText || 'Delete')}</button>`
        break
      default:
        control = `<input type="text" class="input" data-field="${esc(id)}" value="${esc(value)}" />`
    }

    if (field.t === 'link' || field.t === 'danger') {
      return '' // these are rendered specially
    }

    return `<div class="settings-row">
      <div class="settings-row-label">${labelHTML}</div>
      <div class="settings-row-control">${control}</div>
    </div>`
  }

  function collectPresetOptions(field) {
    if (field.options) return field.options
    if (field.optionsFrom && rawData && Array.isArray(rawData[field.optionsFrom])) {
      return rawData[field.optionsFrom].map((item) =>
        typeof item === 'string' ? { label: item, value: item } : { label: item.label || item.value, value: item.value }
      )
    }
    return field.fallbackOptions || [{ label: '(no options)', value: '' }]
  }

  function renderSection(section, data) {
    if (section.condition && !section.condition(data)) return ''
    let inner = ''
    for (const f of section.children || []) {
      if (f.t === 'link') {
        inner += renderLinkCard(f)
        continue
      }
      if (f.t === 'danger') {
        inner += renderDangerAction(f)
        continue
      }
      const v = fieldValue(data, f)
      inner += fieldRowHTML(f, v, data)
    }
    return `<div class="settings-subsection">
      <div class="settings-subsection-title">${esc(section.title)}</div>
      ${inner}
    </div>`
  }

  function renderLinkCard(field) {
    const href = field.href
    if (href) {
      return `<a class="settings-link-card" href="${esc(href)}">
        <span class="settings-link-card-icon">${esc(field.icon || '↗')}</span>
        <span class="settings-link-card-body">
          <span class="settings-link-card-title">${esc(field.label)}</span>
          <span class="settings-link-card-desc">${esc(field.description || '')}</span>
        </span>
      </a>`
    }
    return `<div class="settings-link-card" style="cursor: default; opacity: 0.7;">
      <span class="settings-link-card-icon">${esc(field.icon || '↗')}</span>
      <span class="settings-link-card-body">
        <span class="settings-link-card-title">${esc(field.label)}</span>
        <span class="settings-link-card-desc">${esc(field.description || 'Use the Discord /' + (field.command || 'command') + ' command to manage this list.')}</span>
      </span>
    </div>`
  }

  function renderDangerAction(field) {
    const hint = field.hint ? `<span class="settings-row-hint">${esc(field.hint)}</span>` : ''
    return `<div class="settings-row" style="border-color: rgba(244,63,94,0.25);">
      <div class="settings-row-label">
        <span class="settings-row-name text-danger">${esc(field.label)}</span>${hint}
      </div>
      <div class="settings-row-control">
        <button class="btn btn-danger btn-sm" data-danger="${esc(field.id)}">${esc(field.buttonText || 'Delete')}</button>
      </div>
    </div>`
  }

  function renderCategoryPanel(cat) {
    const data = categoryData(cat.key)
    let bodyHTML = ''

    for (const f of cat.fields) {
      if (f.t === 'section') {
        bodyHTML += renderSection(f, data)
        continue
      }
      if (f.t === 'link') {
        bodyHTML += renderLinkCard(f)
        continue
      }
      if (f.t === 'danger') {
        bodyHTML += renderDangerAction(f)
        continue
      }
      const v = fieldValue(data, f)
      bodyHTML += fieldRowHTML(f, v, data)
    }

    const showActionBar = cat.key !== 'rankup' && cat.key !== 'dangerZone'
    const actionBar = showActionBar
      ? `<div class="settings-action-bar">
          <span id="dirty-indicator"></span>
          <div class="flex gap-sm">
            <button class="btn btn-secondary" id="discard-btn" disabled>Discard</button>
            <button class="btn btn-primary" id="save-btn" disabled>Save Changes</button>
          </div>
        </div>`
      : ''

    const dangerWrap = cat.danger ? '<div class="settings-danger-zone">' : ''
    const dangerWrapClose = cat.danger ? '</div>' : ''

    const panel = document.querySelector('#settings-panel')
    panel.innerHTML = `
      <div class="settings-panel-header">
        <div>
          <div class="settings-panel-title">${esc(cat.name)}</div>
          <div class="settings-panel-subtitle">${esc(cat.description || '')}</div>
        </div>
      </div>
      ${dangerWrap}
      <div class="card">
        <div class="card-body">${bodyHTML}</div>
      </div>
      ${dangerWrapClose}
      ${actionBar}
    `

    // Mount tag + msglist inputs
    mountDynamicControls(cat, data)
    // Wire danger actions
    if (cat.key === 'dangerZone') {
      const btn = panel.querySelector('[data-danger="deleteBridge"]')
      if (btn) btn.addEventListener('click', onDeleteBridge)
    }
    // Reset dirty baseline for the active category
    savedSnapshot = serializeCategory(cat, data)
    isDirty = false
    updateDirtyUI()
  }

  function mountDynamicControls(cat, data) {
    tagInputRegistry.clear()
    const panel = document.querySelector('#settings-panel')

    function walk(fields) {
      for (const f of fields || []) {
        if (f.t === 'section') {
          walk(f.children)
          continue
        }
        if (f.t === 'tag') {
          const host = panel.querySelector(`[data-tag-host="${cssEscape(f.id)}"]`)
          if (!host) continue
          const labelFor = f.channelLabel ? (id) => channelNameMap.get(String(id)) : null
          const tag = createTagInput(arr(data[f.id]), f.placeholder || '…', markDirty, labelFor, f.max)
          host.append(tag.el)
          tagInputRegistry.set(f.id, tag)
        } else if (f.t === 'msglist') {
          const host = panel.querySelector(`[data-msglist-host="${cssEscape(f.id)}"]`)
          if (!host) continue
          mountMessageList(host, f, arr(data[f.id]))
        }
      }
    }
    walk(cat.fields)
  }

  function cssEscape(value) {
    return String(value).replace(/"/g, '\\"')
  }

  // ---- Tag input (replicating rules.js behaviour) -----------------------------

  function createTagInput(initial, placeholder, onChange, labelFor, max) {
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
        tag.title = t
        const labelEl = document.createElement('span')
        labelEl.textContent = labelFor ? labelFor(t) || t : t
        const rm = document.createElement('span')
        rm.className = 'tag-remove'
        rm.textContent = '✕'
        rm.addEventListener('click', () => {
          const i = tags.indexOf(t)
          if (i !== -1) {
            tags.splice(i, 1)
            render()
            if (onChange) onChange()
          }
        })
        tag.append(labelEl)
        tag.append(rm)
        field.before(tag)
      }
    }

    function addTag(value) {
      const v = String(value == null ? '' : value).trim()
      if (!v) return
      if (tags.includes(v)) return
      if (max && tags.length >= max) return
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

  // ---- Message list editor -------------------------------------------------

  function mountMessageList(host, field, messages) {
    const list = [...messages]
    host.innerHTML = ''
    host.className = 'flex-column gap-xs'

    function render() {
      host.innerHTML = ''
      list.forEach((msg, idx) => {
        const row = document.createElement('div')
        row.className = 'settings-message-editor'
        row.innerHTML = `
          <div class="settings-message-row">
            <input class="input" data-msgidx="${idx}" value="${esc(msg).replace(/"/g, '&quot;')}" />
            <button class="btn btn-danger btn-sm" data-msgdel="${idx}" title="Remove">✕</button>
          </div>
        `
        host.append(row)
      })
      const addRow = document.createElement('div')
      addRow.className = 'settings-message-row'
      addRow.innerHTML = `
        <input class="input" data-msgadd placeholder="${esc(field.placeholder || 'New message…')}" />
        <button class="btn btn-success btn-sm" data-msgaddbtn>+ Add</button>
      `
      host.append(addRow)
    }

    host.addEventListener('input', (e) => {
      const t = e.target
      if (t.dataset && t.dataset.msgidx != null) {
        list[Number(t.dataset.msgidx)] = t.value
        markDirty()
      }
    })

    host.addEventListener('click', (e) => {
      const del = e.target.closest('[data-msgdel]')
      if (del) {
        list.splice(Number(del.dataset.msgdel), 1)
        render()
        markDirty()
        return
      }
      const addBtn = e.target.closest('[data-msgaddbtn]')
      if (addBtn) {
        const input = host.querySelector('[data-msgadd]')
        const v = (input?.value || '').trim()
        if (v && !list.includes(v) && list.length < 20) {
          list.push(v)
          render()
          markDirty()
        }
      }
    })

    host._getMessageList = () => [...list]
    render()
  }

  // ---- Read form state back into a category object -------------------------

  function readCategoryState(cat) {
    const data = JSON.parse(JSON.stringify(categoryData(cat.key) || {}))
    const panel = document.querySelector('#settings-panel')

    function walk(fields, target) {
      for (const f of fields || []) {
        if (f.t === 'section') {
          walk(f.children, target)
          continue
        }
        if (f.t === 'tag') {
          const tag = tagInputRegistry.get(f.id)
          target[f.id] = tag ? tag.getTags() : arr(target[f.id])
          continue
        }
        if (f.t === 'msglist') {
          const host = panel.querySelector(`[data-msglist-host="${cssEscape(f.id)}"]`)
          target[f.id] = host && host._getMessageList ? host._getMessageList() : arr(target[f.id])
          continue
        }
        if (f.t === 'link' || f.t === 'danger') continue
        const el = panel.querySelector(`[data-field="${cssEscape(f.id)}"]`)
        if (!el) continue
        if (f.t === 'boolean') target[f.id] = !!el.checked
        else if (f.t === 'number') target[f.id] = num(el.value)
        else target[f.id] = el.value
      }
    }

    walk(cat.fields, data)
    return data
  }

  function serializeCategory(cat, data) {
    const subset = {}
    function walk(fields) {
      for (const f of fields || []) {
        if (f.t === 'section') {
          walk(f.children)
          continue
        }
        if (f.t === 'link' || f.t === 'danger') continue
        const v = data[f.id]
        if (f.t === 'tag' || f.t === 'msglist') subset[f.id] = JSON.stringify(arr(v))
        else if (f.t === 'boolean') subset[f.id] = bool(v) ? '1' : '0'
        else if (f.t === 'number') subset[f.id] = String(num(v))
        else subset[f.id] = str(v)
      }
    }
    walk(cat.fields)
    return JSON.stringify(subset)
  }

  function currentSnapshot() {
    if (!currentCategory) return ''
    const cat = CATEGORIES.find((c) => c.key === currentCategory)
    if (!cat) return ''
    return serializeCategory(cat, readCategoryState(cat))
  }

  // ---- Dirty tracking ------------------------------------------------------

  function markDirty() {
    checkDirty()
  }

  function checkDirty() {
    if (isSaving || isLoading || !currentCategory) return
    isDirty = currentSnapshot() !== savedSnapshot
    updateDirtyUI()
  }

  function updateDirtyUI() {
    const saveBtn = document.querySelector('#save-btn')
    const discardBtn = document.querySelector('#discard-btn')
    const ind = document.querySelector('#dirty-indicator')
    if (!saveBtn) return
    if (isSaving) {
      saveBtn.disabled = true
      saveBtn.textContent = 'Saving…'
      if (discardBtn) discardBtn.disabled = true
      if (ind) ind.innerHTML = '<span class="badge badge-info">Saving…</span>'
      return
    }
    if (isDirty) {
      saveBtn.disabled = false
      if (discardBtn) discardBtn.disabled = false
      if (ind) ind.innerHTML = '<span class="badge badge-warning">Unsaved changes</span>'
    } else {
      saveBtn.disabled = true
      saveBtn.textContent = 'Save Changes'
      if (discardBtn) discardBtn.disabled = true
      if (ind) ind.innerHTML = '<span class="badge badge-success">All changes saved</span>'
    }
  }

  async function saveCategory() {
    if (!currentBridgeId || !currentCategory || isSaving) return
    const cat = CATEGORIES.find((c) => c.key === currentCategory)
    if (!cat || cat.key === 'rankup' || cat.key === 'dangerZone') return
    isSaving = true
    updateDirtyUI()
    try {
      const payload = readCategoryState(cat)
      const url = `/api/settings/${encodeURIComponent(currentBridgeId)}/${encodeURIComponent(cat.key)}`
      await App.apiPut(url, payload)
      // Merge into rawData
      rawData.categories = rawData.categories || {}
      rawData.categories[cat.key] = payload
      // Reset dirty baseline so the snapshot reflects server state
      savedSnapshot = serializeCategory(cat, payload)
      isDirty = false
      updateDirtyUI()
      App.showToast(`${cat.name} saved`, 'success')
    } catch (error) {
      App.showToast(`Failed to save ${cat.name}: ${error?.message || String(error)}`, 'error')
    } finally {
      isSaving = false
      updateDirtyUI()
    }
  }

  function discardCategory() {
    if (!currentCategory) return
    const cat = CATEGORIES.find((c) => c.key === currentCategory)
    if (!cat) return
    if (isDirty && !App.confirmAction('Discard unsaved changes?')) return
    renderCategoryPanel(cat)
  }

  async function onDeleteBridge() {
    if (!currentBridgeId) return
    if (
      !App.confirmAction(
        'Are you sure you want to permanently delete this bridge and all of its settings? This cannot be undone.'
      )
    )
      return
    const btn = document.querySelector('[data-danger="deleteBridge"]')
    if (btn) {
      btn.disabled = true
      btn.textContent = 'Deleting…'
    }
    try {
      await App.apiDelete(`/api/settings/${encodeURIComponent(currentBridgeId)}`)
      App.showToast('Bridge deleted', 'success')
      currentBridgeId = null
      rawData = null
      await App.populateBridgeSelector(document.querySelector('#bridge-select'), onBridgeChange)
    } catch (error) {
      App.showToast(`Failed to delete bridge: ${error?.message || String(error)}`, 'error')
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Delete this Bridge'
      }
    }
  }

  // ---- Selection / load flow -----------------------------------------------

  async function selectCategory(catKey) {
    if (!currentBridgeId) {
      renderSidebar()
      showPanel('<div class="empty-state"><div class="empty-state-text">Select a bridge to begin.</div></div>')
      return
    }
    if (isDirty && currentCategory && catKey !== currentCategory) {
      if (!App.confirmAction('You have unsaved changes in the current category. Switch and discard them?')) {
        return
      }
    }
    currentCategory = catKey
    renderSidebar()
    const cat = CATEGORIES.find((c) => c.key === catKey)
    if (!cat) return
    renderCategoryPanel(cat)
  }

  function showPanel(html) {
    const panel = document.querySelector('#settings-panel')
    if (panel) panel.innerHTML = html
  }

  function showLoading() {
    showPanel('<div class="loading"><div class="loading-spinner"></div></div>')
  }

  function showError(error) {
    const message = error?.message || String(error)
    const isMissing = /Failed to load|404|Not Found|load failed/i.test(message)
    if (isMissing) {
      showPanel(`
        <div class="settings-gateway-error">
          <strong>Settings API not available.</strong>
          <span>The <code>/api/settings/:bridgeId</code> endpoint returned no response. The backend handler has not been wired up yet — see <code>src/instance/web/settings-api.ts</code> (planned).</span>
          <span class="text-xs text-muted">Detail: ${esc(message)}</span>
        </div>
      `)
    } else {
      showPanel(
        `<div class="empty-state"><div class="empty-state-text">Failed to load settings: ${esc(message)}</div></div>`
      )
    }
  }

  async function loadSettingsWithAuth() {
    isLoading = true
    showLoading()
    try {
      const res = await App.apiGet(`/api/settings/${encodeURIComponent(currentBridgeId)}`)
      rawData = res || {}
      rebuildChannelNameMap(rawData)
      isLoading = false
      if (currentCategory) {
        const cat = CATEGORIES.find((c) => c.key === currentCategory)
        if (cat) renderCategoryPanel(cat)
      } else {
        await selectCategory('channels')
      }
    } catch (error) {
      isLoading = false
      rawData = null
      showError(error)
    }
  }

  async function onBridgeChange(bridgeId) {
    if (!bridgeId) {
      currentBridgeId = null
      showPanel('<div class="empty-state"><div class="empty-state-text">No bridge selected.</div></div>')
      renderSidebar()
      return
    }
    if (isDirty && currentBridgeId && bridgeId !== currentBridgeId) {
      if (!App.confirmAction('You have unsaved changes. Switch bridge and discard them?')) {
        const sel = document.querySelector('#bridge-select')
        if (sel && currentBridgeId) sel.value = currentBridgeId
        App.setSelectedBridge(currentBridgeId)
        return
      }
    }
    currentBridgeId = bridgeId
    currentCategory = null
    renderSidebar()
    await loadSettingsWithAuth()
  }

  // ---- WebSocket handling --------------------------------------------------

  function handleWSEvent(type, data) {
    if (type === 'error') {
      setWSStatus('disconnected', 'ws error')
      return
    }
    if (type === 'ack') {
      setWSStatus('connected', 'live')
      return
    }
    if (type === 'settings.configChanged') {
      if (!data || data.bridgeId !== currentBridgeId) return
      if (data.category && currentCategory && data.category === currentCategory && isDirty) {
        App.showToast('Server config changed for this category. Save or discard to refresh.', 'info')
      } else {
        App.showToast('Settings changed externally, reloading…', 'info')
        void loadSettingsWithAuth()
      }
    }
  }

  // ---- Delegated listeners ------------------------------------------------

  function attachDelegatedListeners() {
    const panel = document.querySelector('#settings-panel')

    panel.addEventListener('input', () => checkDirty())
    panel.addEventListener('change', () => checkDirty())

    panel.addEventListener('click', (e) => {
      if (e.target.closest('#save-btn')) {
        void saveCategory()
        return
      }
      if (e.target.closest('#discard-btn')) {
        discardCategory()
        return
      }
    })

    // Sidebar clicks are wired directly in renderSidebar()
  }

  // ---- Bootstrap ----------------------------------------------------------

  async function bootstrap() {
    App.injectNav('settings')
    if (!listenersAttached) {
      attachDelegatedListeners()
      listenersAttached = true
    }
    if (ws) {
      try {
        ws.close()
      } catch {}
      ws = null
    }
    setWSStatus('connecting', 'connecting…')
    ws = App.connectSettingsWS(handleWSEvent)

    if (currentBridgeId) {
      await onBridgeChange(currentBridgeId)
    } else {
      showPanel('<div class="empty-state"><div class="empty-state-text">Select a bridge to begin.</div></div>')
      await App.populateBridgeSelector(document.querySelector('#bridge-select'), onBridgeChange)
      if (!currentBridgeId) {
        showPanel(
          '<div class="empty-state"><div class="empty-state-text">No bridges available. Create one via the Discord /settings command.</div></div>'
        )
      }
    }

    // Create Bridge button
    const createBtn = document.querySelector('#create-bridge-btn')
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        const bridgeId = globalThis.prompt('Enter a unique bridge ID:')
        if (!bridgeId || !bridgeId.trim()) return
        try {
          const res = await App.apiPost('/api/settings', { bridgeId: bridgeId.trim().toLowerCase() })
          if (res && res.success) {
            App.showToast(`Bridge "${res.bridgeId}" created`, 'success')
            // Reload bridge selector
            const select = document.querySelector('#bridge-select')
            if (select) {
              App.populateBridgeSelector(select, (bid) => {
                currentBridgeId = bid
                loadCategory(currentCategory)
              })
            }
          }
        } catch (error) {
          App.showToast(`Failed to create bridge: ${error.message}`, 'error')
        }
      })
    }
  }

  function init() {
    const token = App.requireAuth()
    if (token) bootstrap()
  }

  globalThis.addEventListener('authsuccess', () => bootstrap())
  init()
})()
