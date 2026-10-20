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
    version: '1.10.1',
    cs: ['Tlačítko Zpět (i gesto, na Kompaktu klávesa) vrací v aplikaci o obrazovku zpět, stejně jako „‹“. Aplikaci zavře až na seznamu logů. Na iPhonu a iPadu funguje tah od levého okraje.'],
    en: ['The Back button (and gesture, the Kompakt\'s key) goes back one screen in the app, like "‹". Only on the log list does it close the app. On iPhone and iPad, swipe from the left edge.'],
  },
  {
    version: '1.10',
    cs: [
      'Můj lokátor z polohy: tlačítko se zaměřovačem v Novém logu. Poloha se nikam neukládá ani neposílá.',
      'Nejbližší reference: v logu Aktivace ukáže zaměřovač nejbližší vrcholy SOTA a GMA, parky POTA a WWFF a rozhledny TOTA, klepnutím je přidáš. Funguje i bez signálu: okolí se stáhne samo, další oblasti v Nastavení → Reference offline.',
      'Víc referencí v jedné aktivaci (vrchol + parky + WWFF …), oddělených mezerou. Export nabídne celý log i soubor pro každý program, pojmenovaný podle jeho pravidel.',
    ],
    en: [
      'My locator from the position: the crosshair button in New Log. The position is never stored or sent.',
      'Nearest references: in an Activation log the crosshair lists the nearest SOTA and GMA summits, POTA and WWFF parks and TOTA towers; a tap adds one. Works without signal: the area around you downloads by itself, more in Settings → Offline references.',
      'Several references in one activation (summit + parks + WWFF …), separated by spaces. Export offers the whole log and a file for each program, named as it asks.',
    ],
  },
  {
    version: '1.9',
    cs: [
      'Jakýkoli Icom přes klíčovač M5-ESP32-keyer (beta, firmware 2.1.0+): Nastavení → Rádio → Přes klíčovač. Pásmo, mód a kmitočet z rádia, napsané pásmo / mód nebo F… ho přeladí. Model se pozná podle CI-V adresy (IC-706, IC-910, IC-9700, IC-7300 …); pásmo, které rádio neumí, přepne jen deník.',
      'Jak si klíčovač postavit (součástky, schémata, firmware): odkaz v Nastavení → Klíčovač M5.',
      'VKV závod: lokátor napsaný před značkou je lokátor — hned QRB, azimut a značky známé u lokátoru.',
    ],
    en: [
      'Any Icom through the M5-ESP32-keyer (beta, firmware 2.1.0+): Settings → Radio → Via the keyer. Band, mode and frequency from the radio; a typed band / mode or F… tunes it. The model goes by its CI-V address (IC-706, IC-910, IC-9700, IC-7300 …); a band the radio doesn\'t work switches only the log.',
      'How to build the keyer (parts, schematics, firmware): a link in Settings → M5 keyer.',
      'VHF contest: a locator typed before the call is a locator — QRB, azimuth and the calls known there at once.',
    ],
  },
  {
    version: '1.8.2',
    cs: ['kQSO je i pro iPhone a iPad: stejné logování, soubory ADIF v aplikaci Soubory, klíčovač a IC-705 přes Bluetooth.'],
    en: ['kQSO for iPhone and iPad: the same logging, ADIF files in the Files app, the CW keyer and the IC-705 over Bluetooth.'],
  },
  {
    version: '1.8',
    cs: [
      'Icom IC-705 přes Bluetooth (beta, aplikace pro Android): Nastavení → IC-705. Pásmo, mód a přesný kmitočet (FREQ) bere kQSO z rádia, napsané pásmo / mód nebo F28300 rádio přeladí. V CW jdou makra přes klíčovač rádia, v SSB / FM tlačítka T1–T4 odvysílají hlasové paměti. Transvertory a pásma, která rádio neumí, viz nápověda (H).',
      'Nový log vyžaduje vlastní značku.',
    ],
    en: [
      'Icom IC-705 over Bluetooth (beta, Android app): Settings → IC-705. Band, mode and the exact frequency (FREQ) come from the radio; a typed band / mode or F28300 tunes it. In CW the macros go through the radio\'s keyer, in SSB / FM the T1–T4 buttons send its voice memories. Transverters and bands the radio doesn\'t work: see the help (H).',
      'A new log needs your own callsign.',
    ],
  },
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
