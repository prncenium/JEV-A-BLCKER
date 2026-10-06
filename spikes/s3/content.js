(function () {
  'use strict';

  // ---- reused from spikes/s2/content.js: target rules, visibility, effect checks ----

  function getIframeDoc() {
    const iframe = document.querySelector('iframe[src*="aboutthisad"]');
    if (!iframe) return null;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return null;
      return doc;
    } catch (e) {
      return null;
    }
  }

  function isVisible(el) {
    return !!el && el.offsetWidth > 0;
  }

  function findTarget(step) {
    if (step === 1) {
      const player = document.querySelector('#movie_player');
      if (!player) return null;
      const el = player.querySelector('button[aria-label="My Ad Center"]');
      return isVisible(el) ? el : null;
    }

    const doc = getIframeDoc();
    if (!doc) return null;

    if (step === 2) {
      const el = doc.querySelector('div[role=button][aria-label="Block"]');
      return isVisible(el) ? el : null;
    }

    if (step === 3) {
      const dialog = doc.querySelector('div[role=dialog][aria-label="Stop seeing this ad?"]');
      if (!dialog) return null;
      const buttons = dialog.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim() === 'Continue') return btn;
      }
      return null;
    }

    if (step === 4) {
      const candidates = doc.querySelectorAll('button[aria-label="Close"]');
      for (const btn of candidates) {
        if (btn.closest('[role=banner]')) continue;
        if (isVisible(btn)) return btn;
      }
      return null;
    }

    return null;
  }

  function checkEffect(step) {
    if (step === 1) {
      const doc = getIframeDoc();
      if (!doc) return false;
      return !!doc.querySelector('[role="region"][aria-label="Main ad controls"]');
    }

    if (step === 2) {
      const doc = getIframeDoc();
      if (!doc) return false;
      const dialog = doc.querySelector('div[role=dialog][aria-label="Stop seeing this ad?"]');
      return isVisible(dialog);
    }

    if (step === 3) {
      const doc = getIframeDoc();
      if (!doc) return false;
      try {
        return doc.body.innerText.indexOf('Ad blocked') !== -1;
      } catch (e) {
        return false;
      }
    }

    if (step === 4) {
      const iframe = document.querySelector('iframe[src*="aboutthisad"]');
      if (!iframe) return true;
      if (!isVisible(iframe)) return true;
      const doc = getIframeDoc();
      if (!doc) return true;
      const candidates = doc.querySelectorAll('button[aria-label="Close"]');
      for (const btn of candidates) {
        if (btn.closest('[role=banner]')) continue;
        if (isVisible(btn)) return false;
      }
      return true;
    }

    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pollForTarget(step) {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        let el = null;
        try {
          el = findTarget(step);
        } catch (e) {
          el = null;
        }
        const elapsed = Date.now() - start;
        if (el || elapsed >= 3000) {
          clearInterval(interval);
          resolve(el);
        }
      }, 100);
    });
  }

  function pollEffect(step) {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        let seen = false;
        try {
          seen = checkEffect(step);
        } catch (e) {
          seen = false;
        }
        const elapsed = Date.now() - start;
        if (seen || elapsed >= 3000) {
          clearInterval(interval);
          resolve({ effectSeen: seen, effectMs: elapsed });
        }
      }, 100);
    });
  }

  // ---- recording state ----

  let recording = false;
  let currentMode = null; // 'observe' | 'auto'
  let t0 = null;
  let events = [];
  let lastResult = null;
  let autoStopTimer = null;
  let passiveInterval = null;
  let sampleInterval = null;
  let autoRunActive = false;

  // passive tracker state
  let adShowingState = false;
  let adInterruptingState = false;
  let adCreatedState = false;
  let adShowingIntervals = [];
  let openAdInterval = null; // reference to the currently open interval entry

  let podState = null; // { current, total } | null
  let podIndicatorChanges = [];

  let infoButtonState = false;
  let infoButtonAppearances = 0;

  let lastIframeElement = null;
  const iframeInstanceIds = new WeakMap();
  let nextIframeInstanceId = 1;
  let iframeInstancesSeenCount = 0;
  let currentIframeInstanceId = null;

  let videoState = null; // { paused, durationRounded } | null
  let lastVideoTime = null;
  let lastVideoPollMs = null;

  let panelOpenStartT = null;
  let panelOpenEndT = null;
  let pausedWhilePanelOpenFlag = false;

  const downstreamAdDurations = new Set();

  function nowT() {
    return Math.round(performance.now() - t0);
  }

  function logEvent(type, detail) {
    if (!recording) return;
    if (events.length >= 800) return;
    events.push({ t: nowT(), type, detail: detail === undefined ? null : detail });
    updateStatusLine();
  }

  function logError(err) {
    const message = String(err && err.message ? err.message : err);
    logEvent('error', { message });
  }

  // ---- passive tracking (poll every 250ms while recording) ----

  function pollPassive() {
    try {
      pollAdShowing();
    } catch (e) {
      logError(e);
    }
    try {
      pollPodIndicator();
    } catch (e) {
      logError(e);
    }
    try {
      pollInfoButton();
    } catch (e) {
      logError(e);
    }
    try {
      pollIframe();
    } catch (e) {
      logError(e);
    }
    try {
      pollVideo();
    } catch (e) {
      logError(e);
    }
  }

  function pollAdShowing() {
    const player = document.querySelector('#movie_player');
    const adShowing = !!player && player.classList.contains('ad-showing');
    const adInterrupting = !!player && player.classList.contains('ad-interrupting');
    const adCreated = !!player && player.classList.contains('ad-created');

    if (adShowing !== adShowingState || adInterrupting !== adInterruptingState || adCreated !== adCreatedState) {
      if (adShowing && !adShowingState) {
        openAdInterval = [nowT(), null];
        adShowingIntervals.push(openAdInterval);
      } else if (!adShowing && adShowingState) {
        if (openAdInterval) {
          openAdInterval[1] = nowT();
          openAdInterval = null;
        }
      }
      adShowingState = adShowing;
      adInterruptingState = adInterrupting;
      adCreatedState = adCreated;
      logEvent('ad_showing', { adShowing, adInterrupting, adCreated });
    }
  }

  function pollPodIndicator() {
    const container = document.querySelector('#movie_player .video-ads');
    let next = null;
    if (container) {
      let text = '';
      try {
        text = container.innerText || '';
      } catch (e) {
        text = '';
      }
      const match = /(\d+)\s+of\s+(\d+)/.exec(text);
      if (match) {
        next = { current: Number(match[1]), total: Number(match[2]) };
      }
    }

    const changed =
      (next === null) !== (podState === null) ||
      (next && podState && (next.current !== podState.current || next.total !== podState.total));

    if (changed) {
      podState = next;
      if (next) {
        podIndicatorChanges.push({ t: nowT(), current: next.current, total: next.total });
        logEvent('pod_indicator', { current: next.current, total: next.total });
      } else {
        logEvent('pod_indicator', null);
      }
    }
  }

  function pollInfoButton() {
    const player = document.querySelector('#movie_player');
    const btn = player ? player.querySelector('button[aria-label="My Ad Center"]') : null;
    const visible = isVisible(btn);
    if (visible !== infoButtonState) {
      infoButtonState = visible;
      if (visible) infoButtonAppearances++;
      logEvent('info_button', { visible });
    }
  }

  function pollIframe() {
    const iframe = document.querySelector('iframe[src*="aboutthisad"]');
    if (iframe) {
      if (iframe !== lastIframeElement) {
        let id = iframeInstanceIds.get(iframe);
        if (!id) {
          id = nextIframeInstanceId++;
          iframeInstanceIds.set(iframe, id);
          iframeInstancesSeenCount++;
        }
        lastIframeElement = iframe;
        currentIframeInstanceId = id;
        logEvent('iframe_added', { instanceId: id });
      }
    } else if (lastIframeElement !== null) {
      logEvent('iframe_removed', { instanceId: currentIframeInstanceId });
      lastIframeElement = null;
      currentIframeInstanceId = null;
    }
  }

  function pollVideo() {
    const player = document.querySelector('#movie_player');
    const video = player ? player.querySelector('video') : null;
    const nowMs = performance.now();

    if (!video) {
      if (videoState !== null) {
        videoState = null;
        logEvent('video', null);
      }
      lastVideoTime = null;
      lastVideoPollMs = null;
      return;
    }

    const durationRounded = isFinite(video.duration) ? Math.round(video.duration) : null;
    const next = { paused: video.paused, durationRounded };

    if (!videoState || next.paused !== videoState.paused || next.durationRounded !== videoState.durationRounded) {
      videoState = next;
      logEvent('video', next);
    }

    if (adShowingState && durationRounded !== null) {
      downstreamAdDurations.add(durationRounded);
    }

    if (lastVideoTime !== null && lastVideoPollMs !== null) {
      const realElapsedSec = (nowMs - lastVideoPollMs) / 1000;
      const delta = video.currentTime - lastVideoTime;
      if (delta < -1) {
        logEvent('video_jump', {
          from: Math.round(lastVideoTime * 10) / 10,
          to: Math.round(video.currentTime * 10) / 10,
        });
      } else if (delta > realElapsedSec + 2) {
        logEvent('video_jump', {
          from: Math.round(lastVideoTime * 10) / 10,
          to: Math.round(video.currentTime * 10) / 10,
        });
      }
    }

    lastVideoTime = video.currentTime;
    lastVideoPollMs = nowMs;

    if (currentMode === 'auto' && panelOpenStartT !== null) {
      const t = nowT();
      if (t >= panelOpenStartT && (panelOpenEndT === null || t <= panelOpenEndT)) {
        if (video.paused) pausedWhilePanelOpenFlag = true;
      }
    }
  }

  function sampleVideo() {
    if (!recording) return;
    try {
      const player = document.querySelector('#movie_player');
      const video = player ? player.querySelector('video') : null;
      if (!video) return;
      logEvent('video_sample', {
        currentTime: Math.round(video.currentTime * 10) / 10,
        duration: isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null,
        paused: video.paused,
      });
    } catch (e) {
      logError(e);
    }
  }

  let videoEndedListenerAttached = null;

  function ensureVideoEndedListener() {
    const player = document.querySelector('#movie_player');
    const video = player ? player.querySelector('video') : null;
    if (video && video !== videoEndedListenerAttached) {
      video.addEventListener('ended', () => logEvent('video_ended', null));
      videoEndedListenerAttached = video;
    }
  }

  // ---- mode "auto": click steps 1-4 ----

  async function runAutoClicks() {
    if (autoRunActive) return;
    autoRunActive = true;
    try {
      for (let step = 1; step <= 4; step++) {
        const target = await pollForTarget(step);
        if (!target) {
          logEvent('step_click_' + step, { found: false });
          break;
        }
        try {
          target.click();
        } catch (e) {
          logEvent('step_click_' + step, { found: true, clicked: false });
          logError(e);
          break;
        }
        logEvent('step_click_' + step, { found: true, clicked: true });
        if (step === 4) {
          panelOpenEndT = nowT();
        }

        const result = await pollEffect(step);
        logEvent('step_effect_' + step, { effectSeen: result.effectSeen, effectMs: result.effectMs });
        if (step === 1 && result.effectSeen) {
          panelOpenStartT = nowT();
        }
        if (!result.effectSeen) break;
        if (step < 4) {
          await sleep(300);
        }
      }
    } finally {
      autoRunActive = false;
    }
  }

  // ---- recording lifecycle ----

  function startRecording(mode) {
    if (recording) return;
    recording = true;
    currentMode = mode;
    t0 = performance.now();
    events = [];

    adShowingState = false;
    adInterruptingState = false;
    adCreatedState = false;
    adShowingIntervals = [];
    openAdInterval = null;

    podState = null;
    podIndicatorChanges = [];

    infoButtonState = false;
    infoButtonAppearances = 0;

    lastIframeElement = null;
    nextIframeInstanceId = 1;
    iframeInstancesSeenCount = 0;
    currentIframeInstanceId = null;

    videoState = null;
    lastVideoTime = null;
    lastVideoPollMs = null;
    videoEndedListenerAttached = null;

    panelOpenStartT = null;
    panelOpenEndT = null;
    pausedWhilePanelOpenFlag = false;

    downstreamAdDurations.clear();

    passiveInterval = setInterval(() => {
      try {
        ensureVideoEndedListener();
      } catch (e) {
        logError(e);
      }
      pollPassive();
    }, 250);
    sampleInterval = setInterval(sampleVideo, 5000);

    autoStopTimer = setTimeout(() => stopRecording(), 150000);

    updateStatusLine();

    if (mode === 'auto') {
      runAutoClicks();
    }
  }

  function stopRecording() {
    if (!recording) return;
    const durationMs = Math.round(performance.now() - t0);

    if (openAdInterval) {
      openAdInterval[1] = durationMs;
      openAdInterval = null;
    }

    if (passiveInterval) clearInterval(passiveInterval);
    if (sampleInterval) clearInterval(sampleInterval);
    if (autoStopTimer) clearTimeout(autoStopTimer);
    passiveInterval = null;
    sampleInterval = null;
    autoStopTimer = null;

    const summary = {
      adShowingIntervals: adShowingIntervals.map((iv) => [iv[0], iv[1]]),
      podIndicatorChanges: podIndicatorChanges.slice(),
      iframeInstances: iframeInstancesSeenCount,
      infoButtonAppearances: infoButtonAppearances,
      pausedWhilePanelOpen: currentMode === 'auto' ? pausedWhilePanelOpenFlag : null,
      durationOfDownstreamAds: Array.from(downstreamAdDurations),
    };

    const result = {
      mode: currentMode,
      durationMs,
      summary,
      events: events.slice(),
    };

    lastResult = result;
    recording = false;
    currentMode = null;

    renderResult(result);
    updateStatusLine();
  }

  // ---- UI ----

  let panel, statusLine, pre;

  function updateStatusLine() {
    if (!statusLine) return;
    if (recording) {
      statusLine.textContent = 'Recording (' + currentMode + ') - ' + events.length + ' events';
    } else {
      statusLine.textContent = 'Idle';
    }
  }

  function renderResult(result) {
    if (!pre) return;
    pre.textContent = JSON.stringify(result, null, 2);
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '8px';
    panel.style.right = '8px';
    panel.style.zIndex = '2147483647';
    panel.style.background = 'rgba(20,20,20,0.92)';
    panel.style.color = '#eee';
    panel.style.font = '11px monospace';
    panel.style.padding = '8px';
    panel.style.borderRadius = '6px';
    panel.style.maxWidth = '320px';
    panel.style.maxHeight = '80vh';
    panel.style.overflow = 'auto';
    panel.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';

    const title = document.createElement('div');
    title.textContent = 'S3 pod probe';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '6px';
    panel.appendChild(title);

    statusLine = document.createElement('div');
    statusLine.style.marginBottom = '4px';
    statusLine.textContent = 'Idle';
    panel.appendChild(statusLine);

    const hint = document.createElement('div');
    hint.textContent =
      'O = observe only, no clicks. A = auto-run the 4 clicks and observe. S = stop and finalize. Press keys on the YouTube page, no mouse.';
    hint.style.marginTop = '4px';
    hint.style.marginBottom = '4px';
    hint.style.opacity = '0.8';
    panel.appendChild(hint);

    pre = document.createElement('pre');
    pre.style.background = '#000';
    pre.style.color = '#0f0';
    pre.style.padding = '4px';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-all';
    pre.style.maxHeight = '200px';
    pre.style.overflow = 'auto';
    pre.textContent = '(no result yet)';
    panel.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy results';
    copyBtn.style.font = '10px monospace';
    copyBtn.style.marginTop = '4px';
    copyBtn.addEventListener('click', () => {
      if (!lastResult) return;
      const text = JSON.stringify(lastResult, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });
    panel.appendChild(copyBtn);

    document.body.appendChild(panel);
  }

  // ---- keyboard handling ----

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function handleKeydown(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;

    const key = event.key.toLowerCase();
    if (key !== 'o' && key !== 'a' && key !== 's') return;

    if (recording && key !== 's') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (key === 'o') {
      startRecording('observe');
    } else if (key === 'a') {
      startRecording('auto');
    } else if (key === 's') {
      stopRecording();
    }
  }

  window.addEventListener('keydown', handleKeydown, true);

  const attachedIframeDocs = new WeakSet();

  setInterval(() => {
    let doc = null;
    try {
      doc = getIframeDoc();
    } catch (e) {
      doc = null;
    }
    if (!doc) return;
    if (attachedIframeDocs.has(doc)) return;
    try {
      doc.addEventListener('keydown', handleKeydown, true);
      attachedIframeDocs.add(doc);
    } catch (e) {
      // ignore, same-origin access may not be ready yet
    }
  }, 500);

  if (document.body) {
    buildPanel();
  } else {
    window.addEventListener('DOMContentLoaded', buildPanel);
  }
})();
