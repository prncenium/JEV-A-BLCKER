import { describe, it, expect } from 'vitest'
import { createOpenAIProvider, mapChoice, offeredIds } from '../src/background/providers/openai.js'

const KEY = 'sk-TEST-KEY-do-not-leak'
const BASE = 'https://llm.example.test/v1'

const SNAPSHOT = [
  { id: 'e1', tag: 'div', role: 'button', ariaLabel: 'Like ad', text: 'Like', enabled: true },
  { id: 'e2', tag: 'div', role: 'button', ariaLabel: 'Block', text: 'Block', enabled: true },
  { id: 'e3', tag: 'button', role: null, ariaLabel: null, text: 'Continue', enabled: false }
]

const REQUEST = { goal: 'Click Block', stepIndex: 2, lastAction: 'Clicked e4 (My Ad Center)', snapshot: SNAPSHOT }

// Storage mock with the same get(key) shape as chrome.storage.local.
function makeStorage(data = { settings: { baseUrl: BASE, model: 'test-model' }, openaiKey: KEY }) {
  return { get: async (key) => ({ [key]: data[key] }) }
}

function okResponse(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
}

// Records every call so tests can check the request. respond is called with the request.
function makeFetch(respond) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { fetchImpl, calls }
}

function provider(storage, fetchImpl) {
  return createOpenAIProvider({ storage, fetchImpl })
}

async function errorOf(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected a rejection')
}

