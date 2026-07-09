import { Auth } from './auth.js'
import { Api } from './api.js'
import { Ws } from './ws.js'
import { Ui } from './ui.js'
import { initNav } from './nav.js'
import { initStatusPolling } from './status.js'

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

const esc = (s) => Ui.escapeHtml(s)
const number_ = (n) => {
  const v = Number(n)
  return isNaN(v) ? 0 : v
}
const string_ = (s, d = '') => (s == undefined ? d : String(s))
const bool = (s, d = false) => (s == undefined ? d : !!s)
const array = (a) => (Array.isArray(a) ? a.map(String) : [])

// ---- Category schema -----------------------------------------------------
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
        placeholder: 'Channel ID\u2026',
        max: 5,
        channelLabel: true
      },
      {
        id: 'officerChannelIds',
        t: 'tag',
        label: 'Officer Channels',
        hint: 'Where officers manage the bridge (max 5).',
        placeholder: 'Channel ID\u2026',
        max: 5,
        channelLabel: true
      },
      {
        id: 'loggerChannelIds',
        t: 'tag',
        label: 'Logger Channels',
        hint: 'Audit log destinations (max 5).',
        placeholder: 'Channel ID\u2026',
        max: 5,
        channelLabel: true
      },
      {
        id: 'promoteChannelIds',
        t: 'tag',
        label: 'Promote Channels',
        hint: 'Where Promote/Demote events are forwarded (max 5).',
        placeholder: 'Channel ID\u2026',
        max: 5,
        channelLabel: true
      },
      {
        id: 'chatSummaryEnabled',
        t: 'boolean',
        label: 'Enable Daily Chat Summary',
        hint: 'Summarize public guild chat at the end of every day using AI.'
      },
      {
        id: 'chatSummaryChannelIds',
        t: 'tag',
        label: 'Chat Summary Channels',
        hint: 'Where daily AI summaries are posted (max 5).',
        placeholder: 'Channel ID\u2026',
        max: 5,
        channelLabel: true
      }
    ]
  },
  {
    key: 'instances',
    name: 'Minecraft Instances',
    icon: '\u26CF',
    description: 'Minecraft bot instances this bridge should connect to.',
    fields: [
      {
        id: 'minecraftInstances',
        t: 'tag',
        label: 'Instance Names',
        hint: 'Names of Minecraft instances from config.yaml (max 10).',
        placeholder: 'instance-name\u2026',
        max: 10
      }
    ]
  },
  {
    key: 'staffRoles',
    name: 'Staff Roles',
    icon: '\u2605',
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
              'Manage user links \u2014 /verification, /accept, /blacklist',
              'View guild activity logs \u2014 /log',
              'Invite / join guild \u2014 /invite, /join',
              'Punishments \u2014 mute, check, list',
              'GEXP threshold checking \u2014 /gexp-check',
              'Connect / disconnect Minecraft \u2014 /disconnect, /reconnect',
              'Toggle chat commands \u2014 !toggle',
              'Web dashboard & profanity mgmt \u2014 /dashboard, /profanity',
              'Cross-bridge chat moderation \u2014 !qmute, !qunmute, !qmuted',
              'Persistent leaderboard \u2014 /create-leaderboard'
            ],
            missing: [
              'Destructive punishments (Owner) \u2014 ban, kick, forgive',
              'Rank management (Owner) \u2014 /demote, /promote, /setrank',
              'Raw command execution (Owner) \u2014 /execute',
              'Bridge restart & raw in-game exec (Admin) \u2014 /restart, !execute'
            ]
          },
          {
            name: 'Owner',
            badge: 'warning',
            note: 'Includes all Helper commands.',
            grants: [
              'Destructive punishments \u2014 ban, kick, forgive',
              'Rank management \u2014 /demote, /promote, /setrank',
              'Raw command execution \u2014 /execute'
            ],
            missing: ['Bridge restart & raw in-game exec (Admin only) \u2014 /restart, !execute']
          },
          {
            name: 'Admin',
            badge: 'danger',
            note: 'Service administrator. Set in config.yaml.',
            grants: [
              'Bridge restart \u2014 /restart',
              'Raw in-game command execution \u2014 !execute',
              'Full command manager \u2014 rename, enable/disable any command'
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
        placeholder: 'Search roles\u2026',
        max: 5,
        roleLabel: true
      },
      {
        id: 'ownerRoleIds',
        t: 'tag',
        label: 'Owner Roles',
        hint: 'Full administrative access (max 5).',
        placeholder: 'Search roles\u2026',
        max: 5,
        roleLabel: true,
        warning: true
      }
    ]
  },
  {
    key: 'discordSettings',
    name: 'Discord Settings',
    icon: '\u2699',
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
    icon: '\u2726',
    description: 'Online/offline tracking and randomized chatter for the Minecraft side.',
    fields: [
      { id: 'memberOnline', t: 'boolean', label: 'Member Online', hint: 'Announce when a guild member comes online.' },
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
        collapsible: true,
        title: 'When NOT Persisted',
        condition: (data) => !bool(data.persistOnlineOffline),
        children: [
          {
            id: 'deleteAfterSeconds',
            t: 'number',
            label: 'Delete After (seconds)',
            hint: '1\u201343200',
            min: 1,
            max: 43_200
          },
          { id: 'maxEvents', t: 'number', label: 'Max Events', hint: '1\u20131000', min: 1, max: 1000 }
        ]
      },
      {
        t: 'section',
        collapsible: true,
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
            hint: 'Avoid repeating a recent message within N chars (0\u201350).',
            min: 0,
            max: 50
          },
          {
            id: 'chatterQuietWindowMinutes',
            t: 'number',
            label: 'Quiet Window (minutes)',
            hint: 'Pause chatter shortly after real chat activity (0\u201360).',
            min: 0,
            max: 60
          }
        ]
      }
    ]
  },
  {
    key: 'qualityOfLife',
    name: 'Quality of Life',
    icon: '\u273F',
    description: 'Reactions, mute announcements, and other niceties.',
    fields: [
      {
        t: 'section',
        collapsible: true,
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
              { label: '\U0001f44d Thumbs Up', value: 'thumbsup' },
              { label: '\U0001f44e Thumbs Down', value: 'thumbsdown' }
            ],
            allowEmpty: true
          },
          {
            id: 'leaveDiscordReaction',
            t: 'preset',
            label: 'Leave Discord Reaction',
            options: [
              { label: '\U0001f44d Thumbs Up', value: 'thumbsup' },
              { label: '\U0001f44e Thumbs Down', value: 'thumbsdown' }
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
    key: 'translations',
    name: 'Translations',
    icon: '\U0001f310',
    description: 'Override any bot message per-bridge.',
    fields: [
      {
        t: 'section',
        title: 'Commands (insults, praise, errors)',
        collapsible: true,
        children: [
          {
            id: 'commands.praise',
            t: 'msglist',
            label: 'Praise Messages',
            hint: '22 random praise messages the bot says.'
          },
          {
            id: 'commands.insult',
            t: 'msglist',
            label: 'Insult Messages (custom)',
            hint: '23 custom insult messages.'
          },
          {
            id: 'commands.insult.normal',
            t: 'msglist',
            label: 'Insult Messages (normal)',
            hint: '58 normal insult messages.'
          },
          {
            id: 'commands.explain',
            t: 'textarea',
            label: 'Explain Command',
            hint: 'What the bot says when asked !explain.'
          },
          { id: 'commands.error.must-be-ingame', t: 'text', label: 'Error: Must be in-game' },
          { id: 'commands.error.must-be-admin', t: 'text', label: 'Error: Must be admin' },
          { id: 'commands.error.username-not-exists', t: 'text', label: 'Error: Username not found' },
          { id: 'commands.error.never-joined-hypixel', t: 'text', label: 'Error: Never joined Hypixel' },
          { id: 'commands.error.never-joined-skyblock', t: 'text', label: 'Error: Never joined Skyblock' },
          { id: 'commands.urchin.no-key', t: 'text', label: 'Urchin: No API key' },
          { id: 'commands.urchin.no-tags', t: 'text', label: 'Urchin: No tags' },
          { id: 'commands.urchin.tags', t: 'text', label: 'Urchin: Tags result' },
          { id: 'commands.urchin.not-found', t: 'text', label: 'Urchin: Not found' },
          { id: 'commands.urchin.invalid-key', t: 'text', label: 'Urchin: Invalid key' },
          { id: 'commands.urchin.error', t: 'text', label: 'Urchin: Error' },
          { id: 'commands.sessions.no-key', t: 'text', label: 'Sessions: No API key' },
          { id: 'commands.sessions.game-not-found', t: 'text', label: 'Sessions: Game not found' },
          { id: 'commands.sessions.no-changes', t: 'text', label: 'Sessions: No changes' },
          { id: 'commands.sessions.result', t: 'textarea', label: 'Sessions: Result' },
          { id: 'commands.sessions.not-found', t: 'text', label: 'Sessions: Not found' },
          { id: 'commands.sessions.invalid-key', t: 'text', label: 'Sessions: Invalid key' },
          { id: 'commands.sessions.api-degraded', t: 'text', label: 'Sessions: API degraded' },
          { id: 'commands.sessions.api-ok-but-error', t: 'text', label: 'Sessions: API returned error' },
          { id: 'commands.sessions.api-down', t: 'text', label: 'Sessions: API down' }
        ]
      },
      {
        t: 'section',
        title: 'Discord Messages',
        collapsible: true,
        children: [
          { id: 'discord.status.chat-interrupted', t: 'text', label: 'Chat Interrupted' },
          { id: 'discord.status.chat-resumed', t: 'text', label: 'Chat Resumed' },
          { id: 'discord.status.chat-failed', t: 'text', label: 'Chat Failed' },
          { id: 'discord.status.chat-notice', t: 'text', label: 'Chat Notice' },
          { id: 'discord.status.requires-authentication', t: 'text', label: 'Requires Authentication' },
          { id: 'discord.status.instance-started', t: 'text', label: 'Instance Started' },
          { id: 'discord.message.no-permission', t: 'text', label: 'No Permission' },
          { id: 'discord.message.no-permission-roles', t: 'textarea', label: 'No Permission (Roles)' },
          { id: 'discord.message.no-permission-admin', t: 'textarea', label: 'No Permission (Admin)' },
          { id: 'discord.message.no-permission-roles-admin', t: 'textarea', label: 'No Permission (Roles Admin)' }
        ]
      },
      {
        t: 'section',
        title: 'Discord Commands (/settings, /commands)',
        collapsible: true,
        children: [
          { id: 'discord.commands.settings.essential', t: 'text', label: 'Settings: Essential' },
          { id: 'discord.commands.settings.recommended', t: 'text', label: 'Settings: Recommended' },
          { id: 'discord.commands.settings.warning', t: 'text', label: 'Settings: Warning' },
          { id: 'discord.commands.settings.header', t: 'textarea', label: 'Settings: Header' },
          { id: 'discord.commands.settings.header1', t: 'text', label: 'Settings: Header 1' },
          { id: 'discord.commands.settings.header2', t: 'text', label: 'Settings: Header 2' },
          { id: 'discord.commands.settings.header3', t: 'text', label: 'Settings: Header 3' },
          { id: 'discord.commands.settings.faq', t: 'text', label: 'Settings: FAQ' },
          { id: 'discord.commands.settings.main.title', t: 'text', label: 'Settings: Main title' },
          { id: 'discord.commands.settings.main.description', t: 'textarea', label: 'Settings: Main description' },
          { id: 'discord.commands.commands.title', t: 'text', label: 'Commands: Title' },
          { id: 'discord.commands.commands.description', t: 'textarea', label: 'Commands: Description' },
          { id: 'discord.commands.commands.stats.discord', t: 'text', label: 'Commands: Discord stats' },
          { id: 'discord.commands.commands.stats.minecraft', t: 'text', label: 'Commands: Minecraft stats' },
          { id: 'discord.commands.commands.stats.commands', t: 'text', label: 'Commands: Command stats' },
          { id: 'discord.commands.commands.tabs.discord', t: 'text', label: 'Commands: Discord tab' },
          { id: 'discord.commands.commands.tabs.minecraft', t: 'text', label: 'Commands: Minecraft tab' },
          { id: 'discord.commands.commands.actions.search', t: 'text', label: 'Commands: Search action' },
          { id: 'discord.commands.commands.actions.categories', t: 'text', label: 'Commands: Categories action' },
          { id: 'discord.commands.commands.actions.details', t: 'text', label: 'Commands: Details action' },
          { id: 'discord.commands.commands.actions.back-to-list', t: 'text', label: 'Commands: Back to list' },
          { id: 'discord.commands.commands.actions.clear-search', t: 'text', label: 'Commands: Clear search' },
          { id: 'discord.commands.commands.actions.clear-category', t: 'text', label: 'Commands: Clear category' },
          { id: 'discord.commands.commands.filters.search', t: 'text', label: 'Commands: Search filter' },
          { id: 'discord.commands.commands.filters.category', t: 'text', label: 'Commands: Category filter' },
          { id: 'discord.commands.commands.no-results', t: 'text', label: 'Commands: No results' },
          {
            id: 'discord.commands.commands.try-different-filters',
            t: 'text',
            label: 'Commands: Try different filters'
          },
          { id: 'discord.commands.commands.no-categories', t: 'text', label: 'Commands: No categories' },
          { id: 'discord.commands.commands.command-not-found', t: 'text', label: 'Commands: Command not found' },
          { id: 'discord.commands.commands.pagination.info', t: 'text', label: 'Commands: Pagination info' },
          { id: 'discord.commands.commands.pagination.display', t: 'textarea', label: 'Commands: Pagination display' },
          { id: 'discord.commands.commands.pagination.previous', t: 'text', label: 'Commands: Previous page' },
          { id: 'discord.commands.commands.pagination.next', t: 'text', label: 'Commands: Next page' },
          { id: 'discord.commands.commands.search.title', t: 'text', label: 'Commands: Search title' },
          { id: 'discord.commands.commands.search.label', t: 'text', label: 'Commands: Search label' },
          { id: 'discord.commands.commands.categories.title', t: 'text', label: 'Commands: Categories title' },
          {
            id: 'discord.commands.commands.categories.description',
            t: 'text',
            label: 'Commands: Categories description'
          },
          { id: 'discord.commands.commands.categories.select', t: 'text', label: 'Commands: Category select' },
          { id: 'discord.commands.commands.details.category', t: 'text', label: 'Commands: Details category' },
          { id: 'discord.commands.commands.details.aliases', t: 'text', label: 'Commands: Details aliases' },
          { id: 'discord.commands.commands.details.permission', t: 'text', label: 'Commands: Details permission' },
          { id: 'discord.commands.commands.details.status', t: 'text', label: 'Commands: Details status' },
          { id: 'discord.commands.commands.details.enabled', t: 'text', label: 'Commands: Details enabled' },
          { id: 'discord.commands.commands.details.disabled', t: 'text', label: 'Commands: Details disabled' },
          { id: 'discord.commands.commands.details.custom-name', t: 'text', label: 'Commands: Details custom name' },
          { id: 'discord.commands.commands.admin.title', t: 'text', label: 'Commands: Admin title' },
          { id: 'discord.commands.commands.admin.description', t: 'textarea', label: 'Commands: Admin description' },
          { id: 'discord.commands.commands.admin.rename.button', t: 'text', label: 'Commands: Rename button' },
          {
            id: 'discord.commands.commands.admin.rename.modal.title',
            t: 'text',
            label: 'Commands: Rename modal title'
          },
          {
            id: 'discord.commands.commands.admin.rename.modal.label',
            t: 'text',
            label: 'Commands: Rename modal label'
          },
          {
            id: 'discord.commands.commands.admin.rename.modal.placeholder',
            t: 'text',
            label: 'Commands: Rename modal placeholder'
          },
          { id: 'discord.commands.commands.admin.rename.modal.success', t: 'text', label: 'Commands: Rename success' },
          {
            id: 'discord.commands.commands.admin.rename.modal.error.empty',
            t: 'text',
            label: 'Commands: Rename error empty'
          },
          {
            id: 'discord.commands.commands.admin.rename.modal.error.invalid',
            t: 'text',
            label: 'Commands: Rename error invalid'
          },
          {
            id: 'discord.commands.commands.admin.rename.modal.error.duplicate',
            t: 'text',
            label: 'Commands: Rename error duplicate'
          },
          {
            id: 'discord.commands.commands.admin.rename.modal.error.protected',
            t: 'text',
            label: 'Commands: Rename error protected'
          },
          { id: 'discord.commands.commands.admin.toggle.enable', t: 'text', label: 'Commands: Toggle enable' },
          { id: 'discord.commands.commands.admin.toggle.disable', t: 'text', label: 'Commands: Toggle disable' },
          { id: 'discord.commands.commands.admin.toggle.success', t: 'text', label: 'Commands: Toggle success' },
          {
            id: 'discord.commands.commands.admin.toggle.error.protected',
            t: 'text',
            label: 'Commands: Toggle error protected'
          },
          { id: 'discord.commands.commands.admin.audit.title', t: 'text', label: 'Commands: Audit title' },
          { id: 'discord.commands.commands.admin.audit.empty', t: 'text', label: 'Commands: Audit empty' },
          {
            id: 'discord.commands.commands.admin.audit.entry.rename',
            t: 'text',
            label: 'Commands: Audit rename entry'
          },
          {
            id: 'discord.commands.commands.admin.audit.entry.enable',
            t: 'text',
            label: 'Commands: Audit enable entry'
          },
          {
            id: 'discord.commands.commands.admin.audit.entry.disable',
            t: 'text',
            label: 'Commands: Audit disable entry'
          },
          {
            id: 'discord.commands.commands.admin.audit.entry.restore',
            t: 'text',
            label: 'Commands: Audit restore entry'
          },
          { id: 'discord.commands.commands.admin.audit.timestamp', t: 'text', label: 'Commands: Audit timestamp' },
          { id: 'discord.commands.commands.admin.audit.by', t: 'text', label: 'Commands: Audit by' },
          {
            id: 'discord.commands.commands.admin.confirm.disable.title',
            t: 'text',
            label: 'Commands: Confirm disable title'
          },
          {
            id: 'discord.commands.commands.admin.confirm.disable.message',
            t: 'textarea',
            label: 'Commands: Confirm disable message'
          },
          {
            id: 'discord.commands.commands.admin.confirm.disable.confirm',
            t: 'text',
            label: 'Commands: Confirm disable confirm'
          },
          {
            id: 'discord.commands.commands.admin.confirm.disable.cancel',
            t: 'text',
            label: 'Commands: Confirm disable cancel'
          }
        ]
      },
      {
        t: 'section',
        title: 'Instance Messages (disconnect, auth, errors)',
        collapsible: true,
        children: [
          { id: 'instance.message.authentication-code', t: 'text', label: 'Auth Code' },
          { id: 'instance.message.authentication-code-expired', t: 'text', label: 'Auth Code Expired' },
          { id: 'instance.message.no-autoconnect', t: 'textarea', label: 'No Auto-connect' },
          { id: 'instance.message.minecraft-kicked', t: 'text', label: 'Minecraft Kicked' },
          { id: 'instance.message.minecraft-banned', t: 'text', label: 'Minecraft Banned' },
          { id: 'instance.message.internet-problems', t: 'text', label: 'Internet Problems' },
          { id: 'instance.message.failed-too-many-times', t: 'text', label: 'Failed Too Many Times' },
          { id: 'instance.message.minecraft-ended', t: 'text', label: 'Minecraft Ended' },
          { id: 'instance.message.version-incompatible', t: 'text', label: 'Version Incompatible' },
          { id: 'instance.message.logged-from-another-location', t: 'text', label: 'Logged From Another Location' },
          { id: 'instance.message.xbox-down', t: 'text', label: 'Xbox Down' },
          { id: 'instance.message.xbox-throttled', t: 'text', label: 'Xbox Throttled' },
          { id: 'instance.message.no-account', t: 'textarea', label: 'No Account' },
          { id: 'instance.message.proxy-problem', t: 'text', label: 'Proxy Problem' },
          { id: 'instance.message.restarting', t: 'text', label: 'Restarting' },
          { id: 'instance.message.guild-kicked', t: 'text', label: 'Guild Kicked' },
          { id: 'instance.message.auth-expired', t: 'textarea', label: 'Auth Expired' },
          { id: 'instance.message.auth-invalid', t: 'textarea', label: 'Auth Invalid' },
          { id: 'instance.status.change', t: 'text', label: 'Status Change' },
          { id: 'instance.status.fresh', t: 'text', label: 'Status Fresh' },
          { id: 'instance.status.connecting', t: 'text', label: 'Status Connecting' },
          { id: 'instance.status.connected', t: 'text', label: 'Status Connected' },
          { id: 'instance.status.disconnected', t: 'text', label: 'Status Disconnected' },
          { id: 'instance.status.ended', t: 'text', label: 'Status Ended' },
          { id: 'instance.status.failed', t: 'text', label: 'Status Failed' }
        ]
      },
      {
        t: 'section',
        title: 'Game Messages',
        collapsible: true,
        children: [
          {
            id: 'instance.reaction.join',
            t: 'msglist',
            label: 'Join Reactions',
            hint: 'Random messages when someone joins the guild.'
          },
          {
            id: 'instance.reaction.leave',
            t: 'msglist',
            label: 'Leave Reactions',
            hint: 'Random messages when someone leaves the guild.'
          },
          {
            id: 'instance.reaction.kick',
            t: 'msglist',
            label: 'Kick Reactions',
            hint: 'Random messages when someone is kicked from the guild.'
          },
          {
            id: 'instance.player.announceMuted',
            t: 'text',
            label: 'Muted Player Announcement',
            hint: 'Said when a muted player tries to chat.'
          },
          {
            id: 'instance.repeat.messages',
            t: 'msglist',
            label: 'Repeat Block Messages',
            hint: 'Random messages when Hypixel blocks a repeated message.'
          },
          {
            id: 'instance.reaction.block',
            t: 'text',
            label: 'Blocked Message Notice',
            hint: 'Said when Hypixel blocks a message.'
          },
          {
            id: 'instance.reaction.advertise',
            t: 'text',
            label: 'Advertising Notice',
            hint: 'Said when Hypixel blocks an ad.'
          },
          {
            id: 'instance.reaction.guild-kicked',
            t: 'text',
            label: 'Guild Kicked Notice',
            hint: 'Said when the bot is kicked from the guild.'
          },
          {
            id: 'instance.reaction.guild-muted',
            t: 'textarea',
            label: 'Guild Muted Template',
            hint: 'Variables: {{duration}}, {{responsible}}'
          },
          {
            id: 'instance.reaction.guild-unmuted',
            t: 'text',
            label: 'Guild Unmuted Notice',
            hint: 'Said when the bot is unmuted.'
          },
          {
            id: 'instance.reaction.muted',
            t: 'textarea',
            label: 'Mute Warning Template',
            hint: 'Said when bot tries to chat while muted. Variable: {{hypixelMessage}}'
          },
          {
            id: 'instance.reaction.guild-muted-status',
            t: 'textarea',
            label: 'Guild Muted Status Template',
            hint: 'Said when bot checks mute status. Variable: {{duration}}'
          }
        ]
      }
    ]
  },
  {
    key: 'moderation',
    name: 'Moderation',
    icon: '\u26A0',
    description: 'Heat-based punishments, immune users, and the profanity filter.',
    fields: [
      {
        t: 'section',
        collapsible: true,
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
        collapsible: true,
        title: 'Immunity List',
        children: [
          {
            id: 'immuneDiscordUserIds',
            t: 'tag',
            label: 'Immune Discord Users',
            hint: 'User IDs exempt from moderation.',
            placeholder: 'User ID\u2026',
            max: 100,
            channelLabel: true
          },
          {
            id: 'immuneMojangPlayers',
            t: 'tag',
            label: 'Immune Mojang Players',
            hint: 'Player UUIDs exempt from moderation.',
            placeholder: 'Player UUID\u2026',
            max: 100
          }
        ]
      },
      {
        t: 'section',
        collapsible: true,
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
            icon: '\u270E'
          }
        ]
      }
    ]
  },
  {
    key: 'chatCommands',
    name: 'Chat Commands',
    icon: '\u2318',
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
        hint: '0\u20132 characters. Empty falls back to global.',
        max: 2
      },
      {
        id: 'passthroughPrefix',
        t: 'text',
        label: 'Passthrough Prefix',
        hint: '0\u20132 characters. Empty means no passthrough.',
        max: 2
      },
      {
        id: 'passthroughCommands',
        t: 'tag',
        label: 'Passthrough Commands',
        hint: 'Commands forwarded verbatim (max 20).',
        placeholder: 'command\u2026',
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
    icon: '\u2191',
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
        placeholder: 'Channel ID\u2026',
        hint: 'Discord channel IDs to send notifications to'
      },
      { t: 'promotionRules', id: 'promotionRules' },
      { t: 'demotionRules', id: 'demotionRules' },
      {
        t: 'tag',
        id: 'excludedRanks',
        label: 'Excluded Ranks',
        placeholder: 'Rank name\u2026',
        hint: 'Ranks that should not be affected by automation'
      },
      {
        t: 'tag',
        id: 'excludedPlayers',
        label: 'Excluded Players',
        placeholder: 'Player UUID\u2026',
        hint: 'Players that should not be affected by automation'
      }
    ]
  },
  {
    key: 'tournament',
    name: 'Tournaments',
    icon: '🏆',
    description: 'Tournament system defaults and Discord integration.',
    fields: [
      {
        id: 'enabled',
        t: 'boolean',
        label: 'Enable Tournament System',
        hint: 'Master toggle for the tournament module on this bridge.'
      },
      {
        t: 'section',
        title: 'Discord Integration',
        collapsible: true,
        children: [
          {
            id: 'notificationChannelId',
            t: 'text',
            label: 'Notification Channel',
            hint: 'Channel ID where tournament announcements are posted.',
            placeholder: 'Channel ID\u2026',
            max: 32
          },
          {
            id: 'categoryId',
            t: 'text',
            label: 'Tournament Category',
            hint: 'Discord category ID where tournament channels/threads are created.',
            placeholder: 'Category ID\u2026',
            max: 32
          },
          {
            id: 'announceMc',
            t: 'boolean',
            label: 'Announce in Minecraft',
            hint: 'Send tournament whispers/announcements in-game via the bot.'
          }
        ]
      },
      {
        t: 'section',
        title: 'Match Defaults',
        collapsible: true,
        children: [
          {
            id: 'defaultBestOf',
            t: 'number',
            label: 'Default Best-of',
            hint: 'Default series length for new tournaments (1\u20139).',
            min: 1,
            max: 9
          },
          {
            id: 'defaultDeadlineHours',
            t: 'number',
            label: 'Default Round Deadline (hours)',
            hint: 'Time limit per match before auto-resolution (1\u2013720).',
            min: 1,
            max: 720
          },
          {
            id: 'maxExtensionHours',
            t: 'number',
            label: 'Max Extension (hours)',
            hint: 'Maximum total deadline extension allowed per match (0\u2013168).',
            min: 0,
            max: 168
          }
        ]
      },
      {
        t: 'section',
        title: 'Check-in & Participation',
        collapsible: true,
        children: [
          {
            id: 'checkinWindowMinutes',
            t: 'number',
            label: 'Check-in Window (minutes)',
            hint: 'How long check-in stays open before the scheduled start (0\u20131440).',
            min: 0,
            max: 1440
          },
          {
            id: 'autoCheckin',
            t: 'boolean',
            label: 'Auto Check-in',
            hint: 'Automatically check in players who join during the open window.'
          },
          {
            id: 'minParticipants',
            t: 'number',
            label: 'Minimum Participants',
            hint: 'Lowest signup count required to start (2\u2013128).',
            min: 2,
            max: 128
          },
          {
            id: 'bracketFormat',
            t: 'preset',
            label: 'Default Bracket Format',
            hint: 'Bracket style pre-selected when creating a tournament from the dashboard.',
            options: [
              { label: 'Single Elimination', value: 'single-elim' },
              { label: 'Double Elimination', value: 'double-elim' },
              { label: 'Round Robin', value: 'round-robin' }
            ],
            allowEmpty: true
          },
          {
            id: 'validGameTypes',
            t: 'tag',
            label: 'Valid Game Types',
            hint: 'Whitelist of allowed game types (e.g. Bedwars, Skywars). Empty = any free-text entry (max 20).',
            placeholder: 'Game type\u2026',
            max: 20
          }
        ]
      },
      {
        t: 'link',
        label: 'Open Tournament Dashboard',
        description: 'Create tournaments, manage brackets, confirm scores, and view audit logs.',
        href: 'tournament.html',
        icon: '🏆'
      }
    ]
  },
  {
    key: 'dangerZone',
    name: 'Danger Zone',
    icon: '\u2620',
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
  const element = document.querySelector('#ws-status')
  if (!element) return
  element.classList.remove('connecting', 'disconnected')
  if (state === 'connecting') element.classList.add('connecting')
  else if (state === 'disconnected') element.classList.add('disconnected')
  const text = element.querySelector('.ws-status-text')
  if (text && label) text.textContent = label
}

