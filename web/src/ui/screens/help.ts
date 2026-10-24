// "How to log" help (F1.x). Explains the single-line input grammar with examples.
// Bilingual (en/cs) via the current language. Reachable from Settings and the "?"
// button in the logging header.

import type { Screen } from '../app'
import { el, button } from '../dom'
import { lang, t } from '../i18n'
import { keyerGuideLink } from '../keyer-guide'

export interface HelpNav {
  back(): void
}

interface Row {
  readonly code?: string
  readonly text: string
  /** The text is a link to the keyer's build guide. */
  readonly guide?: boolean
}
interface Section {
  readonly title: string
  readonly rows: readonly Row[]
}

const EN: readonly Section[] = [
  {
    title: 'Basics',
    rows: [
      { text: 'Type a whole QSO on one line — the app recognizes each part by its shape. Only the callsign is required.' },
      { text: 'Enter with text adds it to the QSO and clears the line. Enter on an empty line saves the QSO.' },
    ],
  },
  {
    title: 'Callsign',
    rows: [{ code: 'OK1ABC', text: 'The worked station. Portable calls work too: OK1ABC/P, HB0/OK1MCS/P.' }],
  },
  {
    title: 'Band & mode',
    rows: [
      { code: '40m ssb', text: 'Sets band and mode. They stick until changed and show in the header.' },
      { text: 'Bands: 160m…70cm, microwaves 23cm 13cm 9cm 6cm 3cm 1.25cm 6mm 4mm — also typed as 1G 2G 3G 5G 10G 24G 47G 76G. Modes: cw ssb fm.' },
      { code: '24G cw', text: 'Microwaves also in GHz: 24G = 1.25cm, the ADIF name, which needs a dot the keyboard lacks. 10G = 3cm, 76G = 4mm.' },
    ],
  },
  {
    title: 'Reports',
    rows: [
      { code: '59', text: 'A bare number after the call is the received report. Default 59 (SSB/FM) or 599 (CW).' },
      { code: 'T57', text: 'Override the sent report (rarely needed).' },
    ],
  },
  {
    title: 'Locator, name, reference',
    rows: [
      { code: 'JN79US', text: 'Grid locator (after the callsign). Your own: the crosshair button in New Log fills it from the position.' },
      { code: 'PETR', text: 'Name — General profile only.' },
      { code: 'OK/ZC/001', text: 'Reference; the last slash becomes a dash → OK/ZC-001. Also GMA OL/LI/001, POTA CZ/0001, WWFF OKFF/0001, lookout tower (TOTA) OKR/1001.' },
      { text: 'In an Activation log, the locate button also lists the nearest SOTA, POTA, WWFF, GMA and TOTA references (25 km); a tap adds one. They work offline: the area around you downloads by itself when online, more in Settings → Offline references (e.g. JN before a trip). Parks are measured from their centre.' },
      { code: 'OK/ZC-001 CZ-0123', text: 'Your own references, in New Log: several at once — a summit, POTA parks, a WWFF area, a tower — separated by spaces. Export then offers the whole log and one file per reference, for each program\'s upload.' },
    ],
  },
  {
    title: 'VHF contest (serial number)',
    rows: [
      { code: '002', text: 'A bare number is the serial (report stays 59).' },
      { code: '58123', text: 'To send another report, join it: first 2 chars (SSB/FM) or 3 (CW) = report, rest = serial → 58 + 123.' },
      { code: '59 001', text: 'Spaced report + serial works too. Your sent serial auto-increments (the boxed number in the header).' },
      { text: 'A QSO is saved only with the callsign, the received number and the locator; until then the preview marks NR / LOC with — and an empty Enter keeps the QSO open.' },
      { code: 'JO70VA ⏎ … OK1ABC 007 ⏎', text: 'Locator heard first: a full locator counts even before the call — QRB and azimuth at once, and the strip offers the calls the database knows at that locator. The call (tap or type) completes the QSO later.' },
      { text: 'Points: 1 per km between locator centres (IARU R1). The preview shows QRB as soon as the locator is typed, the header the azimuth (e.g. 146°), grey while it only comes from the callsign database. Each station counts once per band — a repeat, even in another mode, is a dupe with 0 points.' },
      { text: 'QSO list: points per QSO and a score line per band (QSO · points · WWL · ODX). Log list → EDI: the file for the contest manager, one per band, each band with its own power, antenna and rig (remembered for the next contest); the ADIF keeps all bands. New log picks the contest (IARU R1, VKV PA, FM pohár) and a 6-hour entry; SO / MO / CHECK is chosen at the export, LP / QRP on 145 / 435 MHz follows the power; each band gets its PSect and the ČRK file name (01OK1XXX.edi). A 6-hour entry shows the time left in the header (in brackets during the break of 2 h or more). VKV PA and FM pohár score by large-square rings (own square 2, the next ring 3, …), VKV PA × the squares worked; FM pohár\'s EDI screen shows the summary for its web form, to copy.' },
      { text: 'Landscape (tablet, PC) with the system keyboard or none: the serial to give next in big digits at the top right (as in the header), with the UTC clock, the band\'s QSO count, the rate (last 60 / 10 min), the points, the average and the ODX.' },
      { text: 'QSO list → Map: a dot per worked locator, the grid and your QTH; drag to move, − + to zoom, the corners button to fit; calls next to the dots can be switched off in Settings. Tap the map: locator, QRB and azimuth of that spot. Settings → rain radar (off by default) adds the current RainViewer frame for rain scatter. QSO list → Statistics, per band: points, average per QSO, QSOs and points per UTC hour, the large squares worked (tap = the stations there) and the top 10 QSOs; a 6-hour entry also shows its window.' },
    ],
  },
  {
    title: 'Fill piece by piece',
    rows: [
      { code: 'OK1ABC ⏎ JN79US ⏎ PETR ⏎ ⏎', text: 'Add parts over several Enters; an empty Enter saves. The header shows the call while a QSO is unfinished.' },
      { code: 'OK1ND ⏎ OK1NP ⏎', text: 'A new callsign replaces the one already typed — the way to fix a typo. Report, locator… stay.' },
    ],
  },
  {
    title: 'Commands',
    rows: [
      { text: 'A single letter alone on the line, confirmed with Enter. The preview shows what it will do before you press Enter. Next to other text it is ordinary input.' },
      { code: 'W ⏎', text: 'Discard the unfinished QSO (call, reports, locator… and its time). Band and mode stay.' },
      { code: 'H ⏎', text: 'This help (same as the ? button).' },
      { code: 'D ⏎', text: 'Delete the last saved QSO — asks first and shows which one. Works only when nothing is being typed.' },
      { code: 'E ⏎', text: 'Edit the last saved QSO.' },
    ],
  },
  {
    title: 'Time (always UTC)',
    rows: [
      { text: 'The QSO time is stamped in UTC at your first keystroke.' },
      { code: '1832 OK1ABC', text: 'Type HHMM as the first token to set the UTC time manually (e.g. from paper).' },
    ],
  },
  {
    title: 'Suggestions & dupes',
    rows: [
      { text: 'After 2 characters the strip offers matching calls from the callsign database (the bundled list for the log type + stations you have worked). A call already worked shows inverted, and the input line inverts as a dupe warning.' },
      { text: 'A dupe is the same call on the same band + mode; in a VHF contest on the same band (any mode); on a satellite log on the same satellite.' },
    ],
  },
  {
    title: 'Satellite',
    rows: [
      { text: 'One log per pass: the satellite is picked when you create the log, and it sets the uplink/downlink bands and SAT_NAME. The header shows it.' },
      { code: '9A5Y 59 JN86', text: 'Exchange = report + locator. On linear birds you can switch ssb/cw; typed band tokens are ignored.' },
      { text: 'QSO list → Map shows the worked locators; QSOs without a locator are counted above the map.' },
    ],
  },
  {
    title: 'CW keyer (Bluetooth, beta)',
    rows: [
      { text: 'Settings → CW keying (off by default) → Connect: the M5-ESP32-keyer over Bluetooth, in the Android / iOS app or Chrome / Edge. In CW the strip then offers the macros CQ (DE in S&P) EX TU MY REF/LOC/INF ? whenever it has nothing to suggest; the header shows RUN or S&P and the speed (✕ = not connected). Beta, tested with the M5-ESP32-keyer v2: please report bugs on GitHub Issues (github.com/ok1cdj/kQSO/issues).' },
      { text: 'Each profile has its own macros for RUN (I call CQ) and S&P (I answer a CQ), editable in Settings. While sending, STOP is first in the strip; Esc stops too.' },
      { text: 'Macro variables: {CALL} their call, {MYCALL} {MYLOC} {MYREF} from the log header ({MYREF} all your references), {RST} sent report, {NR} my next serial (001), {LOC} {REF} their locator / reference, {HI} greeting by local time — GM until noon, GA until 18:00, GE until midnight.' },
      { code: 'R ⏎ / S ⏎', text: 'RUN / S&P mode (only while CW keying is on).' },
      { code: 'S20 ⏎', text: 'Speed 20 WPM until the keyer disconnects; on connect the default speed from Settings is sent.' },
      { code: 'C ⏎', text: 'Connect the keyer again after it dropped (✕ next to RUN / S&P in the header). Tapping RUN / S&P does the same.' },
      { code: 'ESM ⏎', text: 'ESM on / off (header RUN·ESM): Enter sends the macros as in N1MM. RUN: empty ⏎ = CQ, call ⏎ = EXCH, filling in ⏎ = nothing, empty ⏎ = TU + save. S&P: empty ⏎ = my call, call ⏎ = my call, empty ⏎ = EXCH + save. VHF contest: an empty ⏎ without the number / locator asks NR ? / LOC ? / NR LOC ? and keeps the QSO open.' },
      { code: 'K PSE QRS ⏎', text: 'Send the text once.' },
      { code: 'K ⏎', text: 'CW keyboard: what you type goes out as CW, each word on Space (type ahead; Backspace fixes only the unsent word); the header shows TX. Nothing is logged. An empty Enter, END or Esc (with nothing on the air) ends it.' },
      { text: 'Build the keyer: parts, schematics, firmware →', guide: true },
    ],
  },
  {
    title: 'Radio – CI-V (beta)',
    rows: [
      { text: 'IC-705 over its Bluetooth: Settings → Radio → IC-705 Bluetooth → Connect (Android / iOS app; first time open Pairing Reception on the radio: MENU → SET → Bluetooth Set).' },
      { text: 'Any Icom through the M5-ESP32-keyer on the radio\'s CI-V jack (keyer firmware 2.1.0+; Android / iOS app, Chrome / Edge): Settings → Radio → Via the keyer; the keyer itself is connected under Settings → M5 keyer (one link for CW and the radio). The keyer finds the bus rate and the radio itself; switch CI-V Transceive on in the radio. The model goes by the radio\'s CI-V address — choose it in Settings if the address was changed; it decides the bands, CW and voice memories (IC-910: switch its 23 cm unit on there).' },
      { text: 'The header shows the radio (705, 7300, 9700, 706 …; ✕ = not connected, tap = connect; … = connecting, or the keyer has no radio on CI-V). Band, mode and the exact frequency (ADIF FREQ) come from the radio.' },
      { code: '40m ⏎ / cw ⏎', text: 'Tunes the radio: a band goes to the radio\'s last frequency there (band stacking register; older radios like the IC-706: the usual spot for the mode), the mode stays.' },
      { code: 'F28300 ⏎', text: 'Tunes the radio to 28.300 MHz (kHz, no dot); the mode stays.' },
      { code: '23cm ⏎', text: 'A band the radio doesn\'t work: kQSO doesn\'t try to tune it — only the log switches and QSOs are logged on it; the radio stays connected, is left alone and doesn\'t key (header 705 –) until you type a radio band or change band on the radio. The same when the radio refuses a band. With a transverter (Settings → Radio → XVERT) the radio goes to its IF and the log gets the RF frequency (header 705 XV).' },
      { text: 'In CW the macros send through the radio\'s own keyer where it has one over CI-V (IC-705, 7300, 9700, 7610, 7100; no need for CW keying; without break-in only the sidetone sounds), else the M5 keyer keys the radio by wire (CW keying on). In SSB / FM the strip offers T1–T4, the radio\'s voice memories (IC-705, 7300, 9700, 7610); STOP or Esc stops them.' },
      { text: 'Build the keyer (with CI-V for any Icom) →', guide: true },
    ],
  },
  {
    title: 'Keyboard',
    rows: [
      { text: 'On-screen keyboard is alphabetical, 6×7. Space is single width; Backspace and Enter are double. A hardware keyboard works too.' },
      { code: 'Ctrl+⏎', text: 'Save the QSO now: takes the typed line in and saves when it has all it needs (call, in a VHF contest also the locator).' },
      { code: 'Alt+W D H E', text: 'Discard the QSO / delete the last / help / edit the last — as W D H E ⏎. Alt+D keeps the line being typed.' },
      { code: 'Alt+X', text: 'Take the locator the database offers (+ LOC).' },
      { code: 'Alt+M', text: 'Mode CW → SSB → FM.' },
      { code: 'Alt+L / Alt+Q', text: 'QSO list / back to the logs.' },
      { code: 'F5 F6 F7 F8 F11 F12', text: 'Macros CQ EX TU ? MY INFO (CW, keyer connected); F5–F8 in SSB / FM the radio\'s voice memories T1–T4.' },
      { code: 'PgUp / PgDn', text: 'CW speed ±2 WPM.' },
      { code: 'Alt+R S C K', text: 'RUN / S&P / connect the keyer / CW keyboard (CW keying on). Esc = STOP.' },
      { text: 'A shortcut that has nothing to do now leaves the key alone (F5 without the keyer reloads the page).' },
    ],
  },
]

