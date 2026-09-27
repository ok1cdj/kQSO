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
      { text: 'Bands: 160m…23cm, plus 13cm and 3cm (QO-100). Modes: cw ssb fm.' },
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
      { code: 'OK/ZC/001', text: 'Reference; the last slash becomes a dash → OK/ZC-001. Also POTA OK/0001, WWFF OKFF/0001.' },
    ],
  },
  {
    title: 'VHF contest (serial number)',
    rows: [
      { code: '002', text: 'A bare number is the serial (report stays 59).' },
      { code: '58123', text: 'To send another report, join it: first 2 chars (SSB/FM) or 3 (CW) = report, rest = serial → 58 + 123.' },
      { code: '59 001', text: 'Spaced report + serial works too. Your sent serial auto-increments (TX in the header).' },
      { text: 'Points: 1 per km between locator centres (IARU R1). The preview shows QRB as soon as the locator is typed. Each station counts once per band — a repeat, even in another mode, is a dupe with 0 points.' },
      { text: 'QSO list: points per QSO and a score line per band (QSO · points · WWL · ODX). Log list → EDI: the file for the contest manager, one per band, each band with its own power, antenna and rig (remembered for the next contest); the ADIF keeps all bands.' },
      { text: 'QSO list → Map: a dot per worked locator, the grid and your QTH; drag to move, − + to zoom, ⤢ to fit; calls next to the dots can be switched off in Settings. QSO list → Statistics: points, average per QSO and the top 10 QSOs, per band.' },
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
      { text: 'Pásma: 160m…23cm, k tomu 13cm a 3cm (QO-100). Módy: cw ssb fm.' },
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
      { code: 'OK/ZC/001', text: 'Reference; poslední lomítko se změní na pomlčku → OK/ZC-001. Také POTA OK/0001, WWFF OKFF/0001.' },
    ],
  },
  {
    title: 'VKV závod (pořadové číslo)',
    rows: [
      { code: '002', text: 'Holé číslo je pořadové číslo (report zůstane 59).' },
      { code: '58123', text: 'Pro jiný report ho napiš spojeně: první 2 znaky (SSB/FM) nebo 3 (CW) = report, zbytek = číslo → 58 + 123.' },
      { code: '59 001', text: 'Funguje i s mezerou. Tvé vyslané číslo se počítá samo (TX v hlavičce).' },
      { text: 'Body: 1 za km mezi středy lokátorů (IARU R1). Náhled ukáže QRB, jakmile napíšeš lokátor. Každá stanice se počítá jednou na pásmo — opakování, i jiným módem, je duplicita za 0 bodů.' },
      { text: 'Seznam QSO: body u každého QSO a řádek za pásmo (QSO · body · WWL · ODX). Seznam logů → EDI: soubor pro vyhodnocovatele, jeden za pásmo, každé pásmo s vlastním výkonem, anténou a zařízením (zapamatuje se na příští závod); ADIF drží všechna pásma.' },
      { text: 'Seznam QSO → Mapa: tečka za každý lokátor, mřížka a tvoje QTH; tažením posuneš, − + zoom, ⤢ celé; značky u teček vypneš v Nastavení. Seznam QSO → Statistika: body, průměr na QSO a top 10 spojení, za každé pásmo zvlášť.' },
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
