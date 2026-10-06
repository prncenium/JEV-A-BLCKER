// S5 service worker. Edit MODE, then remove and re-add the extension before each run.
//   "default"  -> setAccessLevel is NOT called (Chrome's default access level applies)
//   "trusted"  -> setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }) is called first
const MODE = "trusted";

const TEST_KEY = "s5TestValue";
const TEST_VALUE = "secret-from-service-worker";

async function run() {
  const log = { mode: MODE, setAccessLevel: "not called", write: null, read: null };
  try {
    if (MODE === "trusted") {
      await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      log.setAccessLevel = "ok";
    }
  } catch (e) {
    log.setAccessLevel = "threw: " + (e && e.message);
  }
  try {
    await chrome.storage.local.set({ [TEST_KEY]: TEST_VALUE });
    log.write = "ok";
  } catch (e) {
    log.write = "threw: " + (e && e.message);
  }
  try {
    const got = await chrome.storage.local.get(TEST_KEY);
    log.read = got[TEST_KEY] === TEST_VALUE ? "ok (value read back)" : "empty: " + JSON.stringify(got);
  } catch (e) {
    log.read = "threw: " + (e && e.message);
  }
  console.log("[S5 sw]", JSON.stringify(log));
}

chrome.runtime.onInstalled.addListener(run);
chrome.runtime.onStartup.addListener(run);
run();
