# Changelog

What changed in each kQSO release: the web app (kqso.ok1cdj.com), the Android app and the iOS app share one version. Newest first.

## [1.13.1] – 2026-10-24

### Fixed
- **Android Back on What's new** right after an update closed the app; it now closes the notes, like the screen's "‹".
- **The VHF contest board** came up on a phone held upright when the system keyboard slid up (seen on the Mudita Kompakt); it now needs the device turned to landscape and enough width.

## [1.13] – 2026-10-24

### Added
- **VHF contest board**: in landscape with the system keyboard or none, the room the kQSO keyboard leaves shows the next serial in big digits (what goes to the other station), the UTC clock, the band's QSO count, rate per 60 / 10 min, points, average and ODX. VHF contest logs only.
- **New VHF callsign database** from the public EDI logs of the ČRK VHF contests (last 2 years, 2 898 logs, 3 055 calls), with the bands each station is QRV on. A call + locator counts once enough logs have it (144 MHz 5, 432 MHz 3, higher 2) or from the station's own log, which drops the typos.
- **QRV bands**: in a VHF contest the other bands the station is QRV on show after the call, short (`2 70 23 13 … 24G 47G 76G`), without the current one; bands already worked in this log are struck out. Your own QSOs add their band to your callsign database.
- **Going up the bands**: a station already in this log gets its locator filled in straight away on another band (VHF contest only; a corrected call drops it again).
- **Hardware keyboard shortcuts** on the logging screen: Ctrl+Enter saves the QSO when it has all it needs; Alt+W / D / H / E as the line commands (Alt+D keeps the line being typed); Alt+X takes the offered locator; Alt+M cycles CW → SSB → FM; Alt+L the QSO list, Alt+Q back; F5 F6 F7 F8 F11 F12 the macros CQ EX TU ? MY INFO (F5–F8 the radio's voice memories in SSB / FM); PgUp / PgDn the CW speed ±2; Alt+R / S / C / K RUN, S&P, connect the keyer, CW keyboard; Ctrl+M ESM on / off. A shortcut with nothing to do leaves the key to the browser.
- **E ⏎** edits the last saved QSO.

### Changed
- ESM on / off is now **ESM ⏎** or Ctrl+M (E is the edit).

### Fixed
- The DUPE warning and the QRV bands use a band typed on the same line (`2G OK1EM` checks 13 cm).

## [1.12] – 2026-10-21

### Added
- **Keyboard for logging** (Settings): kQSO's own, the system one, or none. System = the phone's keyboard (Gboard, iOS), opened by a tap on the input line; the input stays at the top and the recent QSOs fill the rest below it. None = a hardware keyboard only: the recent QSOs take the on-screen keyboard's place above the input, in portrait too. In landscape the log takes the whole width.

## [1.11] – 2026-10-20

### Added
- **VHF contest categories and ČRK EDI files**: the contest is IARU R1 (every ČRK contest: subregionals, Polní den, A1, 50 MHz, September, October), VKV PA or FM pohár, prefilled from the date in New log, together with a 6-hour entry. SO / MO / CHECK is chosen at the EDI export (operators for MO). PSect per band: on 145 / 435 MHz `SO-LP` / `MO-LP` when the power is at most 100 W (QRP is sorted by the evaluator from SPowe), `6H SO` / `6H MO` for a 6-hour entry, plain `6H` on 50 / 70 MHz, `SO` / `MO` on the other bands, `CHECK` everywhere. PBand as the ČRK rules name the bands. Files named by the ČRK table: `01OK1XXX.edi`, 61–64 for 6 hours.
- **6-hour window**: per band, the logging header shows the time left (in brackets during a break of 2 h or more), with a notice when part 2 starts and when the 6 hours are up.
- **VKV PA and FM pohár**: scoring by large-square rings (own square 2, the next ring 3, …), VKV PA × the large squares worked incl. the own one; the QSO list, statistics, EDI and the logging preview follow. VKV PA links to its robot; FM pohár shows a summary per band to copy into its web form (145 / 433 MHz, QRP / QRO by the power). Picking FM pohár in New log switches the mode to FM.
- **Contest statistics**: per UTC hour (QSOs, points, running total, the 6-hour window) and per large square (stations, distance and azimuth; tap for the calls).
- **Band filter**: a multi-band log shows one band at a time in the QSO list and the map (All | 2m | 70cm …), first the band of the last QSO; the choice is kept per log and shared by both. The VHF contest logging screen lists only the current band's recent QSOs.

### Changed
- **Settings**: display, map and Wavelog stay open; the callsign database, offline references, radio CI-V and the M5 keyer fold into one row each with a state line. "How to log" moved to About.

### Fixed
- Hidden segmented rows (radio source / link on the web) are now really hidden.

## [1.10.1] – 2026-10-20

### Changed
- **System Back goes back in the app**: Android's Back button and gesture (also the Mudita Kompakt's key), the browser's Back and, on iPhone / iPad, a swipe from the left edge do what the screen's own "‹" does. Only on the log list does Back leave (it closes the Android app). Before, Back closed the Android app from any screen, even while logging.

