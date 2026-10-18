// On-screen keyboard. Renders the fixed 6×7 grid. Uses pointerdown +
// preventDefault so a tap neither focuses the button (no system keyboard) nor
// selects text, and reacts immediately.

import { strokeIcon } from './dom'
import { KEY_ROWS } from './keys'
import type { KeyAction, KeyIcon } from './keys'

// 24×24 stroke paths for the special keys; currentColor so :active inverts them.
const ICON_PATHS: Readonly<Record<KeyIcon, string>> = {
  space: 'M4 10v5h16v-5',
  backspace: 'M9 5h11v14H9l-6-7zM12 9l6 6M18 9l-6 6',
  enter: 'M19 5v7H6M10 8l-4 4 4 4',
}

function iconSvg(icon: KeyIcon): SVGSVGElement {
  return strokeIcon(ICON_PATHS[icon], `key-icon key-icon--${icon}`)
}

export function createKeyboard(onKey: (action: KeyAction) => void): HTMLElement {
  const kb = document.createElement('div')
  kb.className = 'keyboard'

  for (const row of KEY_ROWS) {
    for (const key of row) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = key.wide ? 'key key--wide' : 'key'
      if (key.icon) {
        b.setAttribute('aria-label', key.label)
        b.appendChild(iconSvg(key.icon))
      } else {
        b.textContent = key.label
      }
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        onKey(key.action)
      })
      kb.appendChild(b)
    }
  }
  return kb
}
