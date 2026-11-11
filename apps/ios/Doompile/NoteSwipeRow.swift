import SwiftUI
import UIKit

struct NoteSwipeRow<Content: View>: View {
    let note: Note
    @Binding var revealedID: String?
    let onOpen: () -> Void
    let onPin: () -> Void
    let onUrgent: () -> Void
    let onDelete: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var dragOffset: CGFloat?
    @State private var dragOrigin: CGFloat?
    @State private var ignoreTapUntil = Date.distantPast
    private let revealWidth: CGFloat = 192
    private var open: Bool { revealedID == note.id }
    private var offset: CGFloat { dragOffset ?? (open ? -revealWidth : 0) }
    private var progress: CGFloat { min(1, max(0, -offset / revealWidth)) }
    private func settle(_ initialVelocity: Double = 0) -> Animation {
        UIAccessibility.isReduceMotionEnabled ? .linear(duration: 0.01)
            : .interpolatingSpring(stiffness: 380, damping: 34, initialVelocity: initialVelocity)
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            if open || offset < 0 {
                HStack(spacing: 6) {
                    action(note.pinned ? "Открепить" : "Закрепить", name: "pin", icon: note.pinned ? "pin.slash" : "pin", color: Palette.accent, perform: onPin)
                    action(note.urgent ? "Убрать из важного" : "Сделать важной", name: "urgent", icon: note.urgent ? "flame" : "flame.fill", color: Palette.orange, perform: onUrgent)
                    action("Удалить", name: "delete", icon: "trash", color: Palette.orange, perform: onDelete)
                }.frame(width: revealWidth - 6)
                    .scaleEffect(0.94 + 0.06 * progress, anchor: .trailing)
                    .offset(x: (1 - progress) * 12)
                    .opacity(min(1, progress * 3))
                    .mask(alignment: .trailing) { Rectangle().frame(width: max(0, -offset - 6)) }
                    .accessibilityHidden(!open).allowsHitTesting(open && dragOrigin == nil)
                    .transition(.opacity)
            }
            content().frame(maxWidth: .infinity).background(Palette.ink)
                .contentShape(Rectangle())
                .onTapGesture {
                    guard Date() >= ignoreTapUntil else { return }
                    if open { close() } else { revealedID = nil; onOpen() }
                }
                .accessibilityElement(children: .contain).accessibilityAddTraits(.isButton)
                .accessibilityLabel(note.plainText.isEmpty ? note.displayTitle : note.plainText)
                .accessibilityAction { if open { close() } else { revealedID = nil; onOpen() } }
                .environment(\.openURL, OpenURLAction { url in
                    guard Date() >= ignoreTapUntil else { return .handled }
                    if open { close(); return .handled }
                    revealedID = nil
                    return .systemAction
                })
                .offset(x: offset)
                .accessibilityIdentifier("note-" + note.id)
                .contextMenu {
                    Button(note.pinned ? "Открепить" : "Закрепить", systemImage: "pin", action: onPin)
                    Button(note.urgent ? "Убрать из важного" : "Сделать важной", systemImage: "flame", action: onUrgent)
                    Button("Удалить", systemImage: "trash", role: .destructive, action: onDelete)
                }
        }
        .contentShape(Rectangle())
        .modifier(HorizontalDragModifier(target: .noteRow(open: open),
            onChanged: { translation, _ in changeDrag(translation.width) },
            onEnded: { translation, predicted in finishDrag(translation.width, predicted: predicted.width) },
            onCancelled: cancelDrag))
        .sensoryFeedback(.selection, trigger: open) { wasOpen, isOpen in !wasOpen && isOpen }
        .accessibilityAction(named: Text(note.pinned ? "Открепить" : "Закрепить"), onPin)
        .accessibilityAction(named: Text(note.urgent ? "Убрать из важного" : "Сделать важной"), onUrgent)
    }
    private func changeDrag(_ translation: CGFloat) {
        let origin = dragOrigin ?? (open ? -revealWidth : 0)
        if dragOrigin == nil {
            dragOrigin = origin
            if !open, revealedID != nil { withAnimation(settle()) { revealedID = nil } }
        }
        let position = min(0, origin + translation)
        let stretch = min(18, max(0, -revealWidth - position) * 0.2)
        ignoreTapUntil = .distantFuture
        var transaction = Transaction(); transaction.disablesAnimations = true
        withTransaction(transaction) { dragOffset = max(-revealWidth, position) - stretch }
    }
    private func finishDrag(_ translation: CGFloat, predicted: CGFloat) {
        guard let origin = dragOrigin else { return }
        let momentum = min(112, max(-112, predicted - translation))
        let threshold = revealWidth * (open ? 0.36 : 0.46)
        let willOpen = origin + translation + momentum < -threshold
        let remaining = (willOpen ? -revealWidth : 0) - offset
        let initialVelocity = abs(remaining) > 1 ? Double(momentum / (HorizontalDragTarget.projectionTime * remaining)) : 0
        settleDrag(open: willOpen, initialVelocity: min(4, max(0, initialVelocity)))
    }
    private func cancelDrag() {
        if dragOrigin != nil { settleDrag(open: open) }
    }
    private func settleDrag(open: Bool, initialVelocity: Double = 0) {
        ignoreTapUntil = Date().addingTimeInterval(0.16)
        withAnimation(settle(initialVelocity)) {
            if open { revealedID = note.id }
            else if self.open { revealedID = nil }
            dragOrigin = nil
            dragOffset = nil
        }
    }
    private func close() { settleDrag(open: false) }
    private func action(_ title: String, name: String, icon: String, color: Color, perform: @escaping () -> Void) -> some View {
        Button {
            close(); perform()
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

enum HorizontalDragTarget {
    case noteRow(open: Bool), openDrawer, closeDrawer

    static let projectionTime: CGFloat = 0.12

    func acceptsTouch(at x: CGFloat) -> Bool {
        if case .openDrawer = self { return Self.isDrawerEdge(x) }
        return true
    }

    func acceptsPan(startX: CGFloat, motion: CGPoint) -> Bool {
        guard abs(motion.x) > abs(motion.y) * 1.15 else { return false }
        switch self {
        case .noteRow(let open): return motion.x < 0 || (open && !Self.isDrawerEdge(startX))
        case .openDrawer: return motion.x > 0 && Self.isDrawerEdge(startX)
        case .closeDrawer: return motion.x < 0
        }
    }

    private static func isDrawerEdge(_ x: CGFloat) -> Bool { (0...22).contains(x) }
}

struct HorizontalDragModifier: ViewModifier {
    var enabled = true
    let target: HorizontalDragTarget
    let onChanged: (CGSize, CGSize) -> Void
    let onEnded: (CGSize, CGSize) -> Void
    var onCancelled: () -> Void = {}

    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(HorizontalPanGesture(drag: self))
        } else {
            content.background { LegacyHorizontalPanGesture(drag: self) }
        }
    }

    @MainActor fileprivate func configure(_ pan: DirectionalPanRecognizer) {
        pan.dragTarget = target
        pan.onChanged = onChanged
        pan.onEnded = onEnded
        pan.onCancelled = onCancelled
        if pan.isEnabled != enabled { pan.isEnabled = enabled }
    }
}

