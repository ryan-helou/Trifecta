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

    // MARK: - launch cover
    //
    // iOS tears down the LaunchScreen storyboard the moment this controller loads, but
    // the WKWebView behind it has nothing to show until the bundle is parsed and React
    // has mounted. That gap was about four seconds of flat, empty colour on a cold
    // start — long enough to read as a hung app rather than a loading one.
    //
    // So the same Splash artwork is held over the web view and dropped once the page
    // reports it has finished loading. `holdTimeout` is a hard ceiling: whatever goes
    // wrong, the cover always leaves, so this can never be the thing that hides the app.
    private var launchCover: UIImageView?
    private var progressObservation: NSKeyValueObservation?
    private static let holdTimeout: TimeInterval = 6

    override func viewDidLoad() {
        super.viewDidLoad()
        applyThemedBackground()
        installLaunchCover()
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
        launchCover?.backgroundColor = color
    }

    private func installLaunchCover() {
        let cover = UIImageView(image: UIImage(named: "Splash"))
        cover.contentMode = .scaleAspectFill
        cover.backgroundColor = themedBackground
        cover.isUserInteractionEnabled = false
        cover.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        launchCover = cover

        progressObservation = webView?.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard (change.newValue ?? 0) >= 1 else { return }
            // one runloop turn past "loaded" so the first frame is actually on screen
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self?.dismissLaunchCover() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.holdTimeout) { [weak self] in
            self?.dismissLaunchCover()
        }
    }

    private func dismissLaunchCover() {
        guard let cover = launchCover else { return }
        launchCover = nil
        progressObservation = nil
        UIView.animate(withDuration: 0.25, animations: { cover.alpha = 0 }) { _ in cover.removeFromSuperview() }
    }
}
