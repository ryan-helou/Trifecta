"use client";

import { useState } from "react";
import type { League, LeagueMember, LeagueSettings, Sport } from "@/lib/league/types";
import { SPORTS, SPORT_LABEL, SPORT_UNIT, UNIT_ABBR, canEditRules } from "@/lib/league/types";
import {
  apiCreateLeague,
  apiDeleteLeague,
  apiInviteToLeague,
  apiJoinLeague,
  apiRemoveMember,
  apiSetMemberRole,
  apiUpdateLeague,
} from "@/lib/api";
import { MAX_LEAGUE_NAME } from "@/lib/league/validate";
import { haptic } from "@/lib/haptics";
import { Sheet } from "../Sheet";
import { useToast } from "../Toast";
import { Avatar, SPORT_COLOR } from "./shared";

/** Every sheet in the app carries an explicit close control (see CoachSheet) — a
 *  drag-to-dismiss handle alone isn't discoverable, and on a tall sheet the
 *  backdrop can be entirely off-screen. */
function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-1">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <button
        onClick={onClose}
        aria-label="Close"
        className="-mr-1 shrink-0 rounded-full px-2 py-1 text-muted transition hover:text-[color:var(--text)]"
      >
        ✕
      </button>
    </div>
  );
}

/** The one thing a new member has to understand before they're in: a league shows
 *  the people in it what you train. Stated at every entry point rather than
 *  assumed — for five friends it's obvious, for a feature anyone can be invited
 *  to it isn't. */
function PrivacyNote({ what = "join" }: { what?: string }) {
  return (
    <p className="mt-3 rounded-xl bg-[color:var(--surface-2)] p-3 text-[0.72rem] leading-relaxed text-muted">
      When you {what}, everyone in the league can see the sessions you log and sync —
      sport, distance, date, and any note. They can&apos;t see your training plan, your
      health data, or anything else in Trifecta. Leave any time and you disappear from
      the board.
    </p>
  );
}

export function CreateLeagueSheet({
  today,
  onClose,
  onCreated,
}: {
  today: string;
  onClose: () => void;
  onCreated: (l: League) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await apiCreateLeague(name.trim(), today);
    setBusy(false);
    if (!r.ok || !r.league) {
      toast({ text: r.error || "Couldn't create that league.", tone: "warning" });
      return;
    }
    haptic("success");
    onCreated(r.league);
  };

  return (
    <Sheet onClose={onClose} label="Create a league" header={<SheetHead title="Start a league" onClose={onClose} />}>
      <div className="px-4 pb-6">
        <p className="mt-1 text-sm text-muted">
          Everything you log and sync starts scoring from today. You set the rules.
        </p>
        <input
          className="input mt-4 w-full"
          placeholder="League name"
          maxLength={MAX_LEAGUE_NAME}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <PrivacyNote what="start a league" />
        <button className="btn btn-primary mt-4 w-full" disabled={!name.trim() || busy} onClick={create}>
          {busy ? "Creating…" : "Create league"}
        </button>
      </div>
    </Sheet>
  );
}

export function JoinLeagueSheet({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (l: League) => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    const r = await apiJoinLeague(code.trim());
    setBusy(false);
    if (!r.ok || !r.league) {
      toast({ text: r.error || "Couldn't join that league.", tone: "warning" });
      return;
    }
    haptic("success");
    toast({ text: r.already ? `You're already in ${r.league.name}.` : `Joined ${r.league.name}.`, tone: "success" });
    onJoined(r.league);
  };

  return (
    <Sheet onClose={onClose} label="Join a league" header={<SheetHead title="Join a league" onClose={onClose} />}>
      <div className="px-4 pb-6">
        <p className="mt-1 text-sm text-muted">Enter the six-character code a friend sent you.</p>
        <input
          className="input mt-4 w-full text-center font-display text-2xl tracking-[0.3em]"
          placeholder="ABC123"
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoFocus
        />
        <PrivacyNote />
        <button className="btn btn-primary mt-4 w-full" disabled={!code.trim() || busy} onClick={join}>
          {busy ? "Joining…" : "Join"}
        </button>
      </div>
    </Sheet>
  );
}

