// "How to log" help (F1.x). Explains the single-line input grammar with examples.
// Bilingual (en/cs) via the current language. Reachable from Settings and the "?"
// button in the logging header.

import type { Screen } from '../app'
import { el, button } from '../dom'
import { lang, t } from '../i18n'

export interface HelpNav {
  back(): void
}

interface Row {
  readonly code?: string
  readonly text: string
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
      { code: 'JN79US', text: 'Grid locator (after the callsign).' },
      { code: 'PETR', text: 'Name — General profile only.' },
      { code: 'OK/ZC/001', text: 'Reference; the last slash becomes a dash → OK/ZC-001. Also GMA OL/LI/001, POTA CZ/0001, WWFF OKFF/0001, lookout tower (TOTA) OKR/1001.' },
    ],
  },
  {
    title: 'VHF contest (serial number)',
    rows: [
      { code: '002', text: 'A bare number is the serial (report stays 59).' },
      { code: '58123', text: 'To send another report, join it: first 2 chars (SSB/FM) or 3 (CW) = report, rest = serial → 58 + 123.' },
      { code: '59 001', text: 'Spaced report + serial works too. Your sent serial auto-increments (the boxed number in the header).' },
      { text: 'A QSO is saved only with the callsign, the received number and the locator; until then the preview marks NR / LOC with — and an empty Enter keeps the QSO open.' },
      { text: 'Points: 1 per km between locator centres (IARU R1). The preview shows QRB as soon as the locator is typed, the header the azimuth (e.g. 146°), grey while it only comes from the callsign database. Each station counts once per band — a repeat, even in another mode, is a dupe with 0 points.' },
      { text: 'QSO list: points per QSO and a score line per band (QSO · points · WWL · ODX). Log list → EDI: the file for the contest manager, one per band, each band with its own power, antenna and rig (remembered for the next contest); the ADIF keeps all bands.' },
      { text: 'QSO list → Map: a dot per worked locator, the grid and your QTH; drag to move, − + to zoom, the corners button to fit; calls next to the dots can be switched off in Settings. Tap the map: locator, QRB and azimuth of that spot. Settings → rain radar (off by default) adds the current RainViewer frame for rain scatter. QSO list → Statistics: points, average per QSO and the top 10 QSOs, per band.' },
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
      { text: 'Settings → CW keying (off by default) → Connect: the M5-ESP32-keyer over Bluetooth, in the Android app or Chrome / Edge. In CW the strip then offers the macros CQ (DE in S&P) EX TU MY REF/LOC/INF ? whenever it has nothing to suggest; the header shows RUN or S&P and the speed (✕ = not connected). Beta, tested with the M5-ESP32-keyer v2: please report bugs on GitHub Issues (github.com/ok1cdj/kQSO/issues).' },
      { text: 'Each profile has its own macros for RUN (I call CQ) and S&P (I answer a CQ), editable in Settings. While sending, STOP is first in the strip; Esc stops too.' },
      { text: 'Macro variables: {CALL} their call, {MYCALL} {MYLOC} {MYREF} from the log header, {RST} sent report, {NR} my next serial (001), {LOC} {REF} their locator / reference, {HI} greeting by local time — GM until noon, GA until 18:00, GE until midnight.' },
      { code: 'R ⏎ / S ⏎', text: 'RUN / S&P mode (only while CW keying is on).' },
      { code: 'S20 ⏎', text: 'Speed 20 WPM until the keyer disconnects; on connect the default speed from Settings is sent.' },
      { code: 'C ⏎', text: 'Connect the keyer again after it dropped (✕ next to RUN / S&P in the header). Tapping RUN / S&P does the same.' },
      { code: 'E ⏎', text: 'ESM on / off (header RUN·ESM): Enter sends the macros as in N1MM. RUN: empty ⏎ = CQ, call ⏎ = EXCH, filling in ⏎ = nothing, empty ⏎ = TU + save. S&P: empty ⏎ = my call, call ⏎ = my call, empty ⏎ = EXCH + save. VHF contest: an empty ⏎ without the number / locator asks NR ? / LOC ? / NR LOC ? and keeps the QSO open.' },
      { code: 'K PSE QRS ⏎', text: 'Send the text once.' },
      { code: 'K ⏎', text: 'CW keyboard: what you type goes out as CW, each word on Space (type ahead; Backspace fixes only the unsent word); the header shows TX. Nothing is logged. An empty Enter, END or Esc (with nothing on the air) ends it.' },
    ],
  },
  {
    title: 'IC-705 (Bluetooth, beta)',
    rows: [
      { text: 'Settings → IC-705 → Connect (Android app; first time open Pairing Reception on the radio: MENU → SET → Bluetooth Set). The header shows 705 (✕ = not connected, tap = connect). Band, mode and the exact frequency (ADIF FREQ) come from the radio.' },
      { code: '40m ⏎ / cw ⏎', text: 'Tunes the radio: a band goes to the radio\'s last frequency there, the mode stays.' },
      { code: 'F28300 ⏎', text: 'Tunes the radio to 28.300 MHz (kHz, no dot); the mode stays.' },
      { code: '23cm ⏎', text: 'A band the radio doesn\'t work: only the log switches, the radio is left alone and doesn\'t key (header 705 –) until you type a radio band or change band on the radio. With a transverter (Settings → IC-705 → XVERT) the radio goes to its IF and the log gets the RF frequency (header 705 XV).' },
      { text: 'In CW the macros send through the radio\'s own keyer (no need for CW keying); without break-in only the sidetone sounds. In SSB / FM the strip offers T1–T4, the radio\'s voice memories; STOP or Esc stops them.' },
    ],
  },
  {
    title: 'Keyboard',
    rows: [
      { text: 'On-screen keyboard is alphabetical, 6×7. Space is single width; Backspace and Enter are double. A hardware keyboard works too.' },
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
      { code: 'JN79US', text: 'Locator (za volačkou).' },
      { code: 'PETR', text: 'Jméno — jen profil Obecný.' },
      { code: 'OK/ZC/001', text: 'Reference; poslední lomítko se změní na pomlčku → OK/ZC-001. Také GMA OL/LI/001, POTA CZ/0001, WWFF OKFF/0001, rozhledna (TOTA) OKR/1001.' },
    ],
  },
  {
    title: 'VKV závod (pořadové číslo)',
    rows: [
      { code: '002', text: 'Holé číslo je pořadové číslo (report zůstane 59).' },
      { code: '58123', text: 'Pro jiný report ho napiš spojeně: první 2 znaky (SSB/FM) nebo 3 (CW) = report, zbytek = číslo → 58 + 123.' },
      { code: '59 001', text: 'Funguje i s mezerou. Tvé vyslané číslo se počítá samo (číslo v rámečku v hlavičce).' },
      { text: 'QSO se uloží jen se značkou, přijatým číslem a lokátorem; do té doby náhled ukazuje u NR / LOC — a prázdný Enter nechá QSO otevřené.' },
      { text: 'Body: 1 za km mezi středy lokátorů (IARU R1). Náhled ukáže QRB, jakmile napíšeš lokátor, hlavička azimut (např. 146°), šedě, dokud je jen z databáze značek. Každá stanice se počítá jednou na pásmo — opakování, i jiným módem, je duplicita za 0 bodů.' },
      { text: 'Seznam QSO: body u každého QSO a řádek za pásmo (QSO · body · WWL · ODX). Seznam logů → EDI: soubor pro vyhodnocovatele, jeden za pásmo, každé pásmo s vlastním výkonem, anténou a zařízením (zapamatuje se na příští závod); ADIF drží všechna pásma.' },
      { text: 'Seznam QSO → Mapa: tečka za každý lokátor, mřížka a tvoje QTH; tažením posuneš, − + zoom, tlačítko s rohy celé; značky u teček vypneš v Nastavení. Ťukni do mapy: lokátor, QRB a azimut toho místa. Nastavení → srážkový radar (výchozí vypnuto) přidá aktuální snímek z RainVieweru pro rain scatter. Seznam QSO → Statistika: body, průměr na QSO a top 10 spojení, za každé pásmo zvlášť.' },
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
      { text: 'Nastavení → CW klíčování (výchozí vypnuto) → Připojit: klíčovač M5-ESP32-keyer přes Bluetooth, v aplikaci pro Android nebo v Chromu / Edge. V CW pak lišta nabízí makra CQ (v S&P DE) EX TU MY REF/LOC/INF ?, kdykoli zrovna nic nenavrhuje; hlavička ukazuje RUN nebo S&P a rychlost (✕ = nepřipojeno). Beta, vyzkoušeno s M5-ESP32-keyer v2: chyby prosím hlaste na GitHub Issues (github.com/ok1cdj/kQSO/issues).' },
      { text: 'Každý profil má vlastní makra pro RUN (dávám CQ) a S&P (odpovídám na CQ), upravíš je v Nastavení. Během vysílání je v liště na prvním místě STOP; zastaví i Esc.' },
      { text: 'Proměnné v makrech: {CALL} značka protistanice, {MYCALL} {MYLOC} {MYREF} z hlavičky logu, {RST} odesílaný report, {NR} moje další pořadové číslo (001), {LOC} {REF} lokátor / reference protistanice, {HI} pozdrav podle místního času — GM do poledne, GA do 18:00, GE do půlnoci.' },
      { code: 'R ⏎ / S ⏎', text: 'Režim RUN / S&P (jen se zapnutým CW klíčováním).' },
      { code: 'S20 ⏎', text: 'Rychlost 20 WPM do odpojení klíčovače; po připojení se pošle výchozí rychlost z Nastavení.' },
      { code: 'C ⏎', text: 'Znovu připojí klíčovač, když spadl (✕ u RUN / S&P v hlavičce). Totéž udělá klepnutí na RUN / S&P.' },
      { code: 'E ⏎', text: 'ESM zap / vyp (v hlavičce RUN·ESM): Enter posílá makra jako v N1MM. RUN: prázdný ⏎ = CQ, značka ⏎ = EXCH, doplnění ⏎ = nic, prázdný ⏎ = TU + uložení. S&P: prázdný ⏎ = moje značka, značka ⏎ = moje značka, prázdný ⏎ = EXCH + uložení. VKV závod: prázdný ⏎ bez čísla / lokátoru se zeptá NR ? / LOC ? / NR LOC ? a QSO nechá otevřené.' },
      { code: 'K PSE QRS ⏎', text: 'Jednou odešle napsaný text.' },
      { code: 'K ⏎', text: 'CW klávesnice: co píšeš, jde do éteru, každé slovo po mezeře (můžeš psát dopředu; Backspace opraví jen neodeslané slovo); hlavička ukazuje TX. Nic se nezapisuje do logu. Konec: prázdný Enter, KONEC nebo Esc (když se nevysílá).' },
    ],
  },
  {
    title: 'IC-705 (Bluetooth, beta)',
    rows: [
      { text: 'Nastavení → IC-705 → Připojit (aplikace pro Android; poprvé na rádiu otevři Pairing Reception: MENU → SET → Bluetooth Set). Hlavička ukazuje 705 (✕ = nepřipojeno, klepnutí = připojit). Pásmo, mód a přesný kmitočet (ADIF FREQ) bere kQSO z rádia.' },
      { code: '40m ⏎ / cw ⏎', text: 'Přeladí rádio: pásmo na poslední kmitočet rádia na tom pásmu, mód zůstane.' },
      { code: 'F28300 ⏎', text: 'Přeladí rádio na 28,300 MHz (v kHz, bez tečky); mód zůstane.' },
      { code: '23cm ⏎', text: 'Pásmo, které rádio neumí: přepne se jen deník, rádio zůstane, jak je, a neklíčuje (hlavička 705 –), dokud nenapíšeš pásmo rádia nebo nepřepneš pásmo na rádiu. S transvertorem (Nastavení → IC-705 → XVERT) jde rádio na mezifrekvenci a do deníku kmitočet RF (hlavička 705 XV).' },
      { text: 'V CW posílají makra vnitřní klíčovač rádia (CW klíčování zapínat netřeba); bez break-inu zní jen příposlech. V SSB / FM lišta nabízí T1–T4, hlasové paměti rádia; STOP nebo Esc je zastaví.' },
    ],
  },
  {
    title: 'Klávesnice',
    rows: [
      { text: 'Klávesnice je abecední, 6×7. Mezera je jednoduchá, Backspace a Enter dvojité. Funguje i hardwarová klávesnice.' },
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
        r.append(el('span', 'help-text', row.text))
        sec.append(r)
      }
      return sec
    })
    this.root.replaceChildren(bar, ...body)
  }

  unmount(): void {}
}