## [1.10] – 2026-10-19

### Added
- **My locator from the position**: the locate button (crosshair) next to *My locator* in New Log fills the 6-character locator from the device position (web, Android, iOS). Asked only on the tap; an approximate fix (over 2 km) is flagged to check. The position isn't stored — only the locator, as before.
- **Nearest references, offline**: after the locate button in an Activation log, New Log lists the nearest SOTA, POTA, WWFF, GMA and TOTA references (25 km, three of each); a tap adds one to *My reference*. The data comes by locator field (`JO`, ~1000 km) from kqso.ok1cdj.com/refs/ and stays in the device — the field around you downloads by itself when online, more in Settings → *Offline references*. Android keeps the tiles out of Auto Backup, iOS out of iCloud backup and the Files app.
- **Several references in one activation**: *My reference* in New Log takes a summit, POTA parks (n-fer), a WWFF area and a tower at once, separated by spaces; one summit, WWFF area or tower per log. Export of such a log offers the whole ADIF and one file per reference, for each program's upload, named as the program asks (WWFF `CALL@OKFF-0123 20261019.adi`, POTA `CALL@CZ-0123-20261019.adi`). QSOs carry `MY_SOTA_REF`, `MY_POTA_REF` (parks comma-separated), the new `MY_WWFF_REF`, and `MY_SIG` / `MY_SIG_INFO` with GMA or TOTA (else WWFF, as before). `{MYREF}` in the macros sends them all. Logs with one reference read as before. A GMA summit with a tower on it shares one `MY_SIG`, so such QSOs also keep all references in `APP_KQSO_MYREF`.

### Fixed
- GMA's own regions inside SOTA associations (HuMPs `G/HCE`, `GM/HCS`, `EI/HIE` …, Faroes `OY/EY` …) and `UNM-001` are taken as GMA, no longer as SOTA / POTA.

## [1.9] – 2026-10-12

### Added
- **Any Icom through the M5-ESP32-keyer (beta)**: the keyer's CI-V tunnel (firmware 2.1.0+, `CIVTX` / `CIVRX`) drives a radio on its CI-V bus the same way as the IC-705 over Bluetooth — band, mode and `FREQ` from the radio, a typed band / mode / `F…` tunes it. Works wherever the keyer works: Android and iOS app, Chrome / Edge. Settings → Radio (was IC-705) → *Via the keyer*; on the apps also *IC-705 Bluetooth*. Tested with the IC-706MkII and IC-910.
- **Radio definitions** (`core/rigmodel.ts`): bands, tuning range and CI-V functions per model — IC-705, IC-706 / MkII / MkIIG, IC-910 (optional 23 cm unit), IC-9700, IC-7300, IC-7610, IC-7100. The model goes by the CI-V address the keyer found, or is chosen in Settings (a radio with a changed address); an unknown address gets a generic radio.
- CW through the radio's own keyer (CI-V 17) and voice memories T1–T4 on the radios that have them (IC-7300, 9700, 7610; CW also IC-7100); older radios are keyed by the keyer's wire. Band stacking register per model.
- A band the radio doesn't work — by its definition, or because it refuses the frequency — isn't tuned: only the log switches and QSOs are logged on it, the radio stays connected (header `–`) and isn't keyed — neither CW / voice through CI-V nor the keyer's wire.
- 23 cm spots (1296.050 CW, 1296.200 SSB, 1297.500 FM) when a radio has no band stack there.
- A link to the keyer's build guide (keyer.ok1cdj.com/build.html: parts, schematics, flasher; EN / CS) in Settings → M5 keyer and in the help.
- VHF contest: a full locator heard before the call (`JO70VA` ⏎) is taken as the locator — QRB and azimuth at once, and the strip offers the calls the callsign database knows at that locator; the call completes the QSO later. Before, it was taken as a callsign.

