// On-screen keyboard. Renders the fixed 6×7 grid. Uses pointerdown +
// preventDefault so a tap neither focuses the button (no system keyboard) nor
// selects text, and reacts immediately.

import { KEY_ROWS } from './keys'
import type { KeyAction } from './keys'

export function createKeyboard(onKey: (action: KeyAction) => void): HTMLElement {
  const kb = document.createElement('div')
  kb.className = 'keyboard'

  for (const row of KEY_ROWS) {
    for (const key of row) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = key.wide ? 'key key--wide' : 'key'
      b.textContent = key.label
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        onKey(key.action)
      })
      kb.appendChild(b)
    }
  }
  return kb
}