function rebuildChannelNameMap(payload) {
  channelNameMap.clear()
  const list = payload?.channels
  if (Array.isArray(list)) {
    for (const c of list) {
      if (c?.id != undefined && c.name) channelNameMap.set(String(c.id), c.name)
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
      if (r?.id != undefined && r.name) roleNameMap.set(String(r.id), r.name)
    }
  }
}

function categoryData(catKey) {
  const cats = rawData?.categories || {}
  return cats[catKey] || {}
}

function fieldValue(data, field) {
  if (currentCategory === 'translations') {
    const override = rawData.translationOverrides ? rawData.translationOverrides[field.id] : undefined
    const raw =
      override === undefined
        ? rawData.translationDefaults
          ? rawData.translationDefaults[field.id]
          : undefined
        : override
    if (raw === undefined) return ''
    if (field.t === 'msglist') {
      try {
        return JSON.parse(raw)
      } catch {}
      return []
    }
    if (field.t === 'boolean') return raw === 'true' || raw === '1'
    if (field.t === 'number') return number_(raw)
    return raw
  }
  if (field.t === 'tag' || field.t === 'msglist') return array(data[field.id])
  if (field.t === 'boolean') return bool(data[field.id])
  if (field.t === 'number') return number_(data[field.id])
  if (field.t === 'text' || field.t === 'preset') return string_(data[field.id], field.allowEmpty ? '' : '')
  return data[field.id]
}

