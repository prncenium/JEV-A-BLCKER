import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSnapshot, clearIds } from '../src/content/snapshot.js'
import { isAllowed } from '../src/content/allowlist.js'
import { createOpenAIProvider } from '../src/background/providers/openai.js'
import { STEPS } from '../src/shared/constants.js'

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

function mountPanel(name) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('src', SECRET_SRC)
  document.body.appendChild(iframe)
  stubLayout(iframe.contentWindow)
  const doc = iframe.contentDocument
  if (!doc.body) {
    doc.open()
    doc.write('<!doctype html><html><head></head><body></body></html>')
    doc.close()
  }
  doc.body.innerHTML = fixture(name)
  return doc
}

function mountPlayerHtml(html) {
  document.body.innerHTML = html
}

beforeEach(() => {
  document.body.innerHTML = ''
  stubLayout(window)
})

describe('buildSnapshot step 1 (#movie_player)', () => {
  it('includes the ⓘ button and the player controls in document order, and nothing outside the player', () => {
    mountPlayerHtml(fixture('player.html'))
    const entries = buildSnapshot(1)
    expect(entries.map((e) => `${e.id} ${e.ariaLabel}`)).toEqual([
      'e1 Watch later',
      'e2 Share',
      'e3 My Ad Center',
      'e4 Pause (k)',
      'e5 Mute (m)',
      'e6 Subtitles/closed captions unavailable',
      'e7 Settings',
      'e8 Full screen (f)'
    ])
  })

  it('the ⓘ entry points at the real ⓘ element, and the allowlist accepts exactly that element at step 1', () => {
    mountPlayerHtml(fixture('player.html'))
    const entries = buildSnapshot(1)
    const info = entries.find((e) => e.ariaLabel === 'My Ad Center')
    expect(info).toEqual({ id: 'e3', tag: 'button', role: null, ariaLabel: 'My Ad Center', text: '', enabled: true })

    const el = document.querySelector(`[data-jev-id="${info.id}"]`)
    expect(el.classList.contains('ytp-ad-button')).toBe(true)
    expect(isAllowed(1, el)).toBe(true)

    // R40 is unchanged: every other step 1 candidate is rejected.
    const others = entries.filter((e) => e.id !== info.id).map((e) => document.querySelector(`[data-jev-id="${e.id}"]`))
    expect(others.map((o) => isAllowed(1, o))).toEqual(others.map(() => false))
  })

  it('the model sees the ⓘ as button "My Ad Center" next to the step 1 goal', async () => {
    mountPlayerHtml(fixture('player.html'))
    const snapshot = buildSnapshot(1)
    let body = null
    const provider = createOpenAIProvider({
      storage: { get: async (k) => ({ [k]: k === 'settings' ? { baseUrl: 'https://x.test/v1', model: 'm' } : 'k' }) },
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body)
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"choice":"e3","confidence":0.9}' } }] }) }
      }
    })
    await provider.decide({ goal: STEPS[0].goal, stepIndex: 1, lastAction: null, snapshot })
    const user = body.messages[1].content
    expect(user).toContain('Goal: Open the My Ad Center panel for the playing ad')
    expect(user).toContain('e3: button "My Ad Center"')
  })
})

describe('buildSnapshot steps 2 to 4 (aboutthisad iframe)', () => {
  it('includes Block, Like ad, Report and the visible Close', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step2.html')
    const labels = buildSnapshot(2).map((e) => e.ariaLabel)
    expect(labels).toContain('Block')
    expect(labels).toContain('Like ad')
    expect(labels).toContain('Report')
    expect(labels).toContain('Close')
  })

  it('excludes everything inside [role=banner], including the account aria-label', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step2.html')
    const entries = buildSnapshot(2)
    expect(entries.map((e) => e.ariaLabel)).not.toContain('Go back')
    expect(entries.map((e) => e.ariaLabel)).not.toContain('Google Account: Test User (test@example.com)')
    for (const e of entries) {
      expect(String(e.ariaLabel)).not.toMatch(/test@example\.com|Signed in/)
      expect(e.text).not.toMatch(/test@example\.com|Signed in/)
    }
  })

  it('excludes the hidden 0x0 Close elements, keeping only the visible one', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step2.html')
    const closes = buildSnapshot(2).filter((e) => e.ariaLabel === 'Close')
    expect(closes).toHaveLength(1)
  })

  it('excludes the hidden verification dialog buttons', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step2.html')
    const texts = buildSnapshot(2).map((e) => e.text)
    expect(texts).not.toContain('Cancel')
    expect(texts).not.toContain('Continue')
  })

  it('assigns ids e1, e2, ... in document order, with the first region item first', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step2.html')
    const entries = buildSnapshot(2)
    entries.forEach((e, i) => expect(e.id).toBe(`e${i + 1}`))
    expect(entries[0].ariaLabel).toBe('Like ad')
  })

  it('includes the step 3 dialog Continue button and the step 4 visible Close', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step3.html')
    expect(buildSnapshot(3).map((e) => e.text)).toContain('Continue')
    mountPlayerHtml('<div id="movie_player" class="ad-showing"></div>')
    mountPanel('panel-step4.html')
    const labels = buildSnapshot(4).map((e) => e.ariaLabel)
    expect(labels).toEqual(['Close'])
  })
})

