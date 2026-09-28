(function () {
  'use strict';

  const records = [];

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

  function iframeExists() {
    return !!document.querySelector('iframe[src*="aboutthisad"]');
  }

  function iframeReadable() {
    return getIframeDoc() !== null;
  }

  function mainAdControlsPresent() {
    const doc = getIframeDoc();
    if (!doc) return false;
    return !!doc.querySelector('[role="region"][aria-label="Main ad controls"]');
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

  function checkEffect(step, targetRef) {
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

  function dispatchEventSequence(el) {
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of types) {
      const EventCtor = type.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
      const ev = new EventCtor(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX,
        clientY,
      });
      el.dispatchEvent(ev);
    }
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

  async function runAction(step, method, trigger) {
    const record = {
      step,
      method,
      found: false,
      visible: false,
      clicked: false,
      effectSeen: false,
      effectMs: null,
      error: null,
      trigger,
      iframeExistsAtClick: false,
      iframeReadableAtClick: false,
      mainAdControlsPresentAtClick: false,
      mainAdControlsPresentAtEnd: false,
    };

    try {
      const el = findTarget(step);
      if (!el) {
        records.push(record);
        renderLatest(record);
        return;
      }
      record.found = true;
      record.visible = isVisible(el);

      record.iframeExistsAtClick = iframeExists();
      record.iframeReadableAtClick = iframeReadable();
      record.mainAdControlsPresentAtClick = mainAdControlsPresent();

      if (method === 'click') {
        el.click();
      } else {
        dispatchEventSequence(el);
      }
      record.clicked = true;

      const result = await pollEffect(step);
      record.effectSeen = result.effectSeen;
      record.effectMs = result.effectMs;
      record.mainAdControlsPresentAtEnd = mainAdControlsPresent();
    } catch (e) {
      record.error = String(e && e.message ? e.message : e);
    }

    records.push(record);
    renderLatest(record);
  }

  let autoRunInProgress = false;

  async function runAutoStep(step) {
    const record = {
      step,
      method: 'click',
      found: false,
      visible: false,
      clicked: false,
      effectSeen: false,
      effectMs: null,
      error: null,
      trigger: 'auto',
      iframeExistsAtClick: false,
      iframeReadableAtClick: false,
      mainAdControlsPresentAtClick: false,
      mainAdControlsPresentAtEnd: false,
    };

    try {
      const el = await pollForTarget(step);
      if (!el) {
        records.push(record);
        renderLatest(record);
        return record;
      }
      record.found = true;
      record.visible = isVisible(el);

      record.iframeExistsAtClick = iframeExists();
      record.iframeReadableAtClick = iframeReadable();
      record.mainAdControlsPresentAtClick = mainAdControlsPresent();

      el.click();
      record.clicked = true;

      const result = await pollEffect(step);
      record.effectSeen = result.effectSeen;
      record.effectMs = result.effectMs;
      record.mainAdControlsPresentAtEnd = mainAdControlsPresent();
    } catch (e) {
      record.error = String(e && e.message ? e.message : e);
    }

    records.push(record);
    renderLatest(record);
    return record;
  }

  async function runAutoRun() {
    if (autoRunInProgress) return;
    autoRunInProgress = true;
    try {
      for (let step = 1; step <= 4; step++) {
        const record = await runAutoStep(step);
        if (!record.found || record.error || !record.clicked || !record.effectSeen) break;
        if (step < 4) {
          await sleep(300);
        }
      }
    } finally {
      autoRunInProgress = false;
    }
  }

  let pre;

  function renderLatest(record) {
    if (!pre) return;
    pre.textContent = JSON.stringify(record, null, 2);
  }

  function buildPanel() {
    const panel = document.createElement('div');
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
    title.textContent = 'S2 click probe';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '6px';
    panel.appendChild(title);

    const steps = [
      { step: 1, label: 'Step 1: My Ad Center' },
      { step: 2, label: 'Step 2: Block' },
      { step: 3, label: 'Step 3: Continue' },
      { step: 4, label: 'Step 4: Close' },
    ];

    for (const s of steps) {
      const row = document.createElement('div');
      row.style.marginBottom = '4px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '4px';

      const label = document.createElement('span');
      label.textContent = s.label;
      label.style.flex = '1';
      row.appendChild(label);

      const btnClick = document.createElement('button');
      btnClick.textContent = 'Try click()';
      btnClick.style.font = '10px monospace';
      btnClick.addEventListener('click', () => runAction(s.step, 'click', 'mouse'));
      row.appendChild(btnClick);

      const btnSeq = document.createElement('button');
      btnSeq.textContent = 'Try event sequence';
      btnSeq.style.font = '10px monospace';
      btnSeq.addEventListener('click', () => runAction(s.step, 'sequence', 'mouse'));
      row.appendChild(btnSeq);

      panel.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.textContent = 'A = auto-run steps 1-4 (press on the YouTube page, no mouse). Keys 1-4 click(), Q W E R event sequence.';
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
      const text = JSON.stringify(records, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });
    panel.appendChild(copyBtn);

    document.body.appendChild(panel);
  }

  const CLICK_KEYS = { '1': 1, '2': 2, '3': 3, '4': 4 };
  const SEQUENCE_KEYS = { q: 1, w: 2, e: 3, r: 4 };

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

    if (key === 'a') {
      if (autoRunInProgress) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runAutoRun();
      return;
    }

    let step = CLICK_KEYS[key];
    let method = 'click';
    if (step === undefined) {
      step = SEQUENCE_KEYS[key];
      method = 'sequence';
    }
    if (step === undefined) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    runAction(step, method, 'key');
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
