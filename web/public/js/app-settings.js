import { Api } from './api.js'
import { Auth } from './auth.js'
import { initNav } from './nav.js'

const FIELDS = [
  { key: 'urchinApiKey', label: 'Urchin API Key' },
  { key: 'seraphApiKey', label: 'Seraph API Key' },
  { key: 'openrouterApiKey', label: 'OpenRouter API Key' },
  { key: 'openrouterModel', label: 'OpenRouter Model' }
]

let dirty = false
let saving = false

const input = (key) => document.getElementById(key)
const sourceBadge = (key) => document.getElementById(`${key}-source`)
const saveBtn = () => document.getElementById('save-btn')
const statusEl = () => document.getElementById('save-status')

function setSourceBadge(key, isCustom) {
  const badge = sourceBadge(key)
  if (!badge) return
  badge.classList.remove('hidden')
  badge.classList.toggle('badge-info', isCustom)
  badge.classList.toggle('badge-muted', !isCustom)
  badge.textContent = isCustom ? 'Custom (DB)' : 'Using config.yaml fallback'
}

function updateDirtyUI() {
  if (!saveBtn()) return
  saveBtn().disabled = !dirty || saving
  saveBtn().textContent = saving ? 'Saving\u2026' : 'Save Changes'
}

function markDirty() {
  dirty = true
  if (statusEl()) statusEl().textContent = ''
  updateDirtyUI()
}

async function loadSettings() {
  try {
    const data = await Api.apiGet('/api/app-settings')
    for (const field of FIELDS) {
      const entry = data && data[field.key]
      const isCustom = Boolean(entry && entry.set)
      input(field.key).placeholder = isCustom
        ? 'Stored in database \u2014 leave empty to keep'
        : `Set in config.yaml \u2014 leave empty to keep`
      input(field.key).value = ''
      setSourceBadge(field.key, isCustom)
    }
    dirty = false
    updateDirtyUI()
  } catch (error) {
    statusEl().textContent = `Failed to load settings: ${error.message}`
  }
}

async function saveSettings() {
  if (saving) return
  saving = true
  updateDirtyUI()
  const body = {}
  for (const field of FIELDS) {
    body[field.key] = input(field.key).value.trim()
  }
  try {
    await Api.apiPut('/api/app-settings', body)
    dirty = false
    saving = false
    updateDirtyUI()
    statusEl().textContent = 'Saved. Changes take effect immediately.'
    await loadSettings()
  } catch (error) {
    saving = false
    updateDirtyUI()
    statusEl().textContent = `Failed to save: ${error.message}`
  }
}

function init() {
  initNav()
  for (const field of FIELDS) {
    input(field.key).addEventListener('input', markDirty)
  }
  saveBtn().addEventListener('click', saveSettings)
  void loadSettings()
}

const token = Auth.requireAuth()
if (token) init()
else globalThis.addEventListener('authsuccess', init, { once: true })
