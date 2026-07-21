import * as React from "react";
import { Discipline } from "@/lib/types";

/*
  Bespoke line-icon set for the Chronograph identity. Hairline strokes, rounded
  joints, `currentColor` — so each icon inherits champagne/muted/discipline color
  from context, exactly like text. No emoji, no dependency. 24×24 grid.
*/

export type IconName =
  | "swim" | "bike" | "run" | "strength" | "brick" | "rest"
  | "today" | "plan" | "progress" | "friends" | "profile"
  | "smile" | "neutral" | "frown"
  | "flame" | "medal" | "calendar" | "stopwatch" | "chat" | "flag" | "trophy"
  | "search" | "heart" | "target" | "signal" | "bell" | "install" | "bolt"
  | "dumbbell" | "check" | "skip";

export function Icon({
  name,
  size = 22,
  strokeWidth = 1.75,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
  };
  const t = title ? <title>{title}</title> : null;

  switch (name) {
    // ---- disciplines ----
    case "swim":
      return (
        <svg {...p}>{t}
          <path d="M2 7q2.5-3 5 0t5 0 5 0 5 0" />
          <path d="M2 12q2.5-3 5 0t5 0 5 0 5 0" />
          <path d="M2 17q2.5-3 5 0t5 0 5 0 5 0" />
        </svg>
      );
    case "bike":
      return (
        <svg {...p}>{t}
          <circle cx="5.5" cy="16.5" r="3.5" />
          <circle cx="18.5" cy="16.5" r="3.5" />
          <path d="M5.5 16.5 10 8h6" />
          <path d="M10 8l4.5 8.5" />
          <path d="M16 8h2.5l0 8.5" />
          <path d="M8.5 8H11" />
        </svg>
      );
    case "run":
      return (
        <svg {...p}>{t}
          <circle cx="14.5" cy="4.5" r="2" />
          <path d="M13.6 6.9 11.2 11" />
          <path d="M11.2 11 14.6 12.8 13.2 18.5" />
          <path d="M11.2 11 7.8 13 9 17.5" />
          <path d="M12.8 7.9 16 9.4 15.4 12.3" />
          <path d="M13 7.6 9.8 8.9" />
        </svg>
      );
    case "strength":
    case "dumbbell":
      return (
        <svg {...p}>{t}
          <path d="M6.5 12h11" />
          <path d="M6.5 9.3v5.4M4.3 10.6v2.8M17.5 9.3v5.4M19.7 10.6v2.8" />
        </svg>
      );
    case "brick":
    case "bolt":
      return (
        <svg {...p}>{t}
          <path d="M12.5 2 5 13h5l-1.5 9 8.5-12h-5l1.5-8z" />
        </svg>
      );
    case "rest":
      return (
        <svg {...p}>{t}
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.6 6.6 0 0 0 20 14.5z" />
        </svg>
      );

    // ---- nav ----
    case "today":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5" />
        </svg>
      );
    case "plan":
    case "calendar":
      return (
        <svg {...p}>{t}
          <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
          <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
        </svg>
      );
    case "progress":
      return (
        <svg {...p}>{t}
          <path d="M3.5 20.5V4" />
          <path d="M3.5 20.5H21" />
          <path d="M7 15l3.5-3.5 3 3L20 7" />
          <path d="M20 11V7h-4" />
        </svg>
      );
    case "friends":
      return (
        <svg {...p}>{t}
          <circle cx="9" cy="8" r="3.2" />
          <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
          <path d="M16 5.2a3.2 3.2 0 0 1 0 6" />
          <path d="M17 13.4a6.2 6.2 0 0 1 4.2 6.6" />
        </svg>
      );
    case "profile":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );

    // ---- feel faces ----
    case "smile":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 14a4.5 4.5 0 0 0 7 0" />
          <path d="M9 9.5h.01M15 9.5h.01" />
        </svg>
      );
    case "neutral":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="12" r="8.5" />
          <path d="M9 15h6" />
          <path d="M9 9.5h.01M15 9.5h.01" />
        </svg>
      );
    case "frown":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 15.5a4.5 4.5 0 0 1 7 0" />
          <path d="M9 9.5h.01M15 9.5h.01" />
        </svg>
      );

    // ---- decorative / utility ----
    case "flame":
      return (
        <svg {...p}>{t}
          <path d="M12 2c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1 .3-1.7.8-2.4C9.6 8 12 7 12 2z" />
          <path d="M12 22a5 5 0 0 0 5-5c0-2-1.2-3.4-2.5-4.5" />
          <path d="M12 22a5 5 0 0 1-5-5c0-1 .3-1.8.8-2.5" />
        </svg>
      );
    case "medal":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="14.5" r="5.5" />
          <path d="M8.5 9.5 6 3M15.5 9.5 18 3M9.5 3h5" />
          <path d="M12 12.2l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L10 14.5l2-.3z" />
        </svg>
      );
    case "stopwatch":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="14" r="7.5" />
          <path d="M12 14V9.5M9.5 2.5h5M12 2.5v3M18.5 8l1.3-1.3" />
        </svg>
      );
    case "chat":
      return (
        <svg {...p}>{t}
          <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5z" />
        </svg>
      );
    case "flag":
      return (
        <svg {...p}>{t}
          <path d="M6 21V3.5" />
          <path d="M6 4h12l-2.5 3.5L18 11H6z" />
        </svg>
      );
    case "trophy":
      return (
        <svg {...p}>{t}
          <path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0z" />
          <path d="M7.5 6H5a2 2 0 0 0 2 3M16.5 6H19a2 2 0 0 1-2 3" />
          <path d="M12 13v3M9 20h6M9.5 20l.5-4h4l.5 4" />
        </svg>
      );
    case "search":
      return (
        <svg {...p}>{t}
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
      );
    case "heart":
      return (
        <svg {...p}>{t}
          <path d="M12 20.5S3.5 15.5 3.5 9.3A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8.5 2.3c0 6.2-8.5 11.2-8.5 11.2z" />
        </svg>
      );
    case "target":
      return (
        <svg {...p}>{t}
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.6" />
        </svg>
      );
    case "signal":
      return (
        <svg {...p}>{t}
          <path d="M4.5 12a7.5 7.5 0 0 1 7.5 7.5" />
          <path d="M4.5 6.5a13 13 0 0 1 13 13" />
          <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "bell":
      return (
        <svg {...p}>{t}
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );
    case "install":
      return (
        <svg {...p}>{t}
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <path d="M12 8v6M9.5 11.5 12 14l2.5-2.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>{t}
          <path d="M4.5 12.5l4.5 4.5 10.5-11" />
        </svg>
      );
    case "skip":
      return (
        <svg {...p}>{t}
          <path d="M7 6l6 6-6 6" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
  }
}

// discipline → icon name (brick reads as the effort-combo bolt)
const DISCIPLINE_ICON: Record<Discipline, IconName> = {
  swim: "swim",
  bike: "bike",
  run: "run",
  brick: "brick",
  strength: "strength",
  rest: "rest",
};

export function DisciplineIcon({
  discipline,
  size,
  className,
}: {
  discipline: Discipline;
  size?: number;
  className?: string;
}) {
  return <Icon name={DISCIPLINE_ICON[discipline] ?? "run"} size={size} className={className} />;
}
