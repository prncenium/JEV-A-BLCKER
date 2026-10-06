import { LIMITS } from '../shared/constants.js'
import { getScope, isVisible } from './scopes.js'

const ID_ATTRIBUTE = 'data-jev-id'
const IFRAME_SELECTOR = 'iframe[src*="aboutthisad"]'
const CLICKABLE = 'button, a, [role="button"], [role="menuitem"]'
const BANNER_SELECTOR = '[role=banner]'
const REGION_SELECTOR = '[role="region"][aria-label="Main ad controls"]'
const DIALOG_SELECTOR = 'div[role=dialog][aria-label="Stop seeing this ad?"]'

// R9: inside the aboutthisad iframe only the Main ad controls region, the Stop seeing this ad? dialog
// and the visible Close button may be sent. Visibility is checked by the caller.
function inPanelAllowedArea(el) {
  if (el.closest(REGION_SELECTOR) || el.closest(DIALOG_SELECTOR)) return true
  return el.tagName === 'BUTTON' && el.getAttribute('aria-label') === 'Close'
}

function isEnabled(el) {
  return !el.disabled && el.getAttribute('aria-disabled') !== 'true'
}

function toEntry(el, id) {
  return {
    id,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    text: (el.textContent || '').trim().slice(0, LIMITS.TEXT_MAX),
    enabled: isEnabled(el)
  }
}

// Removes data-jev-id from the top page and from the aboutthisad iframe document.
export function clearIds() {
  for (const el of document.querySelectorAll(`[${ID_ATTRIBUTE}]`)) el.removeAttribute(ID_ATTRIBUTE)
  try {
    const iframe = document.querySelector(IFRAME_SELECTOR)
    const doc = iframe && iframe.contentDocument
    if (doc) {
      for (const el of doc.querySelectorAll(`[${ID_ATTRIBUTE}]`)) el.removeAttribute(ID_ATTRIBUTE)
    }
  } catch {
    // An inaccessible iframe holds no ids we could have set.
  }
}

// Clears old ids first, so an id from an earlier snapshot can never point at a different element.
// Keeps the first MAX_SNAPSHOT eligible candidates in document order.
export function buildSnapshot(step) {
  clearIds()
  const scope = getScope(step)
  if (!scope) return []
  const inPanel = scope.doc !== document
  const entries = []
  for (const el of scope.root.querySelectorAll(CLICKABLE)) {
    if (entries.length >= LIMITS.MAX_SNAPSHOT) break
    if (el.closest(BANNER_SELECTOR)) continue
    if (!isVisible(el)) continue
    if (inPanel && !inPanelAllowedArea(el)) continue
    const id = `e${entries.length + 1}`
    el.setAttribute(ID_ATTRIBUTE, id)
    entries.push(toEntry(el, id))
  }
  return entries
}