// ---- Sidebar --------------------------------------------------------------

function closeSidebar() {
  const sidebar = document.querySelector('#settings-sidebar')
  const overlay = document.querySelector('#settings-sidebar-overlay')
  if (sidebar) sidebar.classList.remove('open')
  if (overlay) overlay.classList.remove('open')
}

function toggleSidebar() {
  const sidebar = document.querySelector('#settings-sidebar')
  const overlay = document.querySelector('#settings-sidebar-overlay')
  if (!sidebar) return
  const isOpen = sidebar.classList.toggle('open')
  if (overlay) overlay.classList.toggle('open', isOpen)
}

function renderSidebar() {
  const host = document.querySelector('#settings-nav')
  if (!host) return
  host.innerHTML = ''
  for (const cat of CATEGORIES) {
    const li = document.createElement('li')
    li.className = 'settings-nav-item' + (cat.danger ? ' danger' : '') + (currentCategory === cat.key ? ' active' : '')
    li.dataset.cat = cat.key
    li.innerHTML = `<span class="settings-nav-icon">${esc(cat.icon)}</span><span>${esc(cat.name)}</span>`
    li.addEventListener('click', () => {
      selectCategory(cat.key)
      closeSidebar()
    })
    host.append(li)
  }
}

// ---- Panel: per-field renderers ------------------------------------------

