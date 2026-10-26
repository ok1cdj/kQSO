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
    version: '1.15',
    cs: [
      'Rádio Icom na počítači kabelem: Chrome / Edge, vlastní USB rádia (IC-7300, 9700, 705 …) nebo CT-17 / kabel USB–CI-V. Rychlost linky a adresu kQSO najde samo. Nastavení → Rádio → USB / sériová linka; podrobně v návodu.',
      'Pásmo z klávesnice: Alt+N další, Alt+P předchozí.',
    ],
    en: [
      'An Icom radio on a computer by cable: Chrome / Edge, the radio\'s own USB (IC-7300, 9700, 705 …) or a CT-17 / USB–CI-V cable. kQSO finds the bus rate and the address itself. Settings → Radio → USB / serial; details in the manual.',
      'Band from the keyboard: Alt+N next, Alt+P previous.',
    ],
  },
  {
    version: '1.14',
    cs: [
      'ON4KST chat přímo v logu VKV závodu: zprávy, stanice se vzdáleností, azimutem a pásmy, na kterých jsou QRV, žádost o sked jedním klepnutím a psaní ze vstupního řádku (@ZNAČKA text). Na tabletu na šířku aktivní stanice pod závodním panelem. Nastavení → ON4KST chat; bez účtu si ho vyzkoušíš se značkou DEMO.',
      'BOTA — bunkry (Bunkers on the Air): reference B/OK/0123 a nejbližší bunkry v Novém logu. V Nastavení → Reference offline si vybereš, které programy se v okolí nabízejí.',
      'Návod s obrázky (Nastavení → O aplikaci → Návod) a První kroky: VKV závod a SOTA aktivace krok za krokem.',
    ],
    en: [
      'ON4KST chat right in a VHF contest log: messages, stations with distance, bearing and the bands they are QRV on, a sked request in one tap and writing from the input line (@CALL text). On a tablet in landscape the active stations under the contest panel. Settings → ON4KST chat; without an account try it with the call DEMO.',
      'BOTA — bunkers (Bunkers on the Air): references B/OK/0123 and the nearest bunkers in New log. Settings → Offline references lets you choose which programs are offered nearby.',
      'A manual with pictures (Settings → About → Manual) and First steps: a VHF contest and a SOTA activation step by step.',
    ],
  },
  {
    version: '1.13.1',
    cs: ['Esc smaže rozepsaný řádek — třeba značku, kterou si jen ověřuješ v logu. Co už prošlo Enterem, zůstane.'],
    en: ['Esc clears the line being typed — e.g. a call you only looked up in the log. What Enter took in stays.'],
  },
  {
    version: '1.13',
    cs: [
      'VKV závod na šířku bez naší klávesnice: vpravo nahoře velké další číslo spojení, čas UTC, počet QSO na pásmu, rychlost, body a ODX.',
      'Nová VKV databáze značek z veřejných deníků závodů ČRK (3 055 značek) včetně pásem, na kterých jsou stanice QRV.',
      'Za značkou se ukážou ostatní pásma, kde je stanice QRV (2 70 23 … 24G 47G); pásma, kde už ji v logu máš, jsou přeškrtnutá.',
      'Stanici, kterou už v logu máš, se na dalším pásmu rovnou vyplní lokátor.',
      'Zkratky pro HW klávesnici: Ctrl+Enter zapíše QSO, Alt+W/D/H/E, Alt+X lokátor, Alt+M mód, Alt+L/Q, makra F5–F8 F11 F12, PgUp/PgDn rychlost (vše v nápovědě).',
      'E ⏎ upraví poslední QSO; ESM se teď přepíná příkazem ESM ⏎ nebo Ctrl+M.',
    ],
    en: [
      'VHF contest in landscape without our keyboard: the next serial in big digits at the top right, UTC clock, the band\'s QSO count, rate, points and ODX.',
      'New VHF callsign database from the public ČRK contest logs (3,055 calls) with the bands each station is QRV on.',
      'After the call, the other bands the station is QRV on show up (2 70 23 … 24G 47G); bands already worked in this log are struck out.',
      'A station already in this log gets its locator filled in straight away on the next band.',
      'Hardware keyboard shortcuts: Ctrl+Enter saves the QSO, Alt+W/D/H/E, Alt+X locator, Alt+M mode, Alt+L/Q, macros F5–F8 F11 F12, PgUp/PgDn speed (all in the help).',
      'E ⏎ edits the last QSO; ESM is now switched with ESM ⏎ or Ctrl+M.',
    ],
  },
  {
    version: '1.12',
    cs: [
      'Nastavení → Klávesnice pro logování: kQSO, systémová, nebo žádná. Systémová = klávesnice telefonu (otevře se dotykem na řádek vstupu), vstup zůstane nahoře a pod ním poslední QSO. Žádná = jen HW klávesnice, místo naší klávesnice poslední QSO.',
    ],
    en: [
      'Settings → Keyboard for logging: kQSO, system, or none. System = the phone\'s keyboard (tap the input line to open it), the input stays at the top with the recent QSOs below. None = a hardware keyboard only, the recent QSOs take our keyboard\'s place.',
    ],
  },
  {
    version: '1.11',
    cs: [
      'VKV závody: v Novém logu jen závod (IARU R1, VKV PA, FM pohár) a účast na 6 hodin. SO / MO / CHECK se volí v EDI exportu, LP na 145 / 435 MHz podle výkonu (≤ 100 W). Soubory pojmenované podle ČRK (01OK1XXX.edi).',
      'Kategorie 6 hodin: hlavička ukazuje zbývající čas, upozorní na začátek 2. části a konec.',
      'VKV PA a FM pohár: bodování podle pásů velkých čtverců. FM pohár přepne na FM a v EDI ukáže souhrn pro webový formulář.',
      'Statistiky závodu po hodinách a po velkých čtvercích (stanice, vzdálenost, azimut).',
      'Filtr pásem v seznamu QSO a v mapě; ve VKV závodě poslední QSO jen z aktuálního pásma.',
      'Nastavení: technické části (databáze, reference offline, CI-V, klíčovač) složené do řádků se stavem.',
    ],
    en: [
      'VHF contests: New log asks only the contest (IARU R1, VKV PA, FM pohár) and a 6-hour entry. SO / MO / CHECK is chosen at the EDI export, LP on 145 / 435 MHz follows the power (≤ 100 W). Files named as ČRK asks (01OK1XXX.edi).',
      '6-hour entry: the header shows the time left and tells when part 2 starts and when the 6 hours are up.',
      'VKV PA and FM pohár: large-square ring scoring. FM pohár switches to FM and its EDI screen shows the summary for the web form.',
      'Contest statistics per hour and per large square (stations, distance, azimuth).',
      'Band filter in the QSO list and the map; in a VHF contest the recent QSOs show the current band only.',
      'Settings: the technical sections (database, offline references, CI-V, keyer) fold into rows with their state.',
    ],
  },
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
