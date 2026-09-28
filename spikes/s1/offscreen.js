import { probe } from "./probe.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "RUN_PROBE_OFFSCREEN") {
    probe("offscreen").then(sendResponse);
    return true;
  }
  return false;
});
