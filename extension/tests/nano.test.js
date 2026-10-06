import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createNanoProvider } from '../src/background/providers/nano.js'
import { getProvider } from '../src/background/providers/index.js'
import { NANO_TIMEOUT_MS } from '../src/shared/constants.js'

const REQUEST = {
  goal: 'Click Block',
  stepIndex: 2,
  lastAction: null,
  snapshot: [
    { id: 'e1', tag: 'div', role: 'button', ariaLabel: 'Like ad', text: 'Like', enabled: true },
    { id: 'e2', tag: 'div', role: 'button', ariaLabel: 'Block', text: 'Block', enabled: true }
  ]
}

// Stub of the Prompt API (LanguageModel). Counts sessions created and destroyed.
let lm
let answer
let fetchSpy
beforeEach(() => {
  answer = '{"choice":"e2","confidence":0.92}'
  lm = {
    availability: vi.fn(async () => 'available'),
    created: 0,
    destroyed: 0,
    create: vi.fn(async function () {
      lm.created += 1
      return {
        prompt: vi.fn(async () => answer),
        destroy: () => {
          lm.destroyed += 1
        }
      }
    })
  }
  globalThis.LanguageModel = lm
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  delete globalThis.LanguageModel
  vi.unstubAllGlobals()
})

describe('getProvider (T11)', () => {
  it('returns a provider with decide for nano, openai and jev', () => {
    for (const name of ['nano', 'openai', 'jev']) {
      expect(typeof getProvider(name).decide).toBe('function')
    }
  })

  it('jev is a stub that fails with provider-unavailable', async () => {
    await expect(getProvider('jev').decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-unavailable' })
  })

  it('throws on any other name', () => {
    expect(() => getProvider('vercel')).toThrow('unknown provider')
    expect(() => getProvider('toString')).toThrow('unknown provider')
    expect(() => getProvider(undefined)).toThrow('unknown provider')
  })
})

describe('nano mapping (R34)', () => {
  it('maps the model output to a CLICK decision', async () => {
    const decision = await createNanoProvider().decide(REQUEST)
    expect(decision).toEqual({ operation: 'CLICK', targetId: 'e2', confidence: 0.92 })
  })

  it('passes the offered ids as the response constraint enum', async () => {
    const prompt = vi.fn(async () => answer)
    lm.create = vi.fn(async () => ({ prompt, destroy: () => {} }))
    await createNanoProvider().decide(REQUEST)
    const options = prompt.mock.calls[0][1]
    expect(options.responseConstraint.properties.choice.enum).toEqual(['e1', 'e2', 'WAIT', 'BLOCKED'])
  })

  it('a returned choice outside the offered options throws', async () => {
    answer = '{"choice":"e9","confidence":0.99}'
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'invalid-response' })
  })

  it('a non-JSON answer throws', async () => {
    answer = 'not json'
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'invalid-response' })
  })
})

describe('session lifecycle', () => {
  it('creates a new session for each call and destroys it', async () => {
    const nano = createNanoProvider()
    await nano.decide(REQUEST)
    await nano.decide(REQUEST)
    expect(lm.created).toBe(2)
    expect(lm.destroyed).toBe(2)
  })

  it('destroys the session even when prompt fails', async () => {
    lm.create = vi.fn(async () => ({
      prompt: async () => {
        throw new Error('prompt failed')
      },
      destroy: () => {
        lm.destroyed += 1
      }
    }))
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-error' })
    expect(lm.destroyed).toBe(1)
  })
})

describe('availability', () => {
  it('a model that still has to download fails with provider-model-not-ready, without creating a session', async () => {
    lm.availability = vi.fn(async () => 'downloadable')
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-model-not-ready' })
    expect(lm.create).not.toHaveBeenCalled()
  })

  it('a model the device cannot run fails with provider-unavailable', async () => {
    lm.availability = vi.fn(async () => 'unavailable')
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-unavailable' })
  })

  it('throws provider-unavailable when LanguageModel is undefined', async () => {
    delete globalThis.LanguageModel
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-unavailable' })
  })

  it('a NotAllowedError from create means the browser needs a user gesture', async () => {
    lm.create = vi.fn(async () => {
      throw Object.assign(new Error('needs user activation'), { name: 'NotAllowedError' })
    })
    await expect(createNanoProvider().decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-needs-activation' })
  })
})

describe('timeout (NANO_TIMEOUT_MS)', () => {
  it('the constant is 8000 ms', () => {
    expect(NANO_TIMEOUT_MS).toBe(8000)
  })

  it('a prompt that never resolves throws provider-timeout after 8000 ms, aborts and destroys the session', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      let promptSignal = null
      let createSignal = null
      lm.create = vi.fn(async (options) => {
        createSignal = options.signal
        lm.created += 1
        return {
          prompt: vi.fn((_text, options2) => {
            promptSignal = options2.signal
            return new Promise(() => {})
          }),
          destroy: () => {
            lm.destroyed += 1
          }
        }
      })

      const pending = createNanoProvider().decide(REQUEST)
      const settled = expect(pending).rejects.toMatchObject({ reason: 'provider-timeout' })
      await vi.advanceTimersByTimeAsync(7999)
      expect(lm.destroyed).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await settled

      expect(createSignal).toBe(promptSignal)
      expect(promptSignal.aborted).toBe(true)
      expect(lm.destroyed).toBeGreaterThanOrEqual(1)
    } finally {
      logSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('a create() that never resolves also throws provider-timeout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    lm.create = vi.fn(() => new Promise(() => {}))
    await expect(createNanoProvider({ timeoutMs: 20 }).decide(REQUEST)).rejects.toMatchObject({ reason: 'provider-timeout' })
    logSpy.mockRestore()
  })
})

describe('stage logs', () => {
  it('logs start, availability, create, prompt-start and prompt-done with elapsed ms only', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await createNanoProvider().decide(REQUEST)
    const calls = logSpy.mock.calls.filter((c) => c[0] === '[JEV nano]')
    logSpy.mockRestore()

    expect(calls.map((c) => c[1])).toEqual(['start', 'availability', 'create', 'prompt-start', 'prompt-done'])
    for (const call of calls) {
      expect(call).toHaveLength(3)
      expect(typeof call[2]).toBe('number')
    }
    const text = JSON.stringify(calls)
    for (const forbidden of ['Block', 'Like ad', 'e2', 'confidence', 'Goal']) expect(text).not.toContain(forbidden)
  })
})

describe('no network (R34)', () => {
  it('makes zero fetch calls', async () => {
    await createNanoProvider().decide(REQUEST)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
