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

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
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
export function fieldError(field: { row: HTMLElement; input: HTMLInputElement }, message: string): { show(): void } {
  const msg = el('span', 'field-error', message)
  msg.hidden = true
  field.row.append(msg)
  field.input.addEventListener('input', () => {
    msg.hidden = true
    field.row.classList.remove('field--error')
  })
  return {
    show() {
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
    if (it.sub !== undefined) node.append(el('span', 'tile-sub', it.sub))
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
