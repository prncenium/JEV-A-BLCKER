import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runFlow, resetFlow } from '../src/content/flow.js'

// npm test runs from extension/, so fixtures resolve from the working directory.
const fixture = (name) => readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8')

// about:blank keeps jsdom's iframe document synchronous while the src still matches iframe[src*="aboutthisad"].
const SECRET_SRC = 'about:blank#aboutthisad-SECRET-TOKEN-123'

// jsdom has no layout engine: elements inside [data-size="0"] get a 0x0 box, all others 48x48.
function stubLayout(win) {
  win.Element.prototype.getBoundingClientRect = function () {
    const zero = this.closest && this.closest('[data-size="0"]')
    const w = zero ? 0 : 48
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: w, width: w, height: w }
  }
}

// Builds the YouTube panel as a fake: ⓘ opens nothing (the iframe exists already), Block shows the
// dialog, Continue shows the ad-blocked state, and a visible Close removes the ad.
// Each click is recorded in clicks, so tests can check the exact click order.
function mountDom({ onBlock, onClose, closeWorks = true } = {}) {
  document.body.innerHTML = fixture('player.html')
  stubLayout(window)
  const player = document.querySelector('#movie_player')
  const clicks = []

  player.addEventListener('click', (e) => {
    if (!e.target.closest('[aria-label="My Ad Center"]')) return
    clicks.push('My Ad Center')
    player.setAttribute('data-opened', '1')
  })

  const iframe = document.createElement('iframe')
  iframe.setAttribute('src', SECRET_SRC)
  document.body.appendChild(iframe)
  stubLayout(iframe.contentWindow)
  const doc = iframe.contentDocument
  doc.open()
  doc.write('<!doctype html><html><head></head><body></body></html>')
  doc.close()

  const render = (name) => {
    doc.body.innerHTML = fixture(name)
  }
  render('panel-step2.html')

  doc.body.addEventListener('click', (e) => {
    const t = e.target
    if (t.closest('[aria-label="Block"]')) {
      clicks.push('Block')
      if (onBlock) onBlock()
      render('panel-step3.html')
      return
    }
    if (t.closest('[role="dialog"]') && t.textContent.trim() === 'Continue') {
      clicks.push('Continue')
      render('panel-step4.html')
      return
    }
    if (t.closest('[aria-label="Close"]')) {
      clicks.push('Close')
      if (onClose) onClose()
      if (closeWorks) {
        player.classList.remove('ad-showing')
        doc.body.innerHTML = ''
      }
    }
  })

  return { player, doc, clicks }
}

// Returns the scripted decisions in call order. A function item is called with the request snapshot.
function scripted(items) {
  const requests = []
  return {
    requests,
    decide: async (request) => {
      requests.push(request)
      const next = items[requests.length - 1]
      if (next === undefined) throw new Error('no scripted decision')
      return typeof next === 'function' ? next(request.snapshot) : next
    }
  }
}

function idFor(snapshot, label) {
  const entry = snapshot.find((e) => e.ariaLabel === label || e.text === label)
  return entry ? entry.id : 'e999'
}

const click = (label, confidence = 0.95) => (snapshot) => ({
  operation: 'CLICK',
  targetId: idFor(snapshot, label),
  confidence
})
const wait = (confidence = 0.95) => ({ operation: 'WAIT', targetId: null, confidence })
const happyPath = () => [click('My Ad Center'), click('Block'), click('Continue'), click('Close')]

function expectNoIds(doc) {
  expect(document.querySelectorAll('[data-jev-id]')).toHaveLength(0)
  expect(doc.querySelectorAll('[data-jev-id]')).toHaveLength(0)
}

let logs = []
const log = (entry) => {
  logs.push(entry)
}

beforeEach(() => {
  resetFlow('navigated')
  logs = []
})

describe('happy path (R44)', () => {
  it('makes 4 model calls, clicks in order, verifies step 5 locally, and logs success', async () => {
    const dom = mountDom()
    const provider = scripted(happyPath())
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'success', reason: 'verified-closed' })
    expect(provider.requests.map((r) => r.stepIndex)).toEqual([1, 2, 3, 4])
    expect(dom.clicks).toEqual(['My Ad Center', 'Block', 'Continue', 'Close'])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ outcome: 'success', steps: 4, calls: 4 })
    expect(logs[0].confidences).toEqual([0.95, 0.95, 0.95, 0.95])
    expectNoIds(dom.doc)
  })
})