@available(iOS 18.0, *)
private struct HorizontalPanGesture: UIGestureRecognizerRepresentable {
    let drag: HorizontalDragModifier

    func makeUIGestureRecognizer(context: Context) -> DirectionalPanRecognizer {
        let pan = DirectionalPanRecognizer(target: nil, action: nil)
        drag.configure(pan)
        return pan
    }

    func updateUIGestureRecognizer(_ recognizer: DirectionalPanRecognizer, context: Context) {
        drag.configure(recognizer)
    }

    func handleUIGestureRecognizerAction(_ recognizer: DirectionalPanRecognizer, context: Context) {
        recognizer.deliverSample()
    }
}

/// iOS 17 attaches the same recognizer to UIKit and uses this background view as its hit area.
private struct LegacyHorizontalPanGesture: UIViewRepresentable {
    let drag: HorizontalDragModifier

    func makeUIView(context: Context) -> Anchor {
        let anchor = Anchor()
        drag.configure(anchor.pan)
        return anchor
    }

    func updateUIView(_ anchor: Anchor, context: Context) { drag.configure(anchor.pan) }

    static func dismantleUIView(_ anchor: Anchor, coordinator: Void) {
        anchor.pan.view?.removeGestureRecognizer(anchor.pan)
    }

    final class Anchor: UIView {
        let pan = DirectionalPanRecognizer(target: nil, action: nil)

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            isAccessibilityElement = false
            pan.addTarget(pan, action: #selector(DirectionalPanRecognizer.deliverSample))
            pan.containsTouch = { [weak self] touch in
                guard let self, let window else { return false }
                if pan.view === window, window.rootViewController?.presentedViewController != nil { return false }
                return bounds.contains(touch.location(in: self))
            }
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            connectPan()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            connectPan()
        }

