import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startContent, createProvider, createSafeSend } from '../src/content/index.js'

const VALID_REQUEST = {
  goal: 'Open the My Ad Center panel for the playing ad',
  stepIndex: 1,
  lastAction: null,
  snapshot: [{ id: 'e1', tag: 'button', role: null, ariaLabel: 'My Ad Center', text: '', enabled: true }]
}

// Fake detector: keeps the callbacks so tests can fire ad and navigation events.
function fakeDetector() {
  const state = { callbacks: null, stopped: false }
  const detector = (callbacks) => {
    state.callbacks = callbacks
    return () => {
      state.stopped = true
    }
  }
  return { detector, state }
}

function fakeFlow() {
  return {
    runFlow: vi.fn(async () => ({ outcome: 'success', reason: 'verified-closed' })),
    resetFlow: vi.fn()
  }
}

// Replies to each message type. Records every message that reaches send.
function fakeSend(replies = {}) {
  const sent = []
  const send = vi.fn(async (message) => {
    sent.push(message)
    const reply = replies[message.type]
    return typeof reply === 'function' ? reply(message) : reply
  })
  return { send, sent }
}

const ENABLED = { enabled: true, provider: 'openai' }
const DISABLED = { enabled: false, provider: 'openai' }
const NO_PROVIDER = { enabled: true, provider: null }

let storageTouched
beforeEach(() => {
  storageTouched = []
  // A chrome stub whose storage access is recorded. The content script must never touch it (R33).
  globalThis.chrome = {
    storage: {
      local: {
        get: (key) => {
          storageTouched.push(key)
          return Promise.resolve({})
        }
      }
    }
  }
})

afterEach(() => {
  delete globalThis.chrome
})

describe('config gate (R30)', () => {
  it('sends no DECIDE when enabled is false', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send, sent } = fakeSend({ GET_CONFIG: DISABLED })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    expect(sent.map((m) => m.type)).toEqual(['GET_CONFIG'])
    expect(flow.runFlow).not.toHaveBeenCalled()
  })

  it('sends no DECIDE when the provider is null', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send, sent } = fakeSend({ GET_CONFIG: NO_PROVIDER })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    expect(sent.map((m) => m.type)).toEqual(['GET_CONFIG'])
    expect(flow.runFlow).not.toHaveBeenCalled()
  })

  it('checks GET_CONFIG at every AD_DETECTED (DD5)', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send, sent } = fakeSend({ GET_CONFIG: DISABLED })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    await state.callbacks.onAdDetected()
    expect(sent.filter((m) => m.type === 'GET_CONFIG')).toHaveLength(2)
  })

  it('ignores a malformed config reply', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send } = fakeSend({ GET_CONFIG: { enabled: 'yes', provider: 'openai' } })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    expect(flow.runFlow).not.toHaveBeenCalled()
  })
})

describe('flow start', () => {
  it('starts runFlow with an adapter that sends DECIDE and a log that sends LOG_FLOW', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const decision = { operation: 'CLICK', targetId: 'e1', confidence: 0.9 }
    const { send, sent } = fakeSend({
      GET_CONFIG: ENABLED,
      DECIDE: { ok: true, decision }
    })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    expect(flow.runFlow).toHaveBeenCalledTimes(1)
    const { provider, log } = flow.runFlow.mock.calls[0][0]

    expect(await provider.decide(VALID_REQUEST)).toEqual(decision)
    expect(sent.at(-1)).toEqual({ type: 'DECIDE', payload: VALID_REQUEST })

    await log({ ts: 1, outcome: 'success', reason: 'verified-closed', steps: 4, calls: 4, durationMs: 1000, confidences: [0.9] })
    expect(sent.at(-1).type).toBe('LOG_FLOW')
  })

  it('a refused DECIDE makes the provider throw', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send } = fakeSend({ GET_CONFIG: ENABLED, DECIDE: { ok: false, error: 'disabled' } })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    const { provider } = flow.runFlow.mock.calls[0][0]
    await expect(provider.decide(VALID_REQUEST)).rejects.toMatchObject({ reason: 'disabled' })
  })

  it('keeps the background reason code, and maps an unknown code to provider-error', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    let next = { ok: false, error: 'provider-unavailable' }
    const { send } = fakeSend({ GET_CONFIG: ENABLED, DECIDE: () => next })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    const { provider } = flow.runFlow.mock.calls[0][0]
    await expect(provider.decide(VALID_REQUEST)).rejects.toMatchObject({ reason: 'provider-unavailable' })
    next = { ok: false, error: 'something else' }
    await expect(provider.decide(VALID_REQUEST)).rejects.toMatchObject({ reason: 'provider-error' })
  })

  it('an invalid decision from the background makes the provider throw', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send } = fakeSend({
      GET_CONFIG: ENABLED,
      DECIDE: { ok: true, decision: { operation: 'EXPLODE', targetId: null, confidence: 0.9 } }
    })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    const { provider } = flow.runFlow.mock.calls[0][0]
    await expect(provider.decide(VALID_REQUEST)).rejects.toMatchObject({ reason: 'invalid-response' })
  })
})

describe('invalid messages are ignored (R39)', () => {
  it('a request that fails validation is never sent', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send, sent } = fakeSend({ GET_CONFIG: ENABLED, DECIDE: { ok: true, decision: {} } })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    const { provider } = flow.runFlow.mock.calls[0][0]
    await expect(provider.decide({ ...VALID_REQUEST, stepIndex: 9 })).rejects.toMatchObject({ reason: 'no-response' })
    expect(sent.some((m) => m.type === 'DECIDE')).toBe(false)
  })

  it('a log entry that fails validation is never sent', async () => {
    const { send, sent } = fakeSend({})
    const safe = createSafeSend(send)
    const result = await safe({ type: 'LOG_FLOW', payload: { ts: 'bad' } })
    expect(result).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  it('a send that throws resolves to undefined and never reaches the page', async () => {
    const safe = createSafeSend(async () => {
      throw new Error('context invalidated')
    })
    await expect(safe({ type: 'GET_CONFIG' })).resolves.toBeUndefined()
  })

  it('createProvider rejects when the send yields nothing', async () => {
    const provider = createProvider(async () => undefined)
    await expect(provider.decide(VALID_REQUEST)).rejects.toMatchObject({ reason: 'no-response' })
  })
})

describe('reset hooks', () => {
  it('calls resetFlow ad-ended on onAdEnded and navigated on onNavigated', () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    startContent({ send: fakeSend({}).send, detector, flow })

    state.callbacks.onAdEnded()
    state.callbacks.onNavigated()
    expect(flow.resetFlow.mock.calls).toEqual([['ad-ended'], ['navigated']])
  })

  it('returns the detector stop function', () => {
    const { detector, state } = fakeDetector()
    const stop = startContent({ send: fakeSend({}).send, detector, flow: fakeFlow() })
    stop()
    expect(state.stopped).toBe(true)
  })
})

describe('storage (R33)', () => {
  it('never reads chrome.storage during an ad, including when the flow runs', async () => {
    const { detector, state } = fakeDetector()
    const flow = fakeFlow()
    const { send } = fakeSend({ GET_CONFIG: ENABLED })
    startContent({ send, detector, flow })

    await state.callbacks.onAdDetected()
    state.callbacks.onAdEnded()
    state.callbacks.onNavigated()
    expect(storageTouched).toEqual([])
  })
})