describe('confidence thresholds (R13 to R15)', () => {
  it('retries once for a confidence between 0.5 and 0.8, then aborts', async () => {
    const dom = mountDom()
    const provider = scripted([click('My Ad Center', 0.6), click('My Ad Center', 0.6)])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'retry-exhausted' })
    expect(provider.requests.map((r) => r.stepIndex)).toEqual([1, 1])
    expect(dom.clicks).toEqual([])
    expect(logs[0]).toMatchObject({ outcome: 'abort', reason: 'retry-exhausted', calls: 2 })
    expectNoIds(dom.doc)
  })

  it('continues when the single retry reaches 0.8', async () => {
    const dom = mountDom()
    const provider = scripted([click('My Ad Center', 0.6), click('My Ad Center', 0.9), click('Block'), click('Continue'), click('Close')])
    const result = await runFlow({ provider, log })

    expect(result.outcome).toBe('success')
    expect(provider.requests).toHaveLength(5)
    expect(dom.clicks).toEqual(['My Ad Center', 'Block', 'Continue', 'Close'])
  })

  it('aborts below 0.5 with no retry', async () => {
    const dom = mountDom()
    const provider = scripted([click('My Ad Center', 0.3)])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'low-confidence' })
    expect(provider.requests).toHaveLength(1)
    expect(dom.clicks).toEqual([])
    expectNoIds(dom.doc)
  })

  it('BLOCKED aborts immediately with no retry', async () => {
    mountDom()
    const provider = scripted([{ operation: 'BLOCKED', targetId: null, confidence: 0.99 }])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'blocked' })
    expect(provider.requests).toHaveLength(1)
  })
})

describe('decision handling (R12, R16, R17, R19, R20, R21)', () => {
  it('an unknown targetId aborts without a click', async () => {
    const dom = mountDom()
    const provider = scripted([{ operation: 'CLICK', targetId: 'e999', confidence: 0.95 }])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'unknown-target' })
    expect(dom.clicks).toEqual([])
    expectNoIds(dom.doc)
  })

  it('a target rejected by the allowlist aborts (Report at step 2)', async () => {
    const dom = mountDom()
    const provider = scripted([click('My Ad Center'), click('Report')])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'not-allowed' })
    expect(dom.clicks).toEqual(['My Ad Center'])
    expect(logs[0]).toMatchObject({ calls: 2, steps: 1 })
    expectNoIds(dom.doc)
  })

  it('WAIT re-snapshots the same step and does not advance it', async () => {
    mountDom()
    const provider = scripted([wait(), click('My Ad Center'), click('Block'), click('Continue'), click('Close')])
    const result = await runFlow({ provider, log })

    expect(result.outcome).toBe('success')
    expect(provider.requests.map((r) => r.stepIndex)).toEqual([1, 1, 2, 3, 4])
    expect(provider.requests[1].lastAction).toBeNull()
  })

  it('DONE before step 5 aborts, because only the local check may finish the flow', async () => {
    const dom = mountDom()
    const provider = scripted([{ operation: 'DONE', targetId: null, confidence: 0.99 }])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'unexpected-done' })
    expect(dom.clicks).toEqual([])
  })

  it('an invalid decision shape aborts', async () => {
    mountDom()
    const provider = scripted([{ operation: 'FOO', targetId: null, confidence: 0.9 }])
    const result = await runFlow({ provider, log })
    expect(result).toEqual({ outcome: 'abort', reason: 'bad-decision' })
  })
})

describe('guards (R23, R24, R25, R41)', () => {
  it('a 9th model call aborts', async () => {
    mountDom()
    const provider = scripted(Array.from({ length: 8 }, () => wait()))
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'call-limit' })
    expect(provider.requests).toHaveLength(8)
    expect(logs[0].calls).toBe(8)
  }, 20000)

  it('a flow over 10000ms aborts', async () => {
    const dom = mountDom()
    const clock = { t: 0 }
    const provider = {
      decide: async (request) => {
        clock.t = 11000
        return click('My Ad Center')(request.snapshot)
      }
    }
    const result = await runFlow({ provider, log, now: () => clock.t })

    expect(result).toEqual({ outcome: 'abort', reason: 'timeout' })
    expect(dom.clicks).toEqual([])
    expectNoIds(dom.doc)
  })

  it('any thrown error aborts with a fixed reason and no message in the log', async () => {
    const dom = mountDom()
    const provider = {
      decide: async () => {
        throw new Error('boom: secret detail')
      }
    }
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'error' })
    expect(JSON.stringify(logs)).not.toContain('boom')
    expectNoIds(dom.doc)
  })

  it('a panel that never closes aborts after the 3000ms verification window', async () => {
    const dom = mountDom({ closeWorks: false })
    const provider = scripted(happyPath())
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'close-not-verified' })
    expect(provider.requests).toHaveLength(4)
    expectNoIds(dom.doc)
  }, 20000)
})

describe('ad removal and navigation (R4, R5, R45)', () => {
  it('removal of ad-showing after the step 4 click is success and does not reset the flow', async () => {
    const dom = mountDom({ onClose: () => resetFlow('ad-ended') })
    const provider = scripted(happyPath())
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'success', reason: 'verified-closed' })
    expect(logs[0]).toMatchObject({ outcome: 'success', calls: 4 })
    expectNoIds(dom.doc)
  })

  it('removal of ad-showing at step 2 aborts', async () => {
    let dom
    dom = mountDom({
      onBlock: () => {
        dom.player.classList.remove('ad-showing')
        resetFlow('ad-ended')
      }
    })
    const provider = scripted([click('My Ad Center'), click('Block')])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'ad-ended' })
    expect(dom.clicks).toEqual(['My Ad Center', 'Block'])
    expect(provider.requests).toHaveLength(2)
    expectNoIds(dom.doc)
  })

  it('navigation during the flow aborts', async () => {
    const dom = mountDom({ onBlock: () => resetFlow('navigated') })
    const provider = scripted([click('My Ad Center'), click('Block')])
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'navigated' })
    expectNoIds(dom.doc)
  })
})