describe('entry shape and text', () => {
  it('has exactly the R8 fields', () => {
    mountPlayerHtml(fixture('player.html'))
    const [entry] = buildSnapshot(1)
    expect(Object.keys(entry).sort()).toEqual(['ariaLabel', 'enabled', 'id', 'role', 'tag', 'text'])
    expect(entry.tag).toBe('button')
    expect(entry.role).toBeNull()
    expect(entry.enabled).toBe(true)
  })

  it('trims text and cuts it to 80 characters', () => {
    mountPlayerHtml(
      `<div id="movie_player" class="ad-showing"><button aria-label="Long">   ${'a'.repeat(120)}   </button></div>`
    )
    const [entry] = buildSnapshot(1)
    expect(entry.text).toHaveLength(80)
    expect(entry.text).toBe('a'.repeat(80))
  })

  it('reports disabled buttons as not enabled', () => {
    mountPlayerHtml('<div id="movie_player" class="ad-showing"><button aria-label="Off" disabled>Off</button></div>')
    const [entry] = buildSnapshot(1)
    expect(entry.enabled).toBe(false)
  })
})

describe('40-entry cap', () => {
  it('returns exactly 40 entries for 60 candidates, the first 40 in document order', () => {
    const buttons = Array.from({ length: 60 }, (_, i) => `<button aria-label="Option ${i + 1}">Option ${i + 1}</button>`)
    mountPlayerHtml(`<div id="movie_player" class="ad-showing">${buttons.join('')}</div>`)
    const entries = buildSnapshot(1)
    expect(entries).toHaveLength(40)
    expect(entries[0].ariaLabel).toBe('Option 1')
    expect(entries[39].ariaLabel).toBe('Option 40')
    expect(entries[39].id).toBe('e40')
    expect(document.querySelectorAll('[data-jev-id]')).toHaveLength(40)
  })
})

describe('clearIds', () => {
  it('removes every data-jev-id from the top page and the iframe document', () => {
    mountPlayerHtml(fixture('player.html'))
    const iframeDoc = mountPanel('panel-step2.html')
    buildSnapshot(1)
    buildSnapshot(2)
    document.querySelector('#movie_player').setAttribute('data-jev-id', 'e99')
    expect(document.querySelectorAll('[data-jev-id]').length).toBeGreaterThan(0)
    expect(iframeDoc.querySelectorAll('[data-jev-id]').length).toBeGreaterThan(0)

    clearIds()

    expect(document.querySelectorAll('[data-jev-id]')).toHaveLength(0)
    expect(iframeDoc.querySelectorAll('[data-jev-id]')).toHaveLength(0)
  })

  it('a new snapshot never leaves an id from an earlier snapshot behind', () => {
    mountPlayerHtml(fixture('player.html'))
    buildSnapshot(1)
    document.querySelector('.ytp-chrome-top').remove()
    const latest = buildSnapshot(5)
    const withIds = [...document.querySelectorAll('[data-jev-id]')]
    // Only the latest snapshot's ids remain, and each id is on the element that snapshot described.
    expect(withIds).toHaveLength(latest.length)
    for (const entry of latest) {
      const el = document.querySelector(`[data-jev-id="${entry.id}"]`)
      expect(el.getAttribute('aria-label')).toBe(entry.ariaLabel)
    }
    expect(latest.find((e) => e.ariaLabel === 'My Ad Center').id).toBe('e1')
  })
})