        private func connectPan() {
            guard let window else { pan.view?.removeGestureRecognizer(pan); return }
            var host = superview
            while let candidate = host, !(candidate is UIScrollView) { host = candidate.superview }
            let view = host ?? window
            if pan.view !== view { view.addGestureRecognizer(pan) }
        }
    }
}

private final class DirectionalPanRecognizer: UIPanGestureRecognizer, UIGestureRecognizerDelegate {
    var dragTarget: HorizontalDragTarget = .openDrawer
    var containsTouch: ((UITouch) -> Bool)?
    var onChanged: (CGSize, CGSize) -> Void = { _, _ in }
    var onEnded: (CGSize, CGSize) -> Void = { _, _ in }
    var onCancelled: () -> Void = {}
    private var touchOrigin = CGPoint.zero
    private var recognitionOffset = CGPoint.zero
    private var lastMovementAt: CFTimeInterval = 0

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        maximumNumberOfTouches = 1
        delegate = self
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard numberOfTouches == 0, containsTouch?(touch) != false else { return false }
        touchOrigin = touch.location(in: view?.window)
        return dragTarget.acceptsTouch(at: touchOrigin.x)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        let point = location(in: view?.window)
        let motion = CGPoint(x: point.x - touchOrigin.x, y: point.y - touchOrigin.y)
        return dragTarget.acceptsPan(startX: touchOrigin.x, motion: motion)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        // Give the vertical pan the same touch only after this recognizer rejects its direction.
        guard let scroll = other.view as? UIScrollView else { return false }
        return other === scroll.panGestureRecognizer
    }

    @objc func deliverSample() {
        let window = view?.window
        let delta = translation(in: window)
        if state == .began {
            let point = location(in: window)
            recognitionOffset = CGPoint(x: point.x - touchOrigin.x - delta.x, y: point.y - touchOrigin.y - delta.y)
        }
        let translation = CGSize(width: delta.x + recognitionOffset.x, height: delta.y + recognitionOffset.y)
        let now = CACurrentMediaTime()
        if state == .began || state == .changed { lastMovementAt = now }
        let speed = now - lastMovementAt < 0.12 ? velocity(in: window) : .zero
        let predicted = CGSize(width: translation.width + speed.x * HorizontalDragTarget.projectionTime,
                               height: translation.height + speed.y * HorizontalDragTarget.projectionTime)
        switch state {
        case .began, .changed: onChanged(translation, predicted)
        case .ended: onEnded(translation, predicted)
        case .cancelled: onCancelled()
        default: break
        }
    }
}
