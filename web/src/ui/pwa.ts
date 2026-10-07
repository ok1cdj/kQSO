// Service worker registration. Only in production builds — in dev there is
// no /sw.js and the SW would fight HMR.

import { inNativeShell } from '../platform/index'

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  // In the Android / iOS shell assets are already local — no SW needed (and it would
  // fight the native bridge).
  if (inNativeShell()) return
  if (!('serviceWorker' in navigator)) return
  const register = (): void => {
    // BASE_URL is the Vite base (/) — register at the app's scope.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { type: 'module' }).catch(() => {
      /* registration failed (e.g. insecure context) — app still works online */
    })
  }
  // main.ts calls this after an async start-up, usually AFTER 'load' has fired —
  // a plain load listener then never runs and the app silently loses offline mode.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
