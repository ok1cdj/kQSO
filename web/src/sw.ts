// Service worker. Works offline after the first load: the page itself (navigations)
// network-first — online, a new deploy shows at once — with the cached copy when
// offline; the hashed assets cache-first. The cache name is the app version
// (injected at build time), so a new deploy purges the old cache.

/// <reference lib="webworker" />

export {} // make this a module so the `self` declaration is scoped, not global

declare const self: ServiceWorkerGlobalScope
declare const __SW_VERSION__: string

const CACHE = `kqso-${__SW_VERSION__}`
/** How long a page load waits for the network before it takes the cached copy. */
const NAV_TIMEOUT_MS = 3000

/** The manual's pages, so it opens offline even if it was never opened online; its
 *  pictures are cached when the manual is first opened (screens/manual.ts). */
const PRECACHE = ['manual/cs.html', 'manual/en.html', 'manual/start-cs.html', 'manual/start-en.html', 'manual/manual.css']

self.addEventListener('install', (event) => {
  // Activate the new worker immediately — don't wait for old tabs to close.
  void self.skipWaiting()
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).href)))
      .catch(() => {}), // offline install: they get cached on first use instead
  )
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
  // Offline references: refsync.ts keeps them in OPFS and checks index.json itself;
  // cached here, a rebuilt refs/ would never show (and the cache goes with each deploy).
  if (url.pathname.startsWith(new URL('refs/', self.registration.scope).pathname)) return
  // CW decoder models and runtime: the CW worker keeps them in OPFS (~29 MB, not per deploy).
  if (url.pathname.startsWith(new URL('cw/', self.registration.scope).pathname)) return

  // The page: network first, past the HTTP cache too (a stale index.html would point
  // at the old assets). The cached copy when offline — or when a weak signal (a summit)
  // hasn't answered within NAV_TIMEOUT_MS: the log must open, the update can wait.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const scope = self.registration.scope
        const cached = async (): Promise<Response | undefined> =>
          (await cache.match(req)) ?? (await cache.match(new URL('index.html', scope).href)) ?? (await cache.match(scope))
        const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
          if (res.ok && res.type === 'basic') void cache.put(req, res.clone())
          return res
        })
        net.catch(() => {}) // when the cached copy won the race, a later failure is nobody's business
        const slow = new Promise<'slow'>((r) => setTimeout(() => r('slow'), NAV_TIMEOUT_MS))
        try {
          const first = await Promise.race([net, slow])
          if (first !== 'slow') return first
          const shell = await cached()
          return shell ?? (await net) // nothing cached yet: wait for the network after all
        } catch (err) {
          const shell = await cached()
          if (shell) return shell
          throw err
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit

      const res = await fetch(req) // offline and not cached: fails
      // Cache successful same-origin responses for next time (lazy precache).
      if (res.ok && res.type === 'basic') void cache.put(req, res.clone())
      return res
    })(),
  )
})