describe('request (R28, R32)', () => {
  it('posts to {baseUrl}/chat/completions with a Bearer header and the mapped body', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{"choice":"e2","confidence":0.9}'))
    await provider(makeStorage(), fetchImpl).decide(REQUEST)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/chat/completions`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(calls[0].init.body)
    expect(body.model).toBe('test-model')
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
  })

  it('lists every entry id plus WAIT and BLOCKED at steps 1 to 4, with the criteria strings', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{"choice":"WAIT","confidence":0.9}'))
    await provider(makeStorage(), fetchImpl).decide(REQUEST)
    const user = JSON.parse(calls[0].init.body).messages[1].content
    expect(user).toContain('e1: div[role=button] "Like ad"')
    expect(user).toContain('e3: button "Continue" (disabled)')
    expect(user).toContain('WAIT:')
    expect(user).toContain('BLOCKED:')
    expect(user).toContain('Step: 2 of 5')
    expect(user).toContain('Last action: Clicked e4 (My Ad Center)')
  })

  it('offers only WAIT, DONE and BLOCKED at step 5', () => {
    expect(offeredIds({ stepIndex: 5, snapshot: SNAPSHOT })).toEqual(['WAIT', 'DONE', 'BLOCKED'])
    expect(offeredIds({ stepIndex: 2, snapshot: SNAPSHOT })).toEqual(['e1', 'e2', 'e3', 'WAIT', 'BLOCKED'])
  })

  it('sends no lastAction when there is none', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{"choice":"WAIT","confidence":0.9}'))
    await provider(makeStorage(), fetchImpl).decide({ ...REQUEST, lastAction: null })
    expect(JSON.parse(calls[0].init.body).messages[1].content).toContain('Last action: none')
  })
})

describe('response mapping (rules 2 to 5)', () => {
  it('maps an entry id to CLICK with that targetId', () => {
    expect(mapChoice({ choice: 'e2', confidence: 0.9 }, ['e1', 'e2', 'WAIT', 'BLOCKED'])).toEqual({
      operation: 'CLICK',
      targetId: 'e2',
      confidence: 0.9
    })
  })

  it('maps WAIT and BLOCKED with a null targetId', () => {
    expect(mapChoice({ choice: 'WAIT', confidence: 0.8 }, ['e1', 'WAIT', 'BLOCKED'])).toEqual({
      operation: 'WAIT',
      targetId: null,
      confidence: 0.8
    })
    expect(mapChoice({ choice: 'BLOCKED', confidence: 0.99 }, ['e1', 'WAIT', 'BLOCKED']).operation).toBe('BLOCKED')
  })

  it('extracts the first JSON object from surrounding text', async () => {
    const { fetchImpl } = makeFetch(() => okResponse('Sure, here it is: {"choice":"e1","confidence":0.85} hope that helps'))
    const decision = await provider(makeStorage(), fetchImpl).decide(REQUEST)
    expect(decision).toEqual({ operation: 'CLICK', targetId: 'e1', confidence: 0.85 })
  })

  it('a choice outside the offered options throws', async () => {
    const { fetchImpl } = makeFetch(() => okResponse('{"choice":"e9","confidence":0.99}'))
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.reason).toBe('invalid-response')
  })

  it('DONE is rejected at steps 1 to 4', async () => {
    const { fetchImpl } = makeFetch(() => okResponse('{"choice":"DONE","confidence":0.99}'))
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.reason).toBe('invalid-response')
  })

  it('rejects confidence outside [0, 1] or not a number', () => {
    expect(() => mapChoice({ choice: 'e1', confidence: 2 }, ['e1'])).toThrow('invalid-response')
    expect(() => mapChoice({ choice: 'e1', confidence: '0.9' }, ['e1'])).toThrow('invalid-response')
    expect(() => mapChoice({ choice: 'e1', confidence: NaN }, ['e1'])).toThrow('invalid-response')
  })

  it('a body with no JSON object throws malformed', async () => {
    const { fetchImpl } = makeFetch(() => okResponse('I cannot help with that.'))
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.reason).toBe('invalid-response')
  })
})

describe('gpt-oss reasoning settings', () => {
  it('a gpt-oss model gets reasoning_effort low and include_reasoning false', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{"choice":"e2","confidence":0.9}'))
    const storage = makeStorage({ settings: { baseUrl: BASE, model: 'openai/gpt-oss-20b' }, openaiKey: KEY })
    await provider(storage, fetchImpl).decide(REQUEST)
    const body = JSON.parse(calls[0].init.body)
    expect(body.reasoning_effort).toBe('low')
    expect(body.include_reasoning).toBe(false)
  })

  it('a gpt-oss model gets a strict json_schema whose choice enum is the offered ids', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{"choice":"e2","confidence":0.9}'))
    const storage = makeStorage({ settings: { baseUrl: BASE, model: 'openai/gpt-oss-20b' }, openaiKey: KEY })
    await provider(storage, fetchImpl).decide(REQUEST)
    const format = JSON.parse(calls[0].init.body).response_format
    expect(format.type).toBe('json_schema')
    expect(format.json_schema.strict).toBe(true)
    expect(format.json_schema.name).toBe('next_action')
    const schema = format.json_schema.schema
    expect(schema.properties.choice.enum).toEqual(['e1', 'e2', 'e3', 'WAIT', 'BLOCKED'])
    expect(schema.properties.confidence).toEqual({ type: 'number', minimum: 0, maximum: 1 })
    expect(schema.required).toEqual(['choice', 'confidence'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('the answer is still checked even with the strict schema', async () => {
    const { fetchImpl } = makeFetch(() => okResponse('{"choice":"e9","confidence":0.9}'))
    const storage = makeStorage({ settings: { baseUrl: BASE, model: 'openai/gpt-oss-20b' }, openaiKey: KEY })
    const err = await errorOf(provider(storage, fetchImpl).decide(REQUEST))
    expect(err.detail).toBe('choice-not-offered')
  })

  it('any other model gets neither field', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{"choice":"e2","confidence":0.9}'))
    await provider(makeStorage(), fetchImpl).decide(REQUEST)
    const body = JSON.parse(calls[0].init.body)
    expect('reasoning_effort' in body).toBe(false)
    expect('include_reasoning' in body).toBe(false)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })
})

describe('invalid-response detail codes', () => {
  const cases = [
    ['', 'no-content'],
    ['I cannot help with that.', 'no-json-object'],
    ['{"choice": e1}', 'json-parse-failed'],
    ['{"confidence":0.9}', 'choice-missing'],
    ['{"choice":"e9","confidence":0.9}', 'choice-not-offered'],
    ['{"choice":"My Ad Center","confidence":0.9}', 'choice-not-offered'],
    ['{"choice":"e1"}', 'confidence-missing'],
    ['{"choice":"e1","confidence":"0.9"}', 'confidence-string'],
    ['{"choice":"e1","confidence":90}', 'confidence-out-of-range']
  ]
  for (const [content, detail] of cases) {
    it(`${JSON.stringify(content)} gives invalid-response with detail ${detail}`, async () => {
      const { fetchImpl } = makeFetch(() => okResponse(content))
      const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
      expect(err.reason).toBe('invalid-response')
      expect(err.detail).toBe(detail)
    })
  }

  it('a null message content gives no-content', async () => {
    const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: null } }] }) }))
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.detail).toBe('no-content')
  })
})

describe('errors (R43)', () => {
  it('a non-2xx status throws an error holding the status only', async () => {
    const { fetchImpl } = makeFetch(() => ({ ok: false, status: 401, json: async () => ({ error: `bad key ${KEY}` }) }))
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.reason).toBe('provider-auth')
    expect(err.status).toBe(401)
    expect(err.message + String(err.stack)).not.toContain(KEY)
  })

  it('a network failure throws a fixed code with no URL or key', async () => {
    const { fetchImpl } = makeFetch(async () => {
      throw new TypeError(`failed to reach ${BASE} with ${KEY}`)
    })
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.reason).toBe('provider-network')
    expect(err.message + String(err.stack)).not.toContain(KEY)
    expect(err.message + String(err.stack)).not.toContain('llm.example')
  })

  it('a call over 3000ms fails with timeout', async () => {
    const { fetchImpl } = makeFetch((_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted')
        e.name = 'AbortError'
        reject(e)
      })
    }))
    const started = Date.now()
    const err = await errorOf(provider(makeStorage(), fetchImpl).decide(REQUEST))
    expect(err.reason).toBe('provider-timeout')
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900)
  }, 10000)

  it('missing key or settings throws not-configured without any fetch', async () => {
    const { fetchImpl, calls } = makeFetch(() => okResponse('{}'))
    const noKey = await errorOf(provider(makeStorage({ settings: { baseUrl: BASE, model: 'm' } }), fetchImpl).decide(REQUEST))
    const noBase = await errorOf(provider(makeStorage({ settings: { model: 'm' }, openaiKey: KEY }), fetchImpl).decide(REQUEST))
    expect(noKey.reason).toBe('provider-unavailable')
    expect(noBase.reason).toBe('provider-unavailable')
    expect(calls).toHaveLength(0)
  })
})
