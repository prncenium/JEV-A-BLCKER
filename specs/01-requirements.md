# 01 — Requirements

Format: EARS. Every requirement is testable. IDs are permanent — never renumber.

## Detection

- **R1** — WHEN the element `#movie_player` gains the class `ad-showing`, the system SHALL emit an `AD_DETECTED` event.
- **R2** — WHILE `#movie_player` does not have the class `ad-showing`, the system SHALL NOT emit `AD_DETECTED`.
- **R3** — WHEN `AD_DETECTED` fires more than once within 1500ms for the same ad instance, the system SHALL debounce and process only the first.
- **R4** — WHEN the class `ad-showing` is removed, the system SHALL reset the ad instance state to IDLE.
- **R5** — WHEN the user navigates to a new video via SPA navigation, the system SHALL reset all per-ad counters.

## Snapshot

- **R6** — WHEN building a snapshot, the system SHALL include only elements that are visible (non-zero bounding box, not `display:none`, not `visibility:hidden`) and clickable (`button`, `a`, `role="button"`, `role="menuitem"`), and that lie within the scope of the current step: for step 1, descendants of `#movie_player`; for steps 2 to 4, descendants of the `contentDocument` of `iframe[src*="aboutthisad"]`. (amended after recon)
- **R7** — The system SHALL assign each included element a stable `data-jev-id` attribute for the duration of one flow run.
- **R8** — Each snapshot entry SHALL contain: `id`, `tag`, `role`, `ariaLabel`, `text` (trimmed, max 80 chars), and `enabled`.
- **R9** — The system SHALL NOT include in the snapshot: video content, page transcript, watch history, account identifiers, any text outside the current step's scope, the iframe `src` URL, the iframe header (`[role=banner]`), or any iframe element outside `[role="region"][aria-label="Main ad controls"]`, `div[role=dialog][aria-label="Stop seeing this ad?"]`, and the visible `button[aria-label="Close"]`. (amended after recon)
- **R10** — The system SHALL cap a snapshot at 40 entries, keeping those nearest the player controls when over the cap.

## Decision

- **R11** — The system SHALL send the model: the flow goal, the current step index, the last action taken, and the current snapshot.
- **R12** — The model response SHALL conform to: `operation` ∈ {CLICK, WAIT, DONE, BLOCKED}, `targetId` (string or null), `confidence` (0.0–1.0).
- **R13** — WHEN `confidence` >= 0.8, the system SHALL execute the returned operation.
- **R14** — WHEN `confidence` is >= 0.5 and < 0.8, the system SHALL re-snapshot and request one retry for that step, and no more than one.
- **R15** — WHEN `confidence` < 0.5, the system SHALL abort the flow and log the reason.
- **R16** — WHEN `operation` is `BLOCKED`, the system SHALL abort the flow immediately without retry.
- **R17** — WHEN `targetId` does not match any `data-jev-id` in the current snapshot, the system SHALL abort the flow.

## Execution

- **R18** — WHEN executing `CLICK`, the system SHALL dispatch a trusted-style click on the element matching `targetId` and then wait for a DOM mutation inside that step's scope (per R6) or 800ms, whichever is first. (amended after recon)
- **R19** — WHEN executing `WAIT`, the system SHALL pause 500ms and then re-snapshot without incrementing the step count.
- **R20** — WHEN executing `DONE`, the system SHALL mark the flow successful and return to IDLE.
- **R21** — The system SHALL NOT execute any operation other than those listed in R12.

## Guards

- **R22** — The system SHALL run the block flow at most once per ad instance.
- **R23** — The system SHALL make at most 8 model calls per ad instance. (amended after recon)
- **R24** — The system SHALL abort any flow exceeding 10000ms from `AD_DETECTED`.
- **R25** — WHEN any error is thrown at any stage, the system SHALL abort, leave the DOM unmodified beyond `data-jev-id` attributes, and never surface a blocking UI to the user.
- **R26** — The system SHALL remove all `data-jev-id` attributes it added when a flow ends for any reason.

## Configuration

- **R27** — The system SHALL provide an options page allowing the user to select the provider (`nano` or `jev`).
- **R28** — WHEN the provider is `jev`, the options page SHALL accept an API key and store it in `chrome.storage.local`.
- **R29** — The system SHALL NOT contain any API key in source, build output, or version control.
- **R30** — WHEN no provider is configured, the system SHALL remain inactive and SHALL NOT call any network endpoint.
- **R31** — The options page SHALL provide a master enable/disable toggle, defaulting to disabled on first install.

## Network

- **R32** — All model API calls SHALL originate from the background service worker.
- **R33** — The content script SHALL NOT read the API key or issue any `fetch` to a model endpoint.
- **R34** — WHEN the provider is `nano`, the system SHALL make no network request.

## Observability

- **R35** — The system SHALL log each flow run with: outcome, step count, model call count, total duration, and per-step confidence.
- **R36** — The system SHALL expose the last 20 flow logs on the options page.

## Recon-Driven Requirements

- **R40** — The executor SHALL click only elements matching one of these four rules, regardless of the model output: (a) `button[aria-label="My Ad Center"]` inside `#movie_player`; (b) `div[role=button][aria-label="Block"]` inside the aboutthisad iframe; (c) a `button` whose trimmed text is "Continue" inside `div[role=dialog][aria-label="Stop seeing this ad?"]` in the aboutthisad iframe; (d) the visible `button[aria-label="Close"]` in the aboutthisad iframe that is not inside `[role=banner]`. A `targetId` resolving to anything else SHALL abort the flow per R17.
- **R41** — WHEN the step 1 click completes, the system SHALL wait until `iframe[src*="aboutthisad"]` exists, its `contentDocument` is readable, and `[role="region"][aria-label="Main ad controls"]` is present before building the step 2 snapshot. The wait SHALL count toward the R24 limit.
- **R42** — WHEN the aboutthisad iframe `contentDocument` is not accessible, the system SHALL abort per R25.
- **R43** — The system SHALL NOT log, store, or transmit the iframe `src` URL or any account identifier.

## Traceability

Every component in 02-design.md must map to at least one requirement ID above. Every task in 04-tasks.md must cite the requirement IDs it satisfies.

## Amendment Log
- After recon (02-recon.md): R6, R9, R18, R23 amended in place. R40 to R43 added. Goal wording changed from "Block ad / confirm" to "Block / Continue".
- After spike S2: selector syntax fixed to [role="region"][aria-label="Main ad controls"].

## Status
Phase 1: LOCKED (R1 to R43, amended after recon; selector syntax fixed after S2)
