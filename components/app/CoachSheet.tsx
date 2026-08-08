"use client";

import { useEffect, useRef, useState } from "react";
import { Plan } from "@/lib/types";
import { apiCoach } from "@/lib/api";
import { summarizeForCoach } from "@/lib/adapt";
import { proposeFromText, type ActionPreview } from "@/lib/coachActions";
import { CoachMsg } from "./ui";
import { Sheet } from "./Sheet";
import { haptic } from "@/lib/haptics";
import { LogoMark } from "../Logo";
import { Wordmark } from "../Wordmark";
import { workoutsOn } from "./widgets";

/** The company, not the build. The server reports something like
 *  "Google (Gemini) · gemini-3.5-flash-lite", and the whole string was being printed
 *  under the coach's name — an athlete has no use for a model id, and it dates the
 *  product every time the model is swapped (#138). The company still has to be named:
 *  this line exists because their question leaves the device, and guideline 5.1.2(i)
 *  wants the recipient stated. So keep the who, drop the build number. */
function providerName(raw: string): string {
  return raw.split(/[·|]/)[0].trim() || raw;
}

export function CoachSheet({
  plan,
  today,
  prefill,
  messages,
  setMessages,
  onClose,
  onApply,
}: {
  plan: Plan;
  today: string;
  prefill?: string;
  messages: CoachMsg[];
  setMessages: React.Dispatch<React.SetStateAction<CoachMsg[]>>;
  onClose: () => void;
  /** apply a change the athlete accepted from the chat */
  onApply: (p: ActionPreview) => void;
}) {
  const [input, setInput] = useState(prefill ?? "");
  const [busy, setBusy] = useState(false);
  // A change the athlete asked for in words, waiting on their confirmation. The
  // Coach proposes; it never applies on its own.
  const [proposal, setProposal] = useState<ActionPreview | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(preset?: string) {
    const q = (preset ?? input).trim();
    if (!q || busy) return;
    haptic("light");
    setInput("");
    setMessages((m) => [...m, { role: "you", text: q }]);
    setBusy(true);
    // Matched locally and deterministically — the model never touches the plan.
    // null is the common answer, and then the Coach just talks, as before.
    setProposal(proposeFromText(q, plan, today));
    try {
      // fail closed: nothing about the athlete's body unless they opted in
      const ctx = summarizeForCoach(plan, today, {
        includeHealth: plan.profile.aiHealthConsent?.granted === true,
      });
      const res = await apiCoach(ctx, q);
      if (res.provider) setProvider(res.provider);
      setMessages((m) => [...m, { role: "coach", text: res.text || "…" }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "coach", text: "I couldn't reach the coach — check your connection and try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  // starter prompts for the empty chat — a coach's opening beats a blank box.
  // The first one is anchored to today's actual session when there is one.
  const todayW = workoutsOn(plan, today)[0];
  const suggestions = [
    todayW ? `How should I pace my ${todayW.title}?` : "What should I focus on this week?",
    "What should I eat before and after a session?",
    "I'm feeling tired — should I adjust today?",
    "Am I on track for race day?",
  ];
  const fresh = messages.length <= 1 && !input.trim();

  return (
    <Sheet
      onClose={onClose}
      label="Trifecta coach chat"
      panelClassName="h-[82vh]"
      header={
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
          {/* The vector mark, not the app-icon tile. The tile is baked light, so on the
              dark theme it rendered as a white chip — the brightest thing on the sheet,
              pulling the eye away from the conversation it labels. This inherits ink. */}
          <LogoMark size={22} />
          <div className="flex-1">
            <div className="font-display font-bold"><Wordmark /> Coach</div>
            {/* Reported by the server, not hard-coded. This line read "Powered by
                Claude · Haiku" while every request actually went to Google's Gemini
                endpoint — the UI naming the wrong company for where the athlete's text
                goes (guideline 5.1.2(i)). Until the first reply tells us, say what is
                true of every case: it leaves the device. */}
            <div className="text-xs text-muted">
              {provider ? `Powered by ${providerName(provider)}` : "AI coach — your question is sent to our AI provider"}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close coach" className="text-muted hover:text-foreground">✕</button>
        </div>
      }
      footer={
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask your coach…"
          />
          <button onClick={() => send()} disabled={busy || !input.trim()} className="btn btn-primary px-4 py-3">Send</button>
        </div>
      }
    >
      <div role="log" aria-live="polite" aria-atomic="false" className="space-y-3 px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "you" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === "you" ? "accent-gradient text-on-accent" : "border border-line bg-surface-2"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {fresh && (
          <div className="animate-fade-up space-y-2 pt-1">
            <div className="eyebrow text-[0.72rem]">Try asking</div>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5 text-left text-sm transition hover:bg-surface-3 active:scale-[0.99]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">Thinking…</div>
          </div>
        )}
        {/* The Coach's hands. It says what it will do, in one sentence, BEFORE
            doing it — the athlete taps, or doesn't. Nothing here is applied by
            the model, and nothing is applied without this tap. */}
        {proposal && !busy && (
          <div className="rounded-2xl border border-accent/35 bg-accent/5 p-3.5">
            <div className="eyebrow mb-1 text-[0.7rem] text-accent">I can do that</div>
            <p className="text-sm leading-snug">{proposal.summary}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  haptic("success");
                  onApply(proposal);
                  setMessages((m) => [...m, { role: "coach", text: `Done — ${proposal.summary.replace(/\.$/, "")}. You can undo that from the toast.` }]);
                  setProposal(null);
                }}
                className="btn btn-primary flex-1 py-2.5 text-sm"
              >
                Do it
              </button>
              <button onClick={() => setProposal(null)} className="btn btn-ghost flex-1 py-2.5 text-sm">
                Leave it
              </button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </Sheet>
  );
}
