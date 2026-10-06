import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getExtensionApi } from '../src/shared/ext.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initBackground, isTrustedSender } from '../src/background/index.js'

describe('service worker loading', () => {
  it('background/index.js contains no dynamic import() call', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/background/index.js'), 'utf8')
    // Strip line comments so a comment mentioning import() does not count.
    const code = source.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bimport\s*\(/)
  })

  it('uses the statically imported getProvider when none is injected', async () => {
    const env = makeChrome({ settings: { enabled: true, provider: 'jev' } })
    initBackground(env.chromeApi)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { responses } = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    errorSpy.mockRestore()
    // The real jev stub fails with provider-unavailable, which proves the real provider module was used.
    expect(responses).toEqual([{ ok: false, error: 'provider-unavailable' }])
  })
})

const EXT_ID = 'ext-id'
const YT_SENDER = { id: EXT_ID, url: 'https://www.youtube.com/watch?v=abc' }
const OPTIONS_SENDER = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/src/options/options.html` }

// Mocked chrome API. Records the order of storage calls so tests can check access level came first.
function makeChrome(initial = {}) {
  const data = { ...initial }
  const order = []
  const listeners = { installed: [], message: [] }
  const accessCalls = []
  const chromeApi = {
    runtime: {
      id: EXT_ID,
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) }
    },
    storage: {
      local: {
        setAccessLevel: async (opts) => {
          accessCalls.push(opts)
          order.push('access')
        },
        get: async (key) => ({ [key]: data[key] }),
        set: async (obj) => {
          order.push('set')
          Object.assign(data, obj)
        }
      }
    }
  }
  return { chromeApi, listeners, data, order, accessCalls }
}

// Sends a message to every registered listener and collects what sendResponse received.
async function dispatch(listeners, message, sender = YT_SENDER) {
  const responses = []
  let keep
  for (const fn of listeners.message) {
    keep = fn(message, sender, (r) => responses.push(r))
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { keep, responses }
}

const DECIDE_PAYLOAD = { goal: 'Click Block', stepIndex: 2, lastAction: null, snapshot: [] }
const LOG_PAYLOAD = {
  ts: 1,
  outcome: 'success',
  reason: 'verified-closed',
  steps: 4,
  calls: 4,
  durationMs: 2500,
  confidences: [0.9, 0.9, 0.9, 0.9]
}

let env
let fakeProvider
let providerCalls
beforeEach(() => {
  env = makeChrome()
  providerCalls = []
  fakeProvider = {
    decide: async (req) => {
      providerCalls.push(req)
      return { operation: 'CLICK', targetId: 'e1', confidence: 0.9 }
    }
  }
  initBackground(env.chromeApi, { getProvider: async () => fakeProvider })
})

describe('storage access level (S5)', () => {
  it('sets TRUSTED_CONTEXTS on start, before any write', async () => {
    expect(env.accessCalls).toEqual([{ accessLevel: 'TRUSTED_CONTEXTS' }])
    env.listeners.installed[0]({ reason: 'install' })
    await new Promise((r) => setTimeout(r, 0))
    expect(env.order[0]).toBe('access')
  })
})

describe('browsers without storage.local.setAccessLevel (Safari)', () => {
  it('still registers the listeners and writes the install defaults when setAccessLevel is missing', async () => {
    const safari = makeChrome({ settings: { enabled: true, provider: 'nano' } })
    delete safari.chromeApi.storage.local.setAccessLevel
    initBackground(safari.chromeApi, { getProvider: async () => fakeProvider })
    expect(safari.listeners.message).toHaveLength(1)
    const { responses } = await dispatch(safari.listeners, { type: 'GET_CONFIG' })
    expect(responses).toEqual([{ enabled: true, provider: 'nano' }])
    await safari.listeners.installed[0]({ reason: 'install' })
    expect(safari.data.settings).toEqual({ enabled: false, provider: null })
  })

  it('still starts when setAccessLevel throws or rejects', async () => {
    const throwing = makeChrome()
    throwing.chromeApi.storage.local.setAccessLevel = () => { throw new Error('only session') }
    expect(() => initBackground(throwing.chromeApi, { getProvider: async () => fakeProvider })).not.toThrow()
    expect(throwing.listeners.message).toHaveLength(1)

    const rejecting = makeChrome()
    rejecting.chromeApi.storage.local.setAccessLevel = () => Promise.reject(new Error('only session'))
    initBackground(rejecting.chromeApi, { getProvider: async () => fakeProvider })
    await rejecting.listeners.installed[0]({ reason: 'install' })
    expect(rejecting.data.settings).toEqual({ enabled: false, provider: null })
  })
})

describe('getExtensionApi', () => {
  afterEach(() => {
    delete globalThis.browser
    delete globalThis.chrome
  })

  it('uses chrome when there is no browser object (Chrome, Edge, Opera)', () => {
    globalThis.chrome = { runtime: { id: 'x' } }
    expect(getExtensionApi()).toBe(globalThis.chrome)
  })

  it('prefers browser when it exists (Safari)', () => {
    globalThis.chrome = { runtime: { id: 'x' } }
    globalThis.browser = { runtime: { id: 'x' } }
    expect(getExtensionApi()).toBe(globalThis.browser)
  })

  it('returns null outside an extension', () => {
    expect(getExtensionApi()).toBeNull()
    globalThis.chrome = { runtime: {} }
    expect(getExtensionApi()).toBeNull()
  })
})

describe('first install (R31)', () => {
  it('writes { enabled: false, provider: null } on install', async () => {
    await env.listeners.installed[0]({ reason: 'install' })
    expect(env.data.settings).toEqual({ enabled: false, provider: null })
  })

  it('writes nothing on update or browser update', async () => {
    await env.listeners.installed[0]({ reason: 'update' })
    await env.listeners.installed[0]({ reason: 'chrome_update' })
    expect(env.data.settings).toBeUndefined()
  })
})

describe('GET_CONFIG (R33, R39)', () => {
  it('returns only enabled and provider, never the key, base URL or model', async () => {
    env = makeChrome({
      settings: { enabled: true, provider: 'openai', baseUrl: 'https://llm.example/v1', model: 'm1' },
      openaiKey: 'sk-SECRET-123'
    })
    initBackground(env.chromeApi, { getProvider: async () => fakeProvider })

    const { responses } = await dispatch(env.listeners, { type: 'GET_CONFIG' })
    expect(responses).toEqual([{ enabled: true, provider: 'openai' }])
    const text = JSON.stringify(responses)
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('llm.example')
    expect(text).not.toContain('m1')
  })

  it('returns the defaults when nothing is stored', async () => {
    const { responses } = await dispatch(env.listeners, { type: 'GET_CONFIG' })
    expect(responses).toEqual([{ enabled: false, provider: null }])
  })
})

describe('sender and shape checks (R39)', () => {
  it('ignores a sender from another extension id', async () => {
    const { keep, responses } = await dispatch(env.listeners, { type: 'GET_CONFIG' }, { id: 'other', url: YT_SENDER.url })
    expect(keep).toBe(false)
    expect(responses).toEqual([])
  })

  it('ignores a sender from a page that is neither YouTube nor this extension', async () => {
    const { keep, responses } = await dispatch(env.listeners, { type: 'GET_CONFIG' }, { id: EXT_ID, url: 'https://evil.example/' })
    expect(keep).toBe(false)
    expect(responses).toEqual([])
  })

  it('accepts the options page of this extension', async () => {
    const { responses } = await dispatch(env.listeners, { type: 'GET_CONFIG' }, OPTIONS_SENDER)
    expect(responses).toHaveLength(1)
  })

  it('ignores messages with an invalid shape or an unknown type', async () => {
    const bad = [{ type: 'DECIDE', payload: {} }, { type: 'LOG_FLOW', payload: { ts: 'x' } }, { type: 'NOPE' }, null]
    for (const msg of bad) {
      const { keep, responses } = await dispatch(env.listeners, msg)
      expect(keep).toBe(false)
      expect(responses).toEqual([])
    }
  })

  it('isTrustedSender rejects a missing sender', () => {
    expect(isTrustedSender(undefined, EXT_ID)).toBe(false)
  })
})

describe('DECIDE (R30, R32)', () => {
  it('is refused when disabled, with no provider call', async () => {
    env = makeChrome({ settings: { enabled: false, provider: 'openai' } })
    initBackground(env.chromeApi, { getProvider: async () => fakeProvider })
    const { responses } = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    expect(responses).toEqual([{ ok: false, error: 'disabled' }])
    expect(providerCalls).toHaveLength(0)
  })

  it('is refused when enabled but no provider is set', async () => {
    env = makeChrome({ settings: { enabled: true, provider: null } })
    initBackground(env.chromeApi, { getProvider: async () => fakeProvider })
    const { responses } = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    expect(responses).toEqual([{ ok: false, error: 'disabled' }])
    expect(providerCalls).toHaveLength(0)
  })

  it('returns the provider decision when enabled', async () => {
    env = makeChrome({ settings: { enabled: true, provider: 'nano' } })
    initBackground(env.chromeApi, { getProvider: async () => fakeProvider })
    const { responses } = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    expect(providerCalls).toEqual([DECIDE_PAYLOAD])
    expect(responses).toEqual([{ ok: true, decision: { operation: 'CLICK', targetId: 'e1', confidence: 0.9 } }])
  })

  it('passes a provider reason code through, and maps any other reason to provider-error', async () => {
    env = makeChrome({ settings: { enabled: true, provider: 'nano' } })
    const unavailable = { decide: async () => { throw Object.assign(new Error('x'), { reason: 'provider-unavailable' }) } }
    initBackground(env.chromeApi, { getProvider: async () => unavailable })
    const first = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    expect(first.responses).toEqual([{ ok: false, error: 'provider-unavailable' }])

    const leaking = { decide: async () => { throw Object.assign(new Error('x'), { reason: 'sk-SECRET-1' }) } }
    env = makeChrome({ settings: { enabled: true, provider: 'nano' } })
    initBackground(env.chromeApi, { getProvider: async () => leaking })
    const second = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    expect(second.responses).toEqual([{ ok: false, error: 'provider-error' }])
    expect(JSON.stringify(second.responses)).not.toContain('SECRET')
  })

  it('logs only the error name to console.error on a DECIDE failure', async () => {
    env = makeChrome({ settings: { enabled: true, provider: 'openai' } })
    const err = Object.assign(new Error('HTTP 401 https://llm.example key sk-SECRET'), { name: 'ProviderError' })
    initBackground(env.chromeApi, { getProvider: async () => ({ decide: async () => { throw err } }) })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    const logged = JSON.stringify(errorSpy.mock.calls)
    errorSpy.mockRestore()
    expect(logged).toContain('ProviderError')
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('llm.example')
    expect(logged).not.toContain('401')
  })

  it('prints the reason and fixed detail code, and drops a detail that is not a short code', async () => {
    env = makeChrome({ settings: { enabled: true, provider: 'openai' } })
    let detail = 'choice-not-offered'
    const thrower = { decide: async () => { throw Object.assign(new Error('x'), { name: 'ProviderError', reason: 'invalid-response', detail }) } }
    initBackground(env.chromeApi, { getProvider: async () => thrower })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    detail = 'Model said: click e3 because https://x'
    await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    const calls = errorSpy.mock.calls
    errorSpy.mockRestore()
    expect(calls[0]).toEqual(['[JEV] DECIDE failed:', 'ProviderError', 'invalid-response', 'choice-not-offered'])
    expect(calls[1]).toEqual(['[JEV] DECIDE failed:', 'ProviderError', 'invalid-response', ''])
  })

  it('returns a fixed error code when the provider throws, without its message', async () => {
    env = makeChrome({ settings: { enabled: true, provider: 'openai' } })
    const throwing = { decide: async () => { throw new Error('HTTP 401 https://llm.example key sk-SECRET') } }
    initBackground(env.chromeApi, { getProvider: async () => throwing })
    const { responses } = await dispatch(env.listeners, { type: 'DECIDE', payload: DECIDE_PAYLOAD })
    expect(responses).toEqual([{ ok: false, error: 'provider-error' }])
    expect(JSON.stringify(responses)).not.toContain('SECRET')
  })
})

describe('LOG_FLOW (R35)', () => {
  it('keeps only the newest 20 entries', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ ...LOG_PAYLOAD, ts: i }))
    env = makeChrome({ flowLogs: existing })
    initBackground(env.chromeApi, { getProvider: async () => fakeProvider })

    const { responses } = await dispatch(env.listeners, { type: 'LOG_FLOW', payload: { ...LOG_PAYLOAD, ts: 99 } })
    expect(responses).toEqual([{ ok: true }])
    expect(env.data.flowLogs).toHaveLength(20)
    expect(env.data.flowLogs[0].ts).toBe(1)
    expect(env.data.flowLogs[19].ts).toBe(99)
  })

  it('stores only the R35 fields, so no snapshot or URL can be kept', async () => {
    await dispatch(env.listeners, {
      type: 'LOG_FLOW',
      payload: { ...LOG_PAYLOAD, snapshot: [{ text: 'Like ad' }], url: 'https://llm.example' }
    })
    const [stored] = env.data.flowLogs
    expect(Object.keys(stored).sort()).toEqual(['calls', 'confidences', 'durationMs', 'outcome', 'reason', 'steps', 'ts'])
  })
})
