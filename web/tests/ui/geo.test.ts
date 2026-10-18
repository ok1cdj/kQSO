// The web position helper: a fix becomes {lat, lon, accuracy}, a failure an Error
// whose message is the GeoFailure the New Log form words.
import { describe, it, expect } from 'vitest'
import { browserPosition } from '../../src/platform/web/geo'

function fakeGeo(answer: { coords?: Partial<GeolocationCoordinates>; code?: number }): Geolocation {
  return {
    getCurrentPosition: (ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      if (answer.coords) ok({ coords: answer.coords, timestamp: 0 } as GeolocationPosition)
      else fail?.({ code: answer.code ?? 2 } as GeolocationPositionError)
    },
  } as Geolocation
}

describe('browserPosition', () => {
  it('returns the fix', async () => {
    const p = await browserPosition(fakeGeo({ coords: { latitude: 50.0875, longitude: 14.4213, accuracy: 12 } }))
    expect(p).toEqual({ lat: 50.0875, lon: 14.4213, accuracy: 12 })
  })

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [9, 'unavailable'],
  ])('error code %i → %s', async (code, why) => {
    await expect(browserPosition(fakeGeo({ code }))).rejects.toThrow(why)
  })
})
