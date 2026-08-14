"use client";

import { useEffect, useState } from "react";
import { ApiKeyInfo, apiCreateToken, apiListTokens, apiRevokeToken } from "@/lib/api";
// ./apiKeyFormat, NOT ./apiKeys — the latter imports node:crypto and this is a
// client component.
import { API_KEY_NAME_MAX } from "@/lib/apiKeyFormat";
import { API_BASE } from "@/lib/runtime";
import { useToast } from "./Toast";

/*
  Profile → read-only API keys.

  What this is for: letting another app of yours (a dashboard, a script) read your
  training plan without holding your password. The alternative it replaces is
  storing your real credentials somewhere else, which would also grant WRITE access
  to the whole plan — see PUT /api/state, which refuses these keys outright.

  Collapsed by default, and deliberately near the bottom of the tab. Almost nobody
  needs it; the people who do will look for it. It is not in the danger zone, because
  minting a read-only credential you can revoke in one tap is not a destructive act.
*/
export function ApiKeys() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="eyebrow text-[0.72rem]">Developer access</span>
        <span className="text-xs text-muted">
          {open ? "Hide" : "API keys"} <span className="ml-0.5 text-accent-soft">{open ? "▴" : "▾"}</span>
        </span>
      </button>
      {open && <ApiKeysPanel />}
    </div>
  );
}

function ApiKeysPanel() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // The plaintext key, held ONLY between minting it and the athlete dismissing it.
  // Never persisted, and gone on unmount — the server cannot show it again.
  const [fresh, setFresh] = useState<string | null>(null);

  const refresh = async () => {
    const r = await apiListTokens();
    setKeys(r.ok ? r.keys : []);
  };

  useEffect(() => {
    let alive = true;
    apiListTokens().then((r) => alive && setKeys(r.ok ? r.keys : []));
    return () => {
      alive = false;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    const r = await apiCreateToken(name);
    setBusy(false);
    if (!r.ok || !r.key) {
      toast({ text: r.error || "Couldn't create the key.", tone: "warning" });
      return;
    }
    setFresh(r.key);
    setName("");
    setNaming(false);
    refresh();
  };

  const revoke = async (k: ApiKeyInfo) => {
    setBusy(true);
    const r = await apiRevokeToken(k.id);
    setBusy(false);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't revoke the key.", tone: "warning" });
      return;
    }
    toast({ text: `"${k.name}" revoked — it stops working immediately.`, tone: "success" });
    refresh();
  };

  const live = (keys ?? []).filter((k) => !k.revokedAtISO);
  const dead = (keys ?? []).filter((k) => k.revokedAtISO);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3.5">
        <p className="text-sm leading-snug text-muted">
          A key lets another app read your plan without your password. It can
          <b className="text-foreground"> only read</b> — nothing holding one can change your training,
          and you can kill it here any time.
        </p>
      </div>

      {fresh && <FreshKey value={fresh} onDone={() => setFresh(null)} />}

      {keys === null ? (
        <div className="px-4 py-3.5 text-sm text-muted">Loading…</div>
      ) : live.length === 0 && dead.length === 0 ? (
        <div className="px-4 py-3.5 text-sm text-muted">No keys yet.</div>
      ) : (
        <>
          {live.map((k) => (
            <KeyRow key={k.id} k={k} busy={busy} onRevoke={() => revoke(k)} />
          ))}
          {dead.map((k) => (
            <KeyRow key={k.id} k={k} busy={busy} />
          ))}
        </>
      )}

      {naming ? (
        <div className="border-t border-line p-3">
          <label htmlFor="apikey-name" className="mb-1.5 block text-xs text-muted">
            What&apos;s it for? You&apos;ll see this name in the list.
          </label>
          <input
            id="apikey-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={API_KEY_NAME_MAX}
            autoFocus
            placeholder="JARVIS dashboard"
            className="input w-full"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={create}
              disabled={busy || !name.trim()}
              className="btn btn-primary flex-1 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create key"}
            </button>
            <button
              onClick={() => {
                setNaming(false);
                setName("");
              }}
              className="btn btn-ghost flex-1 py-2.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="flex w-full items-center justify-between border-t border-line px-4 py-3.5 text-left text-sm transition hover:bg-surface-2"
        >
          <span>Create a key</span>
          <span className="text-accent-soft">›</span>
        </button>
      )}

      <HowToUse />
    </div>
  );
}

/** The one and only time the key is visible.
 *
 *  Not a toast and not auto-dismissing: the server keeps a hash, so if this closes
 *  before it's copied the key is unrecoverable and the athlete has to revoke and
 *  start over. It stays until they say they have it. */
function FreshKey({ value, onDone }: { value: string; onDone: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ text: "Key copied.", tone: "success" });
    } catch {
      // Clipboard access isn't guaranteed in a WKWebView. Say so rather than
      // silently doing nothing — the key is on screen and selectable either way.
      toast({ text: "Couldn't copy automatically — select the key and copy it by hand.", tone: "warning" });
    }
  };

  return (
    <div className="border-b border-line bg-surface-2 px-4 py-3.5">
      <div className="text-sm font-semibold">Your new key</div>
      <p className="mt-1 text-xs leading-snug text-muted">
        Copy it now — <b className="text-foreground">this is the only time it&apos;s shown</b>. We store a
        hash, so nobody, including us, can show it to you again.
      </p>
      <code
        className="mt-2.5 block select-all break-all rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-xs"
        /* select-all so one tap selects the whole thing when the clipboard API is
           unavailable, which is the realistic failure mode inside the app shell. */
      >
        {value}
      </code>
      <div className="mt-2 flex gap-2">
        <button onClick={copy} className="btn btn-ghost flex-1 py-2.5 text-sm font-semibold">
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button onClick={onDone} className="btn btn-ghost flex-1 py-2.5 text-sm">
          I&apos;ve saved it
        </button>
      </div>
    </div>
  );
}

function KeyRow({ k, busy, onRevoke }: { k: ApiKeyInfo; busy: boolean; onRevoke?: () => void }) {
  const revoked = !!k.revokedAtISO;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
      <div className="min-w-0">
        <div className={`truncate text-sm font-semibold ${revoked ? "text-muted line-through" : ""}`}>{k.name}</div>
        <div className="text-xs text-muted">
          {revoked
            ? `Revoked ${shortDate(k.revokedAtISO!)}`
            : `Created ${shortDate(k.createdAtISO)} · ${k.lastUsedAtISO ? `last used ${shortDate(k.lastUsedAtISO)}` : "never used"}`}
        </div>
      </div>
      {onRevoke && (
        <button
          onClick={onRevoke}
          disabled={busy}
          className="shrink-0 text-xs font-semibold disabled:opacity-50"
          style={{ color: "var(--danger)" }}
        >
          Revoke
        </button>
      )}
    </div>
  );
}

/** The half of the job that isn't in the app: what to point the other app at.
 *  Without this the athlete has a key and no idea where to send it. */
function HowToUse() {
  // The web PWA is same-origin, so API_BASE is "" there and only the browser knows
  // the real host. Read directly rather than in an effect: this panel only mounts
  // after a tap (the section starts collapsed), so no prerender pass reaches here
  // and there is no hydration text to mismatch.
  const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  return (
    <div className="border-t border-line px-4 py-3.5">
      <div className="mb-1.5 text-xs font-semibold">Using it</div>
      <code className="block select-all break-all rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-[0.68rem] leading-relaxed text-muted">
        GET {origin}/api/state
        <br />
        Authorization: Bearer tri_…
      </code>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
