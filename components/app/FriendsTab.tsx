"use client";

import { useApp } from "../AppProvider";
import { useToast } from "./Toast";
import { haptic } from "@/lib/haptics";
import { Icon, IconName } from "./icons";

const COMING: { icon: IconName; title: string; body: string }[] = [
  { icon: "target", title: "Build toward the same race", body: "Link up with friends chasing the same start line and see the countdown together." },
  { icon: "signal", title: "See each other's sessions", body: "A simple feed of who trained today — no numbers to chase, just momentum you can feel." },
  { icon: "bell", title: "Gentle nudges", body: "\"Your buddy just finished their ride.\" Encouragement, opt-in, never pressure." },
  { icon: "medal", title: "Share the wins", body: "Send a long ride or a race result to the group chat as a card, not a screenshot." },
];

export function FriendsTab() {
  const { profile } = useApp();
  const toast = useToast();
  const raceName = profile?.raceName ?? profile?.custom?.name;

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Friends</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">Train together</h1>
      </div>

      {/* hero */}
      <div className="card-glass animate-fade-up relative overflow-hidden p-5 text-center" style={{ animationDelay: "60ms" }}>
        <div className="flex justify-center text-accent"><Icon name="friends" size={40} /></div>
        <div className="mt-2 font-display text-lg font-semibold">Coming soon</div>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-sm text-muted">
          The hardest sessions are easier with someone in it with you.
          {raceName ? <> Soon you&apos;ll take on <span className="font-semibold text-foreground">{raceName}</span> alongside your friends.</> : <> Soon you&apos;ll train for your race alongside your friends.</>}
        </p>
      </div>

      {/* what's coming */}
      <div className="space-y-2.5">
        {COMING.map((c, i) => (
          <div key={c.title} className="card animate-fade-up flex items-start gap-3 p-4" style={{ animationDelay: `${120 + i * 50}ms` }}>
            <span className="mt-0.5 text-accent"><Icon name={c.icon} size={20} /></span>
            <div>
              <div className="font-display text-[0.98rem] font-semibold">{c.title}</div>
              <div className="mt-0.5 text-sm text-muted">{c.body}</div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => { haptic("light"); toast({ text: "We'll let you know the moment friends land.", tone: "default" }); }}
        className="btn btn-primary w-full py-3.5 text-base"
      >
        Notify me when it&apos;s ready
      </button>
      <p className="px-4 text-center text-xs text-muted">Being built now — it&apos;s next on the roadmap.</p>
    </div>
  );
}
