import UIKit
import Capacitor

/// Capacitor's `backgroundColor` is a single static value in capacitor.config.ts, and it
/// paints the safe areas — the strip behind the status bar and the strip behind the home
/// indicator, which the web content is inset away from (`ios.contentInset: "always"`).
///
/// With a light-only app that was fine. Once dark mode shipped, a hardcoded white left a
/// bright band across the top and bottom of an otherwise near-black screen, which reads as
/// a rendering bug rather than a theme.
///
/// So the safe-area fill follows the system appearance here instead. The two values are
/// deliberately the same literals as `--background` in app/globals.css — if either moves,
/// move both, or the seam comes back.
class ThemedBridgeViewController: CAPBridgeViewController {
    /// mirrors `--background` in app/globals.css
    private static let paperLight = UIColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1.0)
    /// mirrors `--background` inside `@media (prefers-color-scheme: dark)`
    private static let paperDark = UIColor(red: 13.0 / 255.0, green: 13.0 / 255.0, blue: 14.0 / 255.0, alpha: 1.0)

    private var themedBackground: UIColor {
        traitCollection.userInterfaceStyle == .dark ? Self.paperDark : Self.paperLight
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyThemedBackground()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        // only repaint when the appearance actually flipped — this fires for size classes,
        // dynamic type and more besides
        guard traitCollection.hasDifferentColorAppearance(comparedTo: previous) else { return }
        applyThemedBackground()
    }

    private func applyThemedBackground() {
        let color = themedBackground
        view.backgroundColor = color
        // The WKWebView carries its own background AND its scroll view's — a white
        // rubber-band overscroll on a dark page is the same seam in a different place.
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
        webView?.isOpaque = true
    }
}
