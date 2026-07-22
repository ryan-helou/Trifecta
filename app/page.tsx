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
function Anon() {
  const [view, setView] = useState<"welcome" | "onboarding" | "login">("welcome");
  if (view === "onboarding") return <Onboarding onLogin={() => setView("login")} />;
  if (view === "login") return <AuthScreen onBack={() => setView("welcome")} />;
  return (
    <WelcomeScreen
      onCreatePlan={() => setView("onboarding")}
      onSignIn={() => setView("login")}
    />
  );
}

function Root() {
  const { screen } = useApp();
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
}

export default function Page() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
