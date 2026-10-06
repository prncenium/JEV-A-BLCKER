# 03 — Design

Language: JavaScript (ES2022 modules) only, per R37. Every component maps to requirement IDs (see Traceability). Component names are permanent.

## Spec file map
- 00-steering.md, 01-requirements.md, 02-recon.md, 03-design.md (this file)
- 04-decision-contract.md, 05-tasks.md, 06-test-plan.md (not yet written)

## Runtime contexts
1. Content script (top frame of https://www.youtube.com/*): detects ads, snapshots the DOM, validates decisions, clicks. Owns all flow state. Never holds the API key, never calls a model endpoint (R32, R33).
2. Background service worker: stateless request handler. Owns settings, API key, provider calls, flow-log storage.
3. Options page: settings UI and log viewer.

The aboutthisad iframe is same-origin, so the top-frame content script reads it through contentDocument. all_frames is not used (see OQ3).

## File layout
```
extension/
  manifest.json
  package.json
  vite.config.js
  src/
    shared/
      constants.js
      schema.js
    content/
      index.js
      detector.js
      scopes.js
      snapshot.js
      allowlist.js
      executor.js
      flow.js
    background/
      index.js
      providers/
        index.js
        jev.js
        nano.js
    options/
      options.html
      options.js
```

## Manifest
```json
{
  "manifest_version": 3,
  "name": "JEV-AD-Blocker",
  "version": "0.1.0",
  "permissions": ["storage"],
  "host_permissions": ["https://www.youtube.com/*", "https://ai-gateway.vercel.sh/*"],
  "optional_host_permissions": ["https://*/*"],
  "background": { "service_worker": "src/background/index.js", "type": "module" },
  "content_scripts": [
    { "matches": ["https://www.youtube.com/*"], "js": ["src/content/index.js"], "run_at": "document_idle" }
  ],
  "options_page": "src/options/options.html"
}
```

The options page requests host permission for the chosen openai base URL origin with chrome.permissions.request when the user saves, so no fixed AI host is needed.

## Steps table (used by scopes, snapshot, allowlist, flow)

| Step | Goal text sent to model | Scope | Readiness | Only click allowed (R40) |
|------|-------------------------|-------|-----------|--------------------------|
| 1 | Open the My Ad Center panel for the playing ad | #movie_player | #movie_player has class ad-showing and a visible button[aria-label="My Ad Center"] inside it | rule (a) |
| 2 | Click Block | aboutthisad iframe: [role="region"][aria-label="Main ad controls"] and the visible Close button | region present in iframe contentDocument | rule (b) |
| 3 | Click Continue in the Stop seeing this ad? dialog | aboutthisad iframe: div[role=dialog][aria-label="Stop seeing this ad?"] | dialog present and visible | rule (c) |
| 4 | Close the My Ad Center panel | aboutthisad iframe: the visible Close button | Close button visible, outside [role=banner] | rule (d) |
| 5 | Confirm the flow finished | #movie_player | none (runs after the step 4 click wait) | none (only DONE, WAIT, BLOCKED) |

## Components

### shared/constants.js
Exports: OPERATIONS (CLICK, WAIT, DONE, BLOCKED); thresholds ACT=0.8, RETRY=0.5; limits MAX_CALLS=8, MAX_MS=10000, MAX_SNAPSHOT=40, DEBOUNCE_MS=1500, CLICK_WAIT_MS=800, WAIT_MS=500, TEXT_MAX=80; the STEPS table; storage keys; message types.

### shared/schema.js
Exports: validateDecision(obj) and validateMessage(msg). Both return { ok: true, value } or { ok: false, error }. No throwing.
- validateDecision: operation in OPERATIONS; targetId string or null; confidence number in [0, 1].
- validateMessage: type is a known message type; payload shape matches that type.

### content/detector.js
Exports: startDetector({ onAdDetected, onAdEnded, onNavigated }).
- Waits for #movie_player to exist (YouTube is a SPA), then observes its class attribute with a MutationObserver.
- Emits onAdDetected when ad-showing is added, debounced 1500ms per ad instance. Emits onAdEnded when it is removed.
- Emits onNavigated on the yt-navigate-finish event.

### content/scopes.js
Exports: getScope(step), waitForScope(step, timeoutMs).
- Returns { root, doc } for the step, per the steps table.
- Step 1 and 5: root is #movie_player. Steps 2 to 4: the iframe[src*="aboutthisad"] contentDocument, read inside try/catch. Inaccessible returns null.
- Never reads, returns, or logs the iframe src value.

### content/snapshot.js
Exports: buildSnapshot(step), clearIds().
- Collects candidates in the step's scope only. Keeps visible (non-zero bounding box, not display:none, not visibility:hidden) and clickable (button, a, role=button, role=menuitem) elements.
- Excludes anything inside [role=banner] and anything outside the step's allowed iframe regions (R9).
- Assigns data-jev-id (e1, e2, ...) in document order. Entry: { id, tag, role, ariaLabel, text, enabled }; text trimmed to 80 chars.
- Caps at 40 entries.
- clearIds() removes data-jev-id from #movie_player and from the iframe document.

### content/allowlist.js
Exports: isAllowed(step, element).
- Implements rules (a) to (d) from R40 exactly. Step N allows only its own rule. Step 5 allows none.

### content/executor.js
Exports: execute(decision, ctx).
- CLICK: element.click() on the element with matching data-jev-id, then wait for a DOM mutation in the step's scope or 800ms, whichever comes first.
- WAIT: sleep 500ms.
- DONE: return success.
- Any other operation throws.

### content/flow.js
Exports: runFlow(ctx), resetFlow().
- State machine (see below), counters, guards, request building (R11), threshold logic, logging, cleanup.
- Sends DECIDE to the background, validates the response with validateDecision, applies allowlist and execution.
- Builds the flow log entry and sends LOG_FLOW.

### content/index.js
Bootstrap. Starts the detector. On onAdDetected, sends GET_CONFIG. If enabled is false or provider is null, does nothing. Otherwise starts runFlow. On onAdEnded and onNavigated, calls resetFlow.

### background/index.js
- On install and on startup: chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }) so content scripts cannot read the key (R33). On first install, writes defaults { enabled: false, provider: null } (R31).
- chrome.runtime.onMessage router. Rejects any sender whose id is not chrome.runtime.id or whose url is not under https://www.youtube.com/. Validates every message with validateMessage. Returns true for async responses.
- GET_CONFIG: returns { enabled, provider } only. Never the key.
- DECIDE: if not enabled or no provider, refuses (R30). Otherwise calls the selected provider and returns the decision.
- LOG_FLOW: appends the entry to flowLogs, keeps the newest 20.

