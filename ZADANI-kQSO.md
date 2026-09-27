# ZADANI-kQSO.md

Ham radio deník s jednořádkovým chytrým vstupem. **Webová aplikace** na `kqso.ok1cdj.com`, ve druhé fázi zabalená do WebView shellu jako APK.

Cílová zařízení jsou tři a všechna jsou rovnocenná:

| | |
|---|---|
| **Mudita Kompakt** | 480×800 e-ink, MuditaOS K, AOSP bez Google Services — dotykové ovládání, e-ink režim |
| **iPad / tablet** | WebKit, hardwarová i dotyková klávesnice, landscape |
| **Desktop** | ladění parseru, editace logů po aktivaci |

---

## 1. Fáze

### Fáze 1 — web (`v0.x`)

Kompletní funkční deník v prohlížeči. **Není to prototyp.** Otevřeš v EinkBro na Kompaktu, service worker to nacachuje, jdeš s tím na kopec. Na iPadu a desktopu funguje rovnou.

Adresář `app/` v této fázi vůbec nevznikne.

### Fáze 2 — WebView shell (`v1.0`)

APK pro Kompakt. Nepřidává funkce, přidává integraci:

- `keepAwake` přes `FLAG_KEEP_SCREEN_ON` (v prohlížeči závisí na tom, jestli Wake Lock povolí)
- export přes SAF a sdílení přes `ACTION_SEND`
- logy jako skutečné soubory v app storage, dosažitelné přes ADB
- distribuce přes GitHub Releases (F-Droid a Obtainium se nedělají)
- ikona a chování normální appky
- e-ink režim nastavený natvrdo

### Co musí být hotové už ve fázi 1

- **`src/platform/` existuje od začátku a veškerý přístup k souborům jde přes něj.** Ani jedno volání OPFS mimo tenhle adresář. Jinak fáze 2 znamená hledat zápisy rozeseté po celém kódu.
- Přepínač display režimu, aby fáze 2 jen nastavila výchozí hodnotu.
- Otestovaná obnova z crash journalu tvrdým zavřením záložky. V prohlížeči neuvidíš zabití procesu na pozadí, což je přesně scénář, kvůli kterému journal existuje.

### Shell možná nezůstane tady

Shell je ~150 řádků. Pokud se ukáže, že je generický — načti assety, drž displej, ulož soubor, sdílej — vytáhni ho do samostatného **`kShell`** a zabal do něj i ostatní nástroje z `apps.ok1cdj.com`. Rozhodnutí se dá odložit, protože `KQSOPlatform` je čistá hranice; extrakce je pak přejmenování rozhraní, ne refaktor.

---

## 2. Struktura

```
kQSO/
├── web/                        TypeScript, žádné runtime závislosti
│   ├── src/core/               parser, model, ADIF writer/reader — bez DOM API
│   ├── src/ui/                 komponenty, klávesnice
│   ├── src/platform/           bridge + webový shim (JEDINÝ přístup k úložišti)
│   ├── src/theme/              tokeny pro oba display režimy
│   ├── tests/                  vitest nad core
│   ├── sw.ts                   service worker, offline-first
│   └── manifest.webmanifest
├── app/                        fáze 2 — Android WebView shell
│   └── src/main/assets/web/    ← sem se kopíruje build z web/
└── .github/workflows/
```

| | |
|---|---|
| Repo | `ok1cdj/kQSO` |
| Application ID | `com.ok1cdj.kqso` |
| Licence | GPL-3.0 |
| Web | TypeScript, Vite, Vitest — **jen devDependencies**, výstup je statický bundle bez runtime závislostí |
| Android (fáze 2) | Kotlin 2.4.10, AGP 9.4.0, Gradle 9.7.1, minSdk 30, target/compileSdk 37 |
| Lokalizace | čeština + angličtina podle `navigator.language`, bez in-app přepínače |

`src/core/` je ekvivalent `:core` modulu z ostatních appek — čistá logika, nulový kontakt s DOM, testovaná bez prohlížeče.

Zákaz: jakákoli síťová komunikace za běhu, tracking, analytika, runtime npm závislosti, CDN.

### CI/CD

GitHub Actions podle `ok1cdj/kRadar`:

- **Fáze 1:** `npm ci && npm test && npm run build` → deploy `web/dist` na GitHub Pages s doménou `kqso.ok1cdj.com`
- **Fáze 2:** navíc kopie výstupu do `app/src/main/assets/web/`, `gradle assembleRelease`, podpis z keystore v secrets, na tagu `v*` GitHub Release s APK

`local.properties.example`, struktura README stejná jako u ostatních appek rodiny.

### MMD

Ve webu není k dispozici. Vzhled Mudita Mindful Design se naimituje v CSS v e-ink režimu — typografie, tloušťky rámečků, rozestupy. Nesmí to vedle ostatních appek rodiny vypadat cize.

---

## 3. Display režimy

