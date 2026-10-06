// "What's new" notes shown once after an update (log list start) and any time from
// Settings → About. Short, user-facing, CS + EN — the CHANGELOG stays the full record.
// Add an entry per release with something worth telling; a fixes-only release can
// skip it, and then no window appears.

import { compareVersions } from './version'

export interface WhatsNewEntry {
  readonly version: string
  readonly cs: readonly string[]
  readonly en: readonly string[]
}

/** Newest first. */
export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    version: '1.7',
    cs: [
      'CW klíčovač přes Bluetooth (beta): Nastavení → CW klíčování připojí M5-ESP32-keyer, v CW pak lišta nabízí makra (CQ, EX, TU …), RUN / S&P a ESM jako v N1MM. Podrobnosti v nápovědě (H). Chyby prosím hlaste na GitHub Issues.',
      'Vzhled: Nastavení → Zobrazení → Systém / Světlý / Tmavý (i v aplikaci pro Android).',
      'Satelitní QSO ukládají kmitočty uplinku a downlinku (střed transpondéru), takže je Wavelog převezme. Starším QSO se doplní při exportu nebo pushi.',
      'Aplikace pro Android upozorní na seznamu logů, když vyjde nová verze (lze vypnout v Nastavení).',
      'Oprava: srážkový radar na VKV mapě se v aplikaci zapínal sám.',
    ],
    en: [
      'CW keyer over Bluetooth (beta): Settings → CW keying connects the M5-ESP32-keyer; in CW the strip then offers macros (CQ, EX, TU …), RUN / S&P and N1MM-style ESM. Details in the help (H). Please report bugs on GitHub Issues.',
      'Theme: Settings → Display → System / Light / Dark (in the Android app too).',
      'Satellite QSOs store the uplink and downlink frequencies (transponder centre), so Wavelog picks them up. Older QSOs get them on export or push.',
      'The Android app tells you on the log list when a new version is out (can be turned off in Settings).',
      'Fix: the rain radar on the VHF map switched itself on in the app.',
    ],
  },
]

// whatsNewSeen came in 1.7: an install with logs but no record was on 1.6.3 before.
const BEFORE_TRACKING = '1.6.3'

/** The version to show notes after: the saved one; with none saved, a fresh install
 *  (no logs) starts at the current version (nothing to show), an older one at 1.6.3. */
export function seenBaseline(saved: string | null, hasLogs: boolean, current: string): string {
  return saved ?? (hasLogs ? BEFORE_TRACKING : current)
}

/** Notes newer than `seen`, up to `current` (newest first). */
export function notesSince(seen: string, current: string): WhatsNewEntry[] {
  return WHATS_NEW.filter((e) => compareVersions(e.version, seen) > 0 && compareVersions(e.version, current) <= 0)
}