describe('DD10 temporary debug output', () => {
  it('a not-allowed abort prints one [JEV debug] line with the offered entries and chosen id, and nothing reaches the log', async () => {
    mountDom()
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const provider = scripted([click('Settings')])
    const result = await runFlow({ provider, log })
    const calls = debugSpy.mock.calls
    debugSpy.mockRestore()

    expect(result).toEqual({ outcome: 'abort', reason: 'not-allowed' })
    expect(calls).toHaveLength(1)
    const [tag, info] = calls[0]
    expect(tag).toBe('[JEV debug]')
    expect(info.step).toBe(1)
    expect(info.chosenId).toBe(info.offered.find((e) => e.ariaLabel === 'Settings').id)
    expect(info.offered.find((e) => e.ariaLabel === 'My Ad Center')).toEqual({
      id: 'e3', tag: 'button', role: null, ariaLabel: 'My Ad Center', text: ''
    })
    expect(Object.keys(info.offered[0]).sort()).toEqual(['ariaLabel', 'id', 'role', 'tag', 'text'])
    expect(JSON.stringify(logs)).not.toContain('Settings')
  })

  it('cuts every string to 40 characters, and an unknown-target abort also prints the line', async () => {
    const dom = mountDom()
    dom.player.querySelector('.ytp-settings-button').setAttribute('aria-label', 'x'.repeat(100))
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const result = await runFlow({ provider: scripted([{ operation: 'CLICK', targetId: 'z'.repeat(60), confidence: 0.9 }]), log })
    const calls = debugSpy.mock.calls
    debugSpy.mockRestore()

    expect(result.reason).toBe('unknown-target')
    expect(calls).toHaveLength(1)
    const info = calls[0][1]
    expect(info.chosenId).toHaveLength(40)
    expect(info.offered.some((e) => e.ariaLabel === 'x'.repeat(40))).toBe(true)
  })

  it('a successful flow prints no debug line', async () => {
    mountDom()
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    await runFlow({ provider: scripted(happyPath()), log })
    expect(debugSpy).not.toHaveBeenCalled()
    debugSpy.mockRestore()
  })
})

describe('provider failure reasons in the flow log', () => {
  it('logs the provider reason code instead of the generic error', async () => {
    mountDom()
    const unavailable = Object.assign(new Error('provider-unavailable'), { reason: 'provider-unavailable' })
    const provider = { decide: async () => { throw unavailable } }
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'provider-unavailable' })
    expect(logs[0]).toMatchObject({ outcome: 'abort', reason: 'provider-unavailable', steps: 0, calls: 1 })
  })

  it('logs error for a reason outside the fixed set, and never that text', async () => {
    mountDom()
    const leaking = Object.assign(new Error('boom'), { reason: 'https://llm.example/v1 key sk-SECRET' })
    const provider = { decide: async () => { throw leaking } }
    const result = await runFlow({ provider, log })

    expect(result).toEqual({ outcome: 'abort', reason: 'error' })
    expect(JSON.stringify(logs)).not.toContain('SECRET')
  })
})

describe('once per ad instance and logging', () => {
  it('runs at most once per ad instance', async () => {
    mountDom()
    await runFlow({ provider: scripted(happyPath()), log })

    const second = scripted(happyPath())
    const result = await runFlow({ provider: second, log })

    expect(result.outcome).toBe('skipped')
    expect(second.requests).toHaveLength(0)
    expect(logs).toHaveLength(1)
  })

  it('runs again for the next ad after an ad-ended reset', async () => {
    mountDom()
    await runFlow({ provider: scripted(happyPath()), log })

    const dom = mountDom()
    resetFlow('ad-ended')
    const result = await runFlow({ provider: scripted(happyPath()), log })

    expect(result.outcome).toBe('success')
    expect(dom.clicks).toEqual(['My Ad Center', 'Block', 'Continue', 'Close'])
  })

  it('log entries hold no snapshot content, URL or account identifier', async () => {
    mountDom()
    await runFlow({ provider: scripted([click('My Ad Center'), click('Report')]), log })
    await runFlow({ provider: scripted([]), log })
    mountDom()
    resetFlow('navigated')
    await runFlow({ provider: scripted(happyPath()), log })

    const text = JSON.stringify(logs)
    for (const forbidden of ['Report', 'Like ad', 'aboutthisad', 'SECRET', 'http', 'test@example.com', 'Signed in']) {
      expect(text).not.toContain(forbidden)
    }
    for (const entry of logs) {
      expect(Object.keys(entry).sort()).toEqual(['calls', 'confidences', 'durationMs', 'outcome', 'reason', 'steps', 'ts'])
    }
  }, 20000)
})
