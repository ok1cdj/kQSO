// The kqso.eu website: layout.html + the page fragments in pages/<lang>/ → dist/.
// Run from web/: npm run site (vite-node, so whatsnew.ts is imported as it is).
// No dependencies; the screenshots come from the manual (web/public/manual/img).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WHATS_NEW } from '../web/src/core/whatsnew'

const SITE = 'https://kqso.eu'
const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ROOT, '..')
const DIST = join(ROOT, 'dist')
const MANUAL_IMG = join(REPO, 'web/public/manual/img')

type Lang = 'cs' | 'en'
const LANGS: readonly Lang[] = ['cs', 'en']

/** Page key → file name per language; the order is the navigation's. */
const PAGES: readonly { key: string; slug: Record<Lang, string>; nav?: Record<Lang, string> }[] = [
  { key: 'index', slug: { cs: 'index', en: 'index' } },
  { key: 'activations', slug: { cs: 'aktivace', en: 'activations' }, nav: { cs: 'Aktivace', en: 'Activations' } },
  { key: 'contests', slug: { cs: 'zavody', en: 'contests' }, nav: { cs: 'VKV závody', en: 'VHF contests' } },
  { key: 'satellites', slug: { cs: 'satelity', en: 'satellites' }, nav: { cs: 'Satelity', en: 'Satellites' } },
  { key: 'radios', slug: { cs: 'radia', en: 'radios' }, nav: { cs: 'Rádia a CW', en: 'Radios and CW' } },
  { key: 'news', slug: { cs: 'novinky', en: 'news' }, nav: { cs: 'Novinky', en: 'News' } },
  { key: 'faq', slug: { cs: 'faq', en: 'faq' }, nav: { cs: 'Otázky', en: 'FAQ' } },
]

const T = {
  cs: {
    open: 'Otevřít kQSO',
    manual: 'Návod',
    other: 'English',
    skip: 'Přeskočit na obsah',
    menu: 'Menu',
    foot: 'kQSO napsal OK1CDJ · svobodný software pod licencí GPL-3.0',
    privacy: 'Ochrana soukromí',
    version: 'Aktuální verze',
  },
  en: {
    open: 'Open kQSO',
    manual: 'Manual',
    other: 'Česky',
    skip: 'Skip to content',
    menu: 'Menu',
    foot: 'kQSO by OK1CDJ · free software under GPL-3.0',
    privacy: 'Privacy',
    version: 'Current version',
  },
} as const

const APP = 'https://kqso.ok1cdj.com/'
const VERSION = (JSON.parse(readFileSync(join(REPO, 'web/package.json'), 'utf8')) as { version: string }).version
  .replace(/\.0$/, '')

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const href = (lang: Lang, slug: string): string => `/${lang}/${slug === 'index' ? '' : `${slug}.html`}`

/** A fragment starts with <!-- title: … / description: … -->; the rest is the <main>. */
function readPage(lang: Lang, key: string): { title: string; description: string; body: string } {
  const src = readFileSync(join(ROOT, 'pages', lang, `${key}.html`), 'utf8')
  const m = /^<!--([\s\S]*?)-->\s*/.exec(src)
  if (!m) throw new Error(`pages/${lang}/${key}.html: no header comment`)
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = /^\s*(\w+):\s*(.+?)\s*$/.exec(line)
    if (kv) meta[kv[1]] = kv[2]
  }
  if (!meta.title || !meta.description) throw new Error(`pages/${lang}/${key}.html: title / description missing`)
  return { title: meta.title, description: meta.description, body: src.slice(m[0].length) }
}

/** News from the app's What's new (cs + en), newest first. */
function news(lang: Lang): string {
  return WHATS_NEW.map(
    (e) =>
      `<section class="release" id="v${esc(e.version)}">\n<h2><span class="mono">${esc(e.version)}</span></h2>\n<ul>\n${e[lang]
        .map((s) => `<li>${esc(s)}</li>`)
        .join('\n')}\n</ul>\n</section>`,
  ).join('\n')
}

