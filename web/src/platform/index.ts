// The one place the app asks for storage. Detection order: native bridge
// → OPFS web shim → in-memory fallback. Everything else imports KQSOPlatform from
// here and never knows the difference.

import { MemoryPlatform } from './memory'
import { nativePlatform } from './native'
import { WebPlatform, opfsAvailable } from './web/opfs'
import type { KQSOPlatform } from './types'

let instance: KQSOPlatform | null = null

export function getPlatform(): KQSOPlatform {
  if (instance) return instance
  const native = nativePlatform()
  if (native) {
    instance = native
  } else if (opfsAvailable()) {
    instance = new WebPlatform()
  } else {
    console.warn('kQSO: OPFS unavailable — using in-memory storage; data will NOT persist.')
    instance = new MemoryPlatform()
  }
  return instance
}

/** Which backend getPlatform() would use — for the About/settings screen. */
export function platformKind(): 'native' | 'opfs' | 'memory' {
  // Not nativePlatform(): a second instance would take over the keyer callbacks.
  if (typeof window !== 'undefined' && window.KQSONative) return 'native'
  return opfsAvailable() ? 'opfs' : 'memory'
}

export type { KQSOPlatform, LogSummary, KeyerTransport, KeyerLinkState } from './types'
export { MemoryPlatform } from './memory'
export { WebPlatform, opfsAvailable } from './web/opfs'
