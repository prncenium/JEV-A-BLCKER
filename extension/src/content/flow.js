import { OPERATIONS, THRESHOLDS, LIMITS, STEPS, PROVIDER_REASONS } from '../shared/constants.js'
import { validateDecision } from '../shared/schema.js'
import { getScope, waitForScope, isVisible, describeAdCenterButton } from './scopes.js'
import { buildSnapshot, clearIds } from './snapshot.js'
import { isAllowed } from './allowlist.js'
import { execute } from './executor.js'

const ID_ATTRIBUTE = 'data-jev-id'
const PLAYER_SELECTOR = '#movie_player'
const AD_CLASS = 'ad-showing'
const CLOSE_STEP = 4 // The last step with a model call. Its click is followed by local verification (R44, DD8).
const CLOSE_WAIT_MS = 3000
const CLOSE_POLL_MS = 100
const CLOSE_SELECTOR = 'button[aria-label="Close"]'
const BANNER_SELECTOR = '[role=banner]'

class FlowAbort extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

// processed marks an ad instance whose flow already ran (R22). current is the running flow, if any.
const state = { processed: false, current: null }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, ms) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new FlowAbort('timeout')), Math.max(0, ms))
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// DD10, TEMPORARY: remove after T15. Console of the YouTube tab only. Never stored, never sent, never logged.
const DEBUG_TEXT_MAX = 40
const cut = (value) => (typeof value === 'string' ? value.slice(0, DEBUG_TEXT_MAX) : value)

function debugRejected(step, snapshot, chosenId) {
  const offered = snapshot.map((e) => ({ id: e.id, tag: e.tag, role: cut(e.role), ariaLabel: cut(e.ariaLabel), text: cut(e.text) }))
  console.debug('[JEV debug]', { step, offered, chosenId: cut(chosenId) })
}

// Keeps a provider's fixed reason code, and nothing else from its message.
function providerReason(err) {
  const reason = err && err.reason
  return PROVIDER_REASONS.includes(reason) ? reason : 'error'
}

function elapsed(run) {
  return run.now() - run.startedAt
}

function remaining(run) {
  return LIMITS.MAX_MS - elapsed(run)
}

// R24 and cancellation are checked between every async step.
function guard(run) {
  if (run.cancelled) throw new FlowAbort(run.cancelled)
  if (elapsed(run) > LIMITS.MAX_MS) throw new FlowAbort('timeout')
}

function findElement(root, id) {
  for (const el of root.querySelectorAll(`[${ID_ATTRIBUTE}]`)) {
    if (el.getAttribute(ID_ATTRIBUTE) === id) return el
  }
  return null
}

function playerShowsAd() {
  const player = document.querySelector(PLAYER_SELECTOR)
  return !!player && player.classList.contains(AD_CLASS)
}

// The panel is open while a visible Close button sits outside the banner (scopes.js readiness for step 4).
function panelCloseOpen() {
  const scope = getScope(CLOSE_STEP)
  if (!scope) return false
  return [...scope.doc.querySelectorAll(CLOSE_SELECTOR)].some(
    (el) => !el.closest(BANNER_SELECTOR) && isVisible(el)
  )
}

// R44: no model call. Success as soon as the ad class is gone or the panel Close is gone.
async function verifyClosed(run) {
  const deadline = Math.min(run.now() + CLOSE_WAIT_MS, run.startedAt + LIMITS.MAX_MS)
  for (;;) {
    if (!playerShowsAd() || !panelCloseOpen()) return true
    if (run.now() >= deadline) return false
    await sleep(CLOSE_POLL_MS)
  }
}

