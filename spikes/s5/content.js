// S5 content script. Tries to read the value the service worker wrote, and records the outcome.
const TEST_KEY = "s5TestValue";
const TEST_VALUE = "secret-from-service-worker";

async function probe(label) {
  const result = { label, storageApi: typeof chrome !== "undefined" && !!chrome.storage && !!chrome.storage.local, read: null };
  if (!result.storageApi) {
    result.read = "chrome.storage.local undefined";
  } else {
    try {
      const got = await chrome.storage.local.get(TEST_KEY);
      result.read = got && got[TEST_KEY] === TEST_VALUE ? "SUCCEEDED (value read)" : "resolved but empty: " + JSON.stringify(got);
    } catch (e) {
      result.read = "THREW: " + (e && e.message);
    }
  }
  console.log("[S5 content]", JSON.stringify(result));
}

probe("immediate");
setTimeout(() => probe("after 2s"), 2000);
