// The extension API object. Safari (and Firefox) expose a promise-based `browser`. Chrome, Edge and Opera
// have no `browser`, so they keep using `chrome` exactly as before.
export function getExtensionApi() {
  const api = globalThis.browser ?? globalThis.chrome
  return api && api.runtime && api.runtime.id ? api : null
}
