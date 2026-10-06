import { STORAGE_KEYS } from '../shared/constants.js'
import { OPENAI_KEY_STORAGE } from '../background/providers/openai.js'
import { getExtensionApi } from '../shared/ext.js'

// browser in Safari, chrome in Chrome, Edge and Opera.
const ext = getExtensionApi()
const JEV_KEY_STORAGE = STORAGE_KEYS.JEV_KEY
const LOG_SHOWN = 20

const $ = (id) => document.getElementById(id)

function showStatus(text) {
  $('status').textContent = text
}

// The key itself is never shown. The field only says whether one is saved.
async function updateKeyPlaceholder(provider) {
  const storageKey = provider === 'jev' ? JEV_KEY_STORAGE : OPENAI_KEY_STORAGE
  const got = await ext.storage.local.get(storageKey)
  const saved = typeof got[storageKey] === 'string' && got[storageKey].length > 0
  $('key').placeholder = saved ? 'A key is saved. Leave blank to keep it.' : 'Paste the API key'
}

function syncFields() {
  const provider = $('provider').value
  $('openai-fields').hidden = provider !== 'openai'
  $('key-field').hidden = provider !== 'openai' && provider !== 'jev'
  if (!$('key-field').hidden) updateKeyPlaceholder(provider)
}

async function loadSettings() {
  const got = await ext.storage.local.get(STORAGE_KEYS.SETTINGS)
  const settings = got[STORAGE_KEYS.SETTINGS] || {}
  $('enabled').checked = settings.enabled === true
  $('provider').value = settings.provider || ''
  $('baseUrl').value = settings.baseUrl || ''
  $('model').value = settings.model || ''
  syncFields()
}

async function renderLogs() {
  const got = await ext.storage.local.get(STORAGE_KEYS.FLOW_LOGS)
  const logs = (Array.isArray(got[STORAGE_KEYS.FLOW_LOGS]) ? got[STORAGE_KEYS.FLOW_LOGS] : []).slice(-LOG_SHOWN).reverse()
  const items = logs.map((entry) => {
    const li = document.createElement('li')
    const when = new Date(entry.ts).toLocaleString()
    li.textContent = `${when} | ${entry.outcome} | ${entry.reason} | steps ${entry.steps} | calls ${entry.calls} | ${entry.durationMs} ms | confidences ${entry.confidences.join(', ')}`
    return li
  })
  if (items.length === 0) {
    const li = document.createElement('li')
    li.textContent = 'No flow logs yet.'
    items.push(li)
  }
  $('logs').replaceChildren(...items)
}

// Returns the origin pattern for the base URL, or null when the URL is not an https URL.
function originPattern(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' ? `${url.origin}/*` : null
  } catch {
    return null
  }
}

async function save() {
  const provider = $('provider').value || null
  const settings = { enabled: $('enabled').checked, provider, baseUrl: '', model: '' }
  const writes = {}

  if (provider === 'openai') {
    const baseUrl = $('baseUrl').value.trim().replace(/\/+$/, '')
    const pattern = originPattern(baseUrl)
    if (!pattern) {
      showStatus('Enter a base URL that starts with https://.')
      return
    }
    // Must run inside the click, before any await, so the browser can show the permission prompt.
    const granted = await ext.permissions.request({ origins: [pattern] })
    if (!granted) {
      showStatus('Permission for that address was not granted. Nothing was saved.')
      return
    }
    const model = $('model').value.trim()
    if (!model) {
      showStatus('Enter a model name.')
      return
    }
    settings.baseUrl = baseUrl
    settings.model = model
  }

  const keyValue = $('key').value.trim()
  if (keyValue && (provider === 'openai' || provider === 'jev')) {
    writes[provider === 'jev' ? JEV_KEY_STORAGE : OPENAI_KEY_STORAGE] = keyValue
  }
  writes[STORAGE_KEYS.SETTINGS] = settings
  await ext.storage.local.set(writes)
  $('key').value = ''
  await updateKeyPlaceholder(provider)
  showStatus('Saved.')
  renderLogs()
}

$('provider').addEventListener('change', syncFields)
$('save').addEventListener('click', () => {
  save().catch(() => showStatus('Could not save. Try again.'))
})

loadSettings()
renderLogs()
