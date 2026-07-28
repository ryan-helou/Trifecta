"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { IS_NATIVE } from "@/lib/runtime";

interface BIPEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function InstallHint() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // already IN the native app — telling them to "Add to Home Screen from Safari" is nonsense
    if (IS_NATIVE) { setInstalled(true); return; }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }
    const ua = window.navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <div className="mb-1 flex items-center gap-2 font-semibold"><Icon name="install" size={18} className="text-accent" /> Install Trifecta</div>
      {deferred ? (
        <>
          <p className="mb-3 text-sm text-muted">Add it to your home screen to run it full-screen, like a real app.</p>
          <button
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            }}
            className="btn btn-primary w-full py-2.5"
          >
            Add to home screen
          </button>
        </>
      ) : isIOS ? (
        <p className="text-sm text-muted">
          Tap the <span className="font-semibold text-foreground">Share</span> button in Safari, then{" "}
          <span className="font-semibold text-foreground">Add to Home Screen</span>. It&apos;ll open full-screen like a native app.
        </p>
      ) : (
        <p className="text-sm text-muted">
          In your browser menu, choose <span className="font-semibold text-foreground">Install app</span> /{" "}
          <span className="font-semibold text-foreground">Add to Home Screen</span> to run Trifecta full-screen.
        </p>
      )}
    </div>
  );
}
