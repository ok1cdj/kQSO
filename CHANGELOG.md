# Changelog

What changed in each kQSO release: the web app (kqso.ok1cdj.com) and the Android APK share one version. Newest first.

## [Unreleased]

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
