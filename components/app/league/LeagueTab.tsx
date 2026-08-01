"use client";

import { useCallback, useEffect, useState } from "react";
import { useUI } from "../ui";
import { useToast } from "../Toast";
import { apiAnswerInvite, apiLeagues, apiLeagueState } from "@/lib/api";
import type { League, LeagueInvite, LeagueStatePayload } from "@/lib/league/types";
import { haptic } from "@/lib/haptics";
import { Icon } from "../icons";
import { BoardPanel, WeekPanel } from "./LeagueBoard";
import { LogPanel } from "./LeagueLog";
import { FeedPanel } from "./LeagueFeed";
import { TitlesPanel } from "./LeagueTitles";
import { CreateLeagueSheet, InviteSheet, JoinLeagueSheet, LeagueSettingsSheet } from "./LeagueSheets";
import { EmptyLine, Segmented } from "./shared";
import { FriendsTab } from "../FriendsTab";

/** The app's existing follow/kudos feed, rendered inside the League tab. */
function FriendsPanel() {
  return <FriendsTab embedded />;
}

type Panel = "board" | "week" | "log" | "titles" | "feed" | "friends";

// League panels first — they're what the tab is for. "Friends" is the app's
// existing follow/kudos feed, kept reachable here (rather than dropped when this
// tab stopped being the Friends tab) and available even to someone in no league.
const LEAGUE_PANELS: { id: Panel; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "week", label: "Week" },
  { id: "log", label: "Log" },
  { id: "titles", label: "Titles" },
  { id: "feed", label: "Feed" },
];
const FRIENDS_PANEL = { id: "friends" as const, label: "Friends" };

// Which league you were last looking at. A per-device preference, not account
// state — it doesn't belong in the synced blob.
const LAST_LEAGUE_KEY = "trifecta:league:last";

