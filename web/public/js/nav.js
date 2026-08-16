import { Api } from './api.js'
import { Auth } from './auth.js'
import { Ws } from './ws.js'

const NAV_ITEMS = [
  {
    label: 'Main',
    items: [
      { name: 'Overview', href: 'index.html', key: 'overview' },
      { name: 'Pending', href: 'rankup-pending.html', key: 'pending' }
    ]
  },
  {
    label: 'System',
    items: [
      { name: 'Status', href: 'status.html', key: 'status' },
      { name: 'App Settings', href: 'app-settings.html', key: 'app-settings' }
    ]
  }
]

const PendingBadgePermissions = new Set(['owner', 'admin', 'helper'])
const BackToTopThreshold = 400
const DesktopBreakpoint = 820

let badgeElement = null
let badgeCount = null
let badgeSubscription = null

function findActive(sections) {
  const filename = (globalThis.location.pathname.split('/').pop() || 'index.html').toLowerCase()
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === filename) return { section, item }
    }
  }
  return null
}

function breadcrumbSeparator() {
  const separator = document.createElement('span')
  separator.className = 'breadcrumb-sep'
  separator.setAttribute('aria-hidden', 'true')
  separator.textContent = '\u203A'
  return separator
}

function renderBreadcrumbs(active) {
  const container = document.querySelector('.app-container')
  if (!container || !active) return

  const crumbs = document.createElement('nav')
  crumbs.className = 'breadcrumbs'
  crumbs.setAttribute('aria-label', 'Breadcrumb')

  const home = document.createElement('a')
  home.className = 'breadcrumb-link'
  home.href = 'index.html'
  home.textContent = 'Dashboard'
  crumbs.append(home)

  const section = document.createElement('span')
  section.className = 'breadcrumb-segment'
  section.textContent = active.section.label
  crumbs.append(breadcrumbSeparator(), section)

  const current = document.createElement('span')
  current.className = 'breadcrumb-current'
  current.setAttribute('aria-current', 'page')
  current.textContent = active.item.name
  crumbs.append(breadcrumbSeparator(), current)

  container.prepend(crumbs)
}

function initBackToTop() {
  const button = document.createElement('button')
  button.id = 'back-to-top'
  button.className = 'back-to-top'
  button.type = 'button'
  button.setAttribute('aria-label', 'Back to top')
  button.textContent = '\u2191'
  document.body.append(button)

  let visible = false
  const update = () => {
    const show = globalThis.scrollY > BackToTopThreshold
    if (show !== visible) {
      visible = show
      button.classList.toggle('visible', show)
    }
  }
  button.addEventListener('click', () => {
    globalThis.scrollTo({ top: 0, behavior: 'smooth' })
  })
  globalThis.addEventListener('scroll', update, { passive: true })
  update()
}

function setPendingBadge(count) {
  badgeCount = count
  if (!badgeElement) return
  if (count > 0) {
    badgeElement.textContent = count > 99 ? '99+' : String(count)
    badgeElement.classList.remove('hidden')
  } else {
    badgeElement.classList.add('hidden')
  }
}

async function refreshPendingCount() {
  try {
    const data = await Api.apiGet('/api/rankup/bridges')
    const bridges = data && Array.isArray(data.bridges) ? data.bridges : []
    setPendingBadge(bridges.reduce((sum, bridge) => sum + (Number(bridge.pendingCount) || 0), 0))
  } catch {
    setPendingBadge(0)
  }
}

function startPendingBadge() {
  if (!badgeElement || badgeSubscription) return
  badgeSubscription = Ws.connectRankupWS((type, data) => {
    switch (type) {
      case 'error':
        setPendingBadge(0)
        break
      case 'rankup.snapshot': {
        const bridges = (data && data.bridges) || {}
        const total = Object.values(bridges).reduce((sum, bridge) => {
          return sum + ((bridge && bridge.pending && bridge.pending.length) || 0)
        }, 0)
        setPendingBadge(total)
        break
      }
      case 'rankup.reviewAdded':
        if (badgeCount !== null) setPendingBadge(badgeCount + 1)
        break
      case 'rankup.reviewRemoved':
        if (badgeCount !== null) setPendingBadge(Math.max(0, badgeCount - 1))
        break
      case 'rankup.bridgeConfigChanged':
        refreshPendingCount()
        break
    }
  })
}

