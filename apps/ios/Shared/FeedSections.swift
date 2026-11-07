import Foundation

/// The feed uses creation day, like web; edits never move a note to a different day.
struct FeedSection: Identifiable {
    let id: String
    let title: String
    var notes: [Note]

    static func make(_ notes: [Note], now: Date = Date(), calendar: Calendar = .current, includingUrgent: Bool = false) -> [FeedSection] {
        let sorted = notes.filter { $0.deletedAt == nil }.sorted {
            if $0.urgent != $1.urgent { return $0.urgent }
            if $0.pinned != $1.pinned { return $0.pinned }
            return Note.newestFirst($0, $1)
        }
        let fraction = ISO8601DateFormatter()
        fraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let internet = ISO8601DateFormatter()
        let label = DateFormatter()
        label.locale = Locale(identifier: "ru_RU")
        label.calendar = calendar
        label.timeZone = calendar.timeZone
        label.dateFormat = "d MMMM"
        var sections: [FeedSection] = []
        for note in sorted {
            if note.urgent && !includingUrgent { continue }
            let date = fraction.date(from: note.createdAt) ?? internet.date(from: note.createdAt) ?? .distantPast
            let components = calendar.dateComponents([.year, .month, .day], from: date)
            let id = note.urgent ? "urgent" : note.pinned ? "pinned" : "day:\(components.year ?? 0)-\(components.month ?? 0)-\(components.day ?? 0)"
            if let index = sections.firstIndex(where: { $0.id == id }) { sections[index].notes.append(note); continue }
            let title: String
            if note.urgent { title = "Важное" }
            else if note.pinned { title = "Закреплено" }
            else if calendar.isDate(date, inSameDayAs: now) { title = "Сегодня" }
            else if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) { title = "Вчера" }
            else { title = label.string(from: date) }
            sections.append(FeedSection(id: id, title: title, notes: [note]))
        }
        return sections
    }
}
