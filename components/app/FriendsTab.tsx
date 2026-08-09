"use client";

import { useCallback, useEffect, useState } from "react";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { apiComment, apiDeleteComment, apiFollow, apiKudos, apiModerate, apiSocial } from "@/lib/api";
import { FeedCard, FeedItem, SocialPayload } from "@/lib/social";
import { daysBetween } from "@/lib/dates";
import { DisciplineIcon, Icon } from "./icons";
import { DISCIPLINE_META } from "@/lib/zones";
import { Discipline, Unit } from "@/lib/types";
import { fmtDistance, fmtDuration, fmtPace, fmtPace100 } from "@/lib/format";
import { haptic } from "@/lib/haptics";

function ago(todayISO: string, iso: string): string {
  const d = daysBetween(iso, todayISO);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/**
 * One session in the feed (#183) — sport, duration, distance, pace and the
 * athlete's own words, with kudos and comments under it.
 *
 * MODERATION IS PART OF THE COMPONENT, not a settings screen. This is the app's
 * first user-generated content and App Review guideline 1.2 requires a report
 * path and a block for it; more to the point, "report this" three taps away in
 * Settings is not a real escape hatch for someone reading something they don't
 * want to read. It sits on the row that carries the content.
 */
function FeedRow({
  item,
  today,
  unit,
  onChanged,
}: {
  item: FeedItem;
  today: string;
  unit: Unit;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = DISCIPLINE_META[item.discipline as Discipline];

  const kudos = async () => {
    haptic(item.kudosedByMe ? "light" : "success");
    const r = await apiKudos(item.username, item.workoutId, !item.kudosedByMe);
    if (!r.ok) toast({ text: r.error || "Couldn't do that.", tone: "warning" });
    onChanged();
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const r = await apiComment(item.username, item.workoutId, t);
    setBusy(false);
    if (!r.ok) { toast({ text: r.error || "Couldn't post that.", tone: "warning" }); return; }
    setText("");
    haptic("success");
    onChanged();
  };

  const removeComment = async (id: string) => {
    const r = await apiDeleteComment(id);
    if (!r.ok) toast({ text: r.error || "Couldn't delete that.", tone: "warning" });
    onChanged();
  };

  // Report AND block in one action: reporting someone and still seeing them is
  // not a resolution, and asking the athlete to make the same decision twice is
  // just friction at the worst possible moment.
  const report = async () => {
    const r = await apiModerate("report", item.username);
    if (!r.ok) { toast({ text: r.error || "Couldn't report that.", tone: "warning" }); return; }
    toast({ text: `Reported. You won't see ${item.username} again.`, tone: "success", duration: 7000 });
    onChanged();
  };

  // Each sport in its own unit — see FeedItem. A ride reads in km/h, a run in
  // min/km, a swim per 100m; a gym session simply shows a duration.
  const intensity = item.paceSecPerKm
    ? fmtPace(item.paceSecPerKm, unit)
    : item.speedKmh
    ? `${item.speedKmh} km/h`
    : item.paceSecPer100M
    ? fmtPace100(item.paceSecPer100M)
    : null;
  const stats = [
    fmtDuration(item.durationSec),
    item.distanceM ? fmtDistance(item.distanceM, unit, item.discipline === "swim") : null,
    intensity,
  ].filter(Boolean);

  return (
    <div className="card p-3.5">
      <div className="flex items-start gap-3">
        <Avatar name={item.username} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-display font-semibold">{item.isSelf ? "You" : item.username}</span>
            <span className="shrink-0 text-xs text-faint">{ago(today, item.whenISO)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm">
            <span style={{ color: `var(${meta?.colorVar ?? "--accent"})` }}>
              <DisciplineIcon discipline={item.discipline as Discipline} size={15} />
            </span>
            <span className="truncate">{item.title}</span>
          </div>
          <div className="mt-0.5 text-xs tabular-nums text-muted">{stats.join(" · ")}</div>
          {item.note && <p className="mt-1.5 text-sm italic leading-snug text-muted">“{item.note}”</p>}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
        {/* You can't cheer for yourself — the API refuses it, so the button isn't
            there to press (#108: never offer a control that does nothing). But the
            COUNT still shows, because seeing that three people cheered your session
            is the entire reward loop; hiding it on your own row removed the only
            reason the feature pays anyone back. */}
        {item.isSelf ? (
          item.kudos > 0 && (
            <span className="chip pointer-events-none opacity-80">♥ {item.kudos} Kudos</span>
          )
        ) : (
          <button onClick={kudos} aria-pressed={item.kudosedByMe} className={`chip ${item.kudosedByMe ? "is-selected" : ""}`}>
            ♥ {item.kudos > 0 ? item.kudos : ""} Kudos
          </button>
        )}
        <button onClick={() => setOpen((v) => !v)} className="chip">
          💬 {item.comments.length > 0 ? item.comments.length : ""} Comment
        </button>
        {!item.isSelf && (
          <button onClick={report} className="ml-auto text-[0.7rem] text-faint underline underline-offset-2">
            Report
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2.5 space-y-2">
          {item.comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 font-semibold">{c.mine ? "You" : c.username}</span>
              <span className="min-w-0 flex-1 break-words text-muted">{c.text}</span>
              {/* your own comment, or any comment on your own session */}
              {(c.mine || item.isSelf) && (
                <button onClick={() => removeComment(c.id)} aria-label="Delete comment" className="shrink-0 text-xs text-faint">✕</button>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder={item.isSelf ? "Add a note for your crew" : `Say something to ${item.username}`}
              value={text}
              maxLength={COMMENT_MAX_CLIENT}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button onClick={send} disabled={busy || !text.trim()} className="btn btn-primary px-4 py-2.5 text-sm disabled:opacity-40">
              Post
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mirrors COMMENT_MAX on the server. Duplicated rather than imported because
 *  lib/db pulls in `pg`, which must never reach the client bundle. */
const COMMENT_MAX_CLIENT = 500;

/**
 * The follow/kudos feed. It used to own a bottom-nav tab of its own; that slot is
 * now the League tab, and this renders as a panel inside it (`embedded`), which
 * drops the page header and outer padding the host already provides.
 */
export function FriendsTab({ embedded = false }: { embedded?: boolean } = {}) {
  const { today, unit } = useUI();
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
    <div
      className={embedded ? "space-y-5" : "space-y-5 px-4 pb-4"}
      style={embedded ? undefined : { paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
    >
      {!embedded && (
        <div className="animate-fade-up">
          <div className="eyebrow text-[0.72rem]">Friends</div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">Train together</h1>
        </div>
      )}

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
          {/* THE FEED (#183). Sessions, chronological, with what people actually
              did and room to say something about it — the reason to open the tab. */}
          {/* `items ?? []`, not `items`, because the OTA bundle and the Railway
              server deploy INDEPENDENTLY. A bundle carrying this UI can reach a
              phone before the server that serves the field does, and `.length` on
              undefined would white-screen the whole tab. Degrades to the old
              card-only Friends until the server catches up. */}
          {(data?.items ?? []).length > 0 && (
            <div className="space-y-2.5">
              <div className="eyebrow text-[0.72rem]">Recent sessions</div>
              {(data?.items ?? []).map((it) => (
                <FeedRow key={`${it.username}:${it.workoutId}`} item={it} today={today} unit={unit} onChanged={load} />
              ))}
            </div>
          )}

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
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full accent-gradient font-display text-sm font-bold text-on-accent">
      {name[0]?.toUpperCase()}
    </div>
  );
}
