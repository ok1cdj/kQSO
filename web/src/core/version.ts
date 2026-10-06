// Version strings: "1.6.4", "1.6", or a release tag "v1.6.4". Compared numerically
// part by part (1.6.10 > 1.6.9; 1.6 = 1.6.0).

/** "v1.6.4" → "1.6.4"; anything that is not a version → undefined. */
export function parseVersion(s: string): string | undefined {
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(s.trim())
  return m?.[1]
}

/** < 0 when a is older than b, 0 when equal, > 0 when newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** APK new-version notice: the release to announce, unless not newer or hidden by the user. */
export function announceUpdate(installed: string, latest: string | null, dismissed: string | null): string | undefined {
  if (!latest || compareVersions(latest, installed) <= 0 || latest === dismissed) return undefined
  return latest
}

/** Installers that update the app themselves: Play, F-Droid, Droid-ify, Neo Store. */
const STORES: ReadonlySet<string> = new Set(['com.android.vending', 'org.fdroid.fdroid', 'com.looker.droidify', 'com.machiav3lli.fdroid'])

/** Whether the APK should look for a new version on GitHub: only one installed from
 *  GitHub (sideloaded). A store updates it itself, and Play forbids pointing elsewhere.
 *  `nativeVersion` undefined = the web app (never). */
export function checksGitHub(nativeVersion: string | undefined, installSource: string | undefined): boolean {
  return nativeVersion !== undefined && !STORES.has(installSource ?? '')
}
