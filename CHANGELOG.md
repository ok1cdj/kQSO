# Changelog

What changed in each kQSO release: the web app (kqso.ok1cdj.com) and the Android APK share one version. Newest first.

## [Unreleased]

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

[Unreleased]: https://github.com/ok1cdj/kQSO/compare/v1.5...HEAD
[1.5]: https://github.com/ok1cdj/kQSO/compare/v1.4...v1.5
[1.4]: https://github.com/ok1cdj/kQSO/compare/v1.3...v1.4
[1.3]: https://github.com/ok1cdj/kQSO/compare/v1.2...v1.3
[1.2]: https://github.com/ok1cdj/kQSO/compare/v1.1...v1.2
[1.1]: https://github.com/ok1cdj/kQSO/releases/tag/v1.1
