// "What's new": the notes per version, then a Buy Me a Coffee link. Shown once after an
// update (OK → log list) and from Settings → About (all versions).

import type { Screen } from '../app'
import { el, button } from '../dom'
import { t } from '../i18n'
import { BUY_ME_A_COFFEE, entryText } from '../whatsnew'
import type { WhatsNewEntry } from '../../core/index'

export interface WhatsNewNav {
  back(): void
}

export class WhatsNewScreen implements Screen {
  private readonly root = el('div', 'screen screen--list help')

  constructor(
    private readonly entries: readonly WhatsNewEntry[],
    private readonly nav: WhatsNewNav,
  ) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    const bar = el('div', 'bar')
    bar.append(button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'), el('b', 'title', t('whatsnew.title')))
    const body = this.entries.map((e) => {
      const sec = el('div', 'help-section')
      sec.append(el('h2', undefined, t('whatsnew.version', { v: e.version })))
      const ul = el('ul', 'whatsnew-list')
      for (const line of entryText(e)) ul.append(el('li', undefined, line))
      sec.append(ul)
      return sec
    })
    const coffee = el('p', 'whatsnew-coffee')
    const a = el('a', undefined, t('whatsnew.coffee'))
    a.href = BUY_ME_A_COFFEE
    a.target = '_blank'
    a.rel = 'noopener'
    coffee.append(a)
    this.root.replaceChildren(bar, ...body, coffee, button(t('whatsnew.ok'), () => this.nav.back(), 'btn btn--primary'))
  }

  unmount(): void {}
}