### Changed
- The logging header shows the radio's model (`705`, `7300`, `9700`, `706`, `CIV`), and the radio texts say "radio" instead of "IC-705".
- Transverter bands follow the radio (4 m and up that it doesn't work); rows of other bands stay stored.
- Settings: the M5 keyer is connected in one place, its own section, for CW and the radio alike.
- Release: a `v*` tag also uploads the app to Google Play.

## [1.8.2] – 2026-10-07

### Added
- **iOS app (iPhone, iPad)**: the same kQSO as on Android — logs as ADIF files (also in the Files app), export and share through the share sheet, the CW keyer and the Icom IC-705 over Bluetooth. Distributed through TestFlight / the App Store.

### Changed
- Settings: "app" instead of "APK" for the storage and the version.
- APK: only Google Play counts as a store that updates the app (the GitHub new-version check stays off for it); F-Droid clients are no longer singled out.
- Store descriptions in `fastlane/metadata/android` match the Google Play listing (HTML formatting, which Play accepts).
- ADIF: a QSO in a log without your own locator no longer gets an empty `MY_GRIDSQUARE` field.

## [1.8.1] – 2026-10-06

### Changed
- APK: the new-version notice (GitHub) only shows when the app was installed from GitHub; installed from Google Play or an F-Droid repository, the store updates it and kQSO doesn't check.
- README: demo GIFs of logging (SOTA activation on a phone, VHF contest on a tablet).
- Repository: `LICENSE` (GPL-3.0), store descriptions and screenshots in `fastlane/metadata/android`, privacy policy at kqso.ok1cdj.com/privacy.html.

## [1.8] – 2026-10-06

### Added
- **Icom IC-705 over Bluetooth LE (beta, APK)**: Settings → IC-705 (off by default) connects the radio. The logging header shows `705` (✕ = not connected, tap to connect). Band and mode follow the radio, QSOs get the exact frequency (ADIF `FREQ`, pushed to Wavelog too), and a typed band / mode (`40m`, `cw`) tunes the radio — a band to the radio's last frequency there (its band stacking register), the mode stays; `F28300` tunes to 28.300 MHz. A band the IC-705 doesn't work (23 cm and up, 4 m — e.g. a multi-band VHF contest) switches only the log and leaves the radio (and its CW / voice keying) alone; header `705 –`. Transverters: Settings → IC-705 → XVERT, per band the RF and IF frequency (3 cm 10368.000 = 145.000) — that band tunes the radio to the IF and logs the RF frequency (header `705 XV`, `F10368100` works too). In CW the macros, `K`, ESM and STOP send through the radio's own keyer (CI-V) — no need to switch CW keying on, that one is for the M5 keyer; speed, ESM and macros from its Settings apply; the radio must be in CW, else kQSO says so and sends nothing; without break-in only the sidetone sounds (practice). If the link drops while sending, the radio still finishes the part it has (up to 30 characters). In SSB / FM the strip offers T1–T4: the radio's voice TX memories (record e.g. a CQ on the radio), STOP or Esc stops them. Satellite logs are not affected (the bird sets band and frequency).

### Changed
- A new log needs your callsign (every profile): it is the station callsign in the ADIF and `{MYCALL}` in the CW macros, which went out without it.
- CW macro strip: the general profile's free-text button is `INF` (was `INFO`), so the strip fits a phone while STOP is shown.

## [1.7] – 2026-10-06

### Added
- **CW keyer over Bluetooth (beta)** (APK and web in Chrome / Edge; tested with the M5-ESP32-keyer v2, please report bugs on [GitHub Issues](https://github.com/ok1cdj/kQSO/issues)): Settings → CW keying (off by default) connects the M5-ESP32-keyer. In CW the strip offers the macros CQ EX TU MY REF/LOC/INFO (my reference, my locator, or free text in the general profile) ? when there is nothing to suggest, STOP is first while sending (Esc stops too). The header shows RUN or S&P with the speed, or ✕ when the keyer is not connected — tap it, or `C` on the line, to connect again. Macros per log profile × RUN / S&P, editable in Settings, with variables incl. `{HI}` (GM / GA / GE by local time). Default speed in Settings; `S20` on the line = 20 WPM until disconnect; `R` / `S` switch RUN / S&P. ESM (as in N1MM, off by default, `E` or Settings switches it, header RUN·ESM): Enter sends the macros — RUN: CQ, EXCH on the call, TU on the save; S&P: my call, EXCH on the save; a VHF contest QSO missing the number / locator asks NR ? / LOC ?. Free text: `K PSE QRS` sends it once; `K` alone = CW keyboard mode (each typed word goes out on Space; an empty Enter or END leaves it).
- Narrow phones: the logging header shows only ‹ for Logs, and the VHF contest serial without the TX label, so the header fits.
- Satellite QSOs carry the uplink / downlink frequencies (ADIF `FREQ` / `FREQ_RX`, the transponder centre or the FM channel), so Wavelog and other logbooks get them on import. Older satellite QSOs get them filled in (from SAT_NAME + SAT_MODE) when the log is exported or pushed.
- "What's new" after an update: the new version's highlights once on start (not after a fresh install), any time from Settings → About.
- APK: a new version on GitHub shows a quiet line on the log list (Download / Hide), checked at most once a day; Settings → Check for updates turns it off. Links out of the app open in the browser.
- `H` on the logging line opens the help.
- Theme switch: Settings → Display → System / Light / Dark (standard mode; e-ink stays black on white). The APK now has the dark theme too, and System follows the phone.

### Fixed
- Reopening a log continues on the band and mode of its last QSO, not the log's default.
- VHF contest: a received number typed short (23) is saved as 023, like the numbers we send.
- APK: settings that are off by default (rain radar on the VHF map) behaved as on until switched once.
- Web: two storage operations on the same file at once (e.g. two screens reading the settings) could fail, and two quick setting changes could overwrite each other; storage now runs them one after another.

## [1.6.3] – 2026-10-02

### Fixed
- VHF contest: a QSO could be saved without the received number. It now needs the number as well as the locator; until then an empty Enter keeps the QSO open (the preview shows NR —).

## [1.6.2] – 2026-10-02

### Fixed
- Rain radar: the map and the Settings switch now read the setting the same way. Before, Settings could show radar **Yes** while the map did not start it (seen in the APK); switching No → Yes worked around it.
- Map: the zoom − / + and fit buttons are drawn as icons in equal squares; the fit glyph (⤢) came from a fallback font and sat off-centre.

## [1.6.1] – 2026-10-02

### Changed
- New log: picking **VHF contest** sets the band to 2m and the mode to SSB (still changeable).

### Fixed
- APK on Android 15+ (edge-to-edge): the header sat under the status bar and its buttons could not be tapped; the app now keeps clear of the status/navigation bars, the display cutout and the soft keyboard. The Kompakt is unaffected.
- New log: the Activation tile's sub-line (SOTA/GMA/POTA/WWFF/TOTA) wraps instead of running into the next tile.

## [1.6] – 2026-10-01

### Added
- **Rain radar on the VHF-contest map** (rain scatter, 3 cm): Settings → rain radar (off by default). The current RainViewer frame is drawn under the map and refreshed in the background while the map is open; 5 levels from dBZ, greys on e-ink (as kRadar), colours elsewhere. "Weather data by RainViewer" with the frame time is shown on the map.
- **Tap on the map**: the locator there, its QRB and azimuth from your QTH (e.g. `JO61SF · 141 km · 333°`).
- **Azimuth in the VHF contest header**: as soon as the locator is typed (or the callsign database knows it, shown grey) the header shows where to point the antenna, e.g. `146°`.

### Fixed
- Keyboard: Space, Backspace and Enter are drawn as icons instead of the ␣ ⌫ ↵ characters, which some browsers (Tesla) lack and showed as empty boxes.

## [1.5] – 2026-09-30

### Added
- **TOTA lookout towers** (rozhledny.eu): `OKR/1001` is recognized as a tower and written as `MY_SIG=TOTA` + `MY_SIG_INFO=OKR-1001`; tower-to-tower QSOs also get `SIG`/`SIG_INFO`.
- **GMA-only summits** (gma.rocks): a summit with a GMA association (`OL/LI/001`, `OM0/…`, `OE0/…`, `DA/…`) is written as `MY_SIG=GMA` + `MY_SIG_INFO=OL/LI-001` instead of a SOTA reference. SOTA summits (`OK/LI/001`) stay SOTA; GMA accepts them too.

### Fixed
- POTA references with 5 digits (`US/10000`) are accepted.
- Help and README use the current POTA prefixes (`CZ/0001` instead of `OK/0001`).

## [1.4] – 2026-09-29

### Added
- **Microwave bands up to 76 GHz**: 9cm, 6cm, 1.25cm, 6mm and 4mm next to 23cm, 13cm and 3cm (ADIF band names, EDI `PBand` 3,4…76 GHz).
- Microwaves can be typed in GHz: `1G 2G 3G 5G 10G 24G 47G 76G`. `24G` gives `1.25cm`, which the keyboard could not type (it has no dot).
- **EDI equipment per band**: power, antenna, antenna height, TX and RX are kept for each band and prefilled at the next contest.

### Changed
- QSO list and the recent-QSO column on the web: aligned columns when the rows fit.
- README: screenshots (Kompakt, Android, iPad), icon, Buy Me a Coffee link.

## [1.3] – 2026-09-27

### Added
- **QSO map** for VHF-contest and satellite logs: a dot per worked locator with the call, the Maidenhead grid and your QTH over bundled coastlines and borders (1:10m Europe, 1:50m world); works offline. On the Kompakt the worked squares are shown when squares are small.
- **Contest statistics** per band: points, average per QSO and the top 10 QSOs.
- Setting to hide the station calls on the map.

### Fixed
- A new callsign typed on the same line replaces the earlier one, so a typo can be fixed by simply typing the call again.

## [1.2] – 2026-09-25

### Added
- **VHF contest scoring** (IARU R1, 1 point per km) with QRB in the preview, and **EDI (REG1TEST) export**, one file per band.
- Line commands: `W` discards the unfinished QSO, `D` deletes the last saved one.
- Anonymous usage statistics on the web (self-hosted Umami, no log content, can be switched off in Settings; never in the APK).

### Changed
- The web app moved to the root of **kqso.ok1cdj.com**; the old GitHub Pages address redirects there.

### Fixed
- The service worker also registers when the page has already finished loading.

## [1.1] – 2026-09-25

First release as **kQSO** (earlier builds were test versions only).

### Added
- One smart input line with its own 6×7 alphabetical keyboard and a parse preview.
- Log profiles: **Activation** (SOTA / POTA / WWFF), **General**, **VHF contest** (serials, 6-character locator) and **Satellite** (one log per pass; the satellite sets uplink/downlink band and `SAT_NAME`/`SAT_MODE`).
- **Callsign database**: suggestions and locator prefill from bundled sets (VHF contest, chasers, satellites) plus your own worked stations; import/export.
- DUPE warning, recent-QSO column on wide screens (tap to edit), QSO editing.
- ADIF export per log; **Wavelog push** (API v2) for General, Satellite and VHF logs.
- Storage that survives: every QSO is written at once, an unfinished QSO is kept in a crash journal. Web: OPFS (offline PWA); APK: files in app storage.
- **Android APK** (WebView shell), signed, from GitHub Releases.
- E-ink and standard display modes, EN / CS interface, help screen.

[Unreleased]: https://github.com/ok1cdj/kQSO/compare/v1.6.3...HEAD
[1.6.3]: https://github.com/ok1cdj/kQSO/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/ok1cdj/kQSO/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/ok1cdj/kQSO/compare/v1.6...v1.6.1
[1.6]: https://github.com/ok1cdj/kQSO/compare/v1.5...v1.6
[1.5]: https://github.com/ok1cdj/kQSO/compare/v1.4...v1.5
[1.4]: https://github.com/ok1cdj/kQSO/compare/v1.3...v1.4
[1.3]: https://github.com/ok1cdj/kQSO/compare/v1.2...v1.3
[1.2]: https://github.com/ok1cdj/kQSO/compare/v1.1...v1.2
[1.1]: https://github.com/ok1cdj/kQSO/releases/tag/v1.1
