import { probe } from "./probe.js";

const OFFSCREEN_URL = "offscreen.html";
// No offscreen Reason exactly matches "run the Prompt API". WORKERS is the
// closest available fit (on-device model inference is worker-backed); this
// is a judgment call, reported to the user rather than left implicit.
const OFFSCREEN_REASON = "WORKERS";
const OFFSCREEN_JUSTIFICATION =
  "Run the Chrome built-in Prompt API (LanguageModel), which needs a document context not available to the service worker.";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("test.html") });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "RUN_IN_SW") {
    probe("service-worker").then(sendResponse);
    return true;
  }

  if (msg.type === "RUN_IN_OFFSCREEN") {
    runInOffscreen().then(sendResponse);
    return true;
  }

  return false;
});

async function runInOffscreen() {
  const hasDoc = await hasOffscreenDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [OFFSCREEN_REASON],
      justification: OFFSCREEN_JUSTIFICATION
    });
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: "RUN_PROBE_OFFSCREEN" });
    return result;
  } finally {
    await chrome.offscreen.closeDocument();
  }
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  return contexts.length > 0;
}
