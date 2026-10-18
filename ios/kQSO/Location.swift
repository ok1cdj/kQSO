import CoreLocation

/// The device position for 📍 in New Log (the kqso:// page has no Geolocation API).
/// Asked only on that tap; the page keeps just the locator. Main thread.
final class Location: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: [(Any?, String?) -> Void] = []
    private var timer: Timer?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// Replies {lat, lon, accuracy} or a GeoFailure (platform/types.ts): denied,
    /// unavailable, timeout. Taps while one is in flight share its answer.
    func request(_ reply: @escaping (Any?, String?) -> Void) {
        waiting.append(reply)
        guard waiting.count == 1 else { return }
        // As the web's 20 s: a summit fix can take a while, but not forever.
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            self?.finish(nil, "timeout")
        }
        ask(manager.authorizationStatus)
    }

    private func ask(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: manager.requestWhenInUseAuthorization() // → DidChangeAuthorization
        case .denied, .restricted: finish(nil, "denied")
        default: manager.requestLocation()
        }
    }

    // Also called once right after the manager is created; nothing waits then.
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        guard !waiting.isEmpty, m.authorizationStatus != .notDetermined else { return }
        ask(m.authorizationStatus)
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        // Approximate location (the user's choice) comes as a large accuracy; the page warns.
        finish(["lat": l.coordinate.latitude, "lon": l.coordinate.longitude, "accuracy": l.horizontalAccuracy], nil)
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        finish(nil, (error as? CLError)?.code == .denied ? "denied" : "unavailable")
    }

    private func finish(_ value: Any?, _ error: String?) {
        timer?.invalidate()
        timer = nil
        let replies = waiting
        waiting = []
        replies.forEach { $0(value, error) }
    }
}
