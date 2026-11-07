import AppKit
import Foundation
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        guard let item = context.inputItems.first as? NSExtensionItem,
              let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any] else {
            context.cancelRequest(withError: DoompileError.message("Unsupported native message."))
            return
        }
        if message["type"] as? String == "reading-list:add" {
            guard let value = message["url"] as? String, value.count <= 20_000,
                  let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
                Self.complete(context, ["error": "Недопустимый адрес для списка чтения."])
                return
            }
            DispatchQueue.main.async { ReadingListRequest.start(url: url, context: context) }
            return
        }
        guard message["type"] as? String == "configuration" else {
            context.cancelRequest(withError: DoompileError.message("Unsupported native message."))
            return
        }
        Self.complete(context, ["endpoint": Connection.endpoint, "token": Connection.token])
    }
    static func complete(_ context: NSExtensionContext, _ message: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: message]
        context.completeRequest(returningItems: [response])
    }
}

@MainActor
private final class ReadingListRequest: NSObject, NSSharingServiceDelegate {
    private static var active: [UUID: ReadingListRequest] = [:]
    private let id = UUID()
    private let context: NSExtensionContext
    private var service: NSSharingService?
    private var finished = false
    private init(context: NSExtensionContext) { self.context = context }

    static func start(url: URL, context: NSExtensionContext) {
        let operation = ReadingListRequest(context: context)
        active[operation.id] = operation
        guard let service = NSSharingService(named: .addToSafariReadingList), service.canPerform(withItems: [url]) else {
            operation.finish(error: "Системный список чтения Safari недоступен.")
            return
        }
        operation.service = service
        service.delegate = operation
        service.perform(withItems: [url])
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak operation] in
            operation?.finish(error: "Safari не подтвердил добавление в список чтения. Проверь его в Safari.")
        }
    }
    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) { finish(error: nil) }
    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) { finish(error: error.localizedDescription) }
    private func finish(error: String?) {
        guard !finished else { return }
        finished = true
        if let error { SafariWebExtensionHandler.complete(context, ["error": error]) }
        else { SafariWebExtensionHandler.complete(context, ["ok": true]) }
        Self.active.removeValue(forKey: id)
        service = nil
    }
}