Dva režimy, **jedna sada CSS proměnných**, přepínané atributem na kořeni:

```html
<html data-display="eink">   <!-- nebo "standard" -->
```

Všechny rozdíly musí být vyjádřené tokeny v `src/theme/`. Žádné dva stylesheety, žádné `if (isEink)` rozeseté po komponentách.

| | **eink** | **standard** |
|---|---|---|
| barvy | jen `#000` / `#fff`, jediná šedá pro předvyplněné návrhy | plná paleta, respektuje `prefers-color-scheme` |
| tmavý režim | nikdy | ano |
| rámečky | 2 px, plné | 1 px, jemné |
| zaoblení | 0 | ano |
| stíny | žádné | minimální |
| přechody | **žádné** | 100 ms na stavové změny |
| stisk klávesy | inverze čtverce | běžný active stav |
| hover | nikdy | `@media (hover: hover)` |
| ikony | obrysové, silné | běžné |

### Volba režimu

Pořadí priorit:

1. uložená volba uživatele (nastavení, persistováno)
2. `window.KQSONative?.displayMode` — APK shell nastaví `eink`
3. `@media (update: slow)` — standardní cesta k detekci e-inku, ale **nespoléhat na ni**; WebView na Kompaktu o typu displeje nejspíš neví a ohlásí `fast`
4. výchozí `standard`

Přepínač patří do nastavení jako první položka, ne zahrabaný. Někdo bude appku pouštět na e-ink čtečce, kterou nikdy neuvidíme.

---

## 4. Layout

Dva režimy podle poměru stran, ne podle zařízení.

### Portrait / úzká obrazovka

| pruh | výška |
|---|---|
| sticky hlavička | 6 % |
| vstupní řádek | 7 % |
| parse preview | 4,5 % |
| strip (tail / návrhy) | 6,5 % |
| klávesnice, 7 řad | 70 % |
| rezerva | 6 % |

### Landscape / široká obrazovka

Log vlevo, klávesnice vpravo. Na iPadu naležato je řazení pod sebou plýtvání a seznam posledních QSO je tam k něčemu.

```
┌────────────────────┬──────────────────┐
│ 22.09. 40m SSB 59  │                  │
│ ─────────────────  │                  │
│ 14:28 OK2XYZ 59/59 │   klávesnice     │
│ 14:24 DL5ABC 59/59 │                  │
│ 14:19 S57ABC 59/59 │                  │
│ ─────────────────  │                  │
│ OK1ABC 5▌          │                  │
│ [call OK1ABC]      │                  │
└────────────────────┴──────────────────┘
```

### Rozměry — nehardcodovat pixely

Kompakt má 480 fyzických px, ale při `devicePixelRatio` 1,5 je CSS viewport ~320 px. Na iPadu je všechno jinak. Přenositelnost je celý důvod, proč jdeme do webu.

```css
.keyboard {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
  max-width: 400px;     /* jinak jsou na iPadu klávesy obludné */
  margin-inline: auto;
}
```

Na Kompaktu vyjde klávesa ≈ 80 × 80 fyzických px = 9,3 × 9,3 mm. Nad ~12 mm nemá zvětšování smysl.

### Povinné CSS

```css
html { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
body { user-select: none; overscroll-behavior: none; }
```

Meta viewport s `user-scalable=no`. Bez toho dvojitý tap na klávesu zazoomuje stránku a rychlé psaní bude označovat text.

---

## 5. Klávesnice

**Systémová klávesnice se nepoužije nikdy.** Žádný `<input>`, žádný focus, žádné `contenteditable`. Raw string ve stavu aplikace, vykreslený jako `<div>` s CSS kurzorem.

Důvod: na 480 fyzických px šířky je standardních 10 sloupců ≈ 5,5 mm na klávesu. Mřížka 6 sloupců dá ≈ 9,3 mm — skoro dvojnásobek.

### Layout 6×7, 40 kláves

```
┌────┬────┬────┬────┬────┬────┐
│ A  │ B  │ C  │ D  │ E  │ F  │
├────┼────┼────┼────┼────┼────┤
│ G  │ H  │ I  │ J  │ K  │ L  │
├────┼────┼────┼────┼────┼────┤
│ M  │ N  │ O  │ P  │ Q  │ R  │
├────┼────┼────┼────┼────┼────┤
│ S  │ T  │ U  │ V  │ W  │ X  │
├────┼────┼────┼────┼────┴────┤
│ Y  │ Z  │ /  │ ⌫  │    ␣    │
├────┼────┼────┼────┼─────────┤
│ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │
├────┼────┼────┼────┼────┴────┤
│ 7  │ 8  │ 9  │ 0  │    ↵    │
└────┴────┴────┴────┴─────────┘
```

- **Abecední pořadí, ne QWERTY.** Při zalomení do 6 sloupců svalová paměť z QWERTY nefunguje a abecedu na neznámé mřížce najdeš rychleji.
- Enter vpravo dole, kam padne palec. Mezera a Enter dvojité šířky.
- Žádný long-press na alternativní znaky — na e-inku není zpětná vazba.

