import { createNanoProvider } from './nano.js'
import { ProviderError, createOpenAIProvider } from './openai.js'

// Jev is deferred (DD9). The name stays reserved so the options page can list it.
const jevStub = Object.freeze({
  decide: async () => {
    throw new ProviderError('provider-unavailable')
  }
})

const FACTORIES = Object.freeze({
  nano: () => createNanoProvider(),
  openai: () => createOpenAIProvider(),
  jev: () => jevStub
})

export function getProvider(name) {
  const factory = Object.prototype.hasOwnProperty.call(FACTORIES, name) ? FACTORIES[name] : null
  if (!factory) throw new Error('unknown provider')
  return factory()
}
