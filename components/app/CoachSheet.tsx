"use client";

import { useEffect, useRef, useState } from "react";
import { Plan } from "@/lib/types";
import { apiCoach } from "@/lib/api";
import { summarizeForCoach } from "@/lib/adapt";
import { CoachMsg } from "./ui";
import { Reactor } from "../Reactor";
import { Wordmark } from "../Wordmark";

export function CoachSheet({
  plan,
  today,
  prefill,
  messages,
  setMessages,
  onClose,
}: {
  plan: Plan;
  today: string;
  prefill?: string;
  messages: CoachMsg[];
  setMessages: React.Dispatch<React.SetStateAction<CoachMsg[]>>;
  onClose: () => void;
}) {
  const [input, setInput] = useState(prefill ?? "");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // dialog a11y: focus on open + Escape to close
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "you", text: q }]);
    setBusy(true);
    try {
      const ctx = summarizeForCoach(plan, today);
      const res = await apiCoach(ctx, q);
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="AmaTri coach chat"
        tabIndex={-1}
        className="animate-pop relative flex h-[80vh] flex-col rounded-t-3xl border-t border-line bg-background outline-none safe-b"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Reactor size={30} spinning={false} />
          <div className="flex-1">
            <div className="font-display font-bold"><Wordmark /> Coach</div>
            <div className="text-xs text-muted">Powered by Claude · Haiku</div>
          </div>
          <button onClick={onClose} aria-label="Close coach" className="text-muted hover:text-foreground">✕</button>
        </div>

        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-atomic="false"
          className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "you" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "you" ? "accent-gradient text-[#1a0d06]" : "border border-line bg-surface-2"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">Thinking…</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask your coach…"
          />
          <button onClick={send} disabled={busy || !input.trim()} className="btn btn-primary px-4 py-3">Send</button>
        </div>
      </div>
    </div>
  );
}
