// kqso.eu: the mobile menu and the typed log line on the home page.
// The demos are JSON in <script id="demos"> (texts per language stay in the page):
// { ctx: [left, right], line, chips: [[token, value, label, needed]], saved }
// A chip shows once its token (0-based word of the line) is typed; a needed one is
// dashed until then, as in the app.

;(() => {
  const btn = document.querySelector('.menu-btn')
  const nav = document.getElementById('nav')
  if (btn && nav) {
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('open')
      btn.setAttribute('aria-expanded', String(open))
    })
  }

  const box = document.querySelector('.logline')
  const data = document.getElementById('demos')
  if (!box || !data) return
  const demos = JSON.parse(data.textContent)
  const ctxL = box.querySelector('[data-ctx-l]')
  const ctxR = box.querySelector('[data-ctx-r]')
  const input = box.querySelector('.logline-input')
  const chips = box.querySelector('.chips')
  const saved = box.querySelector('.logline-saved')
  const dots = box.querySelector('.logline-dots')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  let timer = 0
  let loop = !still
  let current = 0
  const shown = new Set()

  const chip = (value, label, missing, fresh) => {
    const c = document.createElement('span')
    c.className = `chip${missing ? ' missing' : ''}${fresh ? ' in' : ''}`
    c.append(missing ? '—' : value)
    const s = document.createElement('small')
    s.textContent = label
    c.append(' ', s)
    return c
  }

  /** The line typed up to `n` characters. */
  const draw = (d, n) => {
    const text = d.line.slice(0, n)
    const words = text.split(' ')
    // Tokens completed: all but the last, plus the last when the line is done.
    const done = n >= d.line.length ? words.length : words.length - 1
    input.textContent = text
    const caret = document.createElement('span')
    caret.className = 'caret'
    input.append(caret)
    chips.replaceChildren(
      ...d.chips
        .filter(([tok, , , need]) => tok < done || need)
        .map(([tok, value, label]) => {
          const missing = tok >= done
          const key = `${label}:${value}`
          const fresh = !missing && !shown.has(key)
          if (!missing) shown.add(key)
          return chip(value, label, missing, fresh && !still)
        }),
    )
  }

  const show = (i) => {
    clearTimeout(timer)
    current = i
    const d = demos[i]
    ctxL.textContent = d.ctx[0]
    ctxR.textContent = d.ctx[1]
    saved.textContent = ''
    shown.clear()
    for (const b of dots.children) b.setAttribute('aria-pressed', String(Number(b.dataset.i) === i))
    if (still) {
      draw(d, d.line.length)
      saved.textContent = d.saved
      return
    }
    let n = 0
    const step = () => {
      draw(d, n)
      if (n < d.line.length) {
        n++
        // A space is a short pause, as when listening for the next part.
        timer = setTimeout(step, d.line[n - 1] === ' ' ? 380 : 85 + Math.random() * 60)
      } else {
        timer = setTimeout(() => {
          saved.textContent = d.saved
          if (loop) timer = setTimeout(() => show((current + 1) % demos.length), 2600)
        }, 900)
      }
    }
    step()
  }

  demos.forEach((d, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.i = String(i)
    b.textContent = d.tab
    b.addEventListener('click', () => {
      loop = false
      show(i)
    })
    dots.append(b)
  })
  show(0)
})()

// The screenshots drift slowly to the left in a loop; a hover, touch or focus holds them,
// and they go on a few seconds after the hand is gone. The arrows move one picture.
;(() => {
  const track = document.querySelector('.shots')
  if (!track) return
  const originals = [...track.children]
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  let heldUntil = 0
  const hold = (ms) => {
    heldUntil = performance.now() + ms
  }

  const step = (dir) => {
    const fig = originals[0]
    const by = fig.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || '0')
    track.scrollBy({ left: dir * by, behavior: still ? 'auto' : 'smooth' })
  }
  const nav = document.createElement('div')
  nav.className = 'shots-nav wrap'
  for (const [label, dir, text] of [['‹', -1, document.documentElement.lang === 'cs' ? 'Předchozí' : 'Previous'], ['›', 1, document.documentElement.lang === 'cs' ? 'Další' : 'Next']]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.setAttribute('aria-label', text)
    b.addEventListener('click', () => {
      hold(4000)
      step(dir)
    })
    nav.append(b)
  }
  track.after(nav)
  if (still) return

  // A second copy behind the first makes the loop seamless; it's only for the eye.
  for (const fig of originals) {
    const copy = fig.cloneNode(true)
    copy.setAttribute('aria-hidden', 'true')
    copy.querySelectorAll('img').forEach((img) => (img.loading = 'eager'))
    track.append(copy)
  }
  track.classList.add('drift')

  const SPEED = 28 // px per second
  let pos = track.scrollLeft
  let last = 0
  let hovering = false
  track.addEventListener('pointerenter', () => (hovering = true))
  track.addEventListener('pointerleave', () => {
    hovering = false
    hold(1500)
  })
  track.addEventListener('touchstart', () => hold(4000), { passive: true })
  track.addEventListener('wheel', () => hold(3000), { passive: true })
  track.addEventListener('focusin', () => hold(6000))

  const frame = (now) => {
    const dt = last ? Math.min(now - last, 100) : 0
    last = now
    // One copy's width (with its gap), not scrollWidth / 2, which counts the padding.
    const half = track.children[originals.length].offsetLeft - originals[0].offsetLeft
    if (hovering || now < heldUntil || document.hidden) {
      pos = track.scrollLeft // follow a manual scroll
    } else {
      pos += (SPEED * dt) / 1000
    }
    if (pos >= half) pos -= half
    if (pos < 0) pos += half
    if (Math.abs(track.scrollLeft - pos) >= 0.5) track.scrollLeft = pos
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})()

// Anonymous page views and clicks on the download / open buttons, on the same self-hosted
// Umami as the web app (stats.ok1cdj.com), the way web/src/ui/stats.ts sends them: a
// plain fetch, no script, no cookies. Only on kqso.eu, so a local preview counts nothing.
;(() => {
  if (location.hostname !== 'kqso.eu') return
  const ENDPOINT = 'https://stats.ok1cdj.com/api/send'
  const WEBSITE = 'c0350ba6-419e-465a-99f9-6a9af30a783d'
  // Through the root's language redirect the referrer is kqso.eu/; the root kept the real one.
  let referrer = document.referrer
  try {
    const kept = sessionStorage.getItem('kqso-ref')
    sessionStorage.removeItem('kqso-ref')
    if (kept && referrer === `${location.origin}/`) referrer = kept
  } catch {}
  const send = (extra) => {
    const payload = {
      website: WEBSITE,
      hostname: location.hostname,
      language: navigator.language,
      screen: `${screen.width}x${screen.height}`,
      url: location.pathname,
      title: document.title,
      referrer,
      ...extra,
    }
    referrer = ''
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event', payload }),
      keepalive: true,
    }).catch(() => {})
  }
  send({})
  // Where people go from the site: the app, a store, the APK, the keyer guide.
  const target = (href) =>
    href.startsWith('https://kqso.ok1cdj.com/manual/') ? 'manual'
    : href.startsWith('https://kqso.ok1cdj.com') ? 'open-app'
    : href.includes('play.google.com') ? 'google-play'
    : href.includes('apps.apple.com') ? 'app-store'
    : href.includes('/releases') ? 'apk'
    : href.includes('keyer.ok1cdj.com') ? 'keyer-guide'
    : href.includes('buymeacoffee.com') ? 'coffee'
    : ''
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="https://"]') : null
    const name = a && target(a.href)
    if (name) send({ name: `site-${name}` })
  })
})()

