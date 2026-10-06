import { SCOPE_KINDS, STEPS } from '../shared/constants.js'

const PLAYER_SELECTOR = '#movie_player'
const IFRAME_SELECTOR = 'iframe[src*="aboutthisad"]'
const REGION_SELECTOR = '[role="region"][aria-label="Main ad controls"]'
const DIALOG_SELECTOR = 'div[role=dialog][aria-label="Stop seeing this ad?"]'
const CLOSE_SELECTOR = 'button[aria-label="Close"]'
const POLL_MS = 50

// Non-zero bounding box, not display:none, not visibility:hidden.
export function isVisible(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false
  const rect = el.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return false
  const view = el.ownerDocument && el.ownerDocument.defaultView
  if (view) {
    const style = view.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function stepEntry(step) {
  return STEPS.find((s) => s.step === step) || null
}

// The iframe src is never read, returned or logged. Only contentDocument is touched.
function getIframeDocument() {
  try {
    const iframe = document.querySelector(IFRAME_SELECTOR)
    if (!iframe) return null
    return iframe.contentDocument || null
  } catch {
    return null
  }
}

export function getScope(step) {
  const entry = stepEntry(step)
  if (!entry) return null
  if (entry.scope === SCOPE_KINDS.PLAYER) {
    const root = document.querySelector(PLAYER_SELECTOR)
    return root ? { root, doc: document } : null
  }
  const doc = getIframeDocument()
  return doc ? { root: doc, doc } : null
}

function visibleClose(doc) {
  return [...doc.querySelectorAll(CLOSE_SELECTOR)].some((el) => !el.closest('[role=banner]') && isVisible(el))
}

const AD_CENTER_SELECTOR = 'button[aria-label="My Ad Center"]'

function visibleAdCenterButton(root) {
  return [...root.querySelectorAll(AD_CENTER_SELECTOR)].some((el) => isVisible(el))
}

// DD10, TEMPORARY: remove after T15. Numbers and booleans only, for the console when step 1 never becomes ready.
export function describeAdCenterButton() {
  const player = document.querySelector(PLAYER_SELECTOR)
  const buttons = player ? [...player.querySelectorAll(AD_CENTER_SELECTOR)] : []
  return {
    playerFound: !!player,
    adShowing: !!player && player.classList.contains('ad-showing'),
    buttonCount: buttons.length,
    buttons: buttons.map((el) => {
      const rect = el.getBoundingClientRect()
      const style = el.ownerDocument.defaultView.getComputedStyle(el)
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        display: style.display,
        visibility: style.visibility,
        inVideoAds: !!el.closest('.video-ads')
      }
    })
  }
}

// Readiness per step, from the steps table in 03-design.md.
function isReady(step, scope) {
  try {
    switch (step) {
      case 1:
        // The ad overlay is drawn after ad-showing is set, so also wait for the visible ⓘ (R40 rule a target).
        return scope.root.classList.contains('ad-showing') && visibleAdCenterButton(scope.root)
      case 2:
        return !!scope.doc.querySelector(REGION_SELECTOR)
      case 3:
        return isVisible(scope.doc.querySelector(DIALOG_SELECTOR))
      case 4:
        return visibleClose(scope.doc)
      default:
        return true
    }
  } catch {
    return false
  }
}

export function waitForScope(step, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const scope = getScope(step)
      if (scope && isReady(step, scope)) return resolve(scope)
      if (Date.now() >= deadline) return resolve(null)
      setTimeout(check, POLL_MS)
    }
    check()
  })
}
