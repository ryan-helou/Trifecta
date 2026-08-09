import { NextRequest, NextResponse } from "next/server";
import { getStore, UserLite } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { FeedCard, FeedItem, feedItemsFor, publicCard, raceKeyOf } from "@/lib/social";
import { Profile } from "@/lib/types";
import { todayISO } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social?today=YYYY-MM-DD → the current user's social feed:
// their own card, the people they follow (with kudos on the latest session),
// suggestions (same-race athletes first), and the "training for your race" count.
export async function GET(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const today = req.nextUrl.searchParams.get("today") || todayISO();
  const store = getStore();
  const me = await store.getUserById(uid);
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const followingIds = new Set(await store.getFollowingIds(uid));
  // A block hides both parties from each other everywhere — suggestions included,
  // or the person you just blocked reappears as somebody to follow.
  const blocked = new Set(await store.getBlockEdges(uid));
  for (const b of blocked) followingIds.delete(b);
  const users = (await store.listUsersLite()).filter((u) => !blocked.has(u.id));
  const byId = new Map(users.map((u) => [u.id, u]));
  const myKey = raceKeyOf(me.data?.profile as Profile | undefined);

  const base = (u: UserLite, isSelf: boolean): FeedCard => {
    const c = publicCard(u.username, u.data, today, isSelf);
    return {
      username: c.username,
      isSelf,
      following: followingIds.has(u.id),
      race: c.race,
      level: c.level,
      streak: c.streak,
      weekDone: c.weekDone,
      latest: c.latest ? { ...c.latest, kudos: 0, kudosedByMe: false } : undefined,
    };
  };

  // attach kudos count + whether I've kudos'd the card's latest session
  const withKudos = async (card: FeedCard, ownerId: string): Promise<FeedCard> => {
    if (!card.latest) return card;
    const ks = await store.getKudosForOwner(ownerId);
    const forLatest = ks.filter((k) => k.workoutId === card.latest!.workoutId);
    return { ...card, latest: { ...card.latest, kudos: forLatest.length, kudosedByMe: forLatest.some((k) => k.fromId === uid) } };
  };

  const meCard = await withKudos(base({ id: me.id, username: me.username, data: me.data }, true), me.id);

  // feed — people I follow
  const feed: FeedCard[] = [];
  for (const fid of followingIds) {
    let u = byId.get(fid);
    if (!u) {
      const row = await store.getUserById(fid); // in case they fell outside the lite window
      if (row) u = { id: row.id, username: row.username, data: row.data };
    }
    if (!u) continue;
    feed.push(await withKudos(base(u, false), fid));
  }
  feed.sort((a, b) => (b.latest?.whenISO ?? "").localeCompare(a.latest?.whenISO ?? ""));

  // suggestions — not me, not followed; same-race athletes first
  const others = users.filter((u) => u.id !== uid && !followingIds.has(u.id));
  const sameRace = (u: UserLite) => (myKey && raceKeyOf(u.data?.profile as Profile | undefined) === myKey ? 0 : 1);
  others.sort((a, b) => sameRace(a) - sameRace(b) || (b.data?.updatedAtISO ?? "").localeCompare(a.data?.updatedAtISO ?? ""));
  const suggestions = await Promise.all(
    others.slice(0, 6).map((u) => withKudos(base(u, false), u.id)),
  );

  // cohort — how many others are training for my exact race. Counts over ALL users
  // (minus me), independent of follow state — following someone shouldn't drop them
  // from the "training for your race" tally.
  const cohortUsers = myKey
    ? users.filter((u) => u.id !== uid && raceKeyOf(u.data?.profile as Profile | undefined) === myKey)
    : [];
  const cohort = { count: cohortUsers.length, raceName: meCard.race?.name };

  // ---- the session feed (#183) ------------------------------------------
  // The card list above answers "who am I following"; this answers "what have
  // they been doing", which is the thing worth opening the tab for. Chronological
  // across everyone you follow, full session detail (Ryan's call), each with its
  // kudos and comments attached.
  //
  // Own sessions are included: a feed you never appear in reads like a stranger's.
  const feedOwners: { id: string; username: string; data: UserLite["data"] }[] = [
    { id: me.id, username: me.username, data: me.data },
  ];
  for (const fid of followingIds) {
    const u = byId.get(fid) ?? (await store.getUserById(fid).then((r) => (r ? { id: r.id, username: r.username, data: r.data } : null)));
    if (u) feedOwners.push(u);
  }

  const items: FeedItem[] = [];
  for (const owner of feedOwners) {
    const isSelf = owner.id === uid;
    const [kudosRows, commentRows] = await Promise.all([
      store.getKudosForOwner(owner.id),
      store.getCommentsForOwner(owner.id),
    ]);
    // Resolve comment authors once per owner rather than once per comment.
    const authorIds = [...new Set(commentRows.map((c) => c.fromId))];
    const authors = new Map<string, string>();
    for (const id of authorIds) {
      const u = byId.get(id);
      if (u) authors.set(id, u.username);
      else {
        const row = await store.getUserById(id);
        if (row) authors.set(id, row.username);
      }
    }
    for (const item of feedItemsFor(owner.username, owner.data, today, 5, isSelf)) {
      const ks = kudosRows.filter((k) => k.workoutId === item.workoutId);
      items.push({
        ...item,
        isSelf,
        kudos: ks.length,
        kudosedByMe: ks.some((k) => k.fromId === uid),
        comments: commentRows
          .filter((c) => c.workoutId === item.workoutId && !blocked.has(c.fromId))
          .map((c) => ({
            id: c.id,
            username: authors.get(c.fromId) ?? "",
            text: c.text,
            atISO: c.atISO,
            mine: c.fromId === uid,
          })),
      });
    }
  }
  items.sort((a, b) => (b.whenISO === a.whenISO ? b.workoutId.localeCompare(a.workoutId) : b.whenISO.localeCompare(a.whenISO)));

  return NextResponse.json({ me: meCard, feed, items: items.slice(0, 40), suggestions, cohort });
}