### background/providers/index.js
getProvider(name) returns { decide(request) } for "jev" or "nano". Unknown name throws.

### background/providers/jev.js
decide(request): reads jevKey from storage.local, calls Jev through Vercel AI Gateway (model typesafe-ai/jev) with a timeout, maps the result to { operation, targetId, confidence }. Missing key throws. Never logs the key or full URLs. Exact request and response format is defined in 04-decision-contract.md.

### background/providers/nano.js
decide(request): uses Chrome's built-in Prompt API (LanguageModel) with a JSON schema response constraint. Runs directly in the background service worker (spike S1). Makes no network request (R34). Creates a new session for every call and destroys it afterwards. Validates that the returned choice is one of the offered options and throws otherwise. Experimental fallback, see DD7.

### options/options.html and options.js
Enable toggle (default off), provider select (nano or jev), API key input shown only when provider is jev, save to storage.local, and a viewer for the last 20 flow logs.

## Messages
All messages are { type, payload }. Unknown types are ignored.

| Type | Direction | Payload | Response |
|------|-----------|---------|----------|
| GET_CONFIG | content to background | none | { enabled: boolean, provider: "nano" or "jev" or null } |
| DECIDE | content to background | { goal: string, stepIndex: number, lastAction: string or null, snapshot: Entry[] } | { ok: true, decision: { operation, targetId, confidence } } or { ok: false, error: string } |
| LOG_FLOW | content to background | flow log entry | { ok: true } |

## Storage (chrome.storage.local, access level TRUSTED_CONTEXTS)
- settings: { enabled, provider }
- jevKey: string
- flowLogs: array of at most 20 entries

## Flow log entry (R35)
{ ts, outcome: "success" or "abort", reason, steps, calls, durationMs, confidences: number[] }
No snapshot content, no URLs, no account identifiers (R43).

