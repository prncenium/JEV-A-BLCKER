import { OPERATIONS, LIMITS } from '../shared/constants.js'

const ID_ATTRIBUTE = 'data-jev-id'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Matches by attribute value, so the id is never interpolated into a selector.
function findById(root, id) {
  for (const el of root.querySelectorAll(`[${ID_ATTRIBUTE}]`)) {
    if (el.getAttribute(ID_ATTRIBUTE) === id) return el
  }
  return null
}

// Resolves on the first DOM mutation inside root, or after CLICK_WAIT_MS, whichever comes first.
// The observer is started before the click so a synchronous mutation is not missed.
function clickAndWait(el, root) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const observer = new MutationObserver(() => finish(true))

    function finish(mutated) {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      resolve({ mutated })
    }

    observer.observe(root, { childList: true, attributes: true, characterData: true, subtree: true })
    timer = setTimeout(() => finish(false), LIMITS.CLICK_WAIT_MS)
    try {
      el.click()
    } catch (err) {
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      throw err
    }
  })
}

// ctx: { scope: { root, doc } } for the current step, as returned by getScope.
export async function execute(decision, ctx) {
  const operation = decision && decision.operation
  switch (operation) {
    case OPERATIONS.CLICK: {
      const scope = ctx && ctx.scope
      if (!scope || !scope.root) throw new Error('CLICK needs a scope')
      const el = findById(scope.root, decision.targetId)
      if (!el) throw new Error('CLICK target not found')
      // S2: plain element.click() works on all four R40 targets. No event-sequence fallback.
      const { mutated } = await clickAndWait(el, scope.root)
      return { ok: true, operation, mutated }
    }
    case OPERATIONS.WAIT:
      await sleep(LIMITS.WAIT_MS)
      return { ok: true, operation }
    case OPERATIONS.DONE:
      return { ok: true, operation }
    default:
      // R21: nothing outside CLICK, WAIT and DONE ever executes (BLOCKED included).
      throw new Error('operation not executable')
  }
}
