"use client";

/**
 * The AmaTri chronograph mark — a fine watch dial rather than a sci-fi reactor.
 * A hairline bezel, minute ticks, and a single champagne hand. When `progress`
 * (0–100) is supplied the hand points to it and an accent arc fills the bezel
 * (used on the plan-generation loading screen). Otherwise the hand sweeps once
 * every few seconds like a running second-hand. Calm, precise, unadorned.
 */
export function Reactor({
  size = 180,
  progress,
  spinning = true,
}: {
  size?: number;
  progress?: number;
  spinning?: boolean;
}) {
  const p = progress == null ? null : Math.max(0, Math.min(100, progress));
  const R = 50;
  const C = 2 * Math.PI * R;
  const dash = p == null ? 0 : (p / 100) * C;
  const handAngle = p == null ? 0 : (p / 100) * 360;
  const sweep = spinning && p == null;

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      style={{ display: "block" }}
      aria-hidden
    >
      {/* hairline bezel */}
      <circle cx="60" cy="60" r={R + 6} fill="none" stroke="var(--line)" strokeWidth="1" />
      <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="1.5" />

      {/* minute ticks — subtle, with accented cardinal marks */}
      {Array.from({ length: 60 }).map((_, i) => {
        const cardinal = i % 15 === 0;
        const major = i % 5 === 0;
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const outer = R - 1;
        const inner = major ? R - (cardinal ? 8 : 6) : R - 3;
        const x1 = (60 + Math.cos(a) * outer).toFixed(2);
        const y1 = (60 + Math.sin(a) * outer).toFixed(2);
        const x2 = (60 + Math.cos(a) * inner).toFixed(2);
        const y2 = (60 + Math.sin(a) * inner).toFixed(2);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={cardinal ? "var(--accent)" : "var(--text-faint)"}
            strokeWidth={major ? 1.4 : 0.8}
            opacity={major ? 0.9 : 0.5}
          />
        );
      })}

      {/* progress arc (only when measuring) */}
      {p != null && (
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dasharray 0.3s ease" }}
        />
      )}

      {/* the hand — sweeps when idle, points to progress when measuring */}
      <g
        className={sweep ? "sweep" : undefined}
        style={sweep ? undefined : { transform: `rotate(${handAngle}deg)`, transformOrigin: "60px 60px", transition: "transform 0.3s ease" }}
      >
        <line x1="60" y1="60" x2="60" y2={60 - (R - 4)} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        <line x1="60" y1="60" x2="60" y2="70" stroke="var(--accent-2)" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* center hub */}
      <circle cx="60" cy="60" r="3.4" fill="var(--accent)" />
      <circle cx="60" cy="60" r="1.4" fill="var(--background)" />
    </svg>
  );
}
