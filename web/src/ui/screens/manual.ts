// The manual: public/manual/<lang>.html (also readable on its own on the web), shown
// inside the app so it takes the app's theme (e-ink, dark) and system Back. Its <main>
// is taken over; image and link paths are made absolute against the page's URL.

import type { Screen } from '../app'
import { el, button } from '../dom'
import { lang, t } from '../i18n'

export interface ManualNav {
  back(): void
}

const CSS_ID = 'manual-css'
const SITE = 'https://kqso.ok1cdj.com/'

export class ManualScreen implements Screen {
  private readonly root = el('div', 'screen screen--list')
  private readonly body = el('div')

  constructor(private readonly nav: ManualNav) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    if (!document.getElementById(CSS_ID)) {
      const css = el('link')
      css.id = CSS_ID
      css.rel = 'stylesheet'
      css.href = 'manual/manual.css'
      document.head.append(css)
    }
    const bar = el('div', 'bar')
    bar.append(button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'), el('b', 'title', t('settings.manual')))
    this.root.replaceChildren(bar, this.body)
    void this.load(lang === 'cs' ? 'cs' : 'en')
  }

  unmount(): void {}

  /** `anchor` (#band): scroll there once the page is in. */
  private async load(page: string, anchor = ''): Promise<void> {
    const url = new URL(`manual/${page}.html`, document.baseURI)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      const main = new DOMParser().parseFromString(await res.text(), 'text/html').querySelector('main')
      if (!main) throw new Error('no <main>')
      for (const img of main.querySelectorAll('img')) img.src = new URL(img.getAttribute('src') ?? '', url).href
      for (const a of main.querySelectorAll('a')) this.wire(a, url)
      this.body.replaceChildren(document.adoptNode(main))
      // The pictures load lazily; fetch them all now so the service worker has them offline
      for (const img of main.querySelectorAll('img')) void fetch(img.src).catch(() => {})
      this.root.scrollTop = 0
      if (anchor) this.body.querySelector(anchor)?.scrollIntoView({ block: 'start' })
    } catch {
      this.body.replaceChildren(el('div', 'empty', t('manual.failed')))
    }
  }

  /** In-page anchors scroll, the manual's other pages (the other language, First steps)
   *  load here, anything else opens outside. */
  private wire(a: HTMLAnchorElement, base: URL): void {
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        this.body.querySelector(href)?.scrollIntoView({ block: 'start' })
      })
      return
    }
    const other = /^((?:start-)?(?:cs|en))\.html(#[\w-]+)?$/.exec(href)
    if (other) {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        void this.load(other[1]!, other[2])
      })
      return
    }
    // Our own pages (privacy.html) from the web: the APK / iOS origin means nothing to the system browser
    const target = new URL(href, base)
    a.href = target.origin === location.origin ? new URL(target.pathname.slice(1), SITE).href : target.href
    a.target = '_blank'
    a.rel = 'noopener'
  }
}
