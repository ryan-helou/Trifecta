"use client";

import { useCallback, useEffect, useState } from "react";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { apiFollow, apiKudos, apiSocial } from "@/lib/api";
import { FeedCard, SocialPayload } from "@/lib/social";
import { daysBetween } from "@/lib/dates";
import { DisciplineIcon, Icon } from "./icons";
import { DISCIPLINE_META } from "@/lib/zones";
import { Discipline } from "@/lib/types";
import { haptic } from "@/lib/haptics";

function ago(todayISO: string, iso: string): string {
  const d = daysBetween(iso, todayISO);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export function FriendsTab() {
  const { today } = useUI();
  const toast = useToast();
  const [data, setData] = useState<SocialPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const p = await apiSocial(today);
    setData(p);
    setLoading(false);
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const follow = async (username: string, on: boolean) => {
    setBusy(true);
    const r = await apiFollow(username, on);
    setBusy(false);
    if (!r.ok) { toast({ text: r.error || "Couldn't update.", tone: "warning" }); return; }
    haptic(on ? "success" : "light");
    if (on) toast({ text: `Following ${username}.`, tone: "success" });
    load();
  };

  const add = async () => {
    const name = addName.trim();
    if (!name) return;
    await follow(name, true);
    setAddName("");
  };

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Friends</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">Train together</h1>
      </div>

      {/* add a friend */}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add a friend by username"
          autoCapitalize="none"
          autoCorrect="off"
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} disabled={busy || !addName.trim()} className="btn btn-primary px-5 py-3 text-sm disabled:opacity-40">Add</button>
      </div>

      {/* race cohort */}
      {data && data.cohort.count > 0 && (
        <div className="card-glass animate-fade-up flex items-center gap-3 p-4">
          <span className="text-accent"><Icon name="target" size={22} /></span>
          <div className="text-sm">
            <span className="font-semibold tabular-nums">{data.cohort.count}</span> other{data.cohort.count === 1 ? " athlete is" : " athletes are"} training for
            {data.cohort.raceName ? <> <span className="font-semibold">{data.cohort.raceName}</span></> : " your race"}.
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-6 text-center text-sm text-muted">Loading your crew…</div>
      ) : (
        <>
          {/* feed — who you follow */}
          {data && data.feed.length > 0 ? (
            <div className="space-y-2.5">
              <div className="eyebrow text-[0.72rem]">Your crew</div>
              {data.feed.map((c) => (
                <FriendRow key={c.username} card={c} today={today} onKudos={load} onUnfollow={() => follow(c.username, false)} />
              ))}
            </div>
          ) : (
            <div className="card animate-fade-up p-6 text-center">
              <div className="flex justify-center text-accent"><Icon name="friends" size={34} /></div>
              <div className="mt-2 font-display font-semibold">Build your crew</div>
              <p className="mx-auto mt-1 max-w-[17rem] text-sm text-muted">Add a friend by username, or follow someone training for your race below.</p>
            </div>
          )}

          {/* suggestions */}
          {data && data.suggestions.length > 0 && (
            <div className="space-y-2.5">
              <div className="eyebrow text-[0.72rem]">Athletes to follow</div>
              {data.suggestions.map((c) => (
                <div key={c.username} className="card flex items-center gap-3 p-3.5">
                  <Avatar name={c.username} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display font-semibold">{c.username}</div>
                    <div className="truncate text-xs text-muted">
                      {c.race ? c.race.name : "Getting started"}{c.race?.daysOut != null ? ` · ${c.race.daysOut}d out` : ""}
                    </div>
                  </div>
                  <button onClick={() => follow(c.username, true)} disabled={busy} className="btn btn-ghost px-4 py-2 text-sm">Follow</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FriendRow({ card, today, onKudos, onUnfollow }: { card: FeedCard; today: string; onKudos: () => void; onUnfollow: () => void }) {
  const [kudos, setKudos] = useState(card.latest?.kudos ?? 0);
  const [mine, setMine] = useState(card.latest?.kudosedByMe ?? false);
  const [busy, setBusy] = useState(false);

  const toggleKudos = async () => {
    if (!card.latest) return;
    const next = !mine;
    setMine(next);
    setKudos((k) => k + (next ? 1 : -1));
    setBusy(true);
    haptic(next ? "success" : "light");
    const r = await apiKudos(card.username, card.latest.workoutId, next);
    setBusy(false);
    if (r.ok && typeof r.kudos === "number") setKudos(r.kudos);
    onKudos();
  };

  const disc = (card.latest?.discipline ?? "run") as Discipline;

  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-3">
        <Avatar name={card.username} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display font-semibold">{card.username}</span>
            {card.streak >= 2 && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted"><Icon name="flame" size={12} className="text-accent" /><span className="tabular-nums">{card.streak}</span></span>
            )}
          </div>
          <div className="truncate text-xs text-muted">
            {card.race ? card.race.name : "Training"}{card.race?.daysOut != null ? ` · ${card.race.daysOut}d out` : ""}
          </div>
        </div>
        <button onClick={onUnfollow} className="text-xs text-muted transition hover:text-danger">Following</button>
      </div>

      {card.latest ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <span style={{ color: `var(${DISCIPLINE_META[disc].colorVar})` }}><DisciplineIcon discipline={disc} size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{card.latest.title}</div>
            <div className="text-xs text-muted">{ago(today, card.latest.whenISO)}</div>
          </div>
          <button
            onClick={toggleKudos}
            disabled={busy}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-sm transition ${mine ? "border-accent text-accent" : "border-line text-muted"}`}
          >
            <Icon name="heart" size={15} /> <span className="tabular-nums">{kudos}</span>
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-xs text-muted">No sessions logged yet — cheer them on soon.</div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full accent-gradient font-display text-sm font-bold text-white">
      {name[0]?.toUpperCase()}
    </div>
  );
}