function fieldRowHTML(field, value, data) {
  const id = field.id
  const hint = field.hint ? `<span class="settings-row-hint">${esc(field.hint)}</span>` : ''
  const warning = field.warning ? ` <span class="badge badge-warning" title="High privilege">\u26A0</span>` : ''
  const labelHTML = `<span class="settings-row-name">${esc(field.label)}${warning}</span>${hint}`

  let control = ''
  switch (field.t) {
    case 'boolean': {
      control = `<label class="toggle"><input type="checkbox" data-field="${esc(id)}"${value ? ' checked' : ''} /><span class="toggle-slider"></span></label>`
      break
    }
    case 'number': {
      control = `<input type="number" class="input" data-field="${esc(id)}" value="${esc(value)}"${field.min == undefined ? '' : ` min="${field.min}"`}${field.max == undefined ? '' : ` max="${field.max}"`} />`
      break
    }
    case 'text': {
      control = `<input type="text" class="input" data-field="${esc(id)}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}"${field.max ? ` maxlength="${field.max}"` : ''} />`
      break
    }
    case 'preset': {
      const options = collectPresetOptions(field)
      const optionsHtml =
        (field.allowEmpty ? '<option value="">(default)</option>' : '') +
        options
          .map((o) => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('')
      control = `<select class="select" data-field="${esc(id)}">${optionsHtml}</select>`
      break
    }
    case 'tag': {
      control = `<div data-tag-host="${esc(id)}"></div>`
      break
    }
    case 'textarea': {
      control = `<textarea class="input textarea" data-field="${esc(id)}" rows="3">${esc(value)}</textarea>`
      break
    }
    case 'msglist': {
      control = `<div data-msglist-host="${esc(id)}"></div>`
      break
    }
    case 'link': {
      control = ''
      break
    }
    case 'danger': {
      control = `<button class="btn btn-danger btn-sm" data-danger="${esc(id)}">${esc(field.buttonText || 'Delete')}</button>`
      break
    }
    default: {
      control = `<input type="text" class="input" data-field="${esc(id)}" value="${esc(value)}" />`
    }
  }

  if (field.t === 'link' || field.t === 'danger') return ''
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
  const content = `<div class="settings-subsection">${inner}</div>`
  if (section.collapsible) {
    return `<div class="settings-collapsible">
        <div class="settings-collapsible-header" data-collapse-target>
          <span class="settings-collapsible-arrow">\u25B6</span>
          <span>${esc(section.title)}</span>
        </div>
        <div class="settings-collapsible-body" style="display:none">${content}</div>
      </div>`
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
        <span class="settings-link-card-icon">${esc(field.icon || '\u2197')}</span>
        <span class="settings-link-card-body">
          <span class="settings-link-card-title">${esc(field.label)}</span>
          <span class="settings-link-card-desc">${esc(field.description || '')}</span>
        </span>
      </a>`
  }
  return `<div class="settings-link-card" style="cursor: default; opacity: 0.7;">
      <span class="settings-link-card-icon">${esc(field.icon || '\u2197')}</span>
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
        <span class="perm-tier-arrow">\u25B6</span>
        <span class="badge badge-${tier.badge}">${esc(tier.name)}</span>
        <span class="perm-tier-note">${esc(tier.note)}</span>
      </div>
      <div class="perm-tier-body hidden" data-perm-body="${esc(tier.name)}">
        ${grantsHtml ? `<div class="perm-list-title perm-grants-title">Grants access to:</div>\n        <div class="perm-list">${grantsHtml}</div>` : ''}
        ${missingHtml ? `<div class="perm-list-title perm-missing-title">Does NOT grant:</div>\n        <div class="perm-list">${missingHtml}</div>` : ''}
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
    const options = allRanks
      .map((rk) => `<option value="${esc(rk)}"${rk === value ? ' selected' : ''}>${esc(rk)}</option>`)
      .join('')
    return `<select class="input rank-select" data-rank="${id}">${options}</select>`
  }
  return `<input class="input rank-input" data-rank="${id}" value="${esc(value || '')}" placeholder="Rank name" />`
}

function promotionRowHTML(rule) {
  const r = rule || {}
  return `<tr>
      <td>${rankSelectHTML(r.targetRank || '')}</td>
      <td><input type="number" class="input" data-field="minWeeklyGexp" min="0" value="${number_(r.minWeeklyGexp)}" /></td>
      <td><input type="number" class="input" data-field="minDaysInGuild" min="0" value="${number_(r.minDaysInGuild)}" /></td>
      <td><input type="number" class="input" data-field="minOnlineHours" min="0" value="${number_(r.minOnlineHours)}" /></td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" title="Remove">\u2715</button></td>
    </tr>`
}

function demotionRowHTML(rule) {
  const r = rule || {}
  const action = r.action || 'notify'
  const options = ['demote', 'kick', 'notify']
    .map((a) => `<option value="${a}"${a === action ? ' selected' : ''}>${a}</option>`)
    .join('')
  return `<tr>
      <td>${rankSelectHTML(r.fromRank || '')}</td>
      <td><select class="input" data-field="action">${options}</select></td>
      <td>${rankSelectHTML(r.targetRank || '')}</td>
      <td><input type="number" class="input" data-field="maxWeeklyGexp" min="0" value="${number_(r.maxWeeklyGexp)}" /></td>
      <td><input type="number" class="input" data-field="gracePeriod" min="0" value="${number_(r.gracePeriod)}" /></td>
      <td><input type="number" class="input" data-field="maxDaysInactive" min="0" value="${number_(r.maxDaysInactive)}" /></td>
      <td><button class="btn btn-danger btn-sm" data-action="delete" title="Remove">\u2715</button></td>
    </tr>`
}

function placeholderRow(cols, message) {
  return `<tr data-placeholder><td colspan="${cols}" class="text-center text-muted text-sm">${esc(message)}</td></tr>`
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
      const element = tr.querySelector(`[data-field="${f}"]`)
      return element ? element.value : ''
    }
    const rankSel = tr.querySelector('[data-rank]')
    const targetRank = rankSel ? rankSel.value : ''
    return {
      targetRank,
      minWeeklyGexp: number_(get('minWeeklyGexp')),
      minDaysInGuild: number_(get('minDaysInGuild')),
      minOnlineHours: number_(get('minOnlineHours'))
    }
  })
}