const CS: readonly Section[] = [
  {
    title: 'Základ',
    rows: [
      { text: 'Celé QSO napiš na jeden řádek — appka pozná každou část podle tvaru. Povinná je jen volačka.' },
      { text: 'Enter s obsahem přiklopí část k QSO a vyprázdní řádek. Enter na prázdném řádku QSO zapíše.' },
    ],
  },
  {
    title: 'Volačka',
    rows: [{ code: 'OK1ABC', text: 'Protistanice. Fungují i portable tvary: OK1ABC/P, HB0/OK1MCS/P.' }],
  },
  {
    title: 'Pásmo a mód',
    rows: [
      { code: '40m ssb', text: 'Nastaví pásmo a mód. Drží se, dokud je nezměníš, a jsou vidět v hlavičce.' },
      { text: 'Pásma: 160m…70cm, mikrovlny 23cm 13cm 9cm 6cm 3cm 1.25cm 6mm 4mm — jdou napsat i jako 1G 2G 3G 5G 10G 24G 47G 76G. Módy: cw ssb fm.' },
      { code: '24G cw', text: 'Mikrovlny i v GHz: 24G = 1.25cm, název podle ADIF, který potřebuje tečku, a ta na klávesnici není. 10G = 3cm, 76G = 4mm.' },
    ],
  },
  {
    title: 'Reporty',
    rows: [
      { code: '59', text: 'Holé číslo za volačkou je přijatý report. Výchozí 59 (SSB/FM) nebo 599 (CW).' },
      { code: 'T57', text: 'Přepis vyslaného reportu (zřídka).' },
    ],
  },
  {
    title: 'Locator, jméno, reference',
    rows: [
      { code: 'JN79US', text: 'Locator (za volačkou). Svůj: tlačítko se zaměřovačem v Novém logu ho vyplní z polohy.' },
      { code: 'PETR', text: 'Jméno — jen profil Obecný.' },
      { code: 'OK/ZC/001', text: 'Reference; poslední lomítko se změní na pomlčku → OK/ZC-001. Také GMA OL/LI/001, POTA CZ/0001, WWFF OKFF/0001, rozhledna (TOTA) OKR/1001.' },
      { text: 'V logu Aktivace tlačítko polohy navíc ukáže nejbližší reference SOTA, POTA, WWFF, GMA a TOTA (25 km); klepnutím se přidají. Fungují offline: okolí se stáhne samo, když je síť, další oblasti v Nastavení → Reference offline (např. JN před výletem). Parky se měří od středu.' },
      { code: 'OK/ZC-001 CZ-0123', text: 'Vlastní reference v Novém logu: i víc najednou — vrchol, parky POTA, oblast WWFF, rozhledna — oddělené mezerou. Export pak nabídne celý log a soubor pro každou referenci zvlášť, na nahrání do jednotlivých programů.' },
    ],
  },
  {
    title: 'VKV závod (pořadové číslo)',
    rows: [
      { code: '002', text: 'Holé číslo je pořadové číslo (report zůstane 59).' },
      { code: '58123', text: 'Pro jiný report ho napiš spojeně: první 2 znaky (SSB/FM) nebo 3 (CW) = report, zbytek = číslo → 58 + 123.' },
      { code: '59 001', text: 'Funguje i s mezerou. Tvé vyslané číslo se počítá samo (číslo v rámečku v hlavičce).' },
      { text: 'QSO se uloží jen se značkou, přijatým číslem a lokátorem; do té doby náhled ukazuje u NR / LOC — a prázdný Enter nechá QSO otevřené.' },
      { code: 'JO70VA ⏎ … OK1ABC 007 ⏎', text: 'Lokátor slyšíš dřív: celý lokátor platí i před značkou — hned QRB a azimut a lišta nabídne značky, které databáze u toho lokátoru zná. Značka (klepnutím nebo napsaná) pak QSO doplní.' },
      { text: 'Body: 1 za km mezi středy lokátorů (IARU R1). Náhled ukáže QRB, jakmile napíšeš lokátor, hlavička azimut (např. 146°), šedě, dokud je jen z databáze značek. Každá stanice se počítá jednou na pásmo — opakování, i jiným módem, je duplicita za 0 bodů.' },
      { text: 'Seznam QSO: body u každého QSO a řádek za pásmo (QSO · body · WWL · ODX). Seznam logů → EDI: soubor pro vyhodnocovatele, jeden za pásmo, každé pásmo s vlastním výkonem, anténou a zařízením (zapamatuje se na příští závod); ADIF drží všechna pásma. Nový log volí závod (IARU R1, VKV PA, FM pohár) a účast na 6 hodin; SO / MO / CHECK se volí při exportu, LP / QRP na 145 / 435 MHz podle výkonu; každé pásmo dostane svůj PSect a název souboru podle ČRK (01OK1XXX.edi). U kategorie 6 hodin ukazuje hlavička zbývající čas (v závorce během přestávky 2 h a delší). VKV PA a FM pohár boduje podle pásů velkých čtverců (vlastní čtverec 2, další pás 3, …), VKV PA × pracované čtverce; u FM poháru ukáže obrazovka EDI souhrn pro webový formulář, ke zkopírování.' },
      { text: 'Na šířku (tablet, PC) se systémovou klávesnicí nebo bez klávesnice: vpravo nahoře velké pořadové číslo, které dáváš protistanici (jako v hlavičce), pod ním čas UTC, počet QSO na pásmu, rate (posledních 60 / 10 min), body, průměr a ODX.' },
      { text: 'Seznam QSO → Mapa: tečka za každý lokátor, mřížka a tvoje QTH; tažením posuneš, − + zoom, tlačítko s rohy celé; značky u teček vypneš v Nastavení. Ťukni do mapy: lokátor, QRB a azimut toho místa. Nastavení → srážkový radar (výchozí vypnuto) přidá aktuální snímek z RainVieweru pro rain scatter. Seznam QSO → Statistika, za každé pásmo zvlášť: body, průměr na QSO, QSO a body po hodinách (UTC), pracované velké čtverce (ťuknutím stanice v nich) a top 10 spojení; u kategorie 6 hodin i její okno.' },
    ],
  },
  {
    title: 'Skládání po částech',
    rows: [
      { code: 'OK1ABC ⏎ JN79US ⏎ PETR ⏎ ⏎', text: 'Doplňuj po částech přes víc Enterů; prázdný Enter zapíše. Hlavička ukazuje volačku, dokud je QSO rozdělané.' },
      { code: 'OK1ND ⏎ OK1NP ⏎', text: 'Nová volačka nahradí už napsanou — tak se opraví překlep. Report, locator… zůstanou.' },
    ],
  },
  {
    title: 'Příkazy',
    rows: [
      { text: 'Jedno písmeno samotné na řádku, potvrzené Enterem. Náhled ukáže, co udělá, ještě před Enterem. Vedle dalšího textu je to obyčejný vstup.' },
      { code: 'W ⏎', text: 'Zahodí rozepsané QSO (volačku, reporty, locator… i jeho čas). Pásmo a mód zůstanou.' },
      { code: 'H ⏎', text: 'Tato nápověda (jako tlačítko ?).' },
      { code: 'D ⏎', text: 'Smaže poslední zapsané QSO — nejdřív se zeptá a ukáže které. Jen když nic nepíšeš.' },
      { code: 'E ⏎', text: 'Upraví poslední zapsané QSO.' },
    ],
  },
  {
    title: 'Čas (vždy UTC)',
    rows: [
      { text: 'Čas QSO se razí v UTC při prvním stisku klávesy.' },
      { code: '1832 OK1ABC', text: 'Napiš HHMM jako první token pro ruční UTC čas (třeba z papíru).' },
    ],
  },
  {
    title: 'Návrhy a duplicity',
    rows: [
      { text: 'Od 2 znaků strip nabízí volačky z databáze značek (přibalený seznam pro typ logu + stanice, které jsi dělal). Už zalogovaná značka je inverzně a vstupní řádek zčerná jako varování před duplicitou.' },
      { text: 'Duplicita = stejná značka na stejném pásmu + módu; ve VKV závodě na stejném pásmu (mód nerozhoduje); v satelitním logu na stejné družici.' },
    ],
  },
  {
    title: 'Satelit',
    rows: [
      { text: 'Co přelet, to log: družici vybereš při zakládání logu a ta nastaví pásma uplink/downlink i SAT_NAME. Hlavička ji ukazuje.' },
      { code: '9A5Y 59 JN86', text: 'Předává se report + locator. Na lineárních družicích můžeš přepnout ssb/cw; napsané pásmo se ignoruje.' },
      { text: 'Seznam QSO → Mapa ukáže udělané lokátory; QSO bez lokátoru jsou spočítané nad mapou.' },
    ],
  },
  {
    title: 'CW klíčovač (Bluetooth, beta)',
    rows: [
      { text: 'Nastavení → CW klíčování (výchozí vypnuto) → Připojit: klíčovač M5-ESP32-keyer přes Bluetooth, v aplikaci pro Android a iOS nebo v Chromu / Edge. V CW pak lišta nabízí makra CQ (v S&P DE) EX TU MY REF/LOC/INF ?, kdykoli zrovna nic nenavrhuje; hlavička ukazuje RUN nebo S&P a rychlost (✕ = nepřipojeno). Beta, vyzkoušeno s M5-ESP32-keyer v2: chyby prosím hlaste na GitHub Issues (github.com/ok1cdj/kQSO/issues).' },
      { text: 'Každý profil má vlastní makra pro RUN (dávám CQ) a S&P (odpovídám na CQ), upravíš je v Nastavení. Během vysílání je v liště na prvním místě STOP; zastaví i Esc.' },
      { text: 'Proměnné v makrech: {CALL} značka protistanice, {MYCALL} {MYLOC} {MYREF} z hlavičky logu ({MYREF} všechny tvoje reference), {RST} odesílaný report, {NR} moje další pořadové číslo (001), {LOC} {REF} lokátor / reference protistanice, {HI} pozdrav podle místního času — GM do poledne, GA do 18:00, GE do půlnoci.' },
      { code: 'R ⏎ / S ⏎', text: 'Režim RUN / S&P (jen se zapnutým CW klíčováním).' },
      { code: 'S20 ⏎', text: 'Rychlost 20 WPM do odpojení klíčovače; po připojení se pošle výchozí rychlost z Nastavení.' },
      { code: 'C ⏎', text: 'Znovu připojí klíčovač, když spadl (✕ u RUN / S&P v hlavičce). Totéž udělá klepnutí na RUN / S&P.' },
      { code: 'ESM ⏎', text: 'ESM zap / vyp (v hlavičce RUN·ESM): Enter posílá makra jako v N1MM. RUN: prázdný ⏎ = CQ, značka ⏎ = EXCH, doplnění ⏎ = nic, prázdný ⏎ = TU + uložení. S&P: prázdný ⏎ = moje značka, značka ⏎ = moje značka, prázdný ⏎ = EXCH + uložení. VKV závod: prázdný ⏎ bez čísla / lokátoru se zeptá NR ? / LOC ? / NR LOC ? a QSO nechá otevřené.' },
      { code: 'K PSE QRS ⏎', text: 'Jednou odešle napsaný text.' },
      { code: 'K ⏎', text: 'CW klávesnice: co píšeš, jde do éteru, každé slovo po mezeře (můžeš psát dopředu; Backspace opraví jen neodeslané slovo); hlavička ukazuje TX. Nic se nezapisuje do logu. Konec: prázdný Enter, KONEC nebo Esc (když se nevysílá).' },
      { text: 'Postav si klíčovač: součástky, schémata, firmware →', guide: true },
    ],
  },
  {
    title: 'Rádio – CI-V (beta)',
    rows: [
      { text: 'IC-705 přes jeho Bluetooth: Nastavení → Rádio → IC-705 Bluetooth → Připojit (aplikace pro Android a iOS; poprvé na rádiu otevři Pairing Reception: MENU → SET → Bluetooth Set).' },
      { text: 'Jakýkoli Icom přes klíčovač M5-ESP32-keyer na CI-V konektoru rádia (firmware klíčovače 2.1.0+; aplikace pro Android a iOS, Chrome / Edge): Nastavení → Rádio → Přes klíčovač; samotný klíčovač se připojuje v Nastavení → Klíčovač M5 (jedno spojení pro CW i rádio). Rychlost sběrnice i rádio najde klíčovač sám; v rádiu zapni CI-V Transceive. Model se pozná podle CI-V adresy rádia — při změněné adrese ho vyber v Nastavení; podle něj se řídí pásma, CW a hlasové paměti (IC-910: tam zapni modul 23 cm).' },
      { text: 'Hlavička ukazuje rádio (705, 7300, 9700, 706 …; ✕ = nepřipojeno, klepnutí = připojit; … = připojuje se, nebo klíčovač nemá na CI-V rádio). Pásmo, mód a přesný kmitočet (ADIF FREQ) bere kQSO z rádia.' },
      { code: '40m ⏎ / cw ⏎', text: 'Přeladí rádio: pásmo na poslední kmitočet rádia na tom pásmu (band stacking register; starší rádia jako IC-706: obvyklý kmitočet pro mód), mód zůstane.' },
      { code: 'F28300 ⏎', text: 'Přeladí rádio na 28,300 MHz (v kHz, bez tečky); mód zůstane.' },
      { code: '23cm ⏎', text: 'Pásmo, které rádio neumí: kQSO se ho nepokusí naladit — přepne se jen deník a spojení se na něm logují; rádio zůstane připojené, jak je, a neklíčuje (hlavička 705 –), dokud nenapíšeš pásmo rádia nebo nepřepneš pásmo na rádiu. Stejně, když rádio pásmo odmítne. S transvertorem (Nastavení → Rádio → XVERT) jde rádio na mezifrekvenci a do deníku kmitočet RF (hlavička 705 XV).' },
      { text: 'V CW posílají makra vnitřní klíčovač rádia, pokud ho přes CI-V má (IC-705, 7300, 9700, 7610, 7100; CW klíčování zapínat netřeba; bez break-inu zní jen příposlech), jinak klíčuje rádio klíčovač M5 po drátu (CW klíčování zapnout). V SSB / FM lišta nabízí T1–T4, hlasové paměti rádia (IC-705, 7300, 9700, 7610); STOP nebo Esc je zastaví.' },
      { text: 'Postav si klíčovač (i s CI-V pro jakýkoli Icom) →', guide: true },
    ],
  },
  {
    title: 'Klávesnice',
    rows: [
      { text: 'Klávesnice je abecední, 6×7. Mezera je jednoduchá, Backspace a Enter dvojité. Funguje i hardwarová klávesnice.' },
      { code: 'Ctrl+⏎', text: 'Zapsat QSO hned: přiklopí napsaný řádek a zapíše, když má vše potřebné (volačku, ve VKV závodě i lokátor).' },
      { code: 'Alt+W D H E', text: 'Zahodit QSO / smazat poslední / nápověda / upravit poslední — jako W D H E ⏎. Alt+D nechá rozepsaný řádek.' },
      { code: 'Alt+X', text: 'Vzít lokátor nabídnutý z databáze (+ LOC).' },
      { code: 'Alt+M', text: 'Mód CW → SSB → FM.' },
      { code: 'Alt+L / Alt+Q', text: 'Seznam QSO / zpět na logy.' },
      { code: 'F5 F6 F7 F8 F11 F12', text: 'Makra CQ EX TU ? MY INFO (CW, připojený klíčovač); F5–F8 v SSB / FM hlasové paměti rádia T1–T4.' },
      { code: 'PgUp / PgDn', text: 'Rychlost CW ±2 WPM.' },
      { code: 'Alt+R S C K', text: 'RUN / S&P / připojit klíčovač / CW klávesnice (zapnuté CW klíčování). Esc = STOP.' },
      { text: 'Zkratka, která teď nemá co dělat, klávesu nechá být (F5 bez klíčovače obnoví stránku).' },
    ],
  },
]

export class HelpScreen implements Screen {
  private readonly root = el('div', 'screen screen--list help')

  constructor(private readonly nav: HelpNav) {}

  mount(host: HTMLElement): void {
    host.replaceChildren(this.root)
    const bar = el('div', 'bar')
    bar.append(button(`‹ ${t('common.back')}`, () => this.nav.back(), 'hdr-nav'), el('b', 'title', t('settings.help')))

    const sections = lang === 'cs' ? CS : EN
    const body = sections.map((s) => {
      const sec = el('div', 'help-section')
      sec.append(el('h2', undefined, s.title))
      for (const row of s.rows) {
        const r = el('div', 'help-row')
        if (row.code) r.append(el('code', 'help-code', row.code))
        if (row.guide) r.append(keyerGuideLink(row.text, 'help-text'))
        else r.append(el('span', 'help-text', row.text))
        sec.append(r)
      }
      return sec
    })
    this.root.replaceChildren(bar, ...body)
  }

  unmount(): void {}
}