export function InviteSheet({ league, onClose }: { league: League; onClose: () => void }) {
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(league.inviteCode);
      haptic("light");
      toast({ text: "Code copied.", tone: "success" });
    } catch {
      toast({ text: `Your code is ${league.inviteCode}.` });
    }
  };

  const invite = async () => {
    if (!username.trim() || busy) return;
    setBusy(true);
    const r = await apiInviteToLeague(league.id, username.trim());
    setBusy(false);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't send that invite.", tone: "warning" });
      return;
    }
    haptic("success");
    // Deliberately the same message whether or not the account exists — the
    // endpoint won't confirm which usernames are registered, and neither will this.
    toast({ text: `Invite sent to ${username.trim()}.`, tone: "success" });
    setUsername("");
  };

  return (
    <Sheet onClose={onClose} label="Invite to league" header={<SheetHead title={`Invite to ${league.name}`} onClose={onClose} />}>
      <div className="px-4 pb-6">

        <div className="mt-4 card p-4 text-center">
          <div className="eyebrow text-[0.66rem]">Join code</div>
          <div className="mt-1.5 font-display text-3xl font-semibold tracking-[0.25em]">
            {league.inviteCode}
          </div>
          <button className="btn btn-ghost mt-3 w-full" onClick={copyCode}>
            Copy code
          </button>
        </div>

        <div className="mt-4">
          <div className="eyebrow text-[0.66rem]">Or invite by username</div>
          <div className="mt-2 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Their Trifecta username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <button className="btn btn-primary" disabled={!username.trim() || busy} onClick={invite}>
              Invite
            </button>
          </div>
          <p className="mt-2 text-[0.72rem] text-muted">
            They get an invitation to accept — joining is always their call.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

export function LeagueSettingsSheet({
  league,
  members,
  meId,
  onClose,
  onChanged,
  onDeleted,
}: {
  league: League;
  members: LeagueMember[];
  meId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const isAdmin = canEditRules(league.myRole);
  const isOwner = league.myRole === "owner";
  const [draft, setDraft] = useState<LeagueSettings>(league.settings);
  const [name, setName] = useState(league.name);
  const [busy, setBusy] = useState(false);

  const setMultiplier = (sport: Sport, raw: string) => {
    const n = Number(raw);
    setDraft((d) => ({
      ...d,
      multipliers: { ...d.multipliers, [sport]: Number.isFinite(n) && n >= 0 ? n : 0 },
    }));
  };

  const save = async () => {
    setBusy(true);
    const r = await apiUpdateLeague(league.id, { name: name.trim() || league.name, settings: draft });
    setBusy(false);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't save the rules.", tone: "warning" });
      return;
    }
    haptic("success");
    // Points are derived at read time, so changing a multiplier re-scores every
    // session in the league's history — worth saying out loud before someone
    // wonders why the board moved.
    toast({ text: "Rules saved — the whole season re-scored.", tone: "success" });
    onChanged();
  };

  const rotate = async () => {
    if (!window.confirm("Generate a new join code? The old one stops working.")) return;
    const r = await apiUpdateLeague(league.id, { rotateCode: true });
    if (!r.ok) {
      toast({ text: r.error || "Couldn't rotate the code.", tone: "warning" });
      return;
    }
    toast({ text: "New code generated.", tone: "success" });
    onChanged();
  };

  const remove = async (m: LeagueMember) => {
    const self = m.userId === meId;
    const msg = self ? "Leave this league?" : `Remove ${m.username} from the league?`;
    if (!window.confirm(msg)) return;
    const r = await apiRemoveMember(league.id, m.userId);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't do that.", tone: "warning" });
      return;
    }
    haptic("light");
    if (self) onDeleted();
    else onChanged();
  };

  const setRole = async (m: LeagueMember, role: "admin" | "member") => {
    const r = await apiSetMemberRole(league.id, m.userId, role);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't change that role.", tone: "warning" });
      return;
    }
    onChanged();
  };

  const destroy = async () => {
    if (!window.confirm(`Delete ${league.name}? This can't be undone.`)) return;
    const r = await apiDeleteLeague(league.id);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't delete the league.", tone: "warning" });
      return;
    }
    onDeleted();
  };

  return (
    <Sheet onClose={onClose} label="League settings" header={<SheetHead title={league.name} onClose={onClose} />}>
      <div className="space-y-5 px-4 pb-6">

        {isAdmin && (
          <section>
            <div className="eyebrow text-[0.66rem]">Name</div>
            <input
              className="input mt-2 w-full"
              maxLength={MAX_LEAGUE_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </section>
        )}

        <section>
          <div className="eyebrow text-[0.66rem]">Scoring</div>
          <div className="mt-2 space-y-2">
            {SPORTS.map((sport) => (
              <div key={sport} className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORT_COLOR[sport] }} />
                <label className="flex-1 text-sm" htmlFor={`mult-${sport}`}>
                  {SPORT_LABEL[sport]}
                </label>
                {/* .input is width:100% (globals.css) and outranks a Tailwind w-* on
                    source order, so the width has to be constrained by the wrapper. */}
                <div className="w-20 shrink-0">
                  <input
                    id={`mult-${sport}`}
                    className="input text-right"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    disabled={!isAdmin}
                    value={draft.multipliers[sport]}
                    onChange={(e) => setMultiplier(sport, e.target.value)}
                  />
                </div>
                <span className="w-7 shrink-0 text-[0.7rem] text-muted">
                  /{UNIT_ABBR[SPORT_UNIT[sport]]}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-3">
            <label className="flex-1 text-sm" htmlFor="weekly-goal">
              Weekly target
            </label>
            <div className="w-20 shrink-0">
              <input
                id="weekly-goal"
                className="input text-right"
                type="number"
                min="0"
                step="10"
                disabled={!isAdmin}
                value={draft.weeklyGoal}
                onChange={(e) => setDraft((d) => ({ ...d, weeklyGoal: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </div>
            <span className="w-7 shrink-0 text-[0.7rem] text-muted">pts</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex-1 text-sm" htmlFor="gym-cap">
              Gym cap per day
            </label>
            <div className="w-20 shrink-0">
              <input
                id="gym-cap"
                className="input text-right"
                type="number"
                min="1"
                max="20"
                disabled={!isAdmin}
                value={draft.maxScoringGymPerDay}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    maxScoringGymPerDay: Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
              />
            </div>
            <span className="w-7 shrink-0 text-[0.7rem] text-muted">max</span>
          </div>
          <div>
            <label className="text-sm" htmlFor="forfeit">
              Last place owes
            </label>
            <input
              id="forfeit"
              className="input mt-1.5 w-full"
              placeholder="Optional — nothing by default"
              maxLength={120}
              disabled={!isAdmin}
              value={draft.forfeit}
              onChange={(e) => setDraft((d) => ({ ...d, forfeit: e.target.value }))}
            />
          </div>
        </section>

        {isAdmin && (
          <button className="btn btn-primary w-full" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save rules"}
          </button>
        )}

        <section>
          <div className="eyebrow text-[0.66rem]">Members · {members.length}</div>
          <ul className="mt-2 space-y-1.5">
            {members.map((m) => (
              <li key={m.userId} className="card flex items-center gap-3 p-3">
                <Avatar username={m.username} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.username}
                    {m.userId === meId && <span className="ml-1.5 text-[0.7rem] text-muted">you</span>}
                  </div>
                  {m.role !== "member" && (
                    <div className="text-[0.68rem] capitalize text-muted">{m.role}</div>
                  )}
                </div>
                {isOwner && m.role !== "owner" && (
                  <button
                    className="chip shrink-0 text-[0.66rem]"
                    onClick={() => setRole(m, m.role === "admin" ? "member" : "admin")}
                  >
                    {m.role === "admin" ? "Demote" : "Make admin"}
                  </button>
                )}
                {(m.userId === meId || (isAdmin && m.role === "member")) && m.role !== "owner" && (
                  <button
                    onClick={() => remove(m)}
                    aria-label={m.userId === meId ? "Leave league" : `Remove ${m.username}`}
                    className="shrink-0 px-1 text-muted transition hover:text-[color:var(--danger)]"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isAdmin && (
          <section>
            <div className="eyebrow text-[0.66rem]">Join code</div>
            <div className="mt-2 flex items-center gap-3">
              <span className="font-display text-lg font-semibold tracking-[0.2em]">{league.inviteCode}</span>
              <button className="btn btn-ghost ml-auto" onClick={rotate}>
                Rotate
              </button>
            </div>
            <p className="mt-1.5 text-[0.7rem] text-muted">
              Rotate if the code leaked — anyone holding the old one is locked out.
            </p>
          </section>
        )}

        {isOwner && (
          <button
            className="btn btn-ghost w-full text-[color:var(--danger)]"
            onClick={destroy}
          >
            Delete league
          </button>
        )}
      </div>
    </Sheet>
  );
}
