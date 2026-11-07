import SwiftUI
import UIKit

/// The card follows the finger 1:1. Both directions use the same short, non-spring settle.
struct NoteSwipeRow<Content: View>: View {
    let note: Note
    @Binding var revealedID: String?
    let onOpen: () -> Void
    let onPin: () -> Void
    let onUrgent: () -> Void
    let onDelete: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var velocityHint: CGFloat = 0
    @State private var dragOffset: CGFloat?
    @State private var horizontal: Bool?
    @State private var origin: CGFloat = 0
    @State private var ignoreTapUntil = Date.distantPast
    private let revealWidth: CGFloat = 192
    private var open: Bool { revealedID == note.id }
    private var offset: CGFloat { dragOffset ?? (open ? -revealWidth : 0) }
    private var settle: Animation { .easeOut(duration: UIAccessibility.isReduceMotionEnabled ? 0.01 : 0.14) }

    var body: some View {
        ZStack(alignment: .trailing) {
            content().frame(maxWidth: .infinity).background(Palette.ink)
                .contentShape(Rectangle())
                .onTapGesture {
                    guard Date() >= ignoreTapUntil else { return }
                    if open { close() } else { revealedID = nil; onOpen() }
                }
                .accessibilityElement(children: .combine).accessibilityAddTraits(.isButton)
                .accessibilityAction { if open { close() } else { revealedID = nil; onOpen() } }
                .offset(x: offset)
                .accessibilityIdentifier("note-" + note.id)
                .contextMenu {
                    Button(note.pinned ? "Открепить" : "Закрепить", systemImage: "pin", action: onPin)
                    Button(note.urgent ? "Убрать из важного" : "Сделать важной", systemImage: "flame", action: onUrgent)
                    Button("Удалить", systemImage: "trash", role: .destructive, action: onDelete)
                }
            if offset < 0 {
                HStack(spacing: 6) {
                    action(note.pinned ? "Открепить" : "Закрепить", name: "pin", icon: note.pinned ? "pin.slash" : "pin", color: Palette.accent, perform: onPin)
                    action(note.urgent ? "Убрать из важного" : "Сделать важной", name: "urgent", icon: note.urgent ? "flame" : "flame.fill", color: Palette.orange, perform: onUrgent)
                    action("Удалить", name: "delete", icon: "trash", color: Palette.orange, perform: onDelete)
                }.frame(width: revealWidth - 6)
                    .mask(alignment: .trailing) { Rectangle().frame(width: max(0, -offset - 6)) }
                    .accessibilityHidden(!open).allowsHitTesting(open)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .contentShape(Rectangle())
        .modifier(HorizontalDragModifier(onChanged: { translation, predicted in
            if horizontal == nil {
                // The modifier has already rejected vertical movement before recognition.
                // UIKit may report zero translation at .began; it is still a horizontal pan.
                horizontal = true
                origin = open ? -revealWidth : 0
            }
            guard horizontal == true else { return }
            ignoreTapUntil = .distantFuture
            velocityHint = min(28, max(-28, predicted.width - translation.width))
            var transaction = Transaction(); transaction.disablesAnimations = true
            withTransaction(transaction) { dragOffset = min(0, max(-revealWidth, origin + translation.width)) }
        }, onEnded: { translation, predicted in
            velocityHint = min(28, max(-28, predicted.width - translation.width))
            finishDrag()
        }))
        .accessibilityAction(named: Text(note.pinned ? "Открепить" : "Закрепить"), onPin)
        .accessibilityAction(named: Text(note.urgent ? "Убрать из важного" : "Сделать важной"), onUrgent)
    }
    private func finishDrag() {
        defer { horizontal = nil; velocityHint = 0 }
        guard horizontal == true else { return }
        ignoreTapUntil = Date().addingTimeInterval(0.2)
        let target = (dragOffset ?? origin) + velocityHint < -revealWidth / 2
        withAnimation(settle) { revealedID = target ? note.id : nil; dragOffset = nil }
    }
    private func close() { withAnimation(settle) { revealedID = nil; dragOffset = nil } }
    private func action(_ title: String, name: String, icon: String, color: Color, perform: @escaping () -> Void) -> some View {
        Button {
            revealedID = nil; dragOffset = nil; perform()
        } label: {
            DoompileSymbol(systemName: icon, size: 20).font(.system(size: 20, weight: .medium))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(color).background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(title)
            .accessibilityIdentifier("swipe-action-" + name + "-" + note.id)
            .accessibilityHidden(!open).allowsHitTesting(open)
    }
}

/// Reject vertical movement before recognition, so a row cannot steal the ScrollView pan.
struct HorizontalDragModifier: ViewModifier {
    var enabled = true
    var leadingEdgeWidth: CGFloat? = nil
    let onChanged: (CGSize, CGSize) -> Void
    let onEnded: (CGSize, CGSize) -> Void
    @GestureState private var dragging = false
    @State private var lastSample: (CGSize, CGSize)?
    @State private var horizontal: Bool?
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(HorizontalPanGesture(enabled: enabled, leadingEdgeWidth: leadingEdgeWidth, onChanged: onChanged, onEnded: onEnded))
        } else {
            content.simultaneousGesture(DragGesture(minimumDistance: 20, coordinateSpace: .global)
                .updating($dragging) { _, active, _ in active = true }
                .onChanged { value in
                    if let edge = leadingEdgeWidth, value.startLocation.x > edge { return }
                    if horizontal == nil { horizontal = abs(value.translation.width) > abs(value.translation.height) * 1.15 }
                    guard horizontal == true else { return }
                    lastSample = (value.translation, value.predictedEndTranslation)
                    onChanged(value.translation, value.predictedEndTranslation)
                }
                .onEnded { value in
                    horizontal = nil
                    guard lastSample != nil else { return }
                    lastSample = nil
                    onEnded(value.translation, value.predictedEndTranslation)
                }, including: enabled ? .all : .none)
                .onChange(of: dragging) { _, active in
                    if !active {
                        horizontal = nil
                        if let sample = lastSample { lastSample = nil; onEnded(sample.0, sample.1) }
                    }
                }
        }
    }
}

@available(iOS 18.0, *)
private struct HorizontalPanGesture: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var leadingEdgeWidth: CGFloat?
    let onChanged: (CGSize, CGSize) -> Void
    let onEnded: (CGSize, CGSize) -> Void
    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }
    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        updateUIGestureRecognizer(pan, context: context)
        return pan
    }
    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        if recognizer.isEnabled != enabled { recognizer.isEnabled = enabled }
        context.coordinator.leadingEdgeWidth = leadingEdgeWidth
    }
    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let delta = recognizer.translation(in: nil), velocity = recognizer.velocity(in: nil)
        let translation = CGSize(width: delta.x, height: delta.y)
        let predicted = CGSize(width: delta.x + velocity.x * 0.08, height: delta.y + velocity.y * 0.08)
        switch recognizer.state {
        case .began, .changed: onChanged(translation, predicted)
        case .ended: onEnded(translation, predicted)
        case .cancelled, .failed: onEnded(translation, translation)
        default: break
        }
    }
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var leadingEdgeWidth: CGFloat?
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            guard abs(velocity.x) > abs(velocity.y) * 1.15 else { return false }
            if let edge = leadingEdgeWidth {
                let startX = pan.location(in: nil).x - pan.translation(in: nil).x
                guard startX >= 0, startX <= edge else { return false }
            }
            return true
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            otherGestureRecognizer.view is UIScrollView
        }
    }
}
