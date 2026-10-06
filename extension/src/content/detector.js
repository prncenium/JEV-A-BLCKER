import { LIMITS } from '../shared/constants.js'

const PLAYER_SELECTOR = '#movie_player'
const AD_CLASS = 'ad-showing'
const NAVIGATE_EVENT = 'yt-navigate-finish'
const NAVIGATE_START_EVENT = 'yt-navigate-start'

function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return
  try {
    fn(...args)
  } catch {
    // A failing listener must never break detection.
  }
}

// Identifies the current video: the path plus the v parameter (watch?v=...). Kept in memory only, never logged.
function videoKey() {
  const v = new URLSearchParams(location.search).get('v') || ''
  return `${location.pathname}|${v}`
}

export function startDetector({ onAdDetected, onAdEnded, onNavigated } = {}) {
  let stopped = false
  let player = null
  let classObserver = null
  let lateObserver = null
  let adShowing = false
  let lastDetectedAt = -Infinity
  let lastVideoKey = videoKey()
  let navStartedSinceAd = false

  function handleClassChange() {
    if (!player) return
    const showing = player.classList.contains(AD_CLASS)
    if (showing === adShowing) return
    adShowing = showing
    if (showing) {
      // R3: repeated triggers within DEBOUNCE_MS belong to the same ad instance. Only the first is processed.
      const now = Date.now()
      if (now - lastDetectedAt < LIMITS.DEBOUNCE_MS) return
      lastDetectedAt = now
      navStartedSinceAd = false
      safeCall(onAdDetected)
    } else {
      safeCall(onAdEnded)
    }
  }

  function attach(el) {
    if (classObserver) classObserver.disconnect()
    player = el
    adShowing = false
    classObserver = new MutationObserver(handleClassChange)
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
    // The ad may already be playing when the player is found.
    handleClassChange()
  }

  function findPlayer() {
    return document.querySelector(PLAYER_SELECTOR)
  }

  function waitForPlayer() {
    if (lateObserver) return
    // YouTube is a SPA: #movie_player can appear after the content script runs.
    lateObserver = new MutationObserver(() => {
      const el = findPlayer()
      if (!el) return
      lateObserver.disconnect()
      lateObserver = null
      if (!stopped) attach(el)
    })
    lateObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  function onNavigateStart() {
    navStartedSinceAd = true
  }

  function onNavigate() {
    // The player element can be replaced across SPA navigations; make sure the current one is observed.
    const el = findPlayer()
    if (el && el !== player) attach(el)
    else if (!el && !player) waitForPlayer()
    // R5: only a navigation to a different video resets. YouTube also fires this event without a video change,
    // for example when the first page load finishes while an ad is already playing.
    const key = videoKey()
    const videoChanged = key !== lastVideoKey
    // A navigation that started before the current ad is the one that opened this video. YouTube can start the
    // ad before the navigation finishes, so that finish must not cancel the ad's flow.
    const startedAfterAd = navStartedSinceAd
    const reset = videoChanged && !(adShowing && !startedAfterAd)
    navStartedSinceAd = false
    lastVideoKey = key
    // DD10, TEMPORARY: remove after T15. Booleans only, never the URL.
    console.debug('[JEV debug] navigate', { videoChanged, adShowing, startedAfterAd, reset })
    if (reset) safeCall(onNavigated)
  }

  window.addEventListener(NAVIGATE_START_EVENT, onNavigateStart, true)
  window.addEventListener(NAVIGATE_EVENT, onNavigate, true)

  const initial = findPlayer()
  if (initial) attach(initial)
  else waitForPlayer()

  return function stop() {
    stopped = true
    window.removeEventListener(NAVIGATE_START_EVENT, onNavigateStart, true)
    window.removeEventListener(NAVIGATE_EVENT, onNavigate, true)
    if (classObserver) classObserver.disconnect()
    if (lateObserver) lateObserver.disconnect()
    classObserver = null
    lateObserver = null
    player = null
  }
}