### Hardwarová klávesnice

Protože nepoužíváme `<input>`, stačí posluchač na `keydown` mapující znaky do stejného stavu. Povolené: `A–Z`, `0–9`, `/`, mezera, Backspace, Enter. Vše ostatní ignorovat.

Na iPadu s klávesnicí a na desktopu se pak píše normálně a mřížka slouží jen jako nápověda. Mimochodem je to i nejrychlejší způsob, jak ladit parser.

**Mřížku nikdy neschovávat** podle detekce klávesnice — je to nespolehlivé a na dotykovém iPadu bez klávesnice ji potřebuješ.

---

## 6. Koncept vstupu

Deník se ovládá **jedním vstupním řádkem**, který sám pozná, co do něj píšeš. Inspirace: FLE (Fast Log Entry) a Tučňák OK1ZIA.

Zásadní odchylka od Tučňáka: ten rozlišuje víceznačné tokeny interpunkcí (`59,` `59'` `001;` `59_1001`). Tady je **jediný povolený speciální znak lomítko**. Dvojznačnost se místo toho řeší:

1. **profilem logu** — ví se dopředu, jestli se používají pořadová čísla,
2. **pozicí tokenu** vůči volačce,
3. **uzavřenými slovníky** pro pásmo a mód.

Díky tomu je klávesnice pevných 40 kláves bez přepínání layoutu.

---

## 7. Profily

Profil se volí při založení logu a nejde ho měnit. Je to čistě data — `LogProfile`. Přidání dalšího profilu musí být jeden soubor bez zásahu do parseru.

| profil | pole navíc | `\d{1,4}` za volačkou | fáze 1 |
|---|---|---|---|
| **VKV závod** | pořadové číslo, locator | pořadové číslo | ne |
| **Aktivace** (SOTA/POTA/WWFF) | reference protistanice | přijatý report | **ano** |
| **Obecný** | jméno | přijatý report | **ano** |

**Jediné povinné pole v celé aplikaci je volačka.** Locator, reference protistanice, jméno i report jsou vždy nepovinné. Reference protistanice se zapíše, když ji dostaneš (S2S), jinak se nic neděje a nic nevaruje.

Locator se parsuje **ve všech profilech**. Profil rozhoduje jen o tom, jestli appka upozorní na jeho chybějící hodnotu — a zatím neupozorňuje nikde.

Profil VKV závod má bodování podle IARU R1 (kap. 14.1) a export EDI. Import ADIF je mimo rozsah.

---

## 8. Založení logu

Jeden log = jedna aktivace / jeden závod / jeden provozní den. Pole se předvyplní z posledního logu, kromě reference:

```
Název          SOTA OK/ZC-001
Profil         [VKV závod | Aktivace | Obecný]
Moje volačka   OK1CDJ
Můj locator    JN79US
Moje reference OK/ZC/001          ← jen profil Aktivace
Výchozí report 59 / 599 (CW)     ← podle módu, nenastavuje se
Pásmo / mód    40m  SSB           ← výchozí, dál se mění z řádku
```

Zakládá se v terénu, na kopci, v rukavicích: **jeden tap z hlavní obrazovky, tři pole k potvrzení.** Ne formulář na celou obrazovku.

Poznámka k výchozímu reportu: odvozuje se z módu — **`599` na CW, `59` jinak** (`defaultReport()` v `core/model.ts`, jedna podmínka na jednom místě, parser o ní neví). V hlavičce logu se nenastavuje; od výchozí hodnoty se liší jen konkrétní QSO: holé číslo = přijatý report, `T##` = vyslaný.

---

## 9. Gramatika vstupního řádku

Řádek se rozdělí na tokeny po mezerách, každý token se vyhodnotí **v tomto pořadí, první shoda vyhrává**:

| # | token | pravidlo | pozn. |
|---|---|---|---|
| 1 | **pásmo** | slovník `160m 80m 60m 40m 30m 20m 17m 15m 12m 10m 6m 4m 2m 70cm 23cm` | sticky |
| 2 | **mód** | slovník `cw ssb fm` | sticky |
| 3 | **čas** | `^\d{4}$` **jako první token řádku** | jinak z hodin |
| 4 | **reference** | token obsahující `/`, jehož **poslední část je 3–4 číslice** | viz 9.1 |
| 5 | **volačka** | `^([A-Z0-9]+/)?[A-Z0-9]{1,3}\d[A-Z]{1,4}(/[A-Z0-9]+)?$` | i s koncovým `/` |
| 6 | **vyslaný report** | `^T\d{2,3}$` | mění se zřídka, proto prefix `T` (`T56`) |
| 7 | **číslo** | `^\d+$` **za volačkou** (≤4 znaky mimo VKV, ≤7 ve VKV) | přijatý report (holé číslo); ve VKV `59002` = report+pořadové číslo, report dle módu (CW 3, jinak 2) |
| 8 | **locator** | `^[A-R]{2}\d{2}([A-X]{2})?$` nebo `^\d{2}[A-X]{2}$` | zkrácený doplnit |
| 9 | **jméno** | cokoli zbylého | jen profil Obecný |

