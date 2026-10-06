import { MESSAGE_TYPES, PROVIDER_REASONS } from '../shared/constants.js'
import { validateDecision, validateMessage } from '../shared/schema.js'
import { getExtensionApi } from '../shared/ext.js'
import { startDetector } from './detector.js'
import { runFlow, resetFlow } from './flow.js'

const PROVIDER_NAMES = ['nano', 'openai', 'jev']

// An error that carries only a fixed reason code from PROVIDER_REASONS.
function coded(reason) {
  return Object.assign(new Error(reason), { reason })
}

// Only a well-formed config that is enabled with a known provider starts a flow (R30).
function isActive(config) {
  return !!config && config.enabled === true && PROVIDER_NAMES.includes(config.provider)
}

// send is the only way out of the page. Messages that fail validation are never sent (R39).
// Every failure becomes undefined, so a broken background never throws into the page.
export function createSafeSend(send) {
  return async (message) => {
    if (!validateMessage(message).ok) return undefined
    try {
      return await send(message)
    } catch {
      return undefined
    }
  }
}

// Provider adapter for flow.js. Sends DECIDE to the background and validates the answer.
export function createProvider(safeSend) {
  return {
    decide: async (request) => {
      const response = await safeSend({ type: MESSAGE_TYPES.DECIDE, payload: request })
      // No reply means the message was rejected or the worker did not answer, so the code says so.
      if (!response) throw coded('no-response')
      if (response.ok !== true) {
        throw coded(PROVIDER_REASONS.includes(response.error) ? response.error : 'provider-error')
      }
      const checked = validateDecision(response.decision)
      if (!checked.ok) throw coded('invalid-response')
      return checked.value
    }
  }
}

// Bootstrap per 03-design.md. Never reads chrome.storage: the key and settings stay in the service worker (R33).
export function startContent({ send, detector = startDetector, flow = { runFlow, resetFlow } }) {
  const safeSend = createSafeSend(send)
  const log = (entry) => safeSend({ type: MESSAGE_TYPES.LOG_FLOW, payload: entry })

  return detector({
    onAdDetected: async () => {
      try {
        // DD5: config is checked at every ad detection, not cached.
        const config = await safeSend({ type: MESSAGE_TYPES.GET_CONFIG })
        if (!isActive(config)) return
        await flow.runFlow({ provider: createProvider(safeSend), log })
      } catch {
        // A failed flow must never surface anything to the page (R25).
      }
    },
    onAdEnded: () => flow.resetFlow('ad-ended'),
    onNavigated: () => flow.resetFlow('navigated')
  })
}

const extensionApi = getExtensionApi()
if (extensionApi) startContent({ send: (message) => extensionApi.runtime.sendMessage(message) })
