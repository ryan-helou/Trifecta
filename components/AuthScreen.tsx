"use client";

import { useState } from "react";
import { useApp } from "./AppProvider";
import { Reactor } from "./Reactor";
import { Wordmark } from "./Wordmark";

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
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden">
      <div
        className="safe-t relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-7"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
      >
        {/* brand lockup */}
        <div className="animate-fade-up flex items-center gap-2.5 pt-7" style={{ animationDelay: "60ms" }}>
          <Reactor size={30} />
          <span className="font-display text-lg font-semibold tracking-tight">
            <Wordmark />
          </span>
        </div>

        {/* hero — the thesis */}
        <div className="shrink-0 pt-14">
          <div
            className="animate-fade-up eyebrow flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[0.82rem]"
            style={{ animationDelay: "240ms" }}
          >
            <span><span className="tnum text-foreground">2.4</span> <span className="text-swim">Swim</span></span>
            <span className="text-line">·</span>
            <span><span className="tnum text-foreground">112</span> <span className="text-bike">Bike</span></span>
            <span className="text-line">·</span>
            <span><span className="tnum text-foreground">26.2</span> <span className="text-run">Run</span></span>
          </div>

          <h1
            className="animate-rise mt-5 font-display text-[clamp(2.9rem,13vw,4.1rem)] font-semibold leading-[1.0] tracking-[-0.015em]"
            style={{ animationDelay: "180ms" }}
          >
            First light to
            <br />
            <span className="italic text-accent">finish line.</span>
          </h1>

          <p
            className="animate-fade-up mt-6 max-w-[22rem] text-[0.98rem] leading-relaxed text-muted"
            style={{ animationDelay: "340ms" }}
          >
            An Ironman is one enormous day — a dark-water start, a lit-up finish. Train every mile of it with a plan that adapts as you do.
          </p>
        </div>

        {/* breathing room */}
        <div className="min-h-10 flex-1" aria-hidden />

        {/* auth card — solid, hairline, quiet */}
        <div className="card-glass animate-rise relative shrink-0 p-4" style={{ animationDelay: "440ms" }}>
          <div className="flex rounded-full border border-line bg-surface-2 p-1 text-sm font-semibold">
            <button
              onClick={() => { setMode("signup"); setError(null); }}
              className={`flex-1 rounded-full py-2 transition ${mode === "signup" ? "bg-accent text-[#17130a]" : "text-muted"}`}
            >
              Create account
            </button>
            <button
              onClick={() => { setMode("login"); setError(null); }}
              className={`flex-1 rounded-full py-2 transition ${mode === "login" ? "bg-accent text-[#17130a]" : "text-muted"}`}
            >
              Sign in
            </button>
          </div>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <label className="eyebrow text-[0.78rem]">Username</label>
            <input
              className="input"
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ironmike"
            />
            <label className="eyebrow mt-1 text-[0.78rem]">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {error && <div className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

            <button type="submit" disabled={busy} className="btn btn-primary mt-4 py-3.5 text-base">
              {busy ? "One sec…" : mode === "signup" ? "Start training" : "Sign in"}
              {!busy && <span aria-hidden className="text-lg leading-none">→</span>}
            </button>
          </form>
        </div>

        <p className="animate-fade-up shrink-0 py-6 text-center text-xs text-muted" style={{ animationDelay: "540ms" }}>
          Built for you and your crew. Add it to your home screen to train like it&apos;s a native app.
        </p>
      </div>
    </div>
  );
}