### 9.1 Reference — lomítko se mění na pomlčku

Uživatel nemá pomlčku na klávesnici. Píše ji jako lomítko, parser **nahradí poslední lomítko v tokenu pomlčkou**:

```
OK/ZC/001   →  OK/ZC-001     SOTA   → ADIF SOTA_REF
OK/0001     →  OK-0001       POTA   → ADIF POTA_REF
OKFF/0001   →  OKFF-0001     WWFF   → ADIF SIG=WWFF, SIG_INFO
```

Rozlišení od portable volačky je spolehlivé: u reference je poslední část **čistě číselná a 3–4 znaky dlouhá**, u volačky písmenná nebo jednociferná.

| token | poslední část | verdikt |
|---|---|---|
| `OK1ABC/P` | `P` | volačka |
| `HB0/OK1MCS/P` | `P` | volačka |
| `OK1ABC/5` | `5` — 1 číslice | volačka |
| `OK/ZC/001` | `001` | SOTA |
| `OK/0001` | `0001` | POTA |
| `OKFF/0001` | `0001` | WWFF |

Formát reference se pozná podle tvaru, ne podle profilu. WWFF má sufix `FF` v prefixové části, SOTA tři části, POTA dvě.

### 9.2 Pasti v pořadí vyhodnocení

Pořadí pravidel není libovolné, dvě kolize jsou reálné:

- **`20M` projde regexem na volačku** (prefix `2`, číslice `0`, suffix `M`). Proto musí být pásmo na prvním místě. Žádný přidělený prefix není čistě číselný, takže uzavřený slovník vyhrává bezpečně.
- **`JN79US` projde regexem na volačku** (`JN7` + `9` + `US`). Proto se locator uznává **jen v pozici za volačkou**.

### 9.3 Sticky stav

Drží se napříč řádky do explicitní změny:

- pásmo, mód (z řádku)
- moje volačka, můj locator, moje reference (z hlavičky logu)
- výchozí report se odvozuje z aktuálního módu (CW `599`, jinak `59`), není to samostatný sticky údaj

Sticky stav se zobrazuje v horní liště — vždycky musí být vidět, do čeho logeš.

### 9.4 Příklady

```
40m ssb                   ← jednou na začátku
OK1ABC ↵ ↵                → 14:32  OK1ABC  59/59  40m SSB
OK2XYZ OK/ZC/014 ↵ ↵      → S2S, reference protistanice
DL5ABC 55 JO60UN ↵ ↵      → přijatý report 55 (holé číslo), locator
G8AHK/P PETR ↵ ↵          → profil Obecný, jméno
OK1ABC 57 ↵ W ↵           → rozepsané QSO zahozeno
D ↵                       → po potvrzení smaže poslední zapsané QSO
```

### 9.5 Příkazy

Jedno písmeno **samotné na celém řádku**, potvrzené Enterem. Pásmo a mód jsou taky holá slova, ale jsou to hodnoty, které se míchají do řádku; příkaz je akce, proto platí jen jako celý řádek — `OK1ABC W` je obyčejný vstup (v profilu Obecný jméno `W`). Samotné písmeno nemá číslici, takže nikdy není volačka. Příkaz se vyhodnotí **před** parserem (`core/command.ts`); parse preview místo štítků ukáže, co Enter udělá.

