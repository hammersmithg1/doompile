import Foundation
import SwiftUI

/// The three persisted choices and labels are the same on iPhone, macOS and web.
enum AppearanceMode: String, CaseIterable, Identifiable {
    case system, light, dark
    static let storageKey = "doompile-theme"
    var id: String { rawValue }
    var title: String { switch self { case .system: return "Системная"; case .light: return "Светлая"; case .dark: return "Тёмная" } }
    var colorScheme: ColorScheme? { switch self { case .system: return nil; case .light: return .light; case .dark: return .dark } }
}

enum TagCatalog {
    static var key: String { "doompile-created-tags:" + Connection.scope }
    static func all(noteTags: [String], defaults: UserDefaults = Connection.defaults) -> [String] {
        Array(Set(noteTags + (defaults.stringArray(forKey: key) ?? []))).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
    @discardableResult static func create(_ value: String, defaults: UserDefaults = Connection.defaults) -> Bool {
        let tag = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tag.isEmpty, tag.utf16.count <= NoteLimits.tagLength else { return false }
        defaults.set(all(noteTags: [tag], defaults: defaults), forKey: key)
        return true
    }
}

#if canImport(UIKit)
import UIKit

enum DoompilePalette {
    static let ink = DesignTokens.background
    static let card = DesignTokens.surface
    static let sidebar = DesignTokens.sidebar
    static let text = DesignTokens.text
    static let line = DesignTokens.line
    static let lime = DesignTokens.lime
    static let onLime = DesignTokens.onLime
    static let limeSoft = DesignTokens.limeSoft
    static let accent = DesignTokens.accent
    static let orange = DesignTokens.danger
    static let urgent = DesignTokens.urgent
    static let muted = DesignTokens.muted
}
#endif