async function executeSteps(run, provider) {
  let step = 1
  let retryUsed = false
  let lastAction = null

  for (;;) {
    guard(run)
    const scope = await waitForScope(step, remaining(run))
    if (!scope) {
      // DD10, TEMPORARY: say why step 1 never became ready. Sizes and styles only.
      if (step === 1 && !run.cancelled) console.debug('[JEV debug] step1-not-ready', describeAdCenterButton())
      throw new FlowAbort('scope-unavailable')
    }
    guard(run)

    // R23: at most MAX_CALLS model calls per ad instance.
    if (run.calls >= LIMITS.MAX_CALLS) throw new FlowAbort('call-limit')
    const snapshot = buildSnapshot(step)
    const request = { goal: STEPS[step - 1].goal, stepIndex: step, lastAction, snapshot }
    run.calls += 1
    let raw
    try {
      raw = await withTimeout(Promise.resolve().then(() => provider.decide(request)), remaining(run))
    } catch (err) {
      if (err instanceof FlowAbort) throw err
      // A provider failure keeps its fixed code, so the log says what failed. Anything else is generic.
      throw new FlowAbort(providerReason(err))
    }
    guard(run)

    const checked = validateDecision(raw)
    if (!checked.ok) throw new FlowAbort('bad-decision')
    const decision = checked.value
    run.confidences.push(decision.confidence)

    if (decision.operation === OPERATIONS.BLOCKED) throw new FlowAbort('blocked')
    if (decision.confidence < THRESHOLDS.RETRY) throw new FlowAbort('low-confidence')
    if (decision.confidence < THRESHOLDS.ACT) {
      // R14: one retry for this step, then abort.
      if (retryUsed) throw new FlowAbort('retry-exhausted')
      retryUsed = true
      continue
    }

    switch (decision.operation) {
      case OPERATIONS.WAIT:
        // R19: pause and re-snapshot the same step.
        await execute(decision, { scope })
        continue
      case OPERATIONS.DONE:
        // Only step 5 is verified locally (R44). A DONE before the panel is closed is not trusted.
        throw new FlowAbort('unexpected-done')
      case OPERATIONS.CLICK:
        break
      default:
        throw new FlowAbort('bad-decision')
    }

    const entry = snapshot.find((e) => e.id === decision.targetId)
    if (!entry) {
      debugRejected(step, snapshot, decision.targetId)
      throw new FlowAbort('unknown-target')
    }
    const el = findElement(scope.root, entry.id)
    if (!el || !isAllowed(step, el)) {
      debugRejected(step, snapshot, decision.targetId)
      throw new FlowAbort('not-allowed')
    }

    // R45: set before the click, so an ad-ended event fired by the click itself does not cancel the flow.
    if (step === CLOSE_STEP) run.stepFourClicked = true
    await execute(decision, { scope })
    run.clicks += 1
    lastAction = `Clicked ${entry.id} (${entry.ariaLabel || entry.text || entry.tag})`

    if (step === CLOSE_STEP) {
      const closed = await verifyClosed(run)
      if (run.cancelled) throw new FlowAbort(run.cancelled)
      if (!closed) throw new FlowAbort('close-not-verified')
      return
    }

    step += 1
    retryUsed = false
  }
}

async function writeLog(log, run, result) {
  if (typeof log !== 'function') return
  const entry = {
    ts: run.now(),
    outcome: result.outcome,
    reason: result.reason,
    steps: run.clicks,
    calls: run.calls,
    durationMs: elapsed(run),
    confidences: run.confidences
  }
  try {
    await log(entry)
  } catch {
    // Logging must never break the page.
  }
}

// ctx: { provider: { decide(request) }, log(entry), now?() }. decide resolves to a raw decision.
export async function runFlow(ctx) {
  if (state.processed || state.current) return { outcome: 'skipped', reason: 'already-processed' }

  const now = typeof ctx.now === 'function' ? ctx.now : Date.now
  const run = {
    now,
    startedAt: now(),
    calls: 0,
    clicks: 0,
    confidences: [],
    cancelled: null,
    stepFourClicked: false,
    resetDuring: false
  }
  state.current = run

  let result
  try {
    await executeSteps(run, ctx.provider)
    result = { outcome: 'success', reason: 'verified-closed' }
  } catch (err) {
    result = { outcome: 'abort', reason: err instanceof FlowAbort ? err.reason : 'error' }
  } finally {
    clearIds()
    state.current = null
    // A flow that ended with the ad or the page gone must not block the next ad.
    state.processed = !run.resetDuring
  }

  await writeLog(ctx.log, run, result)
  return result
}

// kind: 'ad-ended' (AD_ENDED) or 'navigated' (NAVIGATED).
export function resetFlow(kind = 'navigated') {
  const run = state.current
  if (run) {
    run.resetDuring = true
    // R45: removal of ad-showing after the step 4 click is success, so the running flow is not reset.
    if (kind === 'ad-ended' && run.stepFourClicked) return
    run.cancelled = kind === 'navigated' ? 'navigated' : 'ad-ended'
    return
  }
  state.processed = false
}
