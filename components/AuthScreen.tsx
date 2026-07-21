"use client";

import { useState } from "react";
import { useApp } from "./AppProvider";
import { Reactor } from "./Reactor";
import { Wordmark } from "./Wordmark";
import { EmberField } from "./EmberField";

export function AuthScreen() {
  const { signup, login } = useApp();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = mode === "signup" ? await signup(username, password) : await login(username, password);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      {/* forge atmosphere */}
      <div className="forge-floor" aria-hidden />
      <EmberField />
      <div className="noise-overlay" aria-hidden />
      <div className="forge-vignette" aria-hidden />

      <div className="no-scrollbar safe-t safe-b relative z-10 mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-6">
        {/* brand lockup */}
        <div className="animate-fade-up flex items-center gap-2.5 pt-6" style={{ animationDelay: "60ms" }}>
          <Reactor size={34} />
          <span className="font-display text-lg font-bold tracking-tight">
            <Wordmark />
          </span>
        </div>

        {/* hero — the thesis */}
        <div className="shrink-0 pt-11">
          <div
            className="animate-fade-up flex items-center gap-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.32em]"
            style={{ animationDelay: "260ms" }}
          >
            <span className="text-swim lit-swim">Swim</span>
            <span className="text-line">/</span>
            <span className="text-bike lit-bike">Bike</span>
            <span className="text-line">/</span>
            <span className="text-run lit-run">Run</span>
          </div>

          <h1 className="animate-rise mt-4 font-display font-bold uppercase leading-[0.88] tracking-[-0.03em] text-[clamp(2.75rem,14vw,3.75rem)]" style={{ animationDelay: "180ms" }}>
            <span className="heat-steel">Forge</span>
            <span className="ml-2.5 align-baseline text-[0.34em] font-semibold normal-case tracking-[0.12em] text-muted">the</span>
            <br />
            <span className="heat-payoff inline-block">
              <span className="heat-molten forge-strike">finish.</span>
            </span>
          </h1>

          <p className="animate-fade-up mt-5 max-w-[19rem] text-[0.95rem] leading-relaxed text-muted" style={{ animationDelay: "360ms" }}>
            An adaptive, day-by-day plan for Olympic, 70.3, and full Ironman — one that reshapes itself as you do.
          </p>
        </div>

        {/* breathing room where the sparks rise toward the forge */}
        <div className="min-h-10 flex-1" aria-hidden />

        {/* auth card — quiet, rising from the forge floor */}
        <div className="card-glass forge-card animate-rise relative shrink-0 p-4" style={{ animationDelay: "460ms" }}>
          <div className="forge-edge" aria-hidden />

          <div className="flex rounded-full border border-line bg-surface-2/80 p-1 text-sm font-semibold">
            <button
              onClick={() => { setMode("signup"); setError(null); }}
              className={`flex-1 rounded-full py-2 transition ${mode === "signup" ? "accent-gradient text-[#1a0d06]" : "text-muted"}`}
            >
              Create account
            </button>
            <button
              onClick={() => { setMode("login"); setError(null); }}
              className={`flex-1 rounded-full py-2 transition ${mode === "login" ? "accent-gradient text-[#1a0d06]" : "text-muted"}`}
            >
              Sign in
            </button>
          </div>

          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Username</label>
            <input
              className="input"
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ironmike"
            />
            <label className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {error && <div className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

            <button type="submit" disabled={busy} className="btn btn-primary mt-3 py-3.5 text-base">
              {busy ? "One sec…" : mode === "signup" ? "Start training" : "Sign in"}
              {!busy && <span aria-hidden className="text-lg leading-none">→</span>}
            </button>
          </form>
        </div>

        <p className="animate-fade-up shrink-0 py-5 text-center text-xs text-muted" style={{ animationDelay: "560ms" }}>
          Built for you and your crew. Add it to your home screen to train like it&apos;s a native app.
        </p>
      </div>
    </div>
  );
}