`reason` is always one of these fixed codes (defined as FLOW_REASONS and PROVIDER_REASONS in shared/constants.js). Never a message, URL, key or response body.
- Success: verified-closed
- Flow aborts: timeout, scope-unavailable, call-limit, bad-decision, blocked, low-confidence, retry-exhausted, unexpected-done, unknown-target, not-allowed, close-not-verified, navigated, ad-ended, error (any exception that is not a coded failure)
- Provider and messaging codes, set by the background or a provider, passed through unchanged:
  - disabled: DECIDE while the ad blocker is off or no provider is set
  - no-response: the background did not answer the DECIDE message
  - invalid-response: the model answer or the decision did not match the contract
  - provider-error: any provider failure without a more specific code
  - provider-unavailable: the provider is not configured, the device cannot run the model, or the provider is the Jev stub
  - provider-model-not-ready: the Nano model still has to download
  - provider-needs-activation: the browser needs a user gesture before it can start the model
  - provider-import-failed: the provider module did not load in the service worker
  - provider-timeout, provider-network: the request timed out or did not reach the endpoint
  - provider-auth (HTTP 401 or 403), provider-rate-limit (HTTP 429), provider-http-error (any other non-2xx status)

## State machine
```
IDLE
  AD_DETECTED, config enabled, provider set, ad not yet processed  -> DETECTED
DETECTED
  step = 1                                                         -> AWAIT_SCOPE
AWAIT_SCOPE
  scope ready                                                      -> SNAPSHOT
  timeout or iframe inaccessible                                   -> ABORT   (R41, R42)
SNAPSHOT
  build snapshot, calls++ ; calls > 8                              -> ABORT   (R23)
                                                                   -> DECIDING
DECIDING
  response received                                                -> VALIDATING
  error or no response                                             -> ABORT
VALIDATING
  schema invalid                                                   -> ABORT   (R38)
  operation BLOCKED                                                -> ABORT   (R16)
  confidence < 0.5                                                 -> ABORT   (R15)
  0.5 <= confidence < 0.8, retry unused for this step              -> SNAPSHOT (R14, mark retry used)
  0.5 <= confidence < 0.8, retry already used                      -> ABORT
  confidence >= 0.8                                                -> ACTING  (R13)
ACTING
  DONE                                                             -> DONE    (R20)
  WAIT                                                             -> sleep 500ms -> SNAPSHOT (R19, step unchanged)
  CLICK, targetId not in snapshot                                  -> ABORT   (R17)
  CLICK, element not allowed for this step                         -> ABORT   (R17, R40)
  CLICK, allowed                                                   -> click -> VERIFYING
VERIFYING
  mutation in scope or 800ms                                       -> step++ -> AWAIT_SCOPE
DONE or ABORT
  clearIds, send LOG_FLOW, mark ad processed                       -> IDLE    (R22, R26, R35)
Any state
  elapsed > 10000ms                                                -> ABORT   (R24)
  any exception                                                    -> ABORT   (R25)
IDLE reset
  AD_ENDED                                                         -> clear processed flag (R4)
  NAVIGATED                                                        -> clear processed flag and counters (R5)
```

## Design decisions
- DD1: The content script owns all flow state. The service worker is stateless because MV3 can terminate it at any time.
- DD2: Per-step allowlist. At step N only the rule for step N may be clicked, and step 5 allows no click. This narrows R40, so a model answer of CLICK on the ⓘ at step 5 aborts instead of reopening the panel.
- DD3: Scope readiness is defined per step (see steps table).
- DD4: After the single retry allowed by R14, confidence below 0.8 aborts.
- DD5: Config is checked with GET_CONFIG at every AD_DETECTED.
- DD6: Step 5 is a model call whose only valid outcome is DONE (or WAIT / BLOCKED). Minimum calls per successful flow is 5, leaving 3 spare under R23.
- DD7: Nano is an experimental fallback. Spike S1 showed it picks a wrong option when the right one is missing, follows instructions injected into labels, and reports high confidence on wrong answers. Its confidence is not a safety gate. The R40 allowlist is. Jev is the primary provider.
- DD8: Step 5 is local verification per R44 and R45. It sends no model call. The STEPS table keeps 5 entries and allowlist.js keeps allowing no click at step 5. A successful flow needs 4 model calls.
- DD9: A third provider "openai" is added: any OpenAI-compatible chat completions endpoint with a user-supplied base URL, model and key. It lives in background/providers/openai.js. The Jev provider is deferred. In providers/index.js "jev" resolves to a stub that throws "jev not implemented". The default provider list is nano, openai, jev.

