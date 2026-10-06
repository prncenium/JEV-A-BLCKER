import { describe, it, expect, beforeEach } from 'vitest'
import { isAllowed } from '../src/content/allowlist.js'

// jsdom has no layout engine: elements inside [data-size="0"] get a 0x0 box, all others 48x48.
function stubLayout(win) {
  win.Element.prototype.getBoundingClientRect = function () {
    const zero = this.closest && this.closest('[data-size="0"]')
    const w = zero ? 0 : 48
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: w, width: w, height: w }
  }
}

const PLAYER = `
  <div id="movie_player" class="html5-video-player ad-showing">
    <div class="video-ads">
      <span class="ytp-ad-badge">Sponsored</span>
      <button id="ii" class="ytp-ad-button" aria-label="My Ad Center"></button>
      <button id="like-top" aria-label="Like ad"></button>
    </div>
  </div>
  <button id="cancel-top" aria-label="Cancel" data-size="0">Cancel</button>
  <button id="ii-outside" aria-label="My Ad Center"></button>`

const PANEL = `
  <div role="banner" aria-label="Signed in as Test User test@example.com">
    <div role="button" id="goback" aria-label="Go back">Back</div>
    <div role="button" id="mainmenu" aria-label="Main menu">Menu</div>
    <button id="close-banner" aria-label="Close">X</button>
    <div role="button" id="account" aria-label="Google Account">T</div>
  </div>
  <div role="region" aria-label="Main ad controls">
    <div role="button" id="like" aria-label="Like ad">Like</div>
    <div role="button" id="block" aria-label="Block">Block</div>
    <div role="button" id="report" aria-label="Report">Report</div>
    <div role="button" id="more" aria-label="See more Acme ads">See more Acme ads</div>
    <div role="button" id="fewer" aria-label="See fewer Acme ads">See fewer Acme ads</div>
    <a href="#" id="customize" aria-label="Customize more of your ads">Customize more of your ads</a>
    <div role="button" id="feedback" aria-label="Send feedback">Send feedback</div>
    <span role="button" id="block-span" aria-label="Block">Block</span>
    <div id="block-norole" aria-label="Block">Block</div>
  </div>
  <div role="dialog" aria-label="Stop seeing this ad?">
    <button id="cancel">Cancel</button>
    <button id="continue"> Continue </button>
    <button id="continue-label" aria-label="Continue"></button>
  </div>
  <button id="continue-outside">Continue</button>
  <div role="dialog" aria-label="Some other dialog"><button id="continue-other">Continue</button></div>
  <button id="close-hidden" aria-label="Close" data-size="0"></button>
  <button id="close-hidden2" aria-label="Close" data-size="0"></button>
  <button id="close-visible" aria-label="Close">X</button>`

let iframe

function $(id) {
  return document.getElementById(id) || iframe.contentDocument.getElementById(id)
}

beforeEach(() => {
  document.body.innerHTML = PLAYER
  stubLayout(window)
  iframe = document.createElement('iframe')
  iframe.setAttribute('src', 'about:blank#aboutthisad')
  document.body.appendChild(iframe)
  stubLayout(iframe.contentWindow)
  const doc = iframe.contentDocument
  if (!doc.body) {
    doc.open()
    doc.write('<!doctype html><html><head></head><body></body></html>')
    doc.close()
  }
  doc.body.innerHTML = PANEL
})

describe('rule (a): ⓘ only at step 1', () => {
  it('allows My Ad Center inside #movie_player at step 1', () => {
    expect(isAllowed(1, $('ii'))).toBe(true)
  })
  it('rejects a My Ad Center button outside #movie_player', () => {
    expect(isAllowed(1, $('ii-outside'))).toBe(false)
  })
  it('rejects other player buttons at step 1', () => {
    expect(isAllowed(1, $('like-top'))).toBe(false)
    expect(isAllowed(1, $('cancel-top'))).toBe(false)
  })
  it('rejects every panel element at step 1', () => {
    for (const id of ['block', 'continue', 'close-visible']) expect(isAllowed(1, $(id))).toBe(false)
  })
  it('rejects the ⓘ at steps 2, 3 and 4', () => {
    for (const step of [2, 3, 4]) expect(isAllowed(step, $('ii'))).toBe(false)
  })
})