| příkaz | akce | podmínky |
|---|---|---|
| `W` | zahodí rozepsané QSO — všechna pole, čas začátku i crash journal; pásmo, mód a satelit zůstanou | bez potvrzení (jde o pár tokenů); nic rozepsaného → nic |
| `D` | smaže poslední **zapsané** QSO (přepis souboru jako při editaci, kap. 13) | potvrzovací dialog s QSO; jen když nic není rozepsané (jinak hláška „zapiš, nebo zahoď přes W"); prázdný log → hláška |

Výsledek se ukáže ve stripu do dalšího stisku klávesy. Další příkazy se přidávají stejným pravidlem: samostatné písmeno na vlastním řádku.

---

## 10. Logovací obrazovka

### Parse preview

Pod vstupním řádkem řádek inverzních štítků s rozparsovaným výsledkem. Okamžitě vidíš, jestli to appka pochopila správně, **než potvrdíš**. Nerozpoznaný token přeškrtnutě.

### Strip — dvojí využití stejného pruhu

- **Výchozí:** poslední zapsané QSO. Potvrzení bez otevírání seznamu.
- **Při ≥ 2 znacích ve vstupním řádku:** až tři široká tlačítka s návrhy volaček z historie logů, které obsahují zadaný řetězec. Tap doplní volačku.

Tohle je z Tučňáka a je to na e-inku nejcennější funkce celé appky — každý nenapsaný znak se počítá. V landscape layoutu má strip vlastní místo nad vstupním řádkem.

### Doplnění locatoru a jména

Z lokální databáze `call → (locator, name)`, budované **z vlastních předchozích logů**. Nikde se nic nestahuje. Po dokončené volačce se známý údaj předvyplní šedě, tap ho potvrdí, psaní ho přepíše.

### DUPE

Po dokončené volačce zkontroluj shodu **call + pásmo + mód** v aktuálním logu. Při shodě invertuj vstupní řádek. Nic neblokuj, jen upozorni.

**VKV závod: call + pásmo, mód se nebere v úvahu** — pravidla IARU R1: každou stanici lze na pásmu udělat jednou, opakované spojení se zapíše, ale boduje 0. Satelit: call + družice.

---

## 11. Chování Enteru a času

### Dvoufázový Enter

1. **Enter s obsahem** → řádek se rozparsuje a přiklopí k rozepsanému QSO, vstup se vyprázdní. Umožňuje doplňovat po částech: `OK1ABC ↵ JN79US ↵ PETR ↵ ↵`. Další token ve tvaru volačky, který není locator, volačku **nahradí** — oprava překlepu: `OK1ND ↵ OK1NP ↵` (ostatní pole zůstanou).
2. **Enter na prázdném řádku** → QSO se zapíše, hlavička skočí na nový čas.
3. **Enter na prázdném, když není nic rozepsaného** → ignoruj. Jinak si zbrklým ťukáním nasypeš prázdná QSO.
4. **Enter na řádku s příkazem** (`W`, `D`, kap. 9.5) → provede příkaz místo parsování.

Commit vyžaduje **jen volačku**.

### Čas

Razítko se bere při **prvním stisku klávesy po předchozím commitu**, ne až při Enteru. Je to čas začátku QSO, což odpovídá tomu, co patří do ADIF, a nezkreslí to pomalé psaní. Zobrazuje se v hlavičce. Ukládá se v UTC.

Ruční přepis: `\d{4}` jako první token řádku (pro dodatečné zapisování ze záznamu).

---

## 12. Platform bridge

Jediné rozhraní mezi aplikací a hostitelem. Dvě implementace, stejné API.

```ts
interface KQSOPlatform {
  readonly displayMode?: 'eink' | 'standard'
  listLogs(): Promise<LogMeta[]>
  createLog(meta: LogMeta): Promise<string>
  appendQso(logId: string, adifLine: string): Promise<void>   // append, nikdy přepis
  readLog(logId: string): Promise<string>
  rewriteLog(logId: string, content: string): Promise<void>   // jen editace/mazání
  deleteLog(logId: string): Promise<void>
  writeJournal(logId: string, text: string): Promise<void>
  exportLog(logId: string, filename: string): Promise<void>
  shareLog(logId: string, filename: string): Promise<void>
  keepAwake(on: boolean): void
}
```

**Web (fáze 1):** shim nad **OPFS** (`navigator.storage.getDirectory()`, zápis přes `createSyncAccessHandle` ve workeru — dává skutečný append bez přepisu celého souboru). Export jako stažení souboru, sdílení přes Web Share API s fallbackem na stažení, `keepAwake` přes Wake Lock API.

**APK (fáze 2):** `addJavascriptInterface` jako `window.KQSONative`. Logy jsou skutečné soubory v app storage.

Detekce: `window.KQSONative` existuje → nativní, jinak shim. Zbytek aplikace o rozdílu neví.

---

## 13. Úložiště

**ADIF soubor je jediný zdroj pravdy.** Jeden log = jeden `.adi`.

- Commit QSO = **append** jednoho řádku přes `platform.appendQso()`. Nikdy přepis celého souboru.
- Otevření logu = načtení a parsování do paměti. Logy jsou malé (< 1000 QSO), je to levné.
- Editace / smazání QSO = `platform.rewriteLog()`. Vzácná operace, může být pomalá.

### Crash journal

Prohlížeč i appku může systém kdykoli zabít. Každý **potvrzený token** (fáze 1 Enteru) se zapíše do `<log>.journal`. Při startu se journal zkontroluje a rozepsané QSO se nabídne k obnovení. Po commitu se journal vyprázdní.

Tohle má Tučňák jako swap file a je to jediná pojistka, kterou v terénu oceníš.

### WebKit maže data — ošetřit povinně

Safari při zapnuté ochraně proti sledování maže proaktivně: pokud na originu nebyla za posledních sedm dní používání prohlížeče žádná interakce, **všechna data vytvořená skriptem se smažou** — a maže se origin jako celek. Týká se to OPFS stejně jako IndexedDB a Cache API.

Konkrétně: odjedeš aktivaci, týden se k tomu nevrátíš, log je pryč. Bez varování. Na iOS a iPadOS to platí i pro prohlížeče třetích stran, protože běží na WebKitu.

Trojí obrana, všechno povinné:

1. **`manifest.webmanifest` s `display: standalone`** a v UI výslovná výzva „Sdílet → Přidat na plochu". Aplikace na ploše nejsou součástí Safari a mají vlastní počítadlo dnů používání, takže z mazání vypadnou. Safari neumí `beforeinstallprompt`, musí se to uživateli říct slovy.
2. **`navigator.storage.persist()`** při prvním uložení QSO, v rámci uživatelského gesta. Od Safari 17 je Storage API plně podporované a origin v perzistentním režimu je z mazání vyloučen. Stav číst přes `persisted()`.
3. **Export po každé aktivaci.** Jediná skutečná pojistka — soubor ve Files nebo v mailu Safari nesmaže. Po zavření logu nabídnout export sám od sebe.

V APK tenhle problém neexistuje, soubory jsou v app storage. Je to čistě WebKit specialita, a právě proto se na ni snadno zapomene.

### Offline

Service worker cachuje celou aplikaci při první návštěvě. Na kopci není signál a webová verze musí fungovat úplně stejně jako APK.

---

## 14. Export

| profil | formát | pole |
|---|---|---|
| Aktivace SOTA | ADIF | `SOTA_REF`, `MY_SOTA_REF` |
| Aktivace POTA | ADIF | `POTA_REF`, `MY_POTA_REF` (ADIF 3.1.4+) |
| Aktivace WWFF | ADIF | `SIG`=WWFF, `SIG_INFO`, `MY_SIG`, `MY_SIG_INFO` |
| Obecný | ADIF | `NAME`, `QTH`, `COMMENT` |
| VKV závod | EDI (REG1TEST), **jeden soubor za pásmo** + ADIF (všechna pásma v jednom) | viz 14.1 |

Vždy zapisovat: `CALL`, `QSO_DATE`, `TIME_ON`, `BAND`, `MODE`, `RST_SENT`, `RST_RCVD`, `STATION_CALLSIGN`, `MY_GRIDSQUARE`. Volitelně `GRIDSQUARE`, když je znám.

**Ověřit před implementací:** POTA v posledních letech měnila požadovaná ADIF pole (dřív `SIG`/`MY_SIG`, dnes `POTA_REF`). Zkontrolovat aktuální dokumentaci nahrávače.

### 14.1 VKV závod — bodování a EDI

**Bodování (pravidla IARU R1 pro 50/70 MHz, 145 MHz a UHF/µW, GC 2023):** 1 bod za km. Vzdálenost mezi **středy lokátorů** sférickou geometrií s převodem **111,2 km na stupeň**, oříznutá na celé km **+ 1** (stejný čtverec = 1 bod). Každá stanice jednou na pásmo; duplicita boduje 0. Násobiče (WWL) se nepoužívají — celkové skóre je součet bodů. Ověřeno na vzorovém logu specifikace REG1TEST (JO65FR → IP62OA = 1302 atd.). Kód: `core/locator.ts`, `core/contest.ts`.

**Kde je to vidět:** štítek `QRB` v parse preview, jakmile je znám lokátor protistanice (hlavička zůstává minimální). Seznam QSO: body u každého QSO (`DUPE` u opakování) a řádek za každé pásmo `QSO · body · WWL · ODX`. Ze seznamu QSO **Statistika**: za každé pásmo QSO, body, průměr bodů na QSO a top 10 spojení toho pásma podle bodů (pásma se nemíchají), u víc pásem ještě řádek celkem (`screens/stats.ts`, `contestStats()`).

**Export EDI (REG1TEST;1, vydání 1.1)** — tlačítko EDI v seznamu logů, jen VKV log (`core/edi.ts`, obrazovka `ediexport.ts`):

- jeden soubor za pásmo (`PBand` z tabulky specifikace: 6m→50 MHz, 4m→70 MHz, 2m→144 MHz, 70cm→432 MHz, 23cm→1,3 GHz, 13cm→2,3 GHz, 3cm→10 GHz); ADIF log zůstává jeden se všemi pásmy
- formulář při exportu: **závod** — název (TName, výchozí = název logu), kategorie (PSect: SO / SO-LP / MO / MO-LP / 6H), další operátoři (MOpe1, jen MO) — uloží se do hlavičky logu (`APP_KQSO_EDI_*`); **stanice** — jméno, e-mail (RHBBS), výkon (SPowe), anténa (SAnte), vysílač — pamatuje si nastavení
- povinné podle pravidel: název, kategorie, e-mail, výkon (číslo), anténa; volačka, lokátor a pásmo jsou vždy
- QSO řádek `YYMMDD;HHMM;CALL;mód;RST;číslo;RST;číslo;;WWL;body;;N;;D` — mód SSB 1, CW 2, FM 6; čísla doplněná nulami na 3; nový velký čtverec `N`; duplicita body 0 + `D`
- 7bit ASCII (diakritika se odstraní), CRLF, řádky ≤ 75 znaků; `RCall` = domovská volačka bez `/P`

---

## 15. Obrazovky

1. **Seznam logů** — název, datum, počet QSO. Tap otevře, kontextové menu nabídne sdílet / exportovat / přejmenovat / smazat. Tlačítko „Nový log".
2. **Nový log** — formulář z kapitoly 8.
3. **Logovací obrazovka** — kapitoly 4 a 10. Výchozí po otevření logu.
4. **Seznam QSO** — tabulka, tap otevře editaci jednoho QSO (klasický formulář, ne parser).
   - **Mapa** (VKV závod, Satelit; příznak profilu `map`) — tečka za každé QSO ve středu jeho lokátoru, mřížka velkých polí a čtverců, vlastní QTH. Pobřeží a hranice Natural Earth (public domain) — Evropa 1:10m, zbytek světa 1:50m — přibalené v bundlu (`web/src/db/world.json`, ~770 KB, gzip ~210 KB, skript `web/scripts/mapdata.py`), takže mapa funguje offline. Web Mercator na canvasu; tažení jen posune obraz a mapa se překreslí jednou po puštění (e-ink), zoom tlačítky − + ⤢. QSO bez lokátoru se jen spočítají. U teček značky stanic (kam se vejdou, bez překryvu); v Nastavení se dají vypnout (`mapLabels`, výchozí zapnuto). Mřížka podle velikosti čtverce 2°×1°: pod 16 px jen pole (JO), 16–30 px tečkované čtverce a popisek u tečky nese i čtverec (`DJ8MS JO54`, při vypnutých značkách jen `JO54`), od 30 px číslice v každém čtverci, od 60 px plné `JO70`.
   - **Statistika** (VKV závod) — kap. 14.1.
5. **Nastavení** — display režim jako první položka, jazyk, stav perzistence úložiště.
6. **⓪ About** — verze, licence, odkaz na repo, callsign autora.

---

## 16. Chování na e-inku

Platí v režimu `eink`, nikoli ve `standard`:

- Žádné animace, žádné CSS transitions, žádné stíny.
- Žádná gesta — jen tap. Bez swipe, bez pinch, bez long-press v hlavním toku.
- Čistá černobílá, bez šedých výplní kromě předvyplněných návrhů. Kontrastní rámečky místo barevného odlišení.
- `prefers-color-scheme` ignorovat, vždy světlé téma.
- Překreslovat co nejmenší plochu — stisk klávesy mění jen tu klávesu.
- `keepAwake(true)` po celou dobu, co je otevřený log. (Platí v obou režimech.)

---

## 17. Testy (`src/core/`, vitest, bez prohlížeče)

Parser je jádro celé appky, musí mít pokrytí:

- Každé pravidlo z kapitoly 9 zvlášť.
- **Kolize:** `20M` jako pásmo vs. volačka, `JN79US` jako locator vs. volačka, `2M` vs. volačka.
- **Reference:** všechny tři formáty, převod lomítka, odlišení od `/P`, `/5`, `HB0/OK1MCS/P`.
- **Pozicionalita:** číslo před volačkou ≠ číslo za volačkou.
- Sticky stav napříč řádky.
- Dvoufázový Enter včetně ignorování prázdného commitu a commitu s pouhou volačkou.
- ADIF writer proti referenčnímu výstupu.
- Roundtrip: parse → ADIF → parse.

---

## 18. Otevřené body

- ~~Antialiasing textu na e-inku~~ — ověřeno na Kompaktu 2026-09-25, text je v pořádku. Ověřená verze WebView na Kompaktu: **146.0.7680.178**.
- Extrakce shellu do samostatného `kShell` — rozhodnout až ve fázi 2.
- Detekce formátu reference u exotických případů (GMA, HEMA) — zatím neřešit.

---

## 19. Mimo rozsah — evidované nápady

Nic z toho se ve fázi 1 ani 2 nedělá. U každého je uvedeno, co si tím **teď nezavřít**, aby pozdější doplnění nebylo přepis.

### 19.1 Satelitní QSO

Profil nebo příznak pro spojení přes satelit. V ADIF to znamená `PROP_MODE=SAT`, `SAT_NAME`, `SAT_MODE`, a hlavně **oddělené TX a RX pásmo** (`BAND` + `BAND_RX`).

**Nezavřít si:** datový model má dnes jedno pásmo a jeden mód jako holý řetězec. Udělej z nich malou strukturu s volitelnou RX variantou už teď — stojí to nic a jinak to znamená sáhnout do parseru, ADIF writeru i UI najednou.

**Gramatika:** název satelitu obsahuje pomlčku (`RS-44`, `SO-50`), takže stejná náhrada lomítkem jako u referencí — `RS/44`. Nekoliduje, protože reference vyžaduje 3–4 číslice v poslední části, satelit má dvě. `ISS` pomlčku nemá vůbec. Rozlišení od volačky zajistí uzavřený slovník aktivních satelitů.

Locator se u satelitních spojení vyměňuje běžně a ten už parser umí.

### 19.2 Synchronizace s Wavelog — plánováno do fáze 3

Push odjetého logu do vlastní Wavelog instance. **Není to nápad, je to plánovaná funkce fáze 3.** Ověřeno PoC proti živé instanci 2026-09-24 (API v2).

**Porušuje pravidlo „žádná síťová komunikace za běhu"**, takže musí být výslovná, uživatelem nakonfigurovaná a ručně spuštěná — stejný model jako `X-API-Key` u kZivyobraz. Nikdy automaticky, nikdy na pozadí, nikdy živě během provozu. Tlačítko u logu v seznamu logů, vedle exportu.

#### Které logy

Jen **Obecný, Satelit a VKV závod**. **Aktivace (SOTA/POTA/WWFF) se do Wavelogu neposílají** — ty se odesílají jinou cestou (mail, upload na server programu). U aktivačního logu tlačítko není.

Důvod navíc: Wavelog při importu bere údaje o vlastní stanici ze station profilu, ne z ADIF — `STATION_CALLSIGN` a `MY_GRIDSQUARE` přepíše hodnotami profilu a `MY_*_REF` zahodí, když je profil nemá. U aktivace, kde se vlastní reference mění s každou výpravou, by se ztratila.

#### API v2 (Wavelog ≥ 3.1.0)

```
POST https://<wavelog>/index.php/api/v2/qso
Authorization: Bearer wl2_…
Content-Type: application/json

{
  "import_type": "adif",
  "station_profile_id": 1,
  "adif": "<CALL:6>OK1ABC<BAND:3>40m...<EOR>"
}
```

Odpověď: `{"data": {"parsed": 4, "imported": 3, "skipped": 1, "messages": []}}`, HTTP 201.

- **Token** `wl2_…` se zakládá v uživatelském nastavení Wavelogu (sekce API). Potřebné scopes: `qso:write` a `station:read`. Starší v1 klíče (`wl…`) v2 nepřijímá.
- **Station profil** se vybírá v nastavení ze seznamu `GET /api/v2/station` (id, název, značka), ne opisováním čísla z URL.
- **Dupe kontrola probíhá na straně Wavelogu**: duplicity se nevrací jako chyba, ale počítají se do `skipped`. Opakované odeslání celého logu je bezpečné — není potřeba sledovat, co už bylo odesláno. Ověřeno: druhé odeslání → `imported: 0, skipped: 4`.
- **`"dryrun": true`** projde import bez zápisu (vrací jen `parsed`) — vhodné pro tlačítko „Otestovat spojení" v nastavení.
- **`GET /api/v2/status`** je veřejný (bez tokenu) — odliší „server nedostupný" od „špatný token" (401 `invalid_token` / `token_expired`, 403 `insufficient_scope`).
- Převzetí polí ověřeno: `BAND_RX`, `PROP_MODE`, `SAT_NAME`, `SAT_MODE`, `GRIDSQUARE`, `RST_*`, `SRX_STRING`/`STX_STRING`, `SOTA_REF`.

Konfigurace patří do nastavení aplikace, ne do jednotlivého logu: URL, token, station profil. Token se ukládá lokálně jako všechno ostatní; v UI ho po uložení nezobrazovat celý.

#### CORS

API v2 posílá `Access-Control-Allow-Origin: *` a odpovídá na preflight `OPTIONS` (204) — **na serveru se nic nastavovat nemusí**. Ověřeno pro obě origin: `https://ok1cdj.github.io` (PWA) i `https://appassets.androidplatform.net` (WebView v APK), včetně skutečného `fetch` ze stránky.

#### Mixed content

Instance na `http://` bude z HTTPS stránky zablokovaná bez ohledu na CORS. Funkce vyžaduje Wavelog za certifikátem. Uvést v nastavení u pole s URL.

#### Chybové stavy

Na kopci není signál a push selže. Nesmí to nic zahodit ani zablokovat — log zůstává lokálně jako doposud, push se dá spustit znovu kdykoli. Zobraz stav odeslání u logu v seznamu (např. „Wavelog: 12 nových, 3 duplicity · 24.09. 14:05"), ale neopakuj automaticky.

### 19.3 Databáze značek a lokátorů

Externí databáze dvojic call ↔ locator, obdoba `C_W` v Tučňáku. Dnes se návrhy berou jen z vlastních logů, což na první aktivaci nedá nic.

**Nezavřít si:** vyhledávání návrhů schovej za malé rozhraní (`SuggestionSource`) místo přímého dotazu do vlastních logů. Pak je přidání druhého zdroje jedna implementace navíc, ne zásah do UI.

**K rozhodnutí později:** odkud data a jak velká. Musí to jít celé offline, takže statický datový soubor verzovaný s bundlem, ne dotaz na server. Pozor na velikost — service worker to cachuje celé a na kopci nemáš, jak to dostáhnout.
