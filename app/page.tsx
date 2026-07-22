"use client";

import { useState } from "react";
import { AppProvider, useApp } from "@/components/AppProvider";
import { AuthScreen } from "@/components/AuthScreen";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { AppShell } from "@/components/app/AppShell";
import { BootSplash } from "@/components/BootSplash";

// Logged-out athletes land on the welcome screen; "Create your plan" (or Sign in)
// reveals the account step, which flows into onboarding.
function Anon() {
  const [started, setStarted] = useState(false);
  return started ? <AuthScreen /> : <WelcomeScreen onStart={() => setStarted(true)} />;
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
