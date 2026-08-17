import { Api } from './api.js'

let pollingInterval = null

function updateStatusIndicator(state) {
  const element = document.querySelector('#bot-status')
  if (!element) return
  element.className = 'status-indicator status-' + state
  element.title = state === 'online' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected'
}

async function fetchBotStatus() {
  try {
    const status = await Api.apiGet('/api/status')
    const mcConnected = status.minecraft ? status.minecraft.some((index) => index.connected) : false
    const dcConnected = status.discord ? status.discord.connected : false
    const element = document.querySelector('#bot-status')
    if (!element) return
    if (mcConnected && dcConnected) {
      element.className = 'status-indicator status-online'
      element.title = 'All connected'
    } else {
      element.className = 'status-indicator status-connecting'
      element.title = 'MC: ' + (mcConnected ? '\u2713' : '\u2717') + ' Discord: ' + (dcConnected ? '\u2713' : '\u2717')
    }
  } catch {}
}

export function initStatusPolling() {
  updateStatusIndicator('connecting')
  fetchBotStatus()
  if (pollingInterval) clearInterval(pollingInterval)
  pollingInterval = setInterval(fetchBotStatus, 30_000)
}

export function stopStatusPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}
