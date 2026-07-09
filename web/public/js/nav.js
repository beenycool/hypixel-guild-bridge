import { Auth } from './auth.js'

const NAV_ITEMS = [
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
  {
    label: 'System',
    items: [{ name: 'Status', href: 'status.html', key: 'status' }]
  }
]

function getActivePage() {
  const path = window.location.pathname
  const filename = path.split('/').pop() || 'index.html'
  for (const section of NAV_ITEMS) {
    for (const item of section.items) {
      if (item.href === filename) return item.key
    }
  }
  return 'overview'
}

export function initNav() {
  const navHost = document.querySelector('#app-nav')
  if (!navHost) return

  const permission = Auth.getPermission()
  const activePage = getActivePage()

  const sections = NAV_ITEMS.map((s) => ({ ...s, items: [...s.items] }))
  if (permission === 'owner' || permission === 'admin') {
    sections[0].items.unshift({ name: 'Settings', href: 'settings.html', key: 'settings' })
  }

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
  toggle.setAttribute('aria-label', 'Toggle navigation')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.innerHTML = '\u2630'
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
      const itemClass = activePage === item.key ? 'nav-item active' : 'nav-item'
      link.className = 'nav-link ' + itemClass
      link.href = item.href
      link.textContent = item.name
      if (activePage === item.key) {
        link.setAttribute('aria-current', 'page')
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

  const disconnectBtn = document.createElement('button')
  disconnectBtn.className = 'btn btn-secondary btn-sm'
  disconnectBtn.id = 'app-nav-disconnect'
  disconnectBtn.textContent = 'Disconnect'
  disconnectBtn.addEventListener('click', () => {
    Auth.disconnect()
  })
  navRight.append(disconnectBtn)

  nav.append(navRight)
  navHost.append(nav)

  toggle.addEventListener('click', () => {
    const isOpen = itemsContainer.classList.toggle('open')
    toggle.setAttribute('aria-expanded', String(isOpen))
  })

  document.addEventListener('click', (e) => {
    if (!navHost.contains(e.target) && itemsContainer.classList.contains('open')) {
      itemsContainer.classList.remove('open')
      toggle.setAttribute('aria-expanded', 'false')
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && itemsContainer.classList.contains('open')) {
      itemsContainer.classList.remove('open')
      toggle.setAttribute('aria-expanded', 'false')
    }
  })
}
