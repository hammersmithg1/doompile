import Foundation

struct CaptureShortcut: Codable, Equatable {
    struct Modifiers: OptionSet, Codable, Equatable {
        let rawValue: UInt32
        static let command = Self(rawValue: 1)
        static let option = Self(rawValue: 2)
        static let control = Self(rawValue: 4)
        static let shift = Self(rawValue: 8)
        static let all: Self = [.command, .option, .control, .shift]
    }
    let keyCode: UInt32
    let modifiers: Modifiers
    let key: String
    static let storageKey = "mac-capture-shortcut-v1"
    static let standard = CaptureShortcut(keyCode: 49, modifiers: [.command, .shift], key: "Пробел")
    var label: String {
        (modifiers.contains(.control) ? "⌃" : "") + (modifiers.contains(.option) ? "⌥" : "") + (modifiers.contains(.shift) ? "⇧" : "") + (modifiers.contains(.command) ? "⌘" : "") + key
    }
    var validationError: String? {
        guard keyCode < 128, modifiers.subtracting(.all).isEmpty, !key.isEmpty else { return "Не удалось распознать клавишу." }
        guard !modifiers.intersection([.command, .control, .option]).isEmpty else { return "Добавь ⌘, ⌃ или ⌥, чтобы сочетание не мешало обычному вводу." }
        guard ![36, 48, 51, 53, 117, 123, 124, 125, 126].contains(keyCode) else { return "Выбери букву, цифру, пробел или функциональную клавишу." }
        let editingKeys: Set<UInt32> = [0, 6, 7, 8, 9, 12, 13, 31, 35, 45, 46, 47]
        if modifiers == .command && (editingKeys.contains(keyCode) || keyCode == 49) { return "Это стандартная команда macOS. Добавь ещё модификатор." }
        return nil
    }
    static func load(from defaults: UserDefaults = .standard) -> CaptureShortcut? {
        // Missing preference means the default; an explicit false means disabled.
        if defaults.object(forKey: storageKey + ".enabled") as? Bool == false { return nil }
        guard let data = defaults.data(forKey: storageKey), let value = try? JSONDecoder().decode(Self.self, from: data), value.validationError == nil else { return .standard }
        return value
    }
    static func persist(_ shortcut: Self?, in defaults: UserDefaults = .standard) throws {
        if let shortcut {
            if let error = shortcut.validationError { throw NSError(domain: "DoompileShortcut", code: 1, userInfo: [NSLocalizedDescriptionKey: error]) }
            defaults.set(try JSONEncoder().encode(shortcut), forKey: storageKey)
        }
        defaults.set(shortcut != nil, forKey: storageKey + ".enabled")
    }
}
