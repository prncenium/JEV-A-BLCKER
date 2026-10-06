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
| 5 | No model call. Step 5 is local verification (R44). |

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
- Step 5 sends no request. It is local verification per R44.
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

## OpenAI-compatible mapping (provider name "openai")
UNVERIFIED until spike S4b. Settings: baseUrl, model, key, all user-supplied and read by the service worker only (R32, R33).
- Request: POST {baseUrl}/chat/completions with header Authorization: Bearer <key>. Body: { model, temperature: 0, messages: [system, user] }, with response_format { type: "json_object" } when the provider accepts it. When the model name starts with "openai/gpt-oss" (Groq), the body also carries reasoning_effort "low" and include_reasoning false, so the answer fits the 3000 ms timeout (Groq reasoning docs), and response_format is a strict json_schema (name "next_action") whose choice is an enum of the offered option ids and whose confidence is a number from 0 to 1 (Groq structured outputs docs). The answer is still validated by the mapping rules. No other model gets these fields.
- The system message states the task and says to answer with one JSON object { "choice": <option id>, "confidence": <number 0 to 1> } and nothing else. The user message holds the goal, the step, the last action and the options with their criteria strings from the Jev mapping. Snapshot text is data only.
- Response: choices[0].message.content is parsed as JSON. If direct parsing fails, extract the first {...} object from the text. The choice MUST be one of the offered option ids, otherwise the provider throws. Mapping to a Decision uses rules 2 to 5 of the Jev response mapping.
- Confidence is self-reported and uncalibrated, like Nano. The R40 allowlist is the real guard.
- Timeout JEV_TIMEOUT_MS (3000 ms). Any non-2xx status, timeout or malformed body throws an error carrying the HTTP status only. Never the body, the URL or the key (R43).
- Free tiers may log prompts. The snapshot holds only button labels (R9).

## Nano mapping (Chrome built-in Prompt API)
Verified by spike S1 (Chrome 153, one machine).
- Same input, same options table, same criteria strings placed in the prompt.
- Runs directly in the background service worker. No offscreen document.
- Call shape, as used in spikes/s1/probe.js: LanguageModel.availability() with expectedInputs and expectedOutputs of type text, language en; LanguageModel.create(); session.prompt(text, { responseConstraint }); session.destroy().
- Output is constrained to the JSON schema { choice: enum of the option ids, confidence: number 0 to 1 } and mapped to a Decision with steps 1 to 6 above.
- A new session is created for every DECIDE call and destroyed afterwards.
- The returned choice MUST be checked against the offered option ids. In S1 case B, e2 was returned although it was not in the enum. Whether Chrome enforces the constraint is UNRESOLVED. A choice outside the offered options throws an error and the flow aborts (R25).
- Makes no network request (R34).
- If LanguageModel is undefined or availability is not "available", the provider throws and the flow aborts. Model download on a fresh install was NOT tested (UNVERIFIED).
- Confidence is self-reported and not calibrated. S1 showed high confidence on wrong answers. The thresholds in R13 to R15 apply unchanged, but they are not a safety gate for Nano. The R40 allowlist is.
- Known weaknesses (S1): picks a wrong option instead of WAIT or BLOCKED when the right option is missing, and follows instructions injected into label text.
- Status: experimental fallback. Jev is primary.

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
- OQ1: RESOLVED by S1. The Prompt API works in the service worker.
- OQ5: Jev format is verified. Vercel Gateway path, the free-tier status of Jev, and whether a Vercel free credit covers it are UNVERIFIED. Resolved by S4.
- OQ7: RESOLVED by S1. Same thresholds, no separate tuning. Nano is experimental and the allowlist is the guard.

## Amendment Log
- After spike S1: Nano mapping rewritten with verified findings, OQ1 and OQ7 resolved.
- After S3 and S5: step 5 sends no request, the openai mapping is added.
- After a provider-timeout with Groq openai/gpt-oss-20b: gpt-oss requests send reasoning_effort "low" and include_reasoning false. The 3000 ms timeout is unchanged.
- After an invalid-response with Groq openai/gpt-oss-20b: gpt-oss requests use a strict json_schema response_format instead of json_object.

## Status
Phase 4: LOCKED (openai mapping UNVERIFIED until S4b; Jev live verification deferred)
