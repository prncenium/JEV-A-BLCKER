# 00 — Steering

## Project
JEV-AD-Blocker — a Chrome extension that automates YouTube's native "Block ad" flow using a System One decision model.

## Goal
When a video ad plays on youtube.com, automatically perform: click ⓘ → click "Block ad" → confirm → close dialog. No user interaction required.

## In Scope
- Chrome (Manifest V3), desktop only
- `https://www.youtube.com/*` only
- Personal/local use via "Load unpacked"
- Decision provider abstraction with two implementations:
  - `NanoProvider` — Chrome built-in Prompt API (Gemini Nano), free, on-device, no key
  - `JevProvider` — TypeSafe Jev via Vercel AI Gateway (`typesafe-ai/jev`)

## Out of Scope
- Skipping, muting, or hiding ads by CSS/network blocking
- Network request filtering (declarativeNetRequest)
- m.youtube.com, YouTube Music, embedded players
- Firefox, Safari, Edge
- Android / iOS native apps
- Chrome Web Store publication
- Any bundled/shared API key

## Stack
- Vite 7 + TypeScript 5
- @crxjs/vite-plugin (MV3)
- Vitest for unit tests
- No UI framework (options page = plain HTML + TS)

## Architecture Principle
The model decides. The extension acts.
Jev/Nano returns a typed operation + target id + confidence. All clicking, waiting, looping, and guarding is owned by extension code.

## Constraints
- C1: API keys are user-supplied via the options page, stored in `chrome.storage.local`. Never hardcoded, never committed.
- C2: Network calls happen only in the background service worker, never in the content script.
- C3: Fail-safe default — on any error, timeout, or low confidence, the extension does nothing and leaves the page untouched.
- C4: Hard caps per ad instance: max 5 model calls, max 10s total, max 1 flow run.
- C5: The DOM snapshot sent to the model contains only visible, clickable elements inside the player container. No page text, no video content, no user data.
- C6: No behavior is coded before it exists in a spec file.

## Risks (accepted)
- R1: Automating clicks may conflict with YouTube's Terms of Service. Personal use only, not distributed.
- R2: YouTube's DOM changes frequently; selectors and snapshot logic will need maintenance.
- R3: "Block ad" suppresses future ads from that advertiser only. It does not skip the current ad.
- R4: Jev is early access; API shape may change. Vercel AI Gateway free-tier status for Jev must be re-verified before Phase 4.
- R5: Chrome built-in AI requires a supported device and a model download.

## Success Criteria
The full ⓘ → Block ad → ✕ flow completes without user input on ≥ 90% of real ads across a 20-ad manual test run, with zero false triggers on non-ad playback.

## Definition of Done (per phase)
A phase is done when its spec file is written, reviewed, and its gate condition is met. Code for a phase is done when it satisfies a numbered requirement from 01-requirements.md.

## Status
Phase 0: LOCKED
