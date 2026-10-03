// "What's new" glue: remember the version seen, pick the notes' language.
// The notes and the pure rules are core/whatsnew.ts.

import { notesSince, seenBaseline } from '../core/index'
import type { WhatsNewEntry } from '../core/index'
import type { KQSOPlatform } from '../platform/index'
import { lang } from './i18n'

export const BUY_ME_A_COFFEE = 'https://www.buymeacoffee.com/ok1cdj'

const SEEN = 'whatsNewSeen' // the last version whose notes were shown

export function entryText(e: WhatsNewEntry): readonly string[] {
  return lang === 'cs' ? e.cs : e.en
}

/** At start: the notes to show now (maybe none), and remember the version as seen. */
export async function takeUnseenNotes(platform: KQSOPlatform, current: string): Promise<WhatsNewEntry[]> {
  const saved = await platform.getSetting(SEEN)
  if (saved === current) return []
  const seen = seenBaseline(saved, (await platform.listLogs()).length > 0, current)
  await platform.setSetting(SEEN, current)
  return notesSince(seen, current)
}
