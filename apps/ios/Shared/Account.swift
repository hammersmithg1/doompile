import Foundation
import CryptoKit
import Combine
import SwiftUI

struct NativeAccount: Codable, Equatable {
    let id: String
    let email: String
    let name: String
    var endpoint: String
    var scope: String { Connection.scope(endpoint: endpoint, userID: id) }
}

@MainActor final class AccountSession: ObservableObject {
    static let shared = AccountSession()
    @Published private(set) var account = Connection.signedIn ? Connection.account : nil
    @Published private(set) var signingIn = false
    @Published var error: String?
    private var polling: Task<Void, Never>?
    private var attemptID = UUID()
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    var scope: String { account?.scope ?? "signed-out" }
    func refresh() { account = Connection.signedIn ? Connection.account : nil }
    private struct Flow: Decodable { let code: String; let secret: String; let verificationUrl: String; let expires: Double }
    private struct Exchange: Decodable {
        let status: String
        let token: String?
        let user: User?
        struct User: Decodable { let id: String; let email: String; let name: String }
    }
    private func post<T: Decodable>(_ endpoint: String, _ body: [String: String], as type: T.Type) async throws -> T {
        guard Connection.validEndpoint(endpoint), let url = URL(string: endpoint + "/api/auth/device") else { throw DoompileError.message("Укажи HTTPS-адрес сервера или localhost.") }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"; request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await Telemetry.network(session, request: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, [200,201].contains(status) else { throw DoompileError.message("Вход не завершён. Проверь адрес сервера и начни ещё раз.") }
        return try JSONDecoder().decode(type, from: data)
    }
    func start(endpoint: String) async -> URL? {
        guard !signingIn else { return nil }
        signingIn = true; error = nil
        let attempt = UUID(); attemptID = attempt
        let base = endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        do {
            #if os(macOS)
            let label = "Doompile для Mac"
            #else
            let label = "Doompile для iPhone"
            #endif
            let flow = try await post(base, ["label":label], as: Flow.self)
            guard attemptID == attempt, signingIn else { return nil }
            guard let url = URL(string: flow.verificationUrl), let origin = URL(string: base), url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port, url.path == "/connect" else { throw DoompileError.message("Сервер вернул неправильный адрес входа.") }
            polling?.cancel()
            polling = Task { [weak self] in
                guard let self else { return }
                defer { if self.attemptID == attempt { self.signingIn = false } }
                do {
                    while !Task.isCancelled && Date().timeIntervalSince1970 * 1000 < flow.expires {
                        try await Task.sleep(for: .seconds(3))
                        let result = try await self.post(base, ["code":flow.code,"secret":flow.secret], as: Exchange.self)
                        if result.status == "approved", let token = result.token, let user = result.user {
                            try Task.checkCancellation()
                            guard self.attemptID == attempt else { return }
                            let account = NativeAccount(id:user.id,email:user.email,name:user.name,endpoint:base)
                            try Connection.install(account, token:token)
                            self.account = account
                            Telemetry.shared.record(.authSucceeded, ["provider": "device"])
                            Task { await Telemetry.shared.flush() }
                            return
                        }
                    }
                    if !Task.isCancelled { self.error = "Ссылка входа истекла. Начни ещё раз." }
                } catch is CancellationError { }
                catch { self.error = error.localizedDescription }
            }
            return url
        } catch { self.error = error.localizedDescription; signingIn = false; return nil }
    }
    func cancel() { attemptID = UUID(); polling?.cancel(); polling = nil; signingIn = false }
    func logout() async {
        guard await NoteLinkEditors.prepare() else { error = "Сначала сохрани открытый редактор."; return }
        cancel()
        let endpoint = Connection.endpoint, token = Connection.token
        // Remove local access immediately; cached notes remain inside this account's directory.
        Telemetry.shared.record(.authSignedOut)
        Connection.logout(); account = nil
        guard let url = URL(string:endpoint + "/api/session"), !token.isEmpty else { return }
        var request = URLRequest(url:url,timeoutInterval:8); request.httpMethod = "DELETE"
        request.setValue("Bearer " + token,forHTTPHeaderField:"Authorization")
        _ = try? await Telemetry.network(session, request: request)
    }
}

struct AccountLoginView: View {
    @ObservedObject private var account = AccountSession.shared
    @Environment(\.openURL) private var openURL
    @State private var endpoint = Connection.endpoint
    var body: some View {
        VStack(alignment:.leading,spacing:20) {
            HStack(spacing: 8) { DoompileWordmark(height: 32); DoompileHalo(width: 38) }
            Text(BrandCopy.motto).font(.title2.bold())
            Text("Войди через Яндекс или Google, чтобы заметки и файлы были рядом на всех устройствах.").font(.callout).foregroundStyle(.secondary)
            TextField("https://…",text:$endpoint).textFieldStyle(.roundedBorder)
            Button(account.signingIn ? "Заверши вход в браузере…" : "Войти через браузер ↗") {
                Task { if let url = await account.start(endpoint:endpoint) { openURL(url) } }
            }.buttonStyle(.borderedProminent).disabled(account.signingIn)
            if account.signingIn { Button("Отменить") { account.cancel() }.buttonStyle(.plain) }
            if let error = account.error { Text(error).font(.footnote).foregroundStyle(.red) }
            Text("После входа разреши подключение приложения и вернись сюда.").font(.footnote).foregroundStyle(.secondary)
            DisclosureGroup("Диагностика") { DiagnosticsView() }.font(.footnote)
        }.padding(32).frame(maxWidth:440)
    }
}

struct AccountSettingsView: View {
    @ObservedObject private var account = AccountSession.shared
    @State private var error: String?
    var body: some View {
        VStack(alignment:.leading,spacing:10) {
            if let user = account.account {
                Text(user.name).font(.headline)
                Text(user.email).font(.callout).foregroundStyle(.secondary)
                Text(user.endpoint).font(.caption).foregroundStyle(.secondary)
                Button("Выйти из аккаунта") { Task { await account.logout() } }
                if let error = error ?? account.error { Text(error).font(.footnote).foregroundStyle(.red) }
            } else { Text("Войди в аккаунт в главном окне.").font(.callout) }
        }
    }
}
