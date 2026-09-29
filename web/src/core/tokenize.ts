// Split an input line into tokens at whitespace.
// Uppercased because the on-screen keyboard is uppercase-only and the
// grammar regexes assume uppercase.

export function tokenize(line: string): string[] {
  return line
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}
