import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startDetector } from '../src/content/detector.js'
import { LIMITS } from '../src/shared/constants.js'

let stop
let cb

// MutationObserver callbacks are microtasks; flush them without moving the fake clock.
const flush = () => vi.advanceTimersByTimeAsync(0)

function addPlayer(cls = 'html5-video-player') {
  const p = document.createElement('div')
  p.id = 'movie_player'
  p.className = cls
  document.body.appendChild(p)
  return p
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  cb = { onAdDetected: vi.fn(), onAdEnded: vi.fn(), onNavigated: vi.fn() }
})

afterEach(() => {
  if (stop) stop()
  stop = undefined
  vi.useRealTimers()
})

describe('onAdDetected', () => {
  it('fires once when ad-showing is added', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    await flush()
    expect(cb.onAdDetected).not.toHaveBeenCalled()
    p.classList.add('ad-showing')
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })

  it('never fires without ad-showing', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    p.classList.add('ytp-autohide')
    p.classList.add('playing-mode')
    p.classList.remove('ytp-autohide')
    await flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(cb.onAdDetected).not.toHaveBeenCalled()
    expect(cb.onAdEnded).not.toHaveBeenCalled()
  })

  it('does not fire again for unrelated class changes while the ad shows', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    p.classList.add('ad-showing')
    await flush()
    p.classList.add('ytp-autohide')
    await flush()
    p.classList.remove('ytp-autohide')
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })

  it('collapses repeated triggers within 1500ms to one', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    p.classList.add('ad-showing')
    await flush()
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(300)
      p.classList.remove('ad-showing')
      await flush()
      await vi.advanceTimersByTimeAsync(100)
      p.classList.add('ad-showing')
      await flush()
    }
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })

  it('fires again for a new ad after the debounce window', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    p.classList.add('ad-showing')
    await flush()
    p.classList.remove('ad-showing')
    await flush()
    await vi.advanceTimersByTimeAsync(LIMITS.DEBOUNCE_MS)
    p.classList.add('ad-showing')
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(2)
  })

  it('fires when the ad is already showing at start', async () => {
    addPlayer('html5-video-player ad-showing')
    stop = startDetector(cb)
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })
})

describe('onAdEnded', () => {
  it('fires when ad-showing is removed', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    p.classList.add('ad-showing')
    await flush()
    p.classList.remove('ad-showing')
    await flush()
    expect(cb.onAdEnded).toHaveBeenCalledTimes(1)
  })
})

describe('onNavigated', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/watch?v=AAA')
  })

  it('fires on yt-navigate-finish dispatched on document when the video changed', async () => {
    addPlayer()
    stop = startDetector(cb)
    history.pushState({}, '', '/watch?v=BBB')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    expect(cb.onNavigated).toHaveBeenCalledTimes(1)
  })

  it('fires on yt-navigate-finish dispatched on window when the video changed', async () => {
    addPlayer()
    stop = startDetector(cb)
    history.pushState({}, '', '/watch?v=BBB')
    window.dispatchEvent(new Event('yt-navigate-finish'))
    expect(cb.onNavigated).toHaveBeenCalledTimes(1)
  })

  it('does not fire when yt-navigate-finish arrives for the same video (page load during an ad)', async () => {
    addPlayer('html5-video-player ad-showing')
    stop = startDetector(cb)
    document.dispatchEvent(new Event('yt-navigate-finish'))
    history.replaceState({}, '', '/watch?v=AAA&t=10')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    expect(cb.onNavigated).not.toHaveBeenCalled()
  })

  it('does not fire when the navigation that opened the video finishes after its ad started (home to watch)', async () => {
    history.replaceState({}, '', '/')
    const p = addPlayer()
    stop = startDetector(cb)
    document.dispatchEvent(new Event('yt-navigate-start'))
    p.classList.add('ad-showing')
    await flush()
    history.pushState({}, '', '/watch?v=BBB')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
    expect(cb.onNavigated).not.toHaveBeenCalled()
  })

  it('fires when the user starts a navigation to another video during an ad (R5, M12)', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    p.classList.add('ad-showing')
    await flush()
    document.dispatchEvent(new Event('yt-navigate-start'))
    history.pushState({}, '', '/watch?v=CCC')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    expect(cb.onNavigated).toHaveBeenCalledTimes(1)
  })

  it('prints one temporary debug line per navigation with booleans only, never the URL', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    addPlayer()
    stop = startDetector(cb)
    history.pushState({}, '', '/watch?v=SECRETID')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    const calls = debugSpy.mock.calls
    debugSpy.mockRestore()
    expect(calls).toEqual([['[JEV debug] navigate', { videoChanged: true, adShowing: false, startedAfterAd: false, reset: true }]])
    expect(JSON.stringify(calls)).not.toContain('SECRETID')
  })

  it('fires once per video change, not again for a repeated event', async () => {
    addPlayer()
    stop = startDetector(cb)
    history.pushState({}, '', '/watch?v=BBB')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    document.dispatchEvent(new Event('yt-navigate-finish'))
    history.pushState({}, '', '/watch?v=AAA')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    expect(cb.onNavigated).toHaveBeenCalledTimes(2)
  })

  it('does not fire for other events', async () => {
    addPlayer()
    stop = startDetector(cb)
    document.dispatchEvent(new Event('yt-navigate-start'))
    expect(cb.onNavigated).not.toHaveBeenCalled()
  })

  it('observes a replaced player after navigation', async () => {
    const old = addPlayer()
    stop = startDetector(cb)
    old.remove()
    const next = addPlayer()
    document.dispatchEvent(new Event('yt-navigate-finish'))
    next.classList.add('ad-showing')
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })
})

describe('late #movie_player', () => {
  it('is still observed when it appears after start', async () => {
    stop = startDetector(cb)
    await flush()
    const p = addPlayer()
    await flush()
    p.classList.add('ad-showing')
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })

  it('detects an ad that is already showing when the late player appears', async () => {
    stop = startDetector(cb)
    await vi.advanceTimersByTimeAsync(2000)
    addPlayer('html5-video-player ad-showing')
    await flush()
    expect(cb.onAdDetected).toHaveBeenCalledTimes(1)
  })
})

describe('stop and resilience', () => {
  it('stops emitting after stop()', async () => {
    const p = addPlayer()
    stop = startDetector(cb)
    stop()
    p.classList.add('ad-showing')
    document.dispatchEvent(new Event('yt-navigate-finish'))
    await flush()
    expect(cb.onAdDetected).not.toHaveBeenCalled()
    expect(cb.onNavigated).not.toHaveBeenCalled()
  })

  it('survives a throwing callback and missing callbacks', async () => {
    const p = addPlayer()
    stop = startDetector({
      onAdDetected: () => {
        throw new Error('boom')
      }
    })
    p.classList.add('ad-showing')
    await flush()
    p.classList.remove('ad-showing')
    await flush()
    document.dispatchEvent(new Event('yt-navigate-finish'))
    expect(true).toBe(true)
  })
})
