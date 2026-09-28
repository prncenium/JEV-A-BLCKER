# 04 — Decision Contract

Sources: TypeSafe API reference (docs.typesafe.ai/api, checked 2026-09-28) for the request and response format. The Vercel AI Gateway route comes from a third-party guide and is UNVERIFIED until spike S4 in 05-tasks.md. Nothing in this file is guessed: unverified items are marked.

## Purpose
Defines (1) the DECIDE payload the content script sends, (2) how each provider turns it into a model call, (3) the decision returned. Both providers return the same shape, so they are swappable.

## DECIDE request (content script to background, unchanged from 03-design.md)
{ goal: string, stepIndex: 1 to 5, lastAction: string or null, snapshot: Entry[] }
Entry = { id, tag, role, ariaLabel, text, enabled } as defined by R8.

## Decision (background to content script)
{ operation: "CLICK" | "WAIT" | "DONE" | "BLOCKED", targetId: string or null, confidence: number 0 to 1 }
- CLICK carries the entry id in targetId. Every other operation has targetId null.
- Validated by validateDecision (R38). The allowlist (R40) is the real safety guard. Model output is never trusted beyond it.

## Jev mapping: one Choice question named "action"

Jev returns typed answers, not free text. Each request carries one Choice question. The options are the snapshot entry ids plus control options.

### Options by step
| Step | Options offered |
|------|-----------------|
| 1 to 4 | every snapshot entry id (e1, e2, ...), plus WAIT, BLOCKED |
| 5 | WAIT, DONE, BLOCKED only (no entry ids) |

### Request body
```json
{
  "model": "typesafe-ai/jev",
  "state": { "snapshot": [ { "id": "e1", "tag": "div", "role": "button", "ariaLabel": "Like ad", "text": "Like", "enabled": true } ] },
  "questions": {
    "action": {
      "type": "choice",
      "instructions": {
        "goal": "Click Block",
        "step": "2 of 5",
        "last_action": "Clicked e4 (My Ad Center)",
        "question": "Which option is the single next action to achieve `goal`, given `last_action`? Choose WAIT if the needed control is not listed yet. Choose BLOCKED if it cannot be achieved."
      },
      "criteria": {
        "e1": "div[role=button] \"Like ad\"",
        "WAIT": "The needed control is not listed yet or the page is still loading. Do nothing this step.",
        "BLOCKED": "The goal cannot be achieved: the needed control is missing or the page is in an unexpected state."
      }
    }
  }
}
```
Rules:
- instructions.goal is the step's goal text from the steps table in 03-design.md. instructions.step is "N of 5". instructions.last_action is the last action string or "none".
- criteria has one key per snapshot entry id. The value is: <tag>[role=<role>] "<label>", where label is ariaLabel if present, else text, and " (disabled)" is appended when enabled is false. Then the control options as shown.
- At step 5 the control options are WAIT, DONE, BLOCKED and criteria has no entry ids. DONE description: "The flow finished: the panel is closed and the ad is still playing or has ended."
- state contains only { snapshot }. No URLs, no account identifiers, no page text (R9, R43).
- Limits from the API docs: Choice accepts at most 255 options. We send at most 43 (40 entries + 3 controls).
- Snapshot text is untrusted page content. It may contain instructions written by advertisers. It is only ever data. The R40 allowlist blocks any click outside the four allowed targets.

### Endpoint (via Vercel AI Gateway, UNVERIFIED until S4)
POST https://ai-gateway.vercel.sh/typesafe/v1/systemone
Authorization: Bearer <AI Gateway key>
Content-Type: application/json
The key is user-supplied (R28), read from storage.local by the service worker only (R32, R33).

### Direct TypeSafe endpoint (documented, NOT implemented in v0.1)
POST https://api.typesafe.ai/v1/systemone with model "jev-latest". It would need host permission for api.typesafe.ai and a TypeSafe key.

### Response (verified format, illustrative numbers)
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "action": {
      "type": "choice",
      "choice": "e2",
      "probabilities": { "e1": 0.03, "e2": 0.94, "WAIT": 0.02, "BLOCKED": 0.01 },
      "confidence": 0.93
    }
  },
  "usage": { "input_tokens": 300, "output_tokens": 30 }
}
```

### Response to Decision mapping
1. answers.action must exist and have type "choice", else error.
2. choice is one of the entry ids in the request: operation "CLICK", targetId = choice.
3. choice is WAIT, DONE or BLOCKED: operation = choice, targetId null.
4. Any other choice value: error.
5. confidence = answers.action.confidence, must be a number 0 to 1.
6. probabilities and usage are dropped. They never reach the content script.

### Errors
- Per-call timeout: 3000 ms.
- Any non-2xx status, timeout, or malformed body: the provider throws an error carrying the HTTP status only. Never the response body, never the URL, never the key (R43).
- No retry inside the provider. The flow aborts (R25). The 429 and 529 retry advice in the API docs does not apply, because R24 and R23 already cap time and calls.
- 401 or 422: also surfaced in the flow log reason as "auth" or "bad-request".

### Confidence
Jev derives Choice confidence from its probability distribution. The thresholds 0.8 and 0.5 (R13 to R15) apply to it as is. Whether these numbers are well calibrated for this task is UNKNOWN. Tune them in Phase 7 from real flow logs.

## Nano mapping (Chrome built-in Prompt API)
- Same input, same options table, same criteria strings placed in the prompt.
- Output is constrained to a JSON schema { choice: enum of the option ids, confidence: number 0 to 1 } and mapped to a Decision with steps 1 to 6 above.
- Makes no network request (R34).
- UNVERIFIED: the exact API call shape, whether it runs in a service worker (OQ1 in 03-design.md), and whether the model returns a usable confidence. The Prompt API has no calibrated confidence. A confidence from Nano is self-reported and uncalibrated. The exact call is defined by spike S1 in 05-tasks.md, not guessed here.
- OQ7: Nano may need its own thresholds, or may be limited to decisions gated by the allowlist alone. Decided after spike S1.

## Traceability
| Requirement | Where it lands |
|-------------|----------------|
| R11 | DECIDE payload, state, instructions |
| R12, R38 | Decision shape, validateDecision, response mapping |
| R13, R14, R15 | Confidence section |
| R16 | BLOCKED option |
| R17, R40 | Allowlist as the guard against untrusted output |
| R19 | WAIT option |
| R20 | DONE option, step 5 only |
| R28, R32, R33 | Endpoint, key handling |
| R34 | Nano mapping |
| R43 | Errors section |

## Gate to lock this phase
Sign-off of this document. Live verification needs the user's key, so it is spike S4 in 05-tasks.md: three recorded snapshots (step 1, step 2, step 3) sent through the gateway must return the correct entry id at confidence 0.8 or higher.

## Open questions
- OQ1: Prompt API in a service worker (from 03-design.md), resolved by S1.
- OQ5: Jev format is verified. Vercel Gateway path, the free-tier status of Jev, and whether a Vercel free credit covers it are UNVERIFIED. Resolved by S4.
- OQ7: Nano confidence source and thresholds.

## Status
Phase 4: LOCKED (live verification pending in spike S4)
