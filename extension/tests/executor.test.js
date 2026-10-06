import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execute } from '../src/content/executor.js'

let root
let target
let other

const flush = () => vi.advanceTimersByTimeAsync(0)

function scope() {
  return { root, doc: document }
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = `
    <div id="movie_player">
      <button id="a" data-jev-id="e1">One</button>
      <button id="b" data-jev-id="e2">Two</button>
    </div>
    <button id="outside" data-jev-id="e9">Outside</button>`
  root = document.getElementById('movie_player')
  target = document.getElementById('b')
  other = document.getElementById('a')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CLICK', () => {
  it('clicks the element with the matching data-jev-id and no other', async () => {
    const t = vi.fn()
    const o = vi.fn()
    target.addEventListener('click', t)
    other.addEventListener('click', o)
    const p = execute({ operation: 'CLICK', targetId: 'e2', confidence: 0.9 }, { scope: scope() })
    await vi.advanceTimersByTimeAsync(800)
    await p
    expect(t).toHaveBeenCalledTimes(1)
    expect(o).not.toHaveBeenCalled()
  })

  it('uses plain click() only, with no pointer or mouse event sequence', async () => {
    const seen = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(type, () => seen.push(type))
    }
    const p = execute({ operation: 'CLICK', targetId: 'e2', confidence: 0.9 }, { scope: scope() })
    await vi.advanceTimersByTimeAsync(800)
    await p
    expect(seen).toEqual(['click'])
  })

  it('resolves on the first DOM mutation in scope, before 800ms', async () => {
    target.addEventListener('click', () => {
      const n = document.createElement('span')
      root.appendChild(n)
    })
    let done = false
    const p = execute({ operation: 'CLICK', targetId: 'e2', confidence: 0.9 }, { scope: scope() }).then((r) => {
      done = true
      return r
    })
    await flush()
    expect(done).toBe(true)
    expect(await p).toEqual({ ok: true, operation: 'CLICK', mutated: true })
  })

  it('resolves on an attribute mutation that happens later, before 800ms', async () => {
    let done = false
    const p = execute({ operation: 'CLICK', targetId: 'e2', confidence: 0.9 }, { scope: scope() }).then((r) => {
      done = true
      return r
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(done).toBe(false)
    root.setAttribute('data-x', '1')
    await flush()
    expect(done).toBe(true)
    expect((await p).mutated).toBe(true)
  })

  it('resolves after 800ms when nothing mutates', async () => {
    let done = false
    const p = execute({ operation: 'CLICK', targetId: 'e2', confidence: 0.9 }, { scope: scope() }).then((r) => {
      done = true
      return r
    })
    await vi.advanceTimersByTimeAsync(799)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    expect(await p).toEqual({ ok: true, operation: 'CLICK', mutated: false })
  })

  it('ignores mutations outside the scope root', async () => {
    let done = false
    const p = execute({ operation: 'CLICK', targetId: 'e2', confidence: 0.9 }, { scope: scope() }).then((r) => {
      done = true
      return r
    })
    document.body.appendChild(document.createElement('div'))
    await vi.advanceTimersByTimeAsync(500)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    expect((await p).mutated).toBe(false)
  })

  it('works with a Document as the scope root (iframe scope)', async () => {
    const clicked = vi.fn()
    document.getElementById('outside').addEventListener('click', clicked)
    const p = execute({ operation: 'CLICK', targetId: 'e9', confidence: 0.9 }, { scope: { root: document, doc: document } })
    await vi.advanceTimersByTimeAsync(800)
    await p
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('throws when no element has the id, and clicks nothing', async () => {
    const t = vi.fn()
    target.addEventListener('click', t)
    await expect(execute({ operation: 'CLICK', targetId: 'e77' }, { scope: scope() })).rejects.toThrow()
    expect(t).not.toHaveBeenCalled()
  })

  it('does not resolve an id outside the scope root', async () => {
    await expect(execute({ operation: 'CLICK', targetId: 'e9' }, { scope: scope() })).rejects.toThrow()
  })

  it('throws without a scope and does not treat the id as a selector', async () => {
    await expect(execute({ operation: 'CLICK', targetId: 'e2' }, {})).rejects.toThrow()
    await expect(execute({ operation: 'CLICK', targetId: 'e2' })).rejects.toThrow()
    await expect(execute({ operation: 'CLICK', targetId: '"] , body [x="' }, { scope: scope() })).rejects.toThrow()
  })
})

describe('WAIT', () => {
  it('resolves after 500ms', async () => {
    let done = false
    const p = execute({ operation: 'WAIT', targetId: null, confidence: 0.9 }, { scope: scope() }).then((r) => {
      done = true
      return r
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    expect((await p).ok).toBe(true)
  })

  it('clicks nothing', async () => {
    const t = vi.fn()
    target.addEventListener('click', t)
    const p = execute({ operation: 'WAIT', targetId: null }, { scope: scope() })
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(t).not.toHaveBeenCalled()
  })
})

describe('DONE', () => {
  it('returns success immediately', async () => {
    expect(await execute({ operation: 'DONE', targetId: null, confidence: 0.9 }, { scope: scope() })).toEqual({
      ok: true,
      operation: 'DONE'
    })
  })
})

describe('any other operation throws', () => {
  it.each(['BLOCKED', 'click', 'SCROLL', 'TYPE', '', undefined, null, 5])('throws for %s', async (operation) => {
    const t = vi.fn()
    target.addEventListener('click', t)
    await expect(execute({ operation, targetId: 'e2' }, { scope: scope() })).rejects.toThrow()
    expect(t).not.toHaveBeenCalled()
  })

  it('throws for a null or missing decision', async () => {
    await expect(execute(null, { scope: scope() })).rejects.toThrow()
    await expect(execute(undefined, { scope: scope() })).rejects.toThrow()
  })
})
