import { probe } from "./probe.js";

const out = document.getElementById("out");

function show(value) {
  out.textContent = JSON.stringify(value, null, 2);
}

document.getElementById("run-extension-page").addEventListener("click", async () => {
  show("running in extension page...");
  const result = await probe("extension-page");
  show(result);
});

document.getElementById("run-sw").addEventListener("click", async () => {
  show("running in service worker...");
  const result = await chrome.runtime.sendMessage({ type: "RUN_IN_SW" });
  show(result);
});

document.getElementById("run-offscreen").addEventListener("click", async () => {
  show("running in offscreen document...");
  const result = await chrome.runtime.sendMessage({ type: "RUN_IN_OFFSCREEN" });
  show(result);
});

document.getElementById("download").addEventListener("click", async () => {
  if (typeof LanguageModel === "undefined") {
    show({ error: "LanguageModel is undefined in this context" });
    return;
  }
  show("starting download...");
  try {
    const session = await LanguageModel.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          show({ downloading: true, loaded: e.loaded });
        });
      }
    });
    show({ downloaded: true });
    session.destroy();
  } catch (err) {
    show({ error: String(err && err.message) });
  }
});

document.getElementById("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(out.textContent);
  } catch (err) {
    show({ copyError: String(err && err.message) });
  }
});
