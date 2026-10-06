import { describe, it, expect } from 'vitest'
import { validateDecision, validateMessage } from '../src/shared/schema.js'

const decision = (over = {}) => ({ operation: 'CLICK', targetId: 'e1', confidence: 0.9, ...over })

const entry = (over = {}) => ({
  id: 'e1',
  tag: 'button',
  role: null,
  ariaLabel: 'My Ad Center',
  text: '',
  enabled: true,
  ...over
})

const decidePayload = (over = {}) => ({
  goal: 'Click Block',
  stepIndex: 2,
  lastAction: null,
  snapshot: [entry()],
  ...over
})

const logPayload = (over = {}) => ({
  ts: 1,
  outcome: 'success',
  reason: 'done',
  steps: 5,
  calls: 5,
  durationMs: 2500,
  confidences: [0.9, 0.95],
  ...over
})

describe('validateDecision', () => {
  it('accepts valid decisions for every operation', () => {
    expect(validateDecision(decision())).toEqual({ ok: true, value: decision() })
    for (const operation of ['WAIT', 'DONE', 'BLOCKED']) {
      const d = decision({ operation, targetId: null })
      expect(validateDecision(d)).toEqual({ ok: true, value: d })
    }
  })

  it('rejects an unknown operation', () => {
    expect(validateDecision(decision({ operation: 'HACK' })).ok).toBe(false)
    expect(validateDecision(decision({ operation: undefined })).ok).toBe(false)
    expect(validateDecision(decision({ operation: 'click' })).ok).toBe(false)
  })

  it('rejects a targetId of the wrong type', () => {
    for (const targetId of [1, undefined, {}, [], true]) {
      expect(validateDecision(decision({ targetId })).ok).toBe(false)
    }
  })

  it('accepts confidence 0 and 1', () => {
    expect(validateDecision(decision({ confidence: 0 })).ok).toBe(true)
    expect(validateDecision(decision({ confidence: 1 })).ok).toBe(true)
  })

  it('rejects confidence -0.1, 1.1, NaN, Infinity, a string and missing', () => {
    for (const confidence of [-0.1, 1.1, NaN, Infinity, '0.9', undefined, null]) {
      expect(validateDecision(decision({ confidence })).ok).toBe(false)
    }
  })

  it('rejects null and non-object input without throwing', () => {
    for (const input of [null, undefined, 'x', 5, true, [], () => {}]) {
      const r = validateDecision(input)
      expect(r.ok).toBe(false)
      expect(typeof r.error).toBe('string')
    }
  })

  it('never throws on hostile objects', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom') } })
    expect(validateDecision(hostile).ok).toBe(false)
    expect(validateMessage(hostile).ok).toBe(false)
  })
})

describe('validateMessage', () => {
  it('accepts GET_CONFIG with no payload', () => {
    expect(validateMessage({ type: 'GET_CONFIG' }).ok).toBe(true)
    expect(validateMessage({ type: 'GET_CONFIG', payload: null }).ok).toBe(true)
  })

  it('rejects GET_CONFIG with a payload', () => {
    expect(validateMessage({ type: 'GET_CONFIG', payload: {} }).ok).toBe(false)
  })

  it('accepts a valid DECIDE', () => {
    const msg = { type: 'DECIDE', payload: decidePayload() }
    expect(validateMessage(msg)).toEqual({ ok: true, value: msg })
    expect(validateMessage({ type: 'DECIDE', payload: decidePayload({ lastAction: 'Clicked e4', snapshot: [] }) }).ok).toBe(true)
  })

  it('rejects DECIDE with wrong payload shapes', () => {
    const bad = [
      undefined,
      null,
      'x',
      decidePayload({ goal: 5 }),
      decidePayload({ stepIndex: '2' }),
      decidePayload({ stepIndex: 0 }),
      decidePayload({ stepIndex: 6 }),
      decidePayload({ stepIndex: 1.5 }),
      decidePayload({ lastAction: 3 }),
      decidePayload({ lastAction: undefined }),
      decidePayload({ snapshot: 'nope' }),
      decidePayload({ snapshot: [entry({ id: 1 })] }),
      decidePayload({ snapshot: [entry({ enabled: 'yes' })] }),
      decidePayload({ snapshot: [null] })
    ]
    for (const payload of bad) {
      expect(validateMessage({ type: 'DECIDE', payload }).ok).toBe(false)
    }
  })

  it('accepts a valid LOG_FLOW', () => {
    const msg = { type: 'LOG_FLOW', payload: logPayload() }
    expect(validateMessage(msg)).toEqual({ ok: true, value: msg })
    expect(validateMessage({ type: 'LOG_FLOW', payload: logPayload({ outcome: 'abort', confidences: [] }) }).ok).toBe(true)
  })

  it('rejects LOG_FLOW with wrong payload shapes', () => {
    const bad = [
      undefined,
      null,
      logPayload({ ts: 'now' }),
      logPayload({ outcome: 'maybe' }),
      logPayload({ reason: 1 }),
      logPayload({ steps: '5' }),
      logPayload({ calls: NaN }),
      logPayload({ durationMs: null }),
      logPayload({ confidences: 'x' }),
      logPayload({ confidences: [0.9, 'a'] })
    ]
    for (const payload of bad) {
      expect(validateMessage({ type: 'LOG_FLOW', payload }).ok).toBe(false)
    }
  })

  it('rejects unknown message types', () => {
    for (const type of ['NOPE', '', undefined, null, 5, 'constructor', '__proto__', 'decide']) {
      expect(validateMessage({ type, payload: {} }).ok).toBe(false)
    }
  })

  it('rejects null and non-object messages without throwing', () => {
    for (const input of [null, undefined, 'DECIDE', 5, [], true]) {
      const r = validateMessage(input)
      expect(r.ok).toBe(false)
      expect(typeof r.error).toBe('string')
    }
  })
})
