// Minimal pure UTF-8 helpers. ADIF field lengths are BYTE counts, so the writer
// and reader must agree on UTF-8 byte boundaries even for non-ASCII NAME/QTH.
// Implemented by hand to keep core dependency-free and DOM-free.

export function utf8Encode(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return out
}

export function utf8Decode(bytes: readonly number[]): string {
  let s = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i++]!
    let cp: number
    if (b0 < 0x80) cp = b0
    else if ((b0 & 0xe0) === 0xc0) cp = ((b0 & 0x1f) << 6) | (bytes[i++]! & 0x3f)
    else if ((b0 & 0xf0) === 0xe0)
      cp = ((b0 & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f)
    else
      cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i++]! & 0x3f) << 12) |
        ((bytes[i++]! & 0x3f) << 6) |
        (bytes[i++]! & 0x3f)
    s += String.fromCodePoint(cp)
  }
  return s
}

/** UTF-8 byte length of a string (the value that goes in an ADIF `<name:LEN>` tag). */
export function byteLength(s: string): number {
  return utf8Encode(s).length
}
