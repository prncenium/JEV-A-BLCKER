export const OPERATIONS = Object.freeze({
  CLICK: 'CLICK',
  WAIT: 'WAIT',
  DONE: 'DONE',
  BLOCKED: 'BLOCKED'
})

export const THRESHOLDS = Object.freeze({
  ACT: 0.8,
  RETRY: 0.5
})

export const LIMITS = Object.freeze({
  MAX_CALLS: 8,
  MAX_MS: 10000,
  MAX_SNAPSHOT: 40,
  DEBOUNCE_MS: 1500,
  CLICK_WAIT_MS: 800,
  WAIT_MS: 500,
  TEXT_MAX: 80,
  JEV_TIMEOUT_MS: 3000
})

// Per-call budget for the Nano provider (availability, create and prompt together). Below the 10 s flow cap.
export const NANO_TIMEOUT_MS = 8000

export const SCOPE_KINDS = Object.freeze({
  PLAYER: 'player',
  IFRAME: 'iframe'
})

// Steps table. Rule letters refer to R40 in 01-requirements.md. Step 5 allows no click.
export const STEPS = Object.freeze([
  Object.freeze({
    step: 1,
    goal: 'Open the My Ad Center panel for the playing ad',
    scope: SCOPE_KINDS.PLAYER,
    rule: 'a'
  }),
  Object.freeze({
    step: 2,
    goal: 'Click Block',
    scope: SCOPE_KINDS.IFRAME,
    rule: 'b'
  }),
  Object.freeze({
    step: 3,
    goal: 'Click Continue in the Stop seeing this ad? dialog',
    scope: SCOPE_KINDS.IFRAME,
    rule: 'c'
  }),
  Object.freeze({
    step: 4,
    goal: 'Close the My Ad Center panel',
    scope: SCOPE_KINDS.IFRAME,
    rule: 'd'
  }),
  Object.freeze({
    step: 5,
    goal: 'Confirm the flow finished',
    scope: SCOPE_KINDS.PLAYER,
    rule: null
  })
])

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'settings',
  JEV_KEY: 'jevKey',
  FLOW_LOGS: 'flowLogs'
})

export const MESSAGE_TYPES = Object.freeze({
  GET_CONFIG: 'GET_CONFIG',
  DECIDE: 'DECIDE',
  LOG_FLOW: 'LOG_FLOW'
})

// Fixed failure codes from the background and providers. Never a message, URL, key or response body.
export const PROVIDER_REASONS = Object.freeze([
  'disabled',
  'no-response',
  'invalid-response',
  'provider-error',
  'provider-unavailable',
  'provider-model-not-ready',
  'provider-needs-activation',
  'provider-import-failed',
  'provider-timeout',
  'provider-network',
  'provider-auth',
  'provider-rate-limit',
  'provider-http-error'
])

// Every reason the flow log may hold (03-design.md, Flow log entry).
export const FLOW_REASONS = Object.freeze([
  'verified-closed',
  'timeout',
  'scope-unavailable',
  'call-limit',
  'bad-decision',
  'blocked',
  'low-confidence',
  'retry-exhausted',
  'unexpected-done',
  'unknown-target',
  'not-allowed',
  'close-not-verified',
  'navigated',
  'ad-ended',
  'error',
  ...PROVIDER_REASONS
])