function readDemotionRows() {
  const tbody = document.querySelector('#demo-tbody')
  if (!tbody) return []
  const rows = [...tbody.querySelectorAll('tr:not([data-placeholder])')]
  return rows.map((tr) => {
    const get = (f) => {
      const element = tr.querySelector(`[data-field="${f}"]`)
      return element ? element.value : ''
    }
    const rankSels = tr.querySelectorAll('[data-rank]')
    const fromRank = rankSels[0] ? rankSels[0].value : ''
    const action = get('action') || 'notify'
    const targetRank = rankSels[1] ? rankSels[1].value : ''
    const rule = {
      fromRank,
      action,
      targetRank: action === 'demote' ? targetRank : undefined,
      maxWeeklyGexp: number_(get('maxWeeklyGexp')),
      gracePeriod: number_(get('gracePeriod')),
      maxDaysInactive: number_(get('maxDaysInactive')) || undefined
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

  mountDynamicControls(cat, data)
  if (cat.key === 'dangerZone') {
    const button = panel.querySelector('[data-danger="deleteBridge"]')
    if (button) button.addEventListener('click', onDeleteBridge)
  }
  if (cat.key === 'rankup') applyDemotionTargetStates()
  savedSnapshot =
    cat.key === 'translations' ? serializeCategory(cat, readCategoryState(cat)) : serializeCategory(cat, data)
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
        if (f.roleLabel) labelFor = (id) => roleNameMap.get(String(id))
        else if (f.channelLabel) labelFor = (id) => channelNameMap.get(String(id))
        const suggestions = f.roleLabel
          ? [...roleNameMap.entries()].map(([id, name]) => ({ label: name, value: id }))
          : undefined
        const tag = createTagInput(
          array(data[f.id]),
          f.placeholder || '\u2026',
          markDirty,
          labelFor,
          f.max,
          suggestions
        )
        host.append(tag.el)
        tagInputRegistry.set(f.id, tag)
      } else if (f.t === 'msglist') {
        const host = panel.querySelector(`[data-msglist-host="${cssEscape(f.id)}"]`)
        if (!host) continue
        mountMessageList(host, f, array(fieldValue(data, f)))
      }
    }
  }
  walk(cat.fields)
}