function render(lang: Lang, page: (typeof PAGES)[number]): string {
  const other: Lang = lang === 'cs' ? 'en' : 'cs'
  const { title, description, body } = readPage(lang, page.key)
  const t = T[lang]
  const self = href(lang, page.slug[lang])
  const nav = PAGES.filter((p) => p.nav)
    .map((p) => {
      const h = href(lang, p.slug[lang])
      return `<a href="${h}"${h === self ? ' aria-current="page"' : ''}>${p.nav![lang]}</a>`
    })
    .join('\n')
  const content = body
    .replace('{{news}}', news(lang))
    .replace(/\{\{version\}\}/g, VERSION)
    .replace(/\{\{app\}\}/g, APP)
  const layout = readFileSync(join(ROOT, 'layout.html'), 'utf8')
  const vars: Record<string, string> = {
    lang,
    title: page.key === 'index' ? title : `${title} · kQSO`,
    description: esc(description),
    url: SITE + self,
    alt: SITE + href(other, page.slug[other]),
    langSwitch: `<span class="langs" role="group" aria-label="${lang === 'cs' ? 'Jazyk' : 'Language'}">${LANGS.map((l) =>
      l === lang
        ? `<span aria-current="true" lang="${l}">${l.toUpperCase()}</span>`
        : `<a href="${href(l, page.slug[l])}" hreflang="${l}" lang="${l}" title="${l === 'cs' ? 'Česky' : 'English'}">${l.toUpperCase()}</a>`,
    ).join('')}</span>`,
    cs: SITE + href('cs', page.slug.cs),
    en: SITE + href('en', page.slug.en),
    home: href(lang, 'index'),
    nav,
    open: t.open,
    app: APP,
    manual: `${APP}manual/${lang}.html`,
    manualLabel: t.manual,
    skip: t.skip,
    menu: t.menu,
    foot: t.foot,
    privacy: t.privacy,
    privacyHref: `${APP}privacy.html`,
    version: VERSION,
    versionLabel: t.version,
    newsHref: href(lang, PAGES.find((p) => p.key === 'news')!.slug[lang]),
    ogLocale: lang === 'cs' ? 'cs_CZ' : 'en_GB',
    content,
  }
  return layout.replace(/\{\{(\w+)\}\}/g, (all, k: string) => {
    if (!(k in vars)) throw new Error(`layout.html: unknown {{${k}}}`)
    return vars[k]
  })
}

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const f of readdirSync(from, { withFileTypes: true })) {
    if (f.isDirectory()) copyDir(join(from, f.name), join(to, f.name))
    else copyFileSync(join(from, f.name), join(to, f.name))
  }
}

/** Every local href / src in the built pages must exist in dist. */
function checkLinks(files: readonly string[]): void {
  const missing: string[] = []
  for (const f of files) {
    const html = readFileSync(join(DIST, f), 'utf8')
    for (const m of html.matchAll(/(?:href|src|poster)="(\/[^"#?]*)/g)) {
      let p = m[1]
      if (p.endsWith('/')) p += 'index.html'
      if (!existsSync(join(DIST, p))) missing.push(`${f}: ${m[1]}`)
    }
  }
  if (missing.length) throw new Error(`Broken links:\n${missing.join('\n')}`)
}

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })
const built: string[] = []
for (const lang of LANGS) {
  mkdirSync(join(DIST, lang), { recursive: true })
  for (const page of PAGES) {
    const file = `${lang}/${page.slug[lang]}.html`
    writeFileSync(join(DIST, file), render(lang, page))
    built.push(file)
  }
}

// Screenshots: only those the pages use, from the manual (one source of truth).
for (const file of built) {
  const html = readFileSync(join(DIST, file), 'utf8')
  for (const m of html.matchAll(/"\/img\/(cs|en)\/([\w-]+\.webp)"/g)) {
    mkdirSync(join(DIST, 'img', m[1]), { recursive: true })
    copyFileSync(join(MANUAL_IMG, m[1], m[2]), join(DIST, 'img', m[1], m[2]))
  }
}

copyDir(join(ROOT, 'media'), join(DIST, 'media'))
for (const f of ['site.css', 'site.js', 'root.html', '404.html']) copyFileSync(join(ROOT, f), join(DIST, f))
copyFileSync(join(REPO, 'web/public/kqso-icon.svg'), join(DIST, 'favicon.svg'))
copyFileSync(join(REPO, 'web/public/kqso-apple-touch-icon-180.png'), join(DIST, 'apple-touch-icon.png'))
// The root picks the language; the build writes it as index.html.
copyFileSync(join(ROOT, 'root.html'), join(DIST, 'index.html'))
rmSync(join(DIST, 'root.html'))
writeFileSync(join(DIST, 'CNAME'), 'kqso.eu\n')
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`)
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${built
    .map((f) => `  <url><loc>${SITE}/${f.replace(/index\.html$/, '')}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
)

checkLinks([...built, 'index.html', '404.html'])
console.log(`site: ${built.length} pages, version ${VERSION} → ${DIST}`)
