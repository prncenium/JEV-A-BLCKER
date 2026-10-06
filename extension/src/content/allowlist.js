import { getScope, isVisible } from './scopes.js'

const DIALOG_SELECTOR = 'div[role=dialog][aria-label="Stop seeing this ad?"]'

function isElement(el) {
  return !!el && typeof el === 'object' && el.nodeType === 1 && typeof el.closest === 'function'
}

function tag(el) {
  return el.tagName.toLowerCase()
}

// True only when the element lives in the aboutthisad iframe document itself.
function inPanelIframe(el, step) {
  const scope = getScope(step)
  return !!scope && el.ownerDocument === scope.doc && scope.doc !== document
}

// R40 rules (a) to (d). At step N only the rule for step N may pass (DD2). Step 5 allows nothing.
const RULES = {
  // (a) button[aria-label="My Ad Center"] inside #movie_player
  1: (el) =>
    tag(el) === 'button' &&
    el.getAttribute('aria-label') === 'My Ad Center' &&
    el.ownerDocument === document &&
    el.closest('#movie_player') !== null,

  // (b) div[role=button][aria-label="Block"] inside the aboutthisad iframe
  2: (el) =>
    inPanelIframe(el, 2) &&
    tag(el) === 'div' &&
    el.getAttribute('role') === 'button' &&
    el.getAttribute('aria-label') === 'Block',

  // (c) button with trimmed text "Continue" inside the Stop seeing this ad? dialog in the iframe
  3: (el) =>
    inPanelIframe(el, 3) &&
    tag(el) === 'button' &&
    el.textContent.trim() === 'Continue' &&
    el.closest(DIALOG_SELECTOR) !== null,

  // (d) the visible button[aria-label="Close"] in the iframe, not inside [role=banner]
  4: (el) =>
    inPanelIframe(el, 4) &&
    tag(el) === 'button' &&
    el.getAttribute('aria-label') === 'Close' &&
    el.closest('[role=banner]') === null &&
    isVisible(el)
}

export function isAllowed(step, element) {
  try {
    if (!isElement(element) || typeof step !== 'number') return false
    const rule = RULES[step]
    return typeof rule === 'function' ? rule(element) === true : false
  } catch {
    return false
  }
}
