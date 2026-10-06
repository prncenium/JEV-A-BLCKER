import { MESSAGE_TYPES, PROVIDER_REASONS, STORAGE_KEYS } from '../shared/constants.js'
import { validateMessage } from '../shared/schema.js'
import { getExtensionApi } from '../shared/ext.js'
// Static import: extension service workers do not allow dynamic import().
import { getProvider as defaultGetProvider } from './providers/index.js'

const ACCESS_LEVEL = 'TRUSTED_CONTEXTS'

// The code sent to the content script. Anything not in PROVIDER_REASONS becomes the generic code.
function errorCode(err) {
  const reason = err && err.reason
  return PROVIDER_REASONS.includes(reason) ? reason : 'provider-error'
}
// A detail is printed only when it is a short lowercase code, so no free text can reach the console.
function fixedDetail(err) {
  const detail = err && err.detail
  return typeof detail === 'string' && /^[a-z-]{1,40}$/.test(detail) ? detail : ''
}
const YOUTUBE_PREFIX ='https://www.youtube.com/'
const FLOW_LOG_LIMIT = 20
const DEFAULT_SETTINGS = Object.freeze({ enabled: false, provider: null })
const LOG_FIELDS = ['ts', 'outcome', 'reason', 'steps', 'calls', 'durationMs', 'confidences']

// Accepts this extension's own pages (options) and the YouTube content script. Everything else is ignored.
export function isTrustedSender(sender, extensionId) {
  if (!sender || sender.id !== extensionId) return false
  const url = typeof sender.url === 'string' ? sender.url : ''
  return url.startsWith(YOUTUBE_PREFIX) || url.startsWith(`chrome-extension://${extensionId}/`)
}

// Keeps only the R35 fields, so nothing else from a sender is ever stored (R43).
function pickLogFields(payload) {
  const entry = {}
  for (const field of LOG_FIELDS) entry[field] = payload[field]
  return entry
}

export function initBackground(chromeApi, { getProvider = defaultGetProvider } = {}) {
  const { runtime, storage } = chromeApi
  const local = storage.local

  // S5: must run on every service worker start, before any write, so content scripts cannot read storage.
  // Safari supports setAccessLevel only for storage.session, so a missing or failing call must not stop startup.
  // In that case content scripts could read storage.local; this extension's own content script never does (R33).
  let accessReady
  try {
    accessReady = typeof local.setAccessLevel === 'function'
      ? Promise.resolve(local.setAccessLevel({ accessLevel: ACCESS_LEVEL }))
      : Promise.resolve()
  } catch {
    accessReady = Promise.resolve()
  }
  accessReady.catch(() => {})

  async function readSettings() {
    const got = await local.get(STORAGE_KEYS.SETTINGS)
    return { ...DEFAULT_SETTINGS, ...(got[STORAGE_KEYS.SETTINGS] || {}) }
  }

  async function handleGetConfig(respond) {
    const settings = await readSettings()
    respond({ enabled: settings.enabled === true, provider: settings.provider ?? null })
  }

  async function handleDecide(payload, respond) {
    const settings = await readSettings()
    if (!settings.enabled || !settings.provider) {
      respond({ ok: false, error: 'disabled' })
      return
    }
    try {
      const provider = await getProvider(settings.provider)
      const decision = await provider.decide(payload)
      respond({ ok: true, decision })
    } catch (err) {
      // The provider error text may hold a URL or key fragment, so only a fixed code leaves the worker.
      // The console gets the error name only, never its message.
      // reason and detail are fixed codes set by our own code, so they are safe to print.
      console.error('[JEV] DECIDE failed:', (err && err.name) || 'Error', errorCode(err), fixedDetail(err))
      respond({ ok: false, error: errorCode(err) })
    }
  }

  async function handleLogFlow(payload, respond) {
    const got = await local.get(STORAGE_KEYS.FLOW_LOGS)
    const logs = Array.isArray(got[STORAGE_KEYS.FLOW_LOGS]) ? got[STORAGE_KEYS.FLOW_LOGS] : []
    const next = [...logs, pickLogFields(payload)].slice(-FLOW_LOG_LIMIT)
    await local.set({ [STORAGE_KEYS.FLOW_LOGS]: next })
    respond({ ok: true })
  }

  async function route(message, respond) {
    try {
      if (message.type === MESSAGE_TYPES.GET_CONFIG) await handleGetConfig(respond)
      else if (message.type === MESSAGE_TYPES.DECIDE) await handleDecide(message.payload, respond)
      else if (message.type === MESSAGE_TYPES.LOG_FLOW) await handleLogFlow(message.payload, respond)
    } catch {
      respond({ ok: false, error: 'internal' })
    }
  }

  runtime.onInstalled.addListener(async (details) => {
    if (!details || details.reason !== 'install') return
    await accessReady.catch(() => {})
    await local.set({ [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } })
  })

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTrustedSender(sender, runtime.id)) return false
    const checked = validateMessage(message)
    if (!checked.ok) return false
    route(checked.value, sendResponse)
    return true
  })

  return { route }
}

// Real service worker. Listeners register synchronously at the top level of the worker.
const extensionApi = getExtensionApi()
if (extensionApi) initBackground(extensionApi)
