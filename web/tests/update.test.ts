import { describe, it, expect } from 'vitest'
import { checksGitHub } from '../src/core/version'

describe('checksGitHub', () => {
  it('only a sideloaded APK (GitHub) checks GitHub for a new version', () => {
    expect(checksGitHub('1.8', undefined)).toBe(true)
    expect(checksGitHub('1.8', 'com.google.android.packageinstaller')).toBe(true)
    expect(checksGitHub('1.8', 'com.android.vending')).toBe(false)
    expect(checksGitHub('1.8', 'org.fdroid.fdroid')).toBe(false)
    expect(checksGitHub('1.8', 'com.looker.droidify')).toBe(false)
    expect(checksGitHub(undefined, undefined)).toBe(false) // the web app
  })
})
