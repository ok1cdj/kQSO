// Service worker. Offline-first: caches the app shell + assets so
// the whole thing works in airplane mode after the first load. The cache name is
// the app version (injected at build time), so a new deploy purges the old cache
// and clients never hang on a stale build.

/// <reference lib="webworker" />

export {} // make this a module so the `self` declaration is scoped, not global

declare const self: ServiceWorkerGlobalScope
declare const __SW_VERSION__: string

const CACHE = `kqso-${__SW_VERSION__}`

self.addEventListener('install', () => {
  // Activate the new worker immediately — don't wait for old tabs to close.
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache that isn't the current version.
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // Only handle our own origin — never intercept cross-origin (e.g. a future
  // Wavelog push).
  if (url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit

      try {
        const res = await fetch(req)
        // Cache successful same-origin responses for next time (lazy precache).
        if (res.ok && res.type === 'basic') cache.put(req, res.clone())
        return res
      } catch (err) {
        // Offline and not cached: for a navigation, serve the cached app shell.
        // Resolve paths against the SW scope, so it works under any base path.
        if (req.mode === 'navigate') {
          const scope = self.registration.scope
          const shell =
            (await cache.match(new URL('index.html', scope).href)) ?? (await cache.match(scope))
          if (shell) return shell
        }
        throw err
      }
    })(),
  )
})
