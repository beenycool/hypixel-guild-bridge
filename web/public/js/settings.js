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
  const roleNameMap = new Map()

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
        },
        {
          id: 'promoteChannelIds',
          t: 'tag',
          label: 'Promote Channels',
          hint: 'Where Promote/Demote events are forwarded (max 5).',
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
          t: 'permissionOverview',
          tiers: [
            {
              name: 'Helper',
              badge: 'info',
              note: 'Lowest privilege. Includes all Anyone commands.',
              grants: [
                'Manage user links — /verification, /accept, /blacklist',
                'View guild activity logs — /log',
                'Invite / join guild — /invite, /join',
                'Punishments — mute, check, list',
                'QOTD management — /qotd',
                'GEXP threshold checking — /gexp-check',
                'Connect / disconnect Minecraft — /disconnect, /reconnect',
                'Toggle chat commands — !toggle',
                'Web dashboard & profanity mgmt — /dashboard, /profanity',
                'Cross-bridge chat moderation — !qmute, !qunmute, !qmuted',
                'Persistent leaderboard — /create-leaderboard'
              ],
              missing: [
                'Destructive punishments (Owner) — ban, kick, forgive',
                'Rank management (Owner) — /demote, /promote, /setrank',
                'Raw command execution (Owner) — /execute',
                'Bridge restart & raw in-game exec (Admin) — /restart, !execute'
              ]
            },
            {
              name: 'Owner',
              badge: 'warning',
              note: 'Includes all Helper commands.',
              grants: [
                'Destructive punishments — ban, kick, forgive',
                'Rank management — /demote, /promote, /setrank',
                'Raw command execution — /execute'
              ],
              missing: ['Bridge restart & raw in-game exec (Admin only) — /restart, !execute']
            },
            {
              name: 'Admin',
              badge: 'danger',
              note: 'Service administrator. Set in config.yaml.',
              grants: [
                'Bridge restart — /restart',
                'Raw in-game command execution — !execute',
                'Full command manager — rename, enable/disable any command'
              ],
              missing: []
            }
          ]
        },
        {
          id: 'helperRoleIds',
          t: 'tag',
          label: 'Helper Roles',
          hint: 'Lowest privilege tier (max 5).',
          placeholder: 'Search roles…',
          max: 5,
          roleLabel: true
        },
        {
          id: 'ownerRoleIds',
          t: 'tag',
          label: 'Owner Roles',
          hint: 'Full administrative access (max 5).',
          placeholder: 'Search roles…',
          max: 5,
          roleLabel: true,
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
      description: 'Configure rankup automation rules, exclusions, and notifications.',
      fields: [
        { t: 'boolean', id: 'enabled', label: 'Rankup Automation Enabled' },
        {
          t: 'boolean',
          id: 'manualReview',
          label: 'Manual Review Mode',
          hint: 'When enabled, rank changes require approval before execution'
        },
        {
          t: 'number',
          id: 'notificationCooldown',
          label: 'Notification Cooldown (hours)',
          hint: 'Minimum hours between notifications for the same player',
          min: 0
        },
        {
          t: 'tag',
          id: 'notificationChannelIds',
          label: 'Notification Channels',
          channelLabel: true,
          placeholder: 'Channel ID…',
          hint: 'Discord channel IDs to send notifications to'
        },
        { t: 'promotionRules', id: 'promotionRules' },
        { t: 'demotionRules', id: 'demotionRules' },
        {
          t: 'tag',
          id: 'excludedRanks',
          label: 'Excluded Ranks',
          placeholder: 'Rank name…',
          hint: 'Ranks that should not be affected by automation'
        },
        {
          t: 'tag',
          id: 'excludedPlayers',
          label: 'Excluded Players',
          placeholder: 'Player UUID…',
          hint: 'Players that should not be affected by automation'
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

  function rebuildRoleNameMap(payload) {
    roleNameMap.clear()
    const list = payload?.roles
    if (Array.isArray(list)) {
      for (const r of list) {
        if (r && r.id != null && r.name) roleNameMap.set(String(r.id), r.name)
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

  function renderPermissionOverview(field) {
    let html = ''
    for (const tier of field.tiers) {
      const grantsHtml = tier.grants.map((g) => `<div class="perm-item perm-grant">+ ${esc(g)}</div>`).join('')
      const missingHtml = tier.missing.map((m) => `<div class="perm-item perm-missing">- ${esc(m)}</div>`).join('')
      html += `<div class="perm-tier">
      <div class="perm-tier-header" data-perm-toggle="${esc(tier.name)}">
        <span class="perm-tier-arrow">▶</span>
        <span class="badge badge-${tier.badge}">${esc(tier.name)}</span>
        <span class="perm-tier-note">${esc(tier.note)}</span>
      </div>
      <div class="perm-tier-body hidden" data-perm-body="${esc(tier.name)}">
        ${
          grantsHtml
            ? `<div class="perm-list-title perm-grants-title">Grants access to:</div>
        <div class="perm-list">${grantsHtml}</div>`
            : ''
        }
        ${
          missingHtml
            ? `<div class="perm-list-title perm-missing-title">Does NOT grant:</div>
        <div class="perm-list">${missingHtml}</div>`
            : ''
        }
      </div>
    </div>`
    }
    return `<div class="permission-overview">${html}</div>`
  }

  let rankFieldIdCounter = 0
  function rankSelectHTML(value) {
    const ranks = (rawData && Array.isArray(rawData.guildRanks) ? rawData.guildRanks : []).map(String)
    const allRanks = [...ranks]
    if (value && value !== '' && !allRanks.includes(value)) allRanks.push(value)
    const id = `rank-sel-${++rankFieldIdCounter}`
    if (allRanks.length > 0) {
      const opts = allRanks
        .map((rk) => `<option value="${esc(rk)}"${rk === value ? ' selected' : ''}>${esc(rk)}</option>`)
        .join('')
      return `<select class="input rank-select" data-rank="${id}">${opts}</select>`
    }
    return `<input class="input rank-input" data-rank="${id}" value="${esc(value || '')}" placeholder="Rank name" />`
  }

  function promotionRowHTML(rule) {
    const r = rule || {}
    return `<tr>
      <td>${rankSelectHTML(r.targetRank || '')}</td>
      <td><input type="number" class="input" data-field="minWeeklyGexp" min="0" value="${num(r.minWeeklyGexp)}" /></td>
      <td><input type="number" class="input" data-field="minDaysInGuild" min="0" value="${num(r.minDaysInGuild)}" /></td>
      <td><input type="number" class="input" data-field="minOnlineHours" min="0" value="${num(r.minOnlineHours)}" /></td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" title="Remove">✕</button></td>
    </tr>`
  }

  function demotionRowHTML(rule) {
    const r = rule || {}
    const action = r.action || 'notify'
    const opts = ['demote', 'kick', 'notify']
      .map((a) => `<option value="${a}"${a === action ? ' selected' : ''}>${a}</option>`)
      .join('')
    return `<tr>
      <td>${rankSelectHTML(r.fromRank || '')}</td>
      <td><select class="input" data-field="action">${opts}</select></td>
      <td>${rankSelectHTML(r.targetRank || '')}</td>
      <td><input type="number" class="input" data-field="maxWeeklyGexp" min="0" value="${num(r.maxWeeklyGexp)}" /></td>
      <td><input type="number" class="input" data-field="gracePeriod" min="0" value="${num(r.gracePeriod)}" /></td>
      <td><input type="number" class="input" data-field="maxDaysInactive" min="0" value="${num(r.maxDaysInactive)}" /></td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" title="Remove">✕</button></td>
    </tr>`
  }

  function placeholderRow(cols, msg) {
    return `<tr data-placeholder><td colspan="${cols}" class="text-center text-muted text-sm">${esc(msg)}</td></tr>`
  }

  function renderPromotionRulesTable(data) {
    const rules = Array.isArray(data.promotionRules) ? data.promotionRules : []
    const rows =
      rules.length > 0 ? rules.map(promotionRowHTML).join('') : placeholderRow(5, 'No promotion rules configured.')
    return `<div class="settings-subsection">
      <div class="settings-subsection-title">Promotion Rules</div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Target Rank</th><th>Min Weekly GEXP</th><th>Min Days in Guild</th><th>Min Online Hours</th><th></th></tr></thead>
          <tbody id="promo-tbody">${rows}</tbody>
        </table>
      </div>
      <button class="btn btn-secondary btn-sm mt-sm" data-action="add-promotion">+ Add Promotion Rule</button>
    </div>`
  }

  function renderDemotionRulesTable(data) {
    const rules = Array.isArray(data.demotionRules) ? data.demotionRules : []
    const rows =
      rules.length > 0 ? rules.map(demotionRowHTML).join('') : placeholderRow(7, 'No demotion rules configured.')
    return `<div class="settings-subsection">
      <div class="settings-subsection-title">Demotion Rules</div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>From Rank</th><th>Action</th><th>Target Rank</th><th>Max Weekly GEXP</th><th>Grace Period (days)</th><th>Max Days Inactive</th><th></th></tr></thead>
          <tbody id="demo-tbody">${rows}</tbody>
        </table>
      </div>
      <button class="btn btn-secondary btn-sm mt-sm" data-action="add-demotion">+ Add Demotion Rule</button>
    </div>`
  }

  function readPromotionRows() {
    const tbody = document.querySelector('#promo-tbody')
    if (!tbody) return []
    const rows = [...tbody.querySelectorAll('tr:not([data-placeholder])')]
    return rows.map((tr) => {
      const get = (f) => {
        const el = tr.querySelector(`[data-field="${f}"]`)
        return el ? el.value : ''
      }
      const rankSel = tr.querySelector('[data-rank]')
      const targetRank = rankSel ? rankSel.value : ''
      return {
        targetRank,
        minWeeklyGexp: num(get('minWeeklyGexp')),
        minDaysInGuild: num(get('minDaysInGuild')),
        minOnlineHours: num(get('minOnlineHours'))
      }
    })
  }

  function readDemotionRows() {
    const tbody = document.querySelector('#demo-tbody')
    if (!tbody) return []
    const rows = [...tbody.querySelectorAll('tr:not([data-placeholder])')]
    return rows.map((tr) => {
      const get = (f) => {
        const el = tr.querySelector(`[data-field="${f}"]`)
        return el ? el.value : ''
      }
      const rankSels = tr.querySelectorAll('[data-rank]')
      const fromRank = rankSels[0] ? rankSels[0].value : ''
      const action = get('action') || 'notify'
      const targetRank = rankSels[1] ? rankSels[1].value : ''
      const rule = {
        fromRank,
        action,
        targetRank: action === 'demote' ? targetRank : undefined,
        maxWeeklyGexp: num(get('maxWeeklyGexp')),
        gracePeriod: num(get('gracePeriod')),
        maxDaysInactive: num(get('maxDaysInactive')) || undefined
      }
      return rule
    })
  }

  function renderCategoryPanel(cat) {
    const data = categoryData(cat.key)
    let bodyHTML = ''

    for (const f of cat.fields) {
      if (f.t === 'permissionOverview') {
        bodyHTML += renderPermissionOverview(f)
        continue
      }
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
      if (f.t === 'promotionRules') {
        bodyHTML += renderPromotionRulesTable(data)
        continue
      }
      if (f.t === 'demotionRules') {
        bodyHTML += renderDemotionRulesTable(data)
        continue
      }
      const v = fieldValue(data, f)
      bodyHTML += fieldRowHTML(f, v, data)
    }

    const showActionBar = cat.key !== 'dangerZone'
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
    if (cat.key === 'rankup') {
      applyDemotionTargetStates()
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
        if (f.t === 'permissionOverview') continue
        if (f.t === 'section') {
          walk(f.children)
          continue
        }
        if (f.t === 'tag') {
          const host = panel.querySelector(`[data-tag-host="${cssEscape(f.id)}"]`)
          if (!host) continue
          let labelFor = null
          if (f.roleLabel) {
            labelFor = (id) => roleNameMap.get(String(id))
          } else if (f.channelLabel) {
            labelFor = (id) => channelNameMap.get(String(id))
          }
          const suggestions = f.roleLabel
            ? Array.from(roleNameMap.entries()).map(([id, name]) => ({ label: name, value: id }))
            : undefined
          const tag = createTagInput(arr(data[f.id]), f.placeholder || '…', markDirty, labelFor, f.max, suggestions)
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

  // ---- Tag input -------------------------------------------------------------

  function createTagInput(initial, placeholder, onChange, labelFor, max, suggestions) {
    const tags = []
    const host = document.createElement('div')
    host.className = 'tag-input'
    host.style.position = 'relative'
    const field = document.createElement('input')
    field.className = 'tag-input-field'
    field.type = 'text'
    field.placeholder = placeholder

    const suggestBox = document.createElement('div')
    suggestBox.className = 'tag-input-suggest'

    let highlightedIndex = -1
    let filtered = []

    function closeSuggest() {
      suggestBox.classList.remove('open')
      highlightedIndex = -1
      filtered = []
    }

    function openSuggest() {
      if (filtered.length > 0 || (field.value.trim() && filtered.length === 0)) {
        suggestBox.classList.add('open')
      }
    }

    function filterSuggestions(query) {
      if (!suggestions) return []
      const q = query.toLowerCase().trim()
      if (!q) return suggestions
      return suggestions.filter((s) => s.label.toLowerCase().includes(q) || s.value.includes(q))
    }

    function renderSuggest() {
      while (suggestBox.firstChild) suggestBox.firstChild.remove()
      if (!suggestions) return
      if (filtered.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'tag-input-suggest-empty'
        empty.textContent = field.value.trim() ? 'No matching roles' : ''
        suggestBox.append(empty)
        return
      }
      for (let i = 0; i < filtered.length; i++) {
        const item = document.createElement('div')
        item.className = 'tag-input-suggest-item'
        if (i === highlightedIndex) item.classList.add('highlighted')
        item.textContent = filtered[i].label
        item.dataset.value = filtered[i].value
        item.addEventListener('mousedown', (e) => {
          e.preventDefault()
          addTag(filtered[i].value)
          field.value = ''
          closeSuggest()
          field.focus()
        })
        suggestBox.append(item)
      }
    }

    function render() {
      while (host.firstChild && host.firstChild !== field && host.firstChild !== suggestBox) host.firstChild.remove()
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
        if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
          addTag(filtered[highlightedIndex].value)
        } else if (field.value.trim()) {
          addTag(field.value)
        }
        field.value = ''
        closeSuggest()
      } else if (e.key === 'Backspace' && field.value === '' && tags.length > 0) {
        tags.pop()
        render()
        if (onChange) onChange()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filtered.length === 0) return
        highlightedIndex = Math.min(highlightedIndex + 1, filtered.length - 1)
        renderSuggest()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filtered.length === 0) return
        highlightedIndex = Math.max(highlightedIndex - 1, -1)
        renderSuggest()
      } else if (e.key === 'Escape') {
        closeSuggest()
      }
    })

    field.addEventListener('input', () => {
      filtered = filterSuggestions(field.value)
      highlightedIndex = -1
      renderSuggest()
      if (filtered.length > 0 || field.value.trim()) {
        openSuggest()
      } else {
        closeSuggest()
      }
    })

    field.addEventListener('focus', () => {
      filtered = filterSuggestions(field.value)
      highlightedIndex = -1
      renderSuggest()
      if (suggestions) openSuggest()
    })

    document.addEventListener('click', (e) => {
      if (!host.contains(e.target)) closeSuggest()
    })

    host.append(field)
    host.append(suggestBox)
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
        if (f.t === 'permissionOverview') continue
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
        if (f.t === 'promotionRules') {
          target[f.id] = readPromotionRows()
          continue
        }
        if (f.t === 'demotionRules') {
          target[f.id] = readDemotionRows()
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
        if (f.t === 'permissionOverview') continue
        if (f.t === 'section') {
          walk(f.children)
          continue
        }
        if (f.t === 'link' || f.t === 'danger') continue
        const v = data[f.id]
        if (f.t === 'tag' || f.t === 'msglist') subset[f.id] = JSON.stringify(arr(v))
        else if (f.t === 'boolean') subset[f.id] = bool(v) ? '1' : '0'
        else if (f.t === 'number') subset[f.id] = String(num(v))
        else if (f.t === 'promotionRules' || f.t === 'demotionRules') subset[f.id] = JSON.stringify(v || [])
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
    if (!cat || cat.key === 'dangerZone') return
    isSaving = true
    updateDirtyUI()
    try {
      const payload = readCategoryState(cat)
      const url = `/api/bridges/${encodeURIComponent(currentBridgeId)}/settings/${encodeURIComponent(cat.key)}`
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
      await App.apiDelete(`/api/bridges/${encodeURIComponent(currentBridgeId)}`)
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
      const res = await App.apiGet(`/api/bridges/${encodeURIComponent(currentBridgeId)}/settings`)
      rawData = res || {}
      rebuildChannelNameMap(rawData)
      rebuildRoleNameMap(rawData)
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

  function addPromotionRow() {
    const tbody = document.querySelector('#promo-tbody')
    if (!tbody) return
    const ph = tbody.querySelector('[data-placeholder]')
    if (ph) ph.remove()
    const tr = document.createElement('tr')
    const ranks = rawData && Array.isArray(rawData.guildRanks) ? rawData.guildRanks : []
    tr.innerHTML = promotionRowHTML({
      targetRank: ranks[0] || '',
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
    const ranks = rawData && Array.isArray(rawData.guildRanks) ? rawData.guildRanks : []
    tr.innerHTML = demotionRowHTML({
      fromRank: ranks[0] || '',
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

  function applyDemotionTargetStates() {
    for (const tr of document.querySelectorAll('#demo-tbody tr')) {
      const action = tr.querySelector('[data-field="action"]')
      if (action) {
        const rankSels = tr.querySelectorAll('[data-rank]')
        if (rankSels.length >= 2) rankSels[1].disabled = action.value !== 'demote'
      }
    }
  }

  function attachDelegatedListeners() {
    const panel = document.querySelector('#settings-panel')

    panel.addEventListener('input', () => checkDirty())
    panel.addEventListener('change', (e) => {
      const t = e.target
      if (t?.dataset?.field === 'action' && currentCategory === 'rankup') {
        const tr = t.closest('tr')
        if (tr) {
          const rankSels = tr.querySelectorAll('[data-rank]')
          if (rankSels.length >= 2) rankSels[1].disabled = t.value !== 'demote'
        }
      }
      checkDirty()
    })

    panel.addEventListener('click', (e) => {
      if (e.target.closest('#save-btn')) {
        void saveCategory()
        return
      }
      if (e.target.closest('#discard-btn')) {
        discardCategory()
        return
      }
      const toggle = e.target.closest('[data-perm-toggle]')
      if (toggle) {
        const name = toggle.dataset.permToggle
        const body = document.querySelector(`[data-perm-body="${cssEscape(name)}"]`)
        const arrow = toggle.querySelector('.perm-tier-arrow')
        if (body) {
          body.classList.toggle('hidden')
          if (arrow) arrow.classList.toggle('open')
        }
        return
      }
      if (currentCategory !== 'rankup') return
      const button = e.target.closest('[data-action]')
      if (!button) return
      switch (button.dataset.action) {
        case 'add-promotion':
          addPromotionRow()
          break
        case 'add-demotion':
          addDemotionRow()
          break
        case 'delete':
          removeRow(button)
          break
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
          await App.apiPost('/api/bridges', { bridgeId: bridgeId.trim().toLowerCase() })
          App.showToast('Bridge created', 'success')
          const select = document.querySelector('#bridge-select')
          if (select) {
            App.populateBridgeSelector(select, (bid) => {
              currentBridgeId = bid
              currentCategory = null
              onBridgeChange(bid)
            })
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