## Open questions (each gets a spike task in 05-tasks.md)
- OQ1: RESOLVED by spike S1 (Chrome 153). LanguageModel is available in the MV3 service worker. No offscreen document and no offscreen permission are needed.
- OQ2: Does element.click() from the content script trigger YouTube's handlers on the ⓘ button and on the iframe's div[role=button] elements? If not, fall back to dispatching a pointer and mouse event sequence.
- OQ3: Can a top-frame content script read the same-origin iframe's contentDocument without all_frames? Expected yes.
- OQ4: RESOLVED by spike S5 (this machine, one Chrome version). TRUSTED_CONTEXTS blocks content-script reads, and the service worker keeps access.
- OQ5: Jev request and response format, and Vercel free-tier status. Resolved in 04-decision-contract.md.
- OQ6: The four unknowns listed in 02-recon.md become test cases in 06-test-plan.md.

## Traceability (requirement to component)

| Requirement | Component |
|-------------|-----------|
| R1, R2, R3, R4 | detector.js |
| R5 | detector.js, flow.js |
| R6 | scopes.js, snapshot.js |
| R7, R8, R10 | snapshot.js |
| R9 | snapshot.js, scopes.js |
| R11 | flow.js |
| R12 | schema.js, constants.js |
| R13, R14, R15, R16 | flow.js, constants.js |
| R17 | flow.js, allowlist.js |
| R18, R19, R21 | executor.js, constants.js |
| R20 | executor.js, flow.js |
| R22, R23, R24, R25 | flow.js |
| R26 | snapshot.js, flow.js |
| R27, R28, R31 | options.html, options.js, background/index.js |
| R29 | project-wide (.gitignore, key only in storage), providers/jev.js |
| R30 | background/index.js, content/index.js |
| R32 | background/index.js, providers/jev.js |
| R33 | background/index.js, content/index.js |
| R34 | providers/nano.js |
| R35 | flow.js, background/index.js |
| R36 | background/index.js, options.js |
| R37 | package.json, project-wide |
| R38 | schema.js, flow.js |
| R39 | schema.js, background/index.js, content/index.js |
| R40 | allowlist.js |
| R41 | scopes.js |
| R42 | scopes.js, flow.js |
| R43 | scopes.js, flow.js, background/index.js |
| R44, R45 | flow.js, executor.js |

## Amendment Log
- After spike S1: nano.js runs in the service worker with no offscreen document, OQ1 resolved, DD7 added.
- After spike S2: selector syntax fixed to [role="region"][aria-label="Main ad controls"].
- After S3 and S5: DD8 and DD9 added, optional_host_permissions added, R44 and R45 traced.
- After nano failure in real Chrome: flow log reasons are fixed codes (see Flow log entry). A provider failure keeps its code from the provider to the log, instead of collapsing into error.
- DD10: temporary console-only debug output on not-allowed aborts, remove after T15.
- After navigated aborts in real Chrome: detector.js emits onNavigated only when the video changed and the navigation did not start before the current ad. DD10 also covers a temporary console.debug line per navigation (booleans only).
- After a live not-allowed abort whose step 1 snapshot held no ⓘ: step 1 readiness also waits for a visible My Ad Center button, because the ad overlay is drawn after ad-showing is set. DD10 also covers a temporary step1-not-ready console line (sizes and styles only).
- For Safari (untested): shared/ext.js picks `browser` when it exists, else `chrome`, so Chrome, Edge and Opera are unchanged. background/index.js calls storage.local.setAccessLevel only when it exists and never fails startup on it, because Safari supports setAccessLevel only for storage.session (MDN browser-compat-data). In Safari, R33 key isolation therefore relies on the content script never reading storage.

## Status
Phase 3: LOCKED (all R1 to R45 traced; amended after S1, S2, S3 and S5)