export function LeagueTab() {
  const { today } = useUI();
  const toast = useToast();

  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [invites, setInvites] = useState<LeagueInvite[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<LeagueStatePayload | null>(null);
  const [panel, setPanel] = useState<Panel>("board");
  const [sheet, setSheet] = useState<null | "create" | "join" | "invite" | "settings">(null);
  const [meId, setMeId] = useState<string>("");

  // ---- load the list of leagues + invitations ----
  const loadLeagues = useCallback(
    async (preferId?: string) => {
      const data = await apiLeagues();
      if (!data) {
        setLeagues([]);
        return;
      }
      setLeagues(data.leagues);
      setInvites(data.invites);
      setActiveId((cur) => {
        const wanted = preferId ?? cur ?? (typeof localStorage !== "undefined" ? localStorage.getItem(LAST_LEAGUE_KEY) : null);
        const hit = data.leagues.find((l) => l.id === wanted);
        return hit?.id ?? data.leagues[0]?.id ?? null;
      });
    },
    [],
  );

  useEffect(() => {
    loadLeagues();
  }, [loadLeagues]);

  // ---- load the active league's state ----
  const loadState = useCallback(async () => {
    if (!activeId) {
      setState(null);
      return;
    }
    const s = await apiLeagueState(activeId, today);
    setState(s);
    // The board has to know which row is yours; the server sends its own view of
    // who's calling rather than the client guessing from the roster.
    if (s) setMeId(s.meId);
  }, [activeId, today]);

  useEffect(() => {
    loadState();
    if (activeId && typeof localStorage !== "undefined") localStorage.setItem(LAST_LEAGUE_KEY, activeId);
  }, [activeId, loadState]);

  const answerInvite = async (invite: LeagueInvite, accept: boolean) => {
    const r = await apiAnswerInvite(invite.id, accept);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't answer that invitation.", tone: "warning" });
      return;
    }
    haptic(accept ? "success" : "light");
    setInvites((cur) => cur.filter((i) => i.id !== invite.id));
    if (accept) {
      toast({ text: `Joined ${invite.leagueName}.`, tone: "success" });
      loadLeagues(invite.leagueId);
    }
  };

  const active = leagues?.find((l) => l.id === activeId) ?? null;

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <header className="animate-fade-up flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow text-[0.72rem]">League</div>
          <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight">
            {active ? active.name : "Compete"}
          </h1>
        </div>
        {active && (
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => setSheet("invite")}
              aria-label="Invite to league"
              className="btn btn-ghost px-2.5 py-2"
            >
              <Icon name="friends" size={18} />
            </button>
            <button
              onClick={() => setSheet("settings")}
              aria-label="League settings"
              className="btn btn-ghost px-2.5 py-2"
            >
              <Icon name="target" size={18} />
            </button>
          </div>
        )}
      </header>

      {/* pending invitations */}
      {invites.map((inv) => (
        <div key={inv.id} className="card-glass animate-fade-up p-4">
          <div className="eyebrow text-[0.66rem]">Invitation</div>
          <p className="mt-1.5 text-sm">
            <span className="font-semibold">{inv.invitedByUsername}</span> invited you to{" "}
            <span className="font-semibold">{inv.leagueName}</span>.
          </p>
          <p className="mt-1.5 text-[0.72rem] text-muted">
            Members will see the sessions you log and sync — sport, distance, date and note.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary flex-1" onClick={() => answerInvite(inv, true)}>
              Join
            </button>
            <button className="btn btn-ghost flex-1" onClick={() => answerInvite(inv, false)}>
              Decline
            </button>
          </div>
        </div>
      ))}

      {leagues === null ? (
        <EmptyLine>Loading…</EmptyLine>
      ) : leagues.length === 0 ? (
        <>
          {panel !== "friends" && (
            <EmptyState onCreate={() => setSheet("create")} onJoin={() => setSheet("join")} />
          )}
          <Segmented value={panel} onChange={setPanel} options={[FRIENDS_PANEL, { id: "board" as Panel, label: "Leagues" }]} />
          {panel === "friends" && <FriendsPanel />}
        </>
      ) : (
        <>
          {/* switcher — only earns its space once there's a choice to make */}
          {leagues.length > 1 && (
            <Segmented
              value={activeId ?? ""}
              onChange={(id) => {
                setState(null);
                setActiveId(id);
              }}
              options={leagues.map((l) => ({ id: l.id, label: l.name }))}
            />
          )}

          <Segmented value={panel} onChange={setPanel} options={[...LEAGUE_PANELS, FRIENDS_PANEL]} />

          {panel === "friends" && <FriendsPanel />}

          {panel === "friends" ? null : !state || !active ? (
            <EmptyLine>Loading the board…</EmptyLine>
          ) : (
            <>
              {panel === "board" && (
                <BoardPanel
                  members={state.members}
                  activities={state.activities}
                  settings={active.settings}
                  season={state.season}
                  today={today}
                  meId={meId}
                />
              )}
              {panel === "week" && (
                <WeekPanel
                  members={state.members}
                  activities={state.activities}
                  settings={active.settings}
                  today={today}
                  meId={meId}
                />
              )}
              {panel === "log" && (
                <LogPanel
                  activities={state.activities}
                  settings={active.settings}
                  today={today}
                  meId={meId}
                  onChanged={loadState}
                />
              )}
              {panel === "titles" && (
                <TitlesPanel leagueId={active.id} members={state.members} today={today} meId={meId} />
              )}
              {panel === "feed" && (
                <FeedPanel
                  members={state.members}
                  activities={state.activities}
                  settings={active.settings}
                  today={today}
                  meId={meId}
                />
              )}
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button className="btn btn-ghost flex-1" onClick={() => setSheet("create")}>
              New league
            </button>
            <button className="btn btn-ghost flex-1" onClick={() => setSheet("join")}>
              Join with a code
            </button>
          </div>
        </>
      )}

      {sheet === "create" && (
        <CreateLeagueSheet
          today={today}
          onClose={() => setSheet(null)}
          onCreated={(l) => {
            setSheet(null);
            loadLeagues(l.id);
          }}
        />
      )}
      {sheet === "join" && (
        <JoinLeagueSheet
          onClose={() => setSheet(null)}
          onJoined={(l) => {
            setSheet(null);
            loadLeagues(l.id);
          }}
        />
      )}
      {sheet === "invite" && active && <InviteSheet league={active} onClose={() => setSheet(null)} />}
      {sheet === "settings" && active && state && (
        <LeagueSettingsSheet
          league={active}
          members={state.members}
          meId={meId}
          onClose={() => setSheet(null)}
          onChanged={() => {
            loadLeagues(active.id);
            loadState();
          }}
          onDeleted={() => {
            setSheet(null);
            setActiveId(null);
            setState(null);
            loadLeagues();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="animate-fade-up space-y-4">
      <div className="card-glass p-6 text-center">
        <span className="inline-flex text-accent">
          <Icon name="podium" size={34} strokeWidth={1.4} />
        </span>
        <h2 className="mt-3 font-display text-lg font-semibold">Race your friends</h2>
        <p className="mx-auto mt-1.5 max-w-[24rem] text-sm leading-relaxed text-muted">
          A league turns your training into a weekly points competition. Every session you
          sync from Strava scores automatically — swim, bike, run and gym, weighted however
          your league decides.
        </p>
      </div>
      <button className="btn btn-primary w-full" onClick={onCreate}>
        Create a league
      </button>
      <button className="btn btn-ghost w-full" onClick={onJoin}>
        Join with a code
      </button>
    </div>
  );
}
