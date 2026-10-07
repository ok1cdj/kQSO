import UIKit

/// The BLE chooser: a list that fills while scanning; a tap picks, Cancel or swiping the
/// sheet down cancels. `closed` gets the row index, or nil — exactly once.
final class DevicePicker: UITableViewController, UIAdaptivePresentationControllerDelegate {
    private var names: [String] = []
    private var closed: ((Int?) -> Void)?

    init(title: String, closed: @escaping (Int?) -> Void) {
        self.closed = closed
        super.init(style: .insetGrouped)
        self.title = title
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: L.cancel, style: .plain, target: self, action: #selector(cancelTapped)
        )
        navigationController?.presentationController?.delegate = self
    }

    func add(_ name: String) {
        names.append(name)
        tableView.insertRows(at: [IndexPath(row: names.count - 1, section: 0)], with: .automatic)
    }

    func showTitle(_ text: String) { title = text }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { names.count }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var content = cell.defaultContentConfiguration()
        content.text = names[indexPath.row]
        cell.contentConfiguration = content
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        finish(indexPath.row)
    }

    @objc private func cancelTapped() { finish(nil) }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        report(nil) // swiped down: already gone
    }

    private func finish(_ index: Int?) {
        dismiss(animated: true)
        report(index)
    }

    private func report(_ index: Int?) {
        let c = closed
        closed = nil
        c?(index)
    }
}
