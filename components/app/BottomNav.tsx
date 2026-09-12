"use client";

import { TabKey } from "./ui";
import { haptic } from "@/lib/haptics";
import { Icon, IconName } from "./icons";

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: "today", label: "Today", icon: "today" },
  { key: "plan", label: "Plan", icon: "plan" },
  { key: "progress", label: "Progress", icon: "progress" },
  { key: "friends", label: "Friends", icon: "friends" },
  { key: "profile", label: "Profile", icon: "profile" },
];

export function BottomNav({
  tab,
  onChange,
  badges,
}: {
  tab: TabKey;
  onChange: (t: TabKey) => void;
  /** unread counts per tab — today only Friends has one (#33) */
  badges?: Partial<Record<TabKey, number>>;
}) {
  const activeIndex = TABS.findIndex((t) => t.key === tab);

  return (
    // FIXED, NOT STICKY.
    //
    // `sticky bottom-0` pins to the bottom of the nav's CONTAINING BLOCK, and that block
    // is the app shell — whose height comes from `min-h-full` resolving `100%` against
    // html. In a browser that is the screen and everything is fine. In the Capacitor
    // WKWebView it is not always the screen, and when the container comes out shorter
    // than its content the nav pins to the container's bottom instead of the viewport's:
    // the bar lands in the MIDDLE of the screen with the rest of Today spilling out
    // underneath it, unreachable. Ryan sent a photo of exactly that — the tab bar across
    // the middle, then the week card, form strip and "Race & plan details" stranded below.
    //
    // `fixed` cannot fail that way: it is positioned against the viewport, so the bar is
    // at the bottom of the screen regardless of what any ancestor's height resolves to.
    // The one thing that breaks `fixed` is a transformed ancestor — TabDeck's track and
    // PullToRefresh both set transforms — and neither is an ancestor of the nav; it is
    // their sibling, and its chain to <html> is transform-free. The scroll region pays for
    // this with bottom padding (see AppShell) so nothing hides behind the bar.
    <nav className="nav-chrome fixed inset-x-0 bottom-0 z-30 border-t border-line bg-background safe-b">
      <div className="relative mx-auto flex max-w-md">
        {/* the champagne underline that slides to sit under the active tab */}
        <div
          aria-hidden
          className="nav-indicator pointer-events-none absolute top-0 flex justify-center"
          style={{ width: `${100 / TABS.length}%`, transform: `translateX(${activeIndex * 100}%)` }}
        >
          <span className="h-[2px] w-8 rounded-full bg-accent" />
        </div>

        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                if (!active) haptic("select");
                onChange(t.key);
              }}
              aria-current={active ? "page" : undefined}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 transition"
            >
              <span
                key={active ? "on" : "off"}
                className={`relative transition ${active ? "animate-nav-bounce text-accent" : "text-muted"}`}
              >
                <Icon name={t.icon} size={22} strokeWidth={active ? 1.9 : 1.6} />
                {/* A dot, not a number: the count is on the tab itself, and a
                    two-digit badge on a 22px icon is unreadable at this size. */}
                {!!badges?.[t.key] && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background"
                    style={{ background: "var(--accent)" }}
                  />
                )}
              </span>
              <span className={`text-[11px] font-semibold transition-colors ${active ? "text-accent" : "text-muted"}`}>
                {t.label}
              </span>
              {!!badges?.[t.key] && <span className="sr-only">{badges[t.key]} unread</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
