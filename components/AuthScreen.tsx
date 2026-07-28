"use client";

import { useState } from "react";
import { useApp } from "./AppProvider";
import { Reactor } from "./Reactor";
import { Wordmark } from "./Wordmark";

/**
 * Login screen for RETURNING athletes. New athletes build their plan first and
 * create their account at the end of onboarding, so this screen is login-only,
 * reached via "Sign in" — with a way back to the welcome screen.
 */
export function AuthScreen({ onBack }: { onBack?: () => void }) {
  const { login } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const err = await login(username.trim(), password);
      if (err) setError(err);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden">
      {/*
        Layout note — do NOT reintroduce a `flex-1` spacer that pins the card to the
        bottom of a 100dvh column. On device that put the password field and the Sign
        in button underneath the iOS keyboard, and because the column exactly filled
        the viewport there was no overflow for WKWebView to scroll them back into
        view: focusing "Username" made the rest of the form unreachable. The form now
        sits high in the natural document flow (comfortably above a ~340pt keyboard)
        and the page scrolls if it ever doesn't fit.
      */}
      <div
        className="safe-t relative z-10 mx-auto flex w-full max-w-md flex-col px-7"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
      >
        {/* brand lockup + back to the welcome screen */}
        <div className="animate-fade-up flex items-center justify-between pt-7" style={{ animationDelay: "60ms" }}>
          <div className="flex items-center gap-2.5">
            <Reactor size={30} />
            <span className="font-display text-lg font-semibold tracking-tight">
              <Wordmark />
            </span>
          </div>
          {onBack && (
            <button onClick={onBack} className="text-sm font-semibold text-muted transition hover:text-foreground">
              ← Back
            </button>
          )}
        </div>

        {/* hero */}
        <div className="shrink-0 pt-9">
          <h1
            className="animate-rise font-display text-[clamp(2.4rem,11vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.015em]"
            style={{ animationDelay: "180ms" }}
          >
            Welcome
            <br />
            <span className="italic text-accent">back.</span>
          </h1>
          <p
            className="animate-fade-up mt-4 max-w-[22rem] text-[0.98rem] leading-relaxed text-muted"
            style={{ animationDelay: "340ms" }}
          >
            Sign in to pick up your plan right where you left off.
          </p>
        </div>

        {/* login card */}
        <div className="card-glass animate-rise relative mt-8 shrink-0 p-5" style={{ animationDelay: "440ms" }}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="eyebrow text-[0.78rem]" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              name="username"
              className="input"
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              enterKeyHint="next"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ironmike"
            />
            <label className="eyebrow mt-1 text-[0.78rem]" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              enterKeyHint="go"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {error && <div className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

            <button type="submit" disabled={busy} className="btn btn-primary mt-4 py-3.5 text-base">
              {busy ? "One sec…" : "Sign in"}
              {!busy && <span aria-hidden className="text-lg leading-none">→</span>}
            </button>
          </form>
        </div>

        <p className="animate-fade-up shrink-0 py-6 text-center text-sm text-muted" style={{ animationDelay: "540ms" }}>
          New here?{" "}
          <button onClick={onBack} className="font-semibold text-foreground underline-offset-2 hover:underline">
            Build your plan
          </button>
        </p>
      </div>
    </div>
  );
}
