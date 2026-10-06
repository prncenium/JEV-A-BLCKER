# 06 — Test Plan

## Rules
- Unit tests are defined inside each task in 05-tasks.md (T2 to T14). This file adds fixtures, integration tests, manual tests, safety checks, and the pass criteria.
- Never open, read, or copy specs/recon/*.html. Fixtures are small hand-written HTML files built from 02-recon.md.
- jsdom has no layout engine. Visibility tests stub getBoundingClientRect, offsetWidth and offsetHeight.
- Live results go in specs/test-results.md, created during the run. It never contains keys, emails, or iframe URLs.
- The user handles all git commits and pushes manually.

## Fixtures (extension/tests/fixtures/)
- F1: player with class ad-showing and the ⓘ button (button[aria-label="My Ad Center"], class ytp-ad-button, dynamic id).
- F2: aboutthisad iframe document, step 2 state: header with role=banner whose aria-label holds a fake account name and email; [role="region"][aria-label="Main ad controls"] with Like ad, Block, Report, See more X ads, See fewer X ads, Customize more of your ads (an <a>); a visible Close button; two hidden 0x0 Close elements; a hidden verification dialog.
- F3: same iframe, step 3 state: div[role=dialog][aria-label="Stop seeing this ad?"] with Cancel and Continue.
- F4: same iframe, step 4 state: "Ad blocked" banner and the visible Close button.
- F5: player without ad-showing (normal video).
- F6: player with 60 clickable candidates, for the 40-entry cap.
- F7: player at step 5 state (panel closed, ad still playing).
- Fake provider: returns scripted decisions per call, so every branch of the state machine can be forced.

## Integration tests (extension/tests/integration.test.js, task T15)
- I1: happy path. Detector fires, 4 model calls, 4 clicks in order, success log, no data-jev-id left.
- I2: F5 only. No AD_DETECTED, no message, no click.
- I3: each abort path (low confidence, BLOCKED, unknown targetId, allowlist rejection, 9th call, over 10s, thrown error) leaves the DOM clean and logs an abort.
- I4: two ads in a row (pod). The second ad triggers a second flow after ad-showing is removed and re-added (R4, R22).
- I5: SPA navigation mid-flow resets state (R5).

## Manual test matrix (real Chrome, English)
Record outcome, steps, calls, duration in specs/test-results.md.

| ID | Case | Expected |
|----|------|----------|
| M1 | Fresh install | Extension disabled, no provider, no network call (R30, R31) |
| M2 | Enabled, provider jev, valid key, unskippable ad | 4 clicks, panel closed, success log |
| M3 | Same, skippable ad | 4 clicks, success log, skip button untouched |
| M4 | Ad pod ("1 of 2", "2 of 2") | One flow per ad instance (R22) |
| M5 | Ad in fullscreen | Documented result, no error, no stuck state |
| M6 | Signed out | Documented result (unknown U3 in 02-recon.md) |
| M7 | Non-ad video, 10 different videos | Zero flows started (R2) |
| M8 | Wrong or empty key | Flow aborts, logs "auth", page untouched |
| M9 | Offline | Flow aborts within 10s, page untouched (R24, R25) |
| M10 | Provider nano | Works if spike S1 found it viable, else documented as unavailable (R34) |
| M11 | User opens My Ad Center manually during an ad | No double clicks, no crash |
| M12 | Navigate to another video mid-flow | Flow stops, no clicks on the new page (R5) |
| M13 | Toggle off while an ad plays | No new flow starts (R31) |
| M14 | Ad keeps playing while panel is open | Documented (unknown U2 from 02-recon.md, also spike S3) |
| M15 | Long video with a mid-roll ad at least 10 minutes after the first ad | A second full flow runs. State was reset when ad-showing was removed (R4, R22) |

## Safety checks
- SC1: allowlist. In a real ad, force the fake provider to return Like ad, Report, See fewer ads, Customize more of your ads, Cancel and Send feedback in turn. Each aborts with no click (R40).
- SC2: key isolation. From the page and content-script consoles, chrome.storage.local.get("jevKey") returns nothing or throws (R33, spike S5).
- SC3: privacy. Inspect the outgoing request in the service worker DevTools Network tab. It has no iframe URL, no account name, no email. Flow logs have no snapshot text and no URL (R9, R43).
- SC4: build output. Searching extension/dist and the repo for the test key returns nothing (R29).
- SC5: nano network. With provider nano, the service worker Network tab shows zero requests (R34).
- SC6: language. The repo contains no .ts or .tsx file, no tsconfig.json, no typescript dependency (R37).

## Live run protocol
- 20 real ads across at least 3 sessions on different days.
- Provider jev. Repeat 10 of them with nano only if M10 passed.
- Success means all 4 clicks done, the panel closed, and a success log.
- Per ad, record date, provider, outcome, steps, calls, duration, per-step confidences from the options page log, and the failure reason if any.

## Pass criteria
- P1: at least 18 of 20 live ads succeed (90 percent).
- P2: zero flows start during the 10 non-ad videos.
- P3: no run makes more than 8 model calls, or runs longer than 10 seconds.
- P4: SC1 to SC6 all pass.
- P5: all unit and integration tests pass (npm test).
- If P1 fails: record the failure reasons, tune thresholds or amend the specs in Phase 7, and rerun the live protocol.

## Regression
After any YouTube UI change or any spec amendment, rerun I1 to I5 and M2, M4, M7, SC1.

## Traceability (requirement to tests)

| Requirement | Tests |
|-------------|-------|
| R1, R2 | T7, I2, M7 |
| R3 | T7 |
| R4 | T7, I4, M4, M15 |
| R5 | T7, T9, I5, M12 |
| R6, R7, R8, R9, R10 | T4, T5, F2, F6 |
| R11 | T9, T12 |
| R12, R38 | T3, T12 |
| R13, R14, R15, R16 | T9, I3 |
| R17 | T6, T9, I3, SC1 |
| R18, R19, R20, R21 | T8, I1 |
| R22 | T9, I4, M4 |
| R23, R24, R25 | T9, I3, M9 |
| R26 | T5, T9, I1, I3 |
| R27, R28 | T13, M2 |
| R29 | SC4 |
| R30 | T10, T14, M1 |
| R31 | T10, T13, M1, M13 |
| R32, R33 | T10, T14, S5, SC2 |
| R34 | T11, M10, SC5 |
| R35, R36 | T9, T10, T13 |
| R37 | SC6 |
| R39 | T3, T10, T14 |
| R40 | T6, SC1 |
| R41, R42 | T4, T9, S3 |
| R43 | T4, T9, T12, SC3 |
| R44, R45 | T9, I1, M2 |

## Amendment Log
- After spike S2: selector syntax fixed to [role="region"][aria-label="Main ad controls"]. M15 added.
- After S3 and S5: I1 uses 4 model calls, R44 and R45 traced.

## Status
Phase 6: LOCKED (amended after S2: M15 added, selector syntax fixed)
