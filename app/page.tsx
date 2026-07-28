"use client";

import { useState } from "react";
import { AppProvider, useApp } from "@/components/AppProvider";
import { AuthScreen } from "@/components/AuthScreen";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { AppShell } from "@/components/app/AppShell";
import { BootSplash } from "@/components/BootSplash";

// Logged-out athletes land on the welcome screen. "Create your plan" goes
// straight into the questionnaire — the account is created at the very end, once
// the plan is built. "Sign in" is the door for returning athletes.
//
// Leaving the welcome screen calls markEngaged(): from that point on, a session that
// finishes restoring in the background is offered rather than imposed. Without it, a
// slow /me landing at step 7 replaced the entire questionnaire with somebody's app.
function Anon() {
  const { markEngaged } = useApp();
  const [view, setView] = useState<"welcome" | "onboarding" | "login">("welcome");
  const go = (v: "onboarding" | "login") => {
    markEngaged();
    setView(v);
  };
  if (view === "onboarding") return <Onboarding onLogin={() => go("login")} />;
  if (view === "login") return <AuthScreen onBack={() => setView("welcome")} />;
  return <WelcomeScreen onCreatePlan={() => go("onboarding")} onSignIn={() => go("login")} />;
}

/** Shown when a session restored *after* the athlete started doing something. It sits
 *  over their work instead of replacing it — the entire point is that nothing they've
 *  entered disappears unless they choose it. */
function SessionPrompt() {
  const { pendingSession, adoptPendingSession, dismissPendingSession } = useApp();
  if (!pendingSession) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-4 pt-3"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
      role="status"
    >
      <div className="card-glass animate-fade-up mx-auto max-w-md rounded-2xl p-4">
        <div className="font-display font-semibold">
          You&apos;re still signed in as {pendingSession.username}
        </div>
        <p className="mt-1 text-sm text-muted">
          That account just finished loading. Open it, or carry on with what you were doing —
          nothing you&apos;ve entered here is lost either way.
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={adoptPendingSession} className="btn btn-primary flex-1 py-2.5 text-sm">
            Open my account
          </button>
          <button onClick={dismissPendingSession} className="btn btn-ghost flex-1 py-2.5 text-sm">
            Keep going here
          </button>
        </div>
      </div>
    </div>
  );
}

function Root() {
  const { screen } = useApp();
  const view = (() => {
    switch (screen) {
      case "loading":
        return <BootSplash />;
      case "anon":
        return <Anon />;
      case "onboarding":
        return <Onboarding />;
      case "app":
        return <AppShell />;
    }
  })();
  return (
    <>
      {view}
      <SessionPrompt />
    </>
  );
}

export default function Page() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
