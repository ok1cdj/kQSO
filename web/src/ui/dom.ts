// Tiny DOM helpers shared by the screens. No framework (no runtime deps).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** A Yes/No setting ('1'/'0', see Settings → yesNo): missing = `def`, anything but
 *  '0' = on. The switch and every reader use this, so they can't disagree. */
export function switchOn(saved: string | null, def = true): boolean {
  return saved === null ? def : saved !== '0'
}

/** A 24×24 line icon (no fill, currentColor) — black on e-ink, follows the theme and
 *  :active inversion, independent of the device's emoji font. Style: .key-icon / .icon. */
export function strokeIcon(d: string, cls: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', cls)
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  return svg
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

const LONG_PRESS_MS = 550

/** A long press (touch, pen, mouse held) or the context menu (right click, Android's long
 *  press) runs `fn`; the click that ends a long press is swallowed, so a plain tap keeps
 *  doing what it does. A move of more than a few px (scrolling) cancels it. */
export function onLongPress(target: HTMLElement, fn: () => void): void {
  let timer = 0
  let x = 0
  let y = 0
  let fired = false
  const cancel = (): void => {
    clearTimeout(timer)
    timer = 0
  }
  const fire = (): void => {
    cancel()
    fired = true
    fn()
  }
  target.addEventListener('pointerdown', (e) => {
    fired = false
    x = e.clientX
    y = e.clientY
    cancel()
    timer = window.setTimeout(fire, LONG_PRESS_MS)
  })
  target.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel()
  })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) target.addEventListener(ev, cancel)
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (!fired) fire()
  })
  target.addEventListener(
    'click',
    (e) => {
      if (!fired) return
      fired = false
      e.stopImmediatePropagation()
      e.preventDefault()
    },
    true,
  )
}

/** A labelled text input row for the classic forms. System keyboard is fine here. */
export function fieldRow(
  label: string,
  value: string,
  opts: { placeholder?: string } = {},
): { row: HTMLElement; input: HTMLInputElement } {
  const row = el('label', 'field')
  row.append(el('span', 'field-label', label))
  const input = el('input', 'field-input')
  input.type = 'text'
  input.value = value
  input.autocomplete = 'off'
  input.autocapitalize = 'characters'
  input.spellcheck = false
  if (opts.placeholder) input.placeholder = opts.placeholder
  row.append(input)
  return { row, input }
}

/**
 * Attach a hidden error line to a field row. `show()` reveals it, marks the row and
 * focuses the input; typing clears it again. Used for fields a profile requires.
 */
export function fieldError(field: { row: HTMLElement; input: HTMLInputElement }, message: string): { show(text?: string): void } {
  const msg = el('span', 'field-error', message)
  msg.hidden = true
  field.row.append(msg)
  field.input.addEventListener('input', () => {
    msg.hidden = true
    field.row.classList.remove('field--error')
  })
  return {
    /** `text` replaces the message, for a field with more than one way to be wrong. */
    show(text?: string) {
      if (text !== undefined) msg.textContent = text
      msg.hidden = false
      field.row.classList.add('field--error')
      field.input.focus()
    },
  }
}

/** A labelled <select> row for the classic forms (e.g. band, mode, profile). */
export function selectRow(
  label: string,
  options: ReadonlyArray<readonly [value: string, text: string]>,
  selected: string,
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = el('label', 'field')
  row.append(el('span', 'field-label', label))
  const select = el('select', 'field-input')
  for (const [value, text] of options) {
    const o = el('option', undefined, text)
    o.value = value
    if (value === selected) o.selected = true
    select.append(o)
  }
  row.append(select)
  return { row, select }
}

/** One tile of a tilePicker: a big title and an optional sub-line. */
export interface Tile {
  readonly value: string
  readonly title: string
  readonly sub?: string
}

/**
 * On-brand tile picker: a grid of tappable tiles instead of a native <select> — one
 * tap, no full-screen OS dialog. Used for the profile and satellite and the EDI section.
 * `value()` returns the selected tile's value; `onChange` fires on each pick.
 */
export function tilePicker(
  label: string,
  tiles: readonly Tile[],
  selected: string,
  onChange?: () => void,
): { row: HTMLElement; value: () => string } {
  const row = el('div', 'field')
  row.append(el('span', 'field-label', label))
  const grid = el('div', 'tilegrid')
  let current = selected
  const nodes = new Map<string, HTMLButtonElement>()
  const paint = (): void => {
    for (const [value, node] of nodes) node.classList.toggle('tile--sel', value === current)
  }
  for (const it of tiles) {
    const node = el('button', 'tile')
    node.type = 'button'
    node.append(el('b', 'tile-title', it.title))
    // A break chance after each slash, so SOTA/GMA/POTA/WWFF/TOTA wraps in a narrow tile.
    if (it.sub !== undefined) node.append(el('span', 'tile-sub', it.sub.replace(/\//g, '/\u200b')))
    node.addEventListener('click', () => {
      current = it.value
      paint()
      onChange?.()
    })
    nodes.set(it.value, node)
    grid.append(node)
  }
  paint()
  row.append(grid)
  return { row, value: () => current }
}
