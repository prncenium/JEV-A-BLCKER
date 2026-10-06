# JEV-AD-Blocker

A browser extension that blocks the advertiser of a YouTube ad while it plays. It clicks through YouTube's own **My Ad Center** panel (ⓘ, Block, Continue, Close), using a language model to choose each click. A fixed allowlist means it can only ever click those four controls.

The extension must be built from source. It is not published in any extension store.

## What you need

- [Node.js](https://nodejs.org/) 20 or newer.
- A model provider. Use one of these:
  - **openai**: any OpenAI-compatible API. Groq's free tier works and was tested: base URL `https://api.groq.com/openai/v1`, model `openai/gpt-oss-20b`, and a key from <https://console.groq.com/keys>.
  - **nano**: Chrome's built-in on-device model. Chrome only, experimental.

## Build

```sh
git clone <this repo>
cd JEV-AD-Blocker/extension
npm install
npm run build
```

The built extension is in `extension/dist`. Keep this folder; the browser loads the extension from it.

## Install in Chrome, Edge, Brave or Opera

1. Open the extensions page: `chrome://extensions`, `edge://extensions`, `brave://extensions` or `opera://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `extension/dist`.
4. Open the extension's options (**Details → Extension options**) and fill them in as described in [Settings](#settings).

**Opera and Opera GX:** turn off Opera's own ad blocker for YouTube (**Settings → Privacy protection → Block ads**). If Opera removes the ad first, this extension has nothing to block.

After any code change, run `npm run build` again and click the reload button on the extension's card. Use reload, not Remove: removing the extension deletes its saved settings and API key.

## Settings

The options page has these fields. The extension is off until you tick **Enable** and save a provider.

| Field | What to enter |
|-------|---------------|
| **Enable the ad blocker** | Tick to turn the extension on. It is off after a fresh install. |
| **Provider** | `openai` (recommended), `nano` (Chrome only, experimental) or `jev` (not implemented yet; do not choose it). |
| **Base URL** | Shown for `openai`. The API address up to and including the version path, for example `https://api.groq.com/openai/v1`. It must start with `https://`. Do not add `/chat/completions`; the extension adds it. |
| **Model name** | Shown for `openai`. The model ID exactly as your provider spells it, for example `openai/gpt-oss-20b`. |
| **API key** | Shown for `openai`. Your provider's secret key. The field stays empty after saving and shows "A key is saved. Leave blank to keep it." To keep the saved key, leave it blank. To change it, paste a new one. |

Click **Save**. For `openai`, the browser then asks for permission to reach the Base URL's address (for example `api.groq.com`). Click **Allow**; if you refuse, nothing is saved.

### Recommended setup: Groq (free)

This is the setup that was tested end to end.

1. Create a free account at <https://console.groq.com> and create a key at <https://console.groq.com/keys>. The key starts with `gsk_`.
2. Fill in the options page:

   | Field | Value |
   |-------|-------|
   | Provider | `openai` |
   | Base URL | `https://api.groq.com/openai/v1` |
   | Model name | `openai/gpt-oss-20b` |
   | API key | your `gsk_…` key |

3. Click **Save**, then **Allow**.

**Free-tier limits** for `openai/gpt-oss-20b`, from Groq's documentation as of October 2026: 30 requests per minute, 1,000 per day, 8,000 tokens per minute and 200,000 per day. One blocked ad uses about 4 requests and at most 8, so the daily limit covers roughly 250 ads. When a limit is hit, that ad is skipped and the flow log shows `provider-rate-limit`.

`openai/gpt-oss-120b` is a larger free model with the same limits. Use it if the 20b model often fails with `invalid-response`.

For models whose names start with `openai/gpt-oss`, the extension automatically sends Groq's settings for short reasoning and a strict answer format. These settings keep each answer within the 3-second limit and in the expected shape.

### Other OpenAI-compatible providers

Any provider with an OpenAI-style `POST /chat/completions` endpoint and Bearer-key authentication can work. Enter its base URL, model ID and key in the same way. Only Groq has been tested. Each model call must answer within **3 seconds**, so prefer fast models. A provider that rejects the `response_format: json_object` field will fail with `provider-http-error`.

### nano (Chrome only, experimental)

This option uses Chrome's built-in Gemini Nano model. It runs on your computer and needs no key, Base URL or model name. It only works in Chrome versions where the built-in model is available and already downloaded; otherwise the flow log shows `provider-model-not-ready` or `provider-unavailable`. Testing showed that Nano often chooses wrong buttons; the allowlist blocks those clicks, so expect many aborts.

### Flow log

The bottom of the options page lists the last 20 attempts, newest first. Each line has the time, the outcome, a reason code, the number of clicks, the number of model calls, the duration and the model's confidence for each step. It never stores page text, URLs or keys.

| Reason | Meaning |
|--------|---------|
| `verified-closed` | Success: all four clicks were made and the ad ended. |
| `provider-auth` | The API key was rejected. Check the key. |
| `provider-rate-limit` | The provider's limit was reached. Wait, or upgrade the plan. |
| `provider-timeout` | The model took longer than 3 seconds. Try a faster model. |
| `provider-unavailable` | The provider is not set up: a field is empty, or nano is not available. |
| `provider-http-error`, `provider-network` | The request failed, or the Base URL is wrong. |
| `invalid-response` | The model's answer was not in the expected format. |
| `not-allowed`, `unknown-target` | The model chose a button outside the allowlist. Nothing was clicked. |
| `scope-unavailable` | The expected YouTube control did not appear in time. |
| `navigated`, `ad-ended` | You changed video, or the ad ended, before the flow finished. |

The full list of codes is in `specs/03-design.md`, under "Flow log entry". When a provider call fails, the extension's service worker console shows one line `[JEV] DECIDE failed: …` with a short detail code. The console never shows the key or the model's text. To open this console in Chrome, open `chrome://extensions` and click **service worker** on the extension's card.

## Install in Safari (macOS)

> **Status: untested.** The code has the changes Safari needs (see "Safari differences" below), but it has not been run in Safari yet. If you try it, please open an issue with the result.

You need a Mac with **Xcode** (free, from the Mac App Store) and **Safari 16.4 or newer**.

1. Build the extension as described in [Build](#build).
2. Convert it into a Safari extension project. From the repository folder, run:
   ```sh
   xcrun safari-web-extension-converter extension/dist --app-name "JEV AD Blocker" --macos-only
   ```
   Xcode opens the generated project. If a flag is not accepted, run `xcrun safari-web-extension-converter --help` to see the options your Xcode version supports.
3. In Xcode, select the project. Under **Signing & Capabilities**, choose your personal team, or **Sign to Run Locally**. A paid Apple Developer account is not needed for your own Mac.
4. Choose the **macOS** scheme and press **Run** (⌘R). A small app opens; you can close it.
5. In Safari, show the developer features: **Safari → Settings → Advanced → Show features for web developers**. On older Safari versions, this option is called **Show Develop menu in menu bar**.
6. Choose **Develop → Allow Unsigned Extensions** and enter your password. Safari turns this off every time it quits, so repeat this step after each restart.
7. Open **Safari → Settings → Extensions**, and tick **JEV-AD-Blocker**.
8. Give it access to YouTube: open youtube.com, click the extension's icon in the toolbar, and choose **Always Allow on This Website**.
9. Open the extension's settings in **Safari → Settings → Extensions** and fill them in as described in [Settings](#settings), using the **openai** provider. Allow access to the API address when Safari asks.

### Safari differences

- **Use the openai provider.** Nano uses Chrome's built-in model, which Safari does not have.
- **Weaker key protection.** In Chrome, the extension locks its storage so that content scripts cannot read the API key. Safari supports this lock only for session storage, not for the local storage where the key is kept, so in Safari the extension skips the lock and keeps working. The extension's own code still never reads the key from the page, but a page-level compromise is less contained than in Chrome.
- After any code change: run `npm run build`, run the converter again (or copy the new `dist` files into the Xcode project), and run it again in Xcode.

## Checking that it works

Open a YouTube video and wait for an ad. Then open the extension's options page. The newest flow-log line should look like:

```
… | success | verified-closed | steps 4 | calls 4 | … ms | confidences …
```

If the line says `abort`, the reason code after it says why. See [Flow log](#flow-log).

## Privacy

- The model receives only button labels from the ad player and the My Ad Center panel. It never receives URLs, account names or page text.
- Your API key is stored only in the browser's extension storage, and is never written into the source or the build.
- The flow log stores only the outcome, the reason code, counts, the duration and the confidence values.

## Tests

```sh
cd extension
npm test
```