describe('rule (b): Block only at step 2', () => {
  it('allows div[role=button][aria-label=Block] in the iframe at step 2', () => {
    expect(isAllowed(2, $('block'))).toBe(true)
  })
  it('rejects Block at steps 1, 3, 4 and 5', () => {
    for (const step of [1, 3, 4, 5]) expect(isAllowed(step, $('block'))).toBe(false)
  })
  it('rejects lookalikes: wrong tag, missing role', () => {
    expect(isAllowed(2, $('block-span'))).toBe(false)
    expect(isAllowed(2, $('block-norole'))).toBe(false)
  })
  it('rejects a Block-shaped element in the top page (not the iframe)', () => {
    const fake = document.createElement('div')
    fake.setAttribute('role', 'button')
    fake.setAttribute('aria-label', 'Block')
    document.body.appendChild(fake)
    expect(isAllowed(2, fake)).toBe(false)
  })
})

describe('rule (c): Continue only at step 3', () => {
  it('allows the Continue button inside the Stop seeing this ad? dialog at step 3', () => {
    expect(isAllowed(3, $('continue'))).toBe(true)
  })
  it('rejects Continue at steps 1, 2, 4 and 5', () => {
    for (const step of [1, 2, 4, 5]) expect(isAllowed(step, $('continue'))).toBe(false)
  })
  it('rejects Continue outside the dialog or inside a different dialog', () => {
    expect(isAllowed(3, $('continue-outside'))).toBe(false)
    expect(isAllowed(3, $('continue-other'))).toBe(false)
  })
  it('rejects a button whose label is Continue but whose text is not', () => {
    expect(isAllowed(3, $('continue-label'))).toBe(false)
  })
  it('rejects Cancel in the dialog and the top page Cancel buttons', () => {
    expect(isAllowed(3, $('cancel'))).toBe(false)
    expect(isAllowed(3, $('cancel-top'))).toBe(false)
  })
})

describe('rule (d): visible Close only at step 4', () => {
  it('allows the visible Close outside [role=banner] at step 4', () => {
    expect(isAllowed(4, $('close-visible'))).toBe(true)
  })
  it('rejects a hidden Close', () => {
    expect(isAllowed(4, $('close-hidden'))).toBe(false)
    expect(isAllowed(4, $('close-hidden2'))).toBe(false)
  })
  it('rejects a Close inside [role=banner]', () => {
    expect(isAllowed(4, $('close-banner'))).toBe(false)
  })
  it('rejects Close at steps 1, 2, 3 and 5', () => {
    for (const step of [1, 2, 3, 5]) expect(isAllowed(step, $('close-visible'))).toBe(false)
  })
})

describe('never-click targets', () => {
  const dangerous = ['like', 'report', 'more', 'fewer', 'customize', 'feedback', 'cancel', 'mainmenu', 'goback', 'account']
  it.each(dangerous)('rejects %s at every step', (id) => {
    for (const step of [1, 2, 3, 4, 5]) expect(isAllowed(step, $(id))).toBe(false)
  })
})

describe('step 5 allows no click', () => {
  it('rejects every allowlisted target at step 5', () => {
    for (const id of ['ii', 'block', 'continue', 'close-visible']) expect(isAllowed(5, $(id))).toBe(false)
  })
})

describe('robustness', () => {
  it('rejects null, undefined, non-elements and unknown steps without throwing', () => {
    for (const el of [null, undefined, {}, 'x', 5, document, iframe.contentDocument]) {
      expect(isAllowed(2, el)).toBe(false)
    }
    for (const step of [0, 6, -1, NaN, undefined, '2']) expect(isAllowed(step, $('block'))).toBe(false)
  })
  it('rejects the panel targets when the iframe is inaccessible', () => {
    const block = $('block')
    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new Error('SecurityError')
      }
    })
    expect(isAllowed(2, block)).toBe(false)
  })
})
