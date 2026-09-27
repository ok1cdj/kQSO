// Monospace rows aligned in columns (web only — tablets, phones): pad every column to
// its widest value; columns empty in every row drop out. The caller renders the rows
// with white-space: pre and falls back to its compact text when a row doesn't fit.

export function alignColumns(rows: readonly (readonly string[])[], rightAlignLast = false): string[] {
  const n = rows[0]?.length ?? 0
  const widths = Array.from({ length: n }, (_, c) => Math.max(...rows.map((r) => r[c]!.length)))
  const last = n - 1
  return rows.map((r) =>
    r
      .map((cell, c) => (rightAlignLast && c === last ? cell.padStart(widths[c]!) : cell.padEnd(widths[c]!)))
      .filter((_, c) => widths[c]! > 0)
      .join('  ')
      .trimEnd(),
  )
}

/** True when none of the elements overflows its box (i.e. every row is on one line). */
export function allFit(els: Iterable<HTMLElement>): boolean {
  for (const e of els) if (e.scrollWidth > e.clientWidth) return false
  return true
}
