"use client";

import { TabKey } from "./ui";
import { haptic } from "@/lib/haptics";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "☀️" },
  { key: "plan", label: "Plan", icon: "🗓️" },
  { key: "progress", label: "Progress", icon: "📈" },
  { key: "profile", label: "Profile", icon: "👤" },
];

export function BottomNav({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  const activeIndex = TABS.findIndex((t) => t.key === tab);

  return (
    <nav className="sticky bottom-0 z-30 border-t border-line bg-background/90 backdrop-blur safe-b">
      <div className="relative mx-auto flex max-w-md">
        {/* the molten pill that slides to sit under the active tab */}
        <div
          aria-hidden
          className="nav-indicator pointer-events-none absolute top-0 flex justify-center pt-0.5"
          style={{ width: `${100 / TABS.length}%`, transform: `translateX(${activeIndex * 100}%)` }}
        >
          <span
            className="h-[3px] w-8 rounded-full accent-gradient"
            style={{ boxShadow: "0 0 10px color-mix(in oklab, var(--accent) 70%, transparent)" }}
          />
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
                className={`text-xl transition ${active ? "animate-nav-bounce" : "opacity-45 grayscale"}`}
              >
                {t.icon}
              </span>
              <span className={`text-[11px] font-semibold transition-colors ${active ? "text-accent-soft" : "text-muted"}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