function initDrawer(toggle, itemsContainer) {
  const backdrop = document.createElement('div')
  backdrop.className = 'nav-backdrop'
  document.body.append(backdrop)

  const closeDrawer = () => {
    if (!itemsContainer.classList.contains('open')) return
    itemsContainer.classList.remove('open')
    backdrop.classList.remove('visible')
    document.body.classList.remove('no-scroll')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = '\u2630'
  }

  toggle.addEventListener('click', () => {
    const isOpen = itemsContainer.classList.toggle('open')
    backdrop.classList.toggle('visible', isOpen)
    document.body.classList.toggle('no-scroll', isOpen)
    toggle.setAttribute('aria-expanded', String(isOpen))
    toggle.textContent = isOpen ? '\u2715' : '\u2630'
  })

  backdrop.addEventListener('click', closeDrawer)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer()
  })

  globalThis.addEventListener('resize', () => {
    if (globalThis.innerWidth > DesktopBreakpoint) closeDrawer()
  })
}

export function initNav() {
  const navHost = document.querySelector('#app-nav')
  if (!navHost) return

  const permission = Auth.getPermission()

  const sections = NAV_ITEMS.map((s) => ({ ...s, items: [...s.items] }))
  if (permission === 'owner' || permission === 'admin') {
    sections[0].items.unshift({ name: 'Settings', href: 'settings.html', key: 'settings' })
  }
  if (permission !== 'owner' && permission !== 'admin') {
    sections[2].items = sections[2].items.filter((item) => item.key !== 'app-settings')
  }

  const active = findActive(sections)
  const activeKey = active ? active.item.key : 'overview'

  const nav = document.createElement('nav')
  nav.className = 'nav'

  const brand = document.createElement('a')
  brand.className = 'nav-brand'
  brand.href = 'index.html'
  brand.textContent = 'Dashboard'
  nav.append(brand)

  const toggle = document.createElement('button')
  toggle.className = 'nav-toggle'
  toggle.id = 'nav-toggle'
  toggle.type = 'button'
  toggle.setAttribute('aria-label', 'Toggle navigation')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.textContent = '\u2630'
  nav.append(toggle)

  const itemsContainer = document.createElement('div')
  itemsContainer.className = 'nav-items'

  for (const section of sections) {
    const label = document.createElement('div')
    label.className = 'nav-section-label'
    label.textContent = section.label
    itemsContainer.append(label)

    for (const item of section.items) {
      const link = document.createElement('a')
      link.className = 'nav-link nav-item' + (activeKey === item.key ? ' active' : '')
      link.href = item.href
      link.textContent = item.name
      if (activeKey === item.key) {
        link.setAttribute('aria-current', 'page')
      }
      if (item.key === 'pending' && PendingBadgePermissions.has(permission)) {
        badgeElement = document.createElement('span')
        badgeElement.className = 'nav-badge hidden'
        link.append(badgeElement)
      }
      itemsContainer.append(link)
    }
  }

  nav.append(itemsContainer)

  const navRight = document.createElement('div')
  navRight.className = 'nav-right'

  const statusIndicator = document.createElement('span')
  statusIndicator.id = 'bot-status'
  statusIndicator.className = 'status-indicator status-unknown'
  statusIndicator.title = 'Connecting...'
  statusIndicator.textContent = '\u25CF'
  navRight.append(statusIndicator)

  const disconnectButton = document.createElement('button')
  disconnectButton.className = 'btn btn-secondary btn-sm'
  disconnectButton.id = 'app-nav-disconnect'
  disconnectButton.type = 'button'
  disconnectButton.textContent = 'Disconnect'
  disconnectButton.addEventListener('click', () => {
    Auth.disconnect()
  })
  navRight.append(disconnectButton)

  nav.append(navRight)
  navHost.append(nav)

  initDrawer(toggle, itemsContainer)
  renderBreadcrumbs(active)
  initBackToTop()
  startPendingBadge()
  globalThis.addEventListener('authsuccess', startPendingBadge, { once: true })
}
