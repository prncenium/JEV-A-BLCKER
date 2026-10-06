# 05 — Tasks

## Rules
- One task at a time, in the order listed. One Claude Code prompt per task. The prompt cites this file, 03-design.md, 04-decision-contract.md, and the task's requirement IDs.
- A task may only implement behavior listed in its Requirements line. Anything else needs a spec change first (C6).
- When a task passes its "Done when", change only its Status line to DONE.
- The user handles all git commits and pushes manually. Claude Code never runs git.
- Spikes are throwaway experiments. Their code lives in spikes/ at the repo root. Their findings go to specs/spikes.md. Spike code is never copied into extension/ except through a task.
- Never open, read, or copy specs/recon/*.html. Those files are gitignored and contain account data. Test fixtures are small hand-written HTML files built from 02-recon.md.
- jsdom has no layout engine. Tests that depend on visibility stub getBoundingClientRect, offsetWidth and offsetHeight.
- Spike gate (G5): a spike result that contradicts 03-design.md or 04-decision-contract.md must be applied to those files, with an Amendment Log entry, before the task that depends on it starts.

## Order
T1, then S1 to S5, then T2 to T15. Dependencies are listed per task.

## Open items
- OI1: RESOLVED by the R10 amendment (first 40 in document order).

## Spikes

### S1 — Chrome built-in Prompt API in an extension
- Answers: OQ1, OQ7
- Requirements: R34
- Depends on: T1
- Do: in spikes/s1 build a minimal extension. Look up the current Chrome built-in AI documentation first and do not guess API names. Record: whether the API exists in an MV3 service worker; whether it must run in an offscreen document instead; its availability states and model download behavior; whether a JSON-schema response constraint works; whether any usable confidence value can be obtained.
- Done when: specs/spikes.md has a section "S1" with the findings and a clear recommendation for nano.js.
- Status: DONE

### S2 — element.click() on YouTube controls
- Answers: OQ2
- Requirements: R18, R40
- Depends on: T1
- Do: in spikes/s2 build a content script that, on a manual trigger, tries element.click() on each of the four R40 targets one at a time during a real ad: the ⓘ button, Block, Continue, Close. For any target that does not respond, test dispatching pointerdown, mousedown, pointerup, mouseup, click in order. It clicks nothing else.
- Done when: specs/spikes.md has a section "S2" stating, per target, whether element.click() works and the fallback that works if it does not.
- Status: DONE

### S3 — Iframe access and timing
- Answers: OQ3 and the first two unknowns in 02-recon.md
- Requirements: R6, R41, R42
- Depends on: T1
- Do: in spikes/s3 build a content script (no all_frames). Already known from S2, do not re-measure: the iframe does not exist before the ⓘ click, it appears about 600 ms after it, and contentDocument is readable. Log per ad: whether the video keeps playing while the panel is open; whether the iframe is reused or recreated between ads; timestamps in ms since the ⓘ click at which #movie_player gains or loses the class ad-showing, at which the step 4 Close click happens, and at which the ad indicator "N of M" changes; whether a second ad of a pod ("1 of 2") starts after the four clicks are done on the first ad. It never logs the iframe src.
- Done when: specs/spikes.md has a section "S3" with these measurements.
- Status: DONE

### S4 — Jev through Vercel AI Gateway
- Answers: OQ5
- Requirements: R28, R32, R38
- Depends on: 04-decision-contract.md, and a Vercel AI Gateway key created by the user
- Do: no extension code. The user sets the key as an environment variable and never writes it into any file in the repo. Check the Jev model page for its free-tier status. Send three hand-written snapshots (step 1, step 2, step 3, built from 02-recon.md) with curl.exe using the request body from 04-decision-contract.md. Record: the confirmed URL path, the model name accepted, the response shape, latency, the returned choice and confidence for each snapshot, and the exact error shape for a wrong key and for a malformed body.
- Done when: specs/spikes.md has a section "S4". All three snapshots return the correct entry id at confidence 0.8 or higher, or the mismatch is recorded and 04-decision-contract.md is amended.
- Status: BLOCKED (Vercel AI Gateway requires a payment method; no free-tier credit found on this account as of 2026-09-29; user deferring)

### S5 — storage access level
- Answers: OQ4
- Requirements: R33
- Depends on: T1
- Do: in spikes/s5 build a service worker that calls chrome.storage.local.setAccessLevel with TRUSTED_CONTEXTS, and a content script that tries chrome.storage.local.get. Compare against the default access level.
- Done when: specs/spikes.md has a section "S5" stating whether the content script is blocked from reading and whether the service worker can still read.
- Status: DONE

### S4b — Free OpenAI-compatible API
- Requirements: R28, R32, R38
- Depends on: T12
- Do: the user picks a free OpenAI-compatible provider and creates a key, supplied through the options page only. Look up that provider's current docs first. Record whether response_format works, the latency, the error shape for a wrong key, and the choice and confidence for three hand-written snapshots (step 1, 2 and 3, built from 02-recon.md).
- Done when: specs/spikes.md has a section "S4b". The three snapshots return the correct entry id, or the mismatch is recorded.
- Status: TODO

## Build tasks

### T1 — Scaffold
- Files: extension/package.json, extension/vite.config.js, extension/manifest.json, minimal entry files extension/src/background/index.js, extension/src/content/index.js, extension/src/options/options.html, extension/src/options/options.js
- Requirements: R29, R37
- Depends on: none
- Do: Vite, @crxjs/vite-plugin, Vitest, jsdom, all at the latest stable versions. The manifest is the one in 03-design.md. Entry files only log a marker line. Confirm .gitignore contains node_modules, dist, .env. If @crxjs/vite-plugin does not support the installed Vite major version, stop and report. Do not switch tooling without amending 00-steering.md.
- Done when: npm install and npm run build succeed in extension/; dist/ loads unpacked in Chrome with zero errors on chrome://extensions; the repo has no .ts file, no tsconfig.json and no typescript dependency; the installed versions are recorded in specs/spikes.md under "Versions".
- Status: DONE

### T2 — shared/constants.js
- Files: extension/src/shared/constants.js, extension/tests/constants.test.js
- Requirements: R3, R10, R12, R13, R14, R15, R18, R19, R23, R24, R39
- Depends on: T1
- Do: implement the constants exactly as listed in 03-design.md, plus JEV_TIMEOUT_MS = 3000 from 04-decision-contract.md.
- Done when: tests assert ACT 0.8, RETRY 0.5, MAX_CALLS 8, MAX_MS 10000, MAX_SNAPSHOT 40, DEBOUNCE_MS 1500, CLICK_WAIT_MS 800, WAIT_MS 500, TEXT_MAX 80, JEV_TIMEOUT_MS 3000, the four operations, the three message types, and a STEPS table with 5 entries. Tests pass.
- Status: DONE

### T3 — shared/schema.js
- Files: extension/src/shared/schema.js, extension/tests/schema.test.js
- Requirements: R12, R38, R39
- Depends on: T2
- Do: validateDecision and validateMessage as in 03-design.md. Both return { ok, value } or { ok, error } and never throw.
- Done when: tests cover valid decisions; an unknown operation; targetId of the wrong type; confidence of 0, 1, -0.1, 1.1, NaN and a string; null and non-object input; unknown message types; and wrong payload shapes for each message type. Tests pass.
- Status: DONE

### T4 — content/scopes.js
- Files: extension/src/content/scopes.js, extension/tests/scopes.test.js, extension/tests/fixtures/
- Requirements: R6, R9, R41, R42, R43
- Depends on: T2, S3
- Do: getScope and waitForScope per 03-design.md, using the S3 findings for timing.
- Done when: tests with hand-written fixtures show step 1 and 5 return #movie_player; steps 2 to 4 return the iframe document; an iframe whose contentDocument getter throws returns null; waitForScope returns null on timeout; the iframe src is never returned or logged. Tests pass.
- Status: DONE

### T5 — content/snapshot.js
- Files: extension/src/content/snapshot.js, extension/tests/snapshot.test.js, extension/tests/fixtures/
- Requirements: R6, R7, R8, R9, R10, R26
- Depends on: T4, OI1
- Do: buildSnapshot and clearIds per 03-design.md.
- Done when: fixtures reproducing the panel structure from 02-recon.md show the step 2 snapshot includes Block, Like ad, Report and the visible Close; excludes everything inside [role=banner] including an element whose aria-label holds an account name; excludes the hidden 0x0 Close elements; trims text to 80 chars; returns exactly 40 entries for 60 candidates; assigns ids e1, e2, ... in document order; and clearIds removes every data-jev-id from the top page and the iframe document. Tests pass.
- Status: DONE

### T6 — content/allowlist.js
- Files: extension/src/content/allowlist.js, extension/tests/allowlist.test.js
- Requirements: R17, R40
- Depends on: T4
- Do: isAllowed(step, element) implementing rules (a) to (d) of R40, with the per-step narrowing from DD2.
- Done when: tests show each rule accepts only its own target at its own step, and rejects Like ad, Report, See more and See fewer ads, Customize more of your ads, Send feedback, Cancel, Main menu, Go back, a hidden Close, a Close inside [role=banner], and every target at step 5. Tests pass.
- Status: DONE

### T7 — content/detector.js
- Files: extension/src/content/detector.js, extension/tests/detector.test.js
- Requirements: R1, R2, R3, R4, R5
- Depends on: T2
- Do: startDetector per 03-design.md.
- Done when: tests with fake timers show onAdDetected fires once when ad-showing is added and never without it; repeated triggers within 1500ms collapse to one; removing ad-showing fires onAdEnded; a yt-navigate-finish event fires onNavigated; and a #movie_player that appears late is still observed. Tests pass.
- Status: DONE

### T8 — content/executor.js
- Files: extension/src/content/executor.js, extension/tests/executor.test.js
- Requirements: R18, R19, R20, R21
- Depends on: T2, S2
- Do: execute per 03-design.md, using the click method that S2 found to work.
- Done when: tests show CLICK clicks the element with the matching data-jev-id and resolves on the first DOM mutation in scope or after 800ms; WAIT resolves after 500ms; DONE returns success; any other operation throws. Tests pass.
- Status: DONE

### T9 — content/flow.js
- Files: extension/src/content/flow.js, extension/tests/flow.test.js
- Requirements: R5, R11, R13, R14, R15, R16, R17, R19, R20, R22, R23, R24, R25, R26, R35, R38, R41, R42, R43, R44, R45
- Depends on: T3, T4, T5, T6, T7, T8
- Do: runFlow and resetFlow implementing the state machine in 03-design.md, using a fake provider in tests.
- Done when: tests show the happy path completes in 4 calls, then local verification of step 5 per R44; confidence between 0.5 and 0.8 retries once then aborts; confidence below 0.5 aborts; BLOCKED aborts with no retry; an unknown targetId aborts; a target rejected by the allowlist aborts; a 9th call aborts; a flow over 10000ms aborts; any thrown error aborts; the flow runs at most once per ad instance; data-jev-id attributes are cleared on every exit path; the log entry holds no snapshot content, no URL and no account identifier. Tests pass. Removal of ad-showing after the step 4 click counts as success and is not reset (R45); removal at an earlier step aborts.
- Status: DONE

### T10 — background/index.js
- Files: extension/src/background/index.js, extension/tests/background.test.js
- Requirements: R30, R31, R32, R33, R35, R36, R39, R43
- Depends on: T3, S5
- Do: the service worker per 03-design.md, using the S5 result for storage access.
- Done when: tests with a mocked chrome API show first install writes { enabled: false, provider: null }; GET_CONFIG never returns the key; messages from an unknown sender or with an invalid shape are ignored; DECIDE is refused when disabled or no provider is set and makes no network call; LOG_FLOW keeps only the newest 20 entries. Tests pass.
- Status: DONE

### T11 — providers/index.js and providers/nano.js
- Files: extension/src/background/providers/index.js, extension/src/background/providers/nano.js, extension/tests/nano.test.js
- Requirements: R34
- Depends on: T10, S1
- Do: getProvider and NanoProvider per 04-decision-contract.md, using the S1 findings.
- Done when: tests with a stubbed Prompt API show getProvider returns a provider for "nano", "openai" and "jev" (jev is a stub that throws "jev not implemented") and throws on any other name; nano maps output to a Decision; nano makes no network request (a fetch spy asserts zero calls); each call creates its own session and destroys it; a returned choice outside the offered options throws. A manual check in real Chrome matches the S1 findings.
- Status: DONE (automated tests only, manual Chrome check pending)

### T12 — providers/openai.js (OpenAI-compatible, replaces jev.js)
- Files: extension/src/background/providers/openai.js, extension/tests/openai.test.js
- Requirements: R12, R28, R29, R32, R43
- Depends on: T10
- Do: OpenAI-compatible provider per the openai mapping in 04-decision-contract.md. Settings baseUrl, model and key are read from storage.local.
- Done when: tests with a mocked fetch show the request goes to {baseUrl}/chat/completions with a Bearer header and the options from the step; the response mapping holds, including JSON extraction from text; a choice outside the offered options throws; a call over 3000 ms fails; any non-2xx status throws an error holding the status only; the key and URLs never appear in any error or log. Tests pass.
- Status: DONE

### T13 — options page
- Files: extension/src/options/options.html, extension/src/options/options.js
- Requirements: R27, R28, R31, R36
- Depends on: T10
- Do: enable toggle defaulting to off, provider select (nano, openai or jev), key input of type password shown for openai and jev, base URL and model inputs shown for openai, chrome.permissions.request for the base URL origin on save, save to storage.local, and a viewer for the last 20 flow logs. Also add optional_host_permissions ["https://*/*"] to extension/manifest.json.
- Done when: a manual check in Chrome shows the toggle is off on a fresh install, the key field appears only for jev, saved settings persist after reload, and the log list shows at most 20 entries.
- Status: DONE (automated tests only, manual Chrome check pending)

### T14 — content/index.js
- Files: extension/src/content/index.js, extension/tests/content-index.test.js
- Requirements: R30, R33, R39
- Depends on: T7, T9, T10
- Do: the bootstrap per 03-design.md.
- Done when: tests show that with enabled false or provider null no DECIDE message is sent; the content script never reads jevKey; invalid messages are ignored; onAdEnded and onNavigated call resetFlow. Tests pass.
- Status: DONE

### T15 — Integration
- Files: extension/tests/integration.test.js
- Requirements: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26
- Depends on: T1 to T14
- Do: an end-to-end test through detector, flow and executor on fixture pages with a fake provider. Then one live run on a real ad with the provider the user picks.
- Done when: the fixture test passes; the live run completes the 4 clicks, or the failure reason is recorded in specs/spikes.md under "T15 live run"; the repo contains no .ts file.
- Status: TODO

## Traceability
Every requirement R1 to R43 must appear in the Requirements line of at least one task.

## Status
Phase 5: LOCKED (amended after S3 and S5: OI1 resolved, S4b added, T9, T11, T12 and T13 changed)