function cssEscape(value) {
  return String(value).replaceAll('"', String.raw`\"`)
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
    if (filtered.length > 0 || (field.value.trim() && filtered.length === 0)) suggestBox.classList.add('open')
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
    for (const [index, element] of filtered.entries()) {
      const item = document.createElement('div')
      item.className = 'tag-input-suggest-item'
      if (index === highlightedIndex) item.classList.add('highlighted')
      item.textContent = element.label
      item.dataset.value = element.value
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        addTag(element.value)
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
      const labelElement = document.createElement('span')
      labelElement.textContent = labelFor ? labelFor(t) || t : t
      const rm = document.createElement('span')
      rm.className = 'tag-remove'
      rm.textContent = '\u2715'
      rm.addEventListener('click', () => {
        const index = tags.indexOf(t)
        if (index !== -1) {
          tags.splice(index, 1)
          render()
          if (onChange) onChange()
        }
      })
      tag.append(labelElement, rm)
      field.before(tag)
    }
  }

  function addTag(value) {
    const v = String(value == undefined ? '' : value).trim()
    if (!v || tags.includes(v)) return
    if (max && tags.length >= max) return
    tags.push(v)
    render()
    if (onChange) onChange()
  }

  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) addTag(filtered[highlightedIndex].value)
      else if (field.value.trim()) addTag(field.value)
      field.value = ''
      closeSuggest()
    } else if (e.key === 'Backspace' && field.value === '' && tags.length > 0) {
      tags.pop()
      render()
      if (onChange) onChange()
    } else
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (filtered.length === 0) return
          highlightedIndex = Math.min(highlightedIndex + 1, filtered.length - 1)
          renderSuggest()
          break
        case 'ArrowUp':
          e.preventDefault()
          if (filtered.length === 0) return
          highlightedIndex = Math.max(highlightedIndex - 1, -1)
          renderSuggest()
          break
        case 'Escape':
          closeSuggest()
          break
      }
  })

  field.addEventListener('input', () => {
    filtered = filterSuggestions(field.value)
    highlightedIndex = -1
    renderSuggest()
    if (filtered.length > 0 || field.value.trim()) openSuggest()
    else closeSuggest()
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

  host.append(field, suggestBox)
  for (const t of initial || []) tags.push(String(t))
  render()

  return { el: host, getTags: () => [...tags], addTag }
}

// ---- Message list editor -------------------------------------------------

function mountMessageList(host, field, messages) {
  const list = [...messages]
  host.innerHTML = ''
  host.className = 'flex-column gap-xs'

  function render() {
    host.innerHTML = ''
    for (const [index, message] of list.entries()) {
      const row = document.createElement('div')
      row.className = 'settings-message-editor'
      row.innerHTML = `<div class="settings-message-row">
          <input class="input" data-msgidx="${index}" value="${esc(message).replaceAll('"', '&quot;')}" />
          <button class="btn btn-danger btn-sm" data-msgdel="${index}" title="Remove">\u2715</button>
        </div>`
      host.append(row)
    }
    const addRow = document.createElement('div')
    addRow.className = 'settings-message-row'
    addRow.innerHTML = `<input class="input" data-msgadd placeholder="${esc(field.placeholder || 'New message\u2026')}" />
        <button class="btn btn-success btn-sm" data-msgaddbtn>+ Add</button>`
    host.append(addRow)
  }

  host.addEventListener('input', (e) => {
    const t = e.target
    if (t.dataset?.msgidx != undefined) {
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
    const addButton = e.target.closest('[data-msgaddbtn]')
    if (addButton) {
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
  const panel = document.querySelector('#settings-panel')

  if (cat.key === 'translations') {
    const overrides = {}
    function walk(fields) {
      for (const f of fields || []) {
        if (f.t === 'section') {
          walk(f.children)
          continue
        }
        if (f.t === 'link' || f.t === 'danger') continue
        if (f.t === 'msglist') {
          const host = panel.querySelector(`[data-msglist-host="${cssEscape(f.id)}"]`)
          overrides[f.id] = JSON.stringify(host?._getMessageList ? host._getMessageList() : [])
          continue
        }
        const element = panel.querySelector(`[data-field="${cssEscape(f.id)}"]`)
        if (!element) continue
        overrides[f.id] = element.value
      }
    }
    walk(cat.fields)
    return { overrides }
  }

  const data = JSON.parse(JSON.stringify(categoryData(cat.key) || {}))

  function walk(fields, target) {
    for (const f of fields || []) {
      if (f.t === 'permissionOverview') continue
      if (f.t === 'section') {
        walk(f.children, target)
        continue
      }
      if (f.t === 'tag') {
        const tag = tagInputRegistry.get(f.id)
        target[f.id] = tag ? tag.getTags() : array(target[f.id])
        continue
      }
      if (f.t === 'msglist') {
        const host = panel.querySelector(`[data-msglist-host="${cssEscape(f.id)}"]`)
        target[f.id] = host?._getMessageList ? host._getMessageList() : array(target[f.id])
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
      const element = panel.querySelector(`[data-field="${cssEscape(f.id)}"]`)
      if (!element) continue
      if (f.t === 'boolean') target[f.id] = !!element.checked
      else if (f.t === 'number') target[f.id] = number_(element.value)
      else target[f.id] = element.value
    }
  }

  walk(cat.fields, data)
  return data
}

function serializeCategory(cat, data) {
  if (cat.key === 'translations') return JSON.stringify(data.overrides || {})
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
      switch (f.t) {
        case 'tag':
        case 'msglist': {
          subset[f.id] = JSON.stringify(array(v))
          break
        }
        case 'boolean': {
          subset[f.id] = bool(v) ? '1' : '0'
          break
        }
        case 'number': {
          subset[f.id] = String(number_(v))
          break
        }
        case 'promotionRules':
        case 'demotionRules': {
          subset[f.id] = JSON.stringify(v || [])
          break
        }
        default: {
          subset[f.id] = string_(v)
        }
      }
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
  const saveButton = document.querySelector('#save-btn')
  const discardButton = document.querySelector('#discard-btn')
  const ind = document.querySelector('#dirty-indicator')
  if (!saveButton) return
  if (isSaving) {
    saveButton.disabled = true
    saveButton.textContent = 'Saving\u2026'
    if (discardButton) discardButton.disabled = true
    if (ind) ind.innerHTML = '<span class="badge badge-info">Saving\u2026</span>'
    return
  }
  if (isDirty) {
    saveButton.disabled = false
    if (discardButton) discardButton.disabled = false
    if (ind) ind.innerHTML = '<span class="badge badge-warning">Unsaved changes</span>'
  } else {
    saveButton.disabled = true
    saveButton.textContent = 'Save Changes'
    if (discardButton) discardButton.disabled = true
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
    await Api.apiPut(url, payload)
    if (cat.key === 'translations') rawData.translationOverrides = payload.overrides || {}
    else {
      rawData.categories = rawData.categories || {}
      rawData.categories[cat.key] = payload
    }
    savedSnapshot = serializeCategory(cat, payload)
    isDirty = false
    updateDirtyUI()
    Ui.showToast(`${cat.name} saved`, 'success')
  } catch (error) {
    Ui.showToast(`Failed to save ${cat.name}: ${error?.message || String(error)}`, 'error')
  } finally {
    isSaving = false
    updateDirtyUI()
  }
}

function discardCategory() {
  if (!currentCategory) return
  const cat = CATEGORIES.find((c) => c.key === currentCategory)
  if (!cat) return
  if (isDirty && !Ui.confirmAction('Discard unsaved changes?')) return
  renderCategoryPanel(cat)
}

async function onDeleteBridge() {
  if (!currentBridgeId) return
  if (
    !Ui.confirmAction(
      'Are you sure you want to permanently delete this bridge and all of its settings? This cannot be undone.'
    )
  )
    return
  const button = document.querySelector('[data-danger="deleteBridge"]')
  if (button) {
    button.disabled = true
    button.textContent = 'Deleting\u2026'
  }
  try {
    await Api.apiDelete(`/api/bridges/${encodeURIComponent(currentBridgeId)}`)
    Ui.showToast('Bridge deleted', 'success')
    currentBridgeId = null
    rawData = null
    Ui.populateBridgeSelector(document.querySelector('#bridge-select'), onBridgeChange)
  } catch (error) {
    Ui.showToast(`Failed to delete bridge: ${error?.message || String(error)}`, 'error')
    if (button) {
      button.disabled = false
      button.textContent = 'Delete this Bridge'
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
  if (
    isDirty &&
    currentCategory &&
    catKey !== currentCategory &&
    !Ui.confirmAction('You have unsaved changes in the current category. Switch and discard them?')
  )
    return
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
    showPanel(`<div class="settings-gateway-error">
          <strong>Settings API not available.</strong>
          <span>The <code>/api/settings/:bridgeId</code> endpoint returned no response. The backend handler has not been wired up yet \u2014 see <code>src/instance/web/settings-api.ts</code> (planned).</span>
          <span class="text-xs text-muted">Detail: ${esc(message)}</span>
        </div>`)
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
    const res = await Api.apiGet(`/api/bridges/${encodeURIComponent(currentBridgeId)}/settings`)
    rawData = res || {}
    rebuildChannelNameMap(rawData)
    rebuildRoleNameMap(rawData)
    isLoading = false
    if (currentCategory) {
      const cat = CATEGORIES.find((c) => c.key === currentCategory)
      if (cat) renderCategoryPanel(cat)
    } else {
      const parameters = new URLSearchParams(globalThis.location.search)
      const deepCat = parameters.get('cat')
      await (deepCat && CATEGORIES.find((c) => c.key === deepCat)
        ? selectCategory(deepCat)
        : selectCategory('channels'))
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
  if (
    isDirty &&
    currentBridgeId &&
    bridgeId !== currentBridgeId &&
    !Ui.confirmAction('You have unsaved changes. Switch bridge and discard them?')
  ) {
    const sel = document.querySelector('#bridge-select')
    if (sel && currentBridgeId) sel.value = currentBridgeId
    Ui.setSelectedBridge(currentBridgeId)
    return
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
      Ui.showToast('Server config changed for this category. Save or discard to refresh.', 'info')
    } else {
      Ui.showToast('Settings changed externally, reloading\u2026', 'info')
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

  panel.addEventListener('input', () => {
    checkDirty()
  })
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
    const collapseToggle = e.target.closest('[data-collapse-target]')
    if (collapseToggle) {
      const body = collapseToggle.nextElementSibling
      const arrow = collapseToggle.querySelector('.settings-collapsible-arrow')
      if (body?.classList.contains('settings-collapsible-body')) {
        const isHidden = body.style.display === 'none'
        body.style.display = isHidden ? '' : 'none'
        if (arrow) arrow.classList.toggle('open', isHidden)
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
}

// ---- Bootstrap ----------------------------------------------------------

async function bootstrap() {
  initNav()
  initStatusPolling()
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
  setWSStatus('connecting', 'connecting\u2026')
  ws = Ws.connectSettingsWS(handleWSEvent)

  if (currentBridgeId) {
    await onBridgeChange(currentBridgeId)
  } else {
    showPanel('<div class="empty-state"><div class="empty-state-text">Select a bridge to begin.</div></div>')
    await Ui.populateBridgeSelector(document.querySelector('#bridge-select'), onBridgeChange)
    if (!currentBridgeId) {
      showPanel(
        '<div class="empty-state"><div class="empty-state-text">No bridges available. Create one via the Discord /settings command.</div></div>'
      )
    }
  }

  const toggleButton = document.querySelector('#settings-sidebar-toggle')
  const closeButton = document.querySelector('#settings-sidebar-close')
  const overlay = document.querySelector('#settings-sidebar-overlay')
  if (toggleButton) toggleButton.addEventListener('click', toggleSidebar)
  if (closeButton) closeButton.addEventListener('click', closeSidebar)
  if (overlay) overlay.addEventListener('click', closeSidebar)

  const createButton = document.querySelector('#create-bridge-btn')
  if (createButton) {
    createButton.addEventListener('click', async () => {
      const bridgeId = globalThis.prompt('Enter a unique bridge ID:')
      if (!bridgeId?.trim()) return
      try {
        await Api.apiPost('/api/bridges', { bridgeId: bridgeId.trim().toLowerCase() })
        Ui.showToast('Bridge created', 'success')
        const select = document.querySelector('#bridge-select')
        if (select) {
          Ui.populateBridgeSelector(select, (bid) => {
            currentBridgeId = bid
            currentCategory = null
            onBridgeChange(bid)
          })
        }
      } catch (error) {
        Ui.showToast(`Failed to create bridge: ${error.message}`, 'error')
      }
    })
  }
}

function init() {
  const token = Auth.requireAuth()
  if (token) bootstrap()
}

globalThis.addEventListener('authsuccess', () => bootstrap())
init()
