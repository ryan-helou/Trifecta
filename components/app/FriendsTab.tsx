"use client";

import { useCallback, useEffect, useState } from "react";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { apiComment, apiDeleteComment, apiFollow, apiKudos, apiModerate, apiSocial } from "@/lib/api";
import { FeedItem, SocialPayload } from "@/lib/social";
import { dayIndexOf, daysBetween } from "@/lib/dates";
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
/**
 * FRIENDS — rebuilt (#192, "friends tab sucks… we need to completely rethink it").
 *
 * What was actually wrong, found by using it with a populated crew rather than by
 * reading the code:
 *
 *  1. THE SAME SESSION APPEARED TWICE, with two different kudos buttons. "Recent
 *     sessions" listed every session; "Your crew" listed every followed athlete
 *     with their LATEST session under it. On a real feed "Long Endurance Run"
 *     rendered seven times on one page. That is squarely my fault: #183 added the
 *     feed and never retired the cards it superseded.
 *  2. THE TAB OPENED WITH A FORM. "Add a friend by username" was the first thing
 *     on screen, above all content, and it only works if you already know
 *     someone's exact username — the least likely thing anyone came here to do.
 *  3. YOUR OWN TRAINING LED THE FEED. You have three other tabs for that. Seeing
 *     your session with its kudos IS the reward loop, but as the headline item it
 *     just pushes everyone else's below the fold.
 *  4. 5.2 SCREENS of scroll before any of it was useful.
 *
 * So: the crew becomes a compact roster strip (who they are, how they're doing,
 * one tap to add) and the feed becomes the page — grouped by day so it reads as a
 * timeline. Each session appears exactly once, in one place, with one set of
 * actions. Your own sessions stay, because the kudos on them are the payoff, but
 * only once somebody has actually reacted.
 */
export function FriendsTab({ embedded = false }: { embedded?: boolean } = {}) {
  const { today, unit } = useUI();
  const toast = useToast();
  const [data, setData] = useState<SocialPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
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
    if (on) {
      toast({ text: `Following ${username}.`, tone: "success" });
    } else {
      // Unfollowing is one tap on somebody's face, so it has to be recoverable —
      // the same act-then-undo contract every other destructive action in the app
      // uses. Without this a mis-tap silently removed a friend.
      toast({
        text: `Unfollowed ${username}.`,
        tone: "default",
        actionLabel: "Undo",
        onAction: () => void follow(username, true),
        duration: 7000,
      });
    }
    load();
  };

  const add = async () => {
    const name = addName.trim();
    if (!name) return;
    await follow(name, true);
    setAddName("");
    setAdding(false);
  };

  const crew = data?.feed ?? [];
  // Your own sessions earn a place once someone has reacted — that's the payoff.
  // Before that they're just your training, which three other tabs already show.
  const items = (data?.items ?? []).filter(
    (i) => !i.isSelf || i.kudos > 0 || i.comments.length > 0,
  );
  const days = groupByDay(items, today);
  const hasCrew = crew.length > 0;

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

      {/* THE ROSTER — who your crew is, at a glance, with adding folded behind a
          "+" instead of a text box occupying the top of the page. */}
      {hasCrew && (
        <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {crew.map((c) => (
            <button
              key={c.username}
              onClick={() => follow(c.username, false)}
              className="flex w-[4.2rem] shrink-0 flex-col items-center gap-1"
              aria-label={`Unfollow ${c.username}`}
            >
              <span className="relative">
                <Avatar name={c.username} />
                {c.streak >= 2 && (
                  <span className="absolute -bottom-0.5 -right-1 inline-flex items-center gap-px rounded-full bg-surface px-1 py-px text-[0.6rem] text-accent">
                    {/* capped: a long streak is real, but four digits blow the badge
                        off the avatar it's pinned to */}
                    <Icon name="flame" size={9} /><span className="tabular-nums">{c.streak > 99 ? "99+" : c.streak}</span>
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[0.68rem] text-muted">{c.username}</span>
            </button>
          ))}
          <button
            onClick={() => setAdding((v) => !v)}
            aria-label="Add a friend"
            className="flex w-[4.2rem] shrink-0 flex-col items-center gap-1"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-line text-muted">＋</span>
            <span className="text-[0.68rem] text-muted">Add</span>
          </button>
        </div>
      )}

      {(adding || !hasCrew) && (
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
      )}

      {loading ? (
        <div className="card p-6 text-center text-sm text-muted">Loading your crew…</div>
      ) : (
        <>
          {/* THE FEED IS THE PAGE. Grouped by day so it reads as a timeline rather
              than an undated pile, and each session appears exactly once. */}
          {days.length > 0 ? (
            <div className="space-y-5">
              {days.map(([label, group]) => (
                <div key={label} className="space-y-2.5">
                  <div className="eyebrow text-[0.72rem]">{label}</div>
                  {group.map((it) => (
                    <FeedRow key={`${it.username}:${it.workoutId}`} item={it} today={today} unit={unit} onChanged={load} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="card animate-fade-up p-6 text-center">
              <div className="flex justify-center text-accent"><Icon name="friends" size={34} /></div>
              <div className="mt-2 font-display font-semibold">{hasCrew ? "Nothing logged yet" : "Build your crew"}</div>
              <p className="mx-auto mt-1 max-w-[17rem] text-sm text-muted">
                {hasCrew
                  ? "When your crew trains, their sessions land here."
                  : "Follow someone training for your race, or add a friend by username."}
              </p>
            </div>
          )}

          {/* Suggestions earn their place only while the crew is small — once you
              have people, this is just a list of strangers under your friends. */}
          {data && data.suggestions.length > 0 && crew.length < 5 && (
            <div className="space-y-2.5">
              <div className="eyebrow text-[0.72rem]">Athletes to follow</div>
              {data.cohort.count > 0 && (
                <p className="text-xs text-muted">
                  <span className="font-semibold tabular-nums text-foreground">{data.cohort.count}</span> other
                  {data.cohort.count === 1 ? " athlete is" : " athletes are"} training for
                  {data.cohort.raceName ? ` ${data.cohort.raceName}` : " your race"}.
                </p>
              )}
              {data.suggestions.slice(0, 5).map((c) => (
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

/** Bucket the feed into days, newest first, so it reads as a timeline. Labels are
 *  relative near today and a weekday beyond that — "3d ago" on a header is worse
 *  than "Friday" when you're scanning for when something happened. */
function groupByDay(items: FeedItem[], today: string): Array<[string, FeedItem[]]> {
  const out = new Map<string, FeedItem[]>();
  const sorted = [...items].sort((a, b) => (a.whenISO < b.whenISO ? 1 : -1));
  for (const it of sorted) {
    const day = it.whenISO.slice(0, 10);
    const n = daysBetween(day, today);
    const label =
      n <= 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? WEEKDAY[dayIndexOf(day)] : `${Math.floor(n / 7)}w ago`;
    out.set(label, [...(out.get(label) ?? []), it]);
  }
  return [...out.entries()];
}

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full accent-gradient font-display text-sm font-bold text-on-accent">
      {name[0]?.toUpperCase()}
    </div>
  );
}
