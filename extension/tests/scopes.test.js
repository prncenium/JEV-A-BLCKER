import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getScope, waitForScope, describeAdCenterButton } from '../src/content/scopes.js'

// npm test runs from extension/, so fixtures resolve from the working directory.
const fixture = (name) => readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8')

// about:blank keeps jsdom's iframe document synchronous and populated while the src still matches the selector.
const SECRET_SRC = 'about:blank#aboutthisad-SECRET-TOKEN-123'

// jsdom has no layout engine: elements marked data-size="0" get a 0x0 box, all others 48x48.
function stubLayout(win) {
  win.Element.prototype.getBoundingClientRect = function () {
    const zero = this.closest && this.closest('[data-size="0"]')
    const w = zero ? 0 : 48
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: w, width: w, height: w }
  }
}

function addIframe(html) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('src', SECRET_SRC)
  document.body.appendChild(iframe)
  stubLayout(iframe.contentWindow)
  const doc = iframe.contentDocument
  if (!doc.body) {
    // jsdom leaves a src-bearing iframe with an empty document; give it a body.
    doc.open()
    doc.write('<!doctype html><html><head></head><body></body></html>')
    doc.close()
  }
  doc.body.innerHTML = html
  return iframe
}

beforeEach(() => {
  document.body.innerHTML = ''
  stubLayout(window)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getScope', () => {
  it('returns #movie_player for steps 1 and 5', () => {
    document.body.innerHTML = fixture('player.html')
    const player = document.querySelector('#movie_player')
    for (const step of [1, 5]) {
      const scope = getScope(step)
      expect(scope.root).toBe(player)
      expect(scope.doc).toBe(document)
    }
  })

  it('returns null for steps 1 and 5 when #movie_player is missing', () => {
    expect(getScope(1)).toBeNull()
    expect(getScope(5)).toBeNull()
  })

  it('returns the iframe document for steps 2 to 4', () => {
    document.body.innerHTML = fixture('player.html')
    const iframe = addIframe(fixture('panel-step2.html'))
    for (const step of [2, 3, 4]) {
      const scope = getScope(step)
      expect(scope.doc).toBe(iframe.contentDocument)
      expect(scope.root).toBe(iframe.contentDocument)
    }
  })

  it('returns null for steps 2 to 4 when there is no aboutthisad iframe', () => {
    document.body.innerHTML = fixture('player.html')
    for (const step of [2, 3, 4]) expect(getScope(step)).toBeNull()
  })

  it('ignores iframes whose src does not contain aboutthisad', () => {
    const other = document.createElement('iframe')
    other.setAttribute('src', 'https://www.youtube.com/embed/other')
    document.body.appendChild(other)
    expect(getScope(2)).toBeNull()
  })

  it('returns null when the iframe contentDocument getter throws', () => {
    const iframe = addIframe(fixture('panel-step2.html'))
    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new Error('SecurityError')
      }
    })
    for (const step of [2, 3, 4]) expect(getScope(step)).toBeNull()
  })

  it('returns null when contentDocument is null', () => {
    const iframe = addIframe(fixture('panel-step2.html'))
    Object.defineProperty(iframe, 'contentDocument', { get: () => null })
    expect(getScope(2)).toBeNull()
  })

  it('returns null for an unknown step', () => {
    document.body.innerHTML = fixture('player.html')
    expect(getScope(0)).toBeNull()
    expect(getScope(6)).toBeNull()
  })

  it('never returns or logs the iframe src', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    document.body.innerHTML = fixture('player.html')
    addIframe(fixture('panel-step2.html'))
    const results = [1, 2, 3, 4, 5].map((s) => getScope(s))
    for (const r of results) {
      // Only { root, doc } DOM nodes come back; no string (such as a src) is returned.
      expect(Object.keys(r).sort()).toEqual(['doc', 'root'])
      for (const v of Object.values(r)) expect(typeof v).toBe('object')
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('waitForScope', () => {
  it('resolves immediately when the scope is ready (step 1 with ad-showing)', async () => {
    document.body.innerHTML = fixture('player.html')
    const scope = await waitForScope(1, 500)
    expect(scope.root).toBe(document.querySelector('#movie_player'))
  })

  it('returns null on timeout when step 1 player lacks ad-showing', async () => {
    document.body.innerHTML = fixture('player.html')
    document.querySelector('#movie_player').classList.remove('ad-showing')
    expect(await waitForScope(1, 120)).toBeNull()
  })

  it('step 1 is not ready while ad-showing is set but the ⓘ is not drawn yet, and becomes ready when it appears', async () => {
    document.body.innerHTML = fixture('player.html')
    const info = document.querySelector('[aria-label="My Ad Center"]')
    const ads = info.parentElement
    info.remove()
    setTimeout(() => ads.appendChild(info), 150)
    const started = Date.now()
    const scope = await waitForScope(1, 2000)
    expect(scope).not.toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('step 1 times out when the only ⓘ is hidden (0x0)', async () => {
    document.body.innerHTML = fixture('player.html')
    document.querySelector('[aria-label="My Ad Center"]').setAttribute('data-size', '0')
    expect(await waitForScope(1, 120)).toBeNull()
  })

  it('describeAdCenterButton reports sizes and styles only', () => {
    document.body.innerHTML = fixture('player.html')
    const info = describeAdCenterButton()
    expect(info).toEqual({
      playerFound: true,
      adShowing: true,
      buttonCount: 1,
      buttons: [{ width: 48, height: 48, display: 'inline-block', visibility: 'visible', inVideoAds: true }]
    })
  })

  it('returns null on timeout when there is no iframe', async () => {
    expect(await waitForScope(2, 120)).toBeNull()
  })

  it('returns null on timeout when the iframe is inaccessible', async () => {
    const iframe = addIframe(fixture('panel-step2.html'))
    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new Error('SecurityError')
      }
    })
    expect(await waitForScope(2, 120)).toBeNull()
  })

  it('step 2 waits until the Main ad controls region is present', async () => {
    const iframe = addIframe('<div>loading</div>')
    setTimeout(() => {
      iframe.contentDocument.body.innerHTML = fixture('panel-step2.html')
    }, 100)
    const scope = await waitForScope(2, 1000)
    expect(scope.doc).toBe(iframe.contentDocument)
    expect(scope.doc.querySelector('[role="region"][aria-label="Main ad controls"]')).not.toBeNull()
  })

  it('step 2 waits for a late iframe', async () => {
    setTimeout(() => addIframe(fixture('panel-step2.html')), 100)
    const scope = await waitForScope(2, 1000)
    expect(scope).not.toBeNull()
  })

  it('step 3 requires the dialog to be visible', async () => {
    addIframe(fixture('panel-step2.html')) // dialog present but hidden
    expect(await waitForScope(3, 150)).toBeNull()
    document.body.innerHTML = ''
    addIframe(fixture('panel-step3.html'))
    expect(await waitForScope(3, 150)).not.toBeNull()
  })

  it('step 4 requires a visible Close outside [role=banner]', async () => {
    addIframe(fixture('panel-step3.html')) // only hidden Close elements
    expect(await waitForScope(4, 150)).toBeNull()
    document.body.innerHTML = ''
    addIframe(fixture('panel-step4.html'))
    expect(await waitForScope(4, 150)).not.toBeNull()
  })

  it('step 5 has no readiness condition', async () => {
    document.body.innerHTML = fixture('player.html')
    document.querySelector('#movie_player').classList.remove('ad-showing')
    expect(await waitForScope(5, 150)).not.toBeNull()
  })
})
