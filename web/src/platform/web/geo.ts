// Device position through the Geolocation API: the web app, and the Android WebView
// once it lets the page ask. Asked only on a tap; the caller keeps just the locator.

import type { GeoFailure, GeoPosition } from '../types'

export function geolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

// GeolocationPositionError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
const FAILURE: Record<number, GeoFailure> = { 1: 'denied', 2: 'unavailable', 3: 'timeout' }

export function browserPosition(geo: Geolocation = navigator.geolocation): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(FAILURE[e.code] ?? 'unavailable')),
      // A summit fix can take a while; a minute-old fix is still the same locator.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  })
}
