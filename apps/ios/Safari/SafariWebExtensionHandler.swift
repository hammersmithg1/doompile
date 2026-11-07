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
                  let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
                  SSReadingList.supportsURL(url) else {
                complete(context, ["error": "Недопустимый адрес для списка чтения."])
                return
            }
            do {
                guard let list = SSReadingList.default() else { throw DoompileError.message("Список чтения Safari недоступен.") }
                try list.addItem(with: url,
                                 title: (message["title"] as? String).map { String($0.prefix(500)) },
                                 previewText: (message["previewText"] as? String).map { String($0.prefix(500)) })
                complete(context, ["ok": true])
            } catch { complete(context, ["error": error.localizedDescription]) }
            return
        }
        guard message["type"] as? String == "configuration" else {
            context.cancelRequest(withError: DoompileError.message("Unsupported native message."))
            return
        }
        // Only extension-owned code can request the app connection.
        complete(context, ["endpoint": Connection.endpoint, "token": Connection.token])
    }
    private func complete(_ context: NSExtensionContext, _ message: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: message]
        context.completeRequest(returningItems: [response])
    }
}
