// GMA-only summit associations (gma.rocks). A GMA summit that is not a SOTA summit
// has its own association prefix (Czechia: SOTA OK/LI-001, GMA OL/LI-001), so a
// three-part reference is GMA when its association is on this list, else SOTA.
// Source: maps.gma.rocks load_gma_regions.php minus the SOTA associations
// (summitslist.csv), 2026-09-30. A GMA association added later falls back to SOTA.

const GMA_ASSOCIATIONS: ReadonlySet<string> = new Set(
  (
    '4L 6K 9A0 AX C3M CE9 CQ CS DA DB E7M EC EC6 EC8 ERM ESM FA FC HB9 HBL HG HK ' +
    'IT JWM K1 K4C K4T K5N K5T K6 K7M K7O LB LYM LZM M MI MM MW OE0 OF0 OL OM0 OP ' +
    'OV PB PJM R2 R4 R5 R6 S50 SA SO SX TC US V5M VA VA2 VA6 VA7 W XCT XE7 XEA1 ' +
    'XEA2 XEA4 XEA5 XEI XG XGM XGW XHA XHL XI XJA XJA5 XJA6 XJA8 XKLA XKLF XKLS ' +
    'XKP4 XLA XLX XLZ XOE XON XPY1 XSM XSP XSV XTF XUT XVE1 XVE2 XVE6 XVE7 XVK3 ' +
    'XVK4 XVK6 XW0C XW1 XW3 XW4C XW4K XW4V XW5A XW5N XW5T XW6 XW7A XW7I XW7M XW7N ' +
    'XW7O XW7W XW7Y XW8V XYO XYU XZ3 XZL1 XZL3 XZS YLM YP YT Z3M ZM1 ZM3 ZT'
  ).split(' '),
)

/** True when a summit association prefix (OL, OM0, DA…) is GMA-only, not SOTA. */
export function isGmaAssociation(prefix: string): boolean {
  return GMA_ASSOCIATIONS.has(prefix)
}
