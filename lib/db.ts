import type { Pool as PgPool } from "pg";
import type {
  League,
  LeagueActivity,
  LeagueInvite,
  LeagueMember,
  LeagueRole,
  LeagueSettings,
  Sport,
} from "./league/types";
import { mergeSettings } from "./league/types";

// ---------------------------------------------------------------------------
// Storage layer. Uses Railway Postgres when DATABASE_URL is set; otherwise an
// in-memory store so the app runs locally / in preview with no database.
// Each user row carries a JSONB `data` blob = { profile, plan } (the app state).
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  data: AppState;
}

export interface AppState {
  profile?: unknown;
  plan?: unknown;
  updatedAtISO?: string;
}

/** A user's linked Strava account. Kept in its own table (not the `data` blob)
 *  so token refreshes and webhook writes never clobber the plan JSON, and so the
 *  webhook can find the owner by athlete id. */
export interface StravaConn {
  userId: string;
  athleteId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
  scope?: string;
  lastSyncAtISO?: string;
}

export interface Store {
  init(): Promise<void>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  createUser(username: string, passwordHash: string): Promise<UserRow>;
  getData(userId: string): Promise<AppState>;
  setData(userId: string, data: AppState): Promise<void>;
  /** Data blob + its optimistic-concurrency version. */
  getDataV(userId: string): Promise<{ state: AppState; version: number } | null>;
  /** Compare-and-set write. Returns the new version, or null when expectedVersion lost. */
  setDataIf(userId: string, data: AppState, expectedVersion: number): Promise<number | null>;
  /** Erase the user and all their data (GDPR right to erasure). */
  deleteUser(userId: string): Promise<void>;
  // ---- sessions (ticket #71) ----
  /** Is this session still honoured? One round trip answering three questions: the
   *  user still exists, this sid has not been revoked by a logout, and the token was
   *  issued at/after the user's session epoch (sign-out-everywhere). */
  isSessionLive(userId: string, sid: string, issuedAt: number): Promise<boolean>;
  /** Revoke one session — the logout of a single device. `expiresAt` lets the row be
   *  pruned once the token would have died on its own anyway. */
  revokeSession(userId: string, sid: string, expiresAt: number): Promise<void>;
  /** Revoke every session for a user by moving their epoch past all issued tokens.
   *  For password changes and an explicit "sign out everywhere". */
  revokeAllSessions(userId: string): Promise<void>;
  /** Append product events. Best-effort: analytics must never fail a request. */
  recordEvents(userId: string, events: { name: string; props?: unknown; atISO?: string }[]): Promise<void>;
  // Strava
  getStravaByUser(userId: string): Promise<StravaConn | null>;
  getStravaByAthlete(athleteId: number): Promise<StravaConn | null>;
  upsertStrava(conn: StravaConn): Promise<void>;
  updateStravaTokens(userId: string, t: { accessToken: string; refreshToken: string; expiresAt: number }): Promise<void>;
  deleteStrava(userId: string): Promise<void>;
  touchStravaSync(userId: string): Promise<void>;
  // Social — follows + kudos
  listUsersLite(limit?: number): Promise<UserLite[]>;
  follow(followerId: string, followingId: string): Promise<void>;
  unfollow(followerId: string, followingId: string): Promise<void>;
  getFollowingIds(userId: string): Promise<string[]>;
  addKudos(fromId: string, ownerId: string, workoutId: string): Promise<void>;
  removeKudos(fromId: string, ownerId: string, workoutId: string): Promise<void>;
  getKudosForOwner(ownerId: string): Promise<KudosRow[]>;
  // ---- leagues (points competitions between users) ----
  createLeague(name: string, ownerId: string, settings: LeagueSettings, inviteCode: string): Promise<League>;
  getLeague(leagueId: string): Promise<League | null>;
  getLeagueByInviteCode(code: string): Promise<League | null>;
  /** Every league this user belongs to, each carrying their own role. */
  listLeaguesForUser(userId: string): Promise<League[]>;
  countLeaguesOwned(ownerId: string): Promise<number>;
  updateLeague(leagueId: string, patch: { name?: string; settings?: LeagueSettings; inviteCode?: string }): Promise<void>;
  deleteLeague(leagueId: string): Promise<void>;
  addLeagueMember(leagueId: string, userId: string, role: LeagueRole): Promise<void>;
  removeLeagueMember(leagueId: string, userId: string): Promise<void>;
  setLeagueRole(leagueId: string, userId: string, role: LeagueRole): Promise<void>;
  listLeagueMembers(leagueId: string): Promise<LeagueMember[]>;
  getLeagueRole(leagueId: string, userId: string): Promise<LeagueRole | null>;
  /** Before erasing an account: hand every league they own to its longest-standing
   *  other member, or delete it if they were alone. Without this the owner FK
   *  cascade would take everyone else's league down with the account. */
  handOffOwnedLeagues(ownerId: string): Promise<void>;
  // ---- activities ----
  // Rows are USER-scoped, not league-scoped: one session is one row however many
  // leagues the athlete is in. Each league scores the same row with its own rules.
  createActivity(input: NewActivity, source?: "manual" | "strava", stravaId?: number): Promise<LeagueActivity>;
  getActivity(id: string): Promise<LeagueActivity | null>;
  updateActivity(id: string, patch: Partial<Omit<NewActivity, "userId">>): Promise<LeagueActivity | null>;
  deleteActivity(id: string): Promise<boolean>;
  /** The windowed read behind every leaderboard: these members, this date range. */
  listActivitiesForUsers(userIds: string[], from: string, to: string): Promise<LeagueActivity[]>;
  /** Log a Strava activity once. Returns the new row, or null if already imported. */
  importStravaActivity(input: NewActivity, stravaId: number): Promise<LeagueActivity | null>;
  /** Drop a Strava-sourced row when the athlete deletes it upstream. */
  deleteStravaActivity(userId: string, stravaId: number): Promise<void>;
  // ---- invites ----
  createLeagueInvite(leagueId: string, invitedUserId: string, invitedBy: string): Promise<void>;
  listInvitesForUser(userId: string): Promise<LeagueInvite[]>;
  getLeagueInvite(inviteId: string): Promise<LeagueInvite | null>;
  respondToInvite(inviteId: string, status: "accepted" | "declined"): Promise<void>;
}

/** A new session to score. `km` is 1 for a flat gym workout — see SPORT_UNIT. */
export interface NewActivity {
  userId: string;
  sport: Sport;
  km: number;
  occurredOn: string;
  note: string | null;
}

export interface UserLite {
  id: string;
  username: string;
  data: AppState;
}

export interface KudosRow {
  fromId: string;
  workoutId: string;
}

function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

// ---- Postgres ----

class PgStore implements Store {
  private pool: PgPool;
  private ready: Promise<void> | null = null;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool
        .query(
          `CREATE TABLE IF NOT EXISTS users (
             id TEXT PRIMARY KEY,
             username TEXT NOT NULL,
             username_lower TEXT UNIQUE NOT NULL,
             password_hash TEXT NOT NULL,
             data JSONB NOT NULL DEFAULT '{}'::jsonb,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )`,
        )
        .then(() =>
          // existing prod table predates the column — CREATE IF NOT EXISTS won't add it
          this.pool.query(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS data_version BIGINT NOT NULL DEFAULT 1",
          ),
        )
        .then(() =>
          // Sign-out-everywhere marker: any token issued before this instant is dead.
          this.pool.query(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch BIGINT NOT NULL DEFAULT 0",
          ),
        )
        .then(() =>
          // Per-device logout. Rows are self-pruning: expires_at is the token's own
          // expiry, after which the token is dead regardless and the row is noise.
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS revoked_sessions (
               user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               sid TEXT NOT NULL,
               expires_at BIGINT NOT NULL,
               PRIMARY KEY (user_id, sid)
             )`,
          ),
        )
        .then(() =>
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS strava_connections (
               user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
               athlete_id BIGINT UNIQUE NOT NULL,
               access_token TEXT NOT NULL,
               refresh_token TEXT NOT NULL,
               expires_at BIGINT NOT NULL,
               scope TEXT,
               connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
               last_sync_at TIMESTAMPTZ
             )`,
          ),
        )
        .then(() =>
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS follows (
               follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
               PRIMARY KEY (follower_id, following_id)
             )`,
          ),
        )
        .then(() =>
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS kudos (
               from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               workout_id TEXT NOT NULL,
               created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
               PRIMARY KEY (from_id, owner_id, workout_id)
             )`,
          ),
        )
        .then(() =>
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS leagues (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               invite_code TEXT UNIQUE NOT NULL,
               settings JSONB NOT NULL,
               created_at TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          ),
        )
        .then(() =>
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS league_members (
               league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
               user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               role TEXT NOT NULL DEFAULT 'member',
               joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
               PRIMARY KEY (league_id, user_id)
             )`,
          ),
        )
        .then(() =>
          // "which leagues am I in" — the query behind every screen in the tab
          this.pool.query("CREATE INDEX IF NOT EXISTS league_members_user_idx ON league_members (user_id)"),
        )
        .then(() =>
          // Sessions that score. USER-scoped, not league-scoped: one row per
          // session however many leagues the athlete is in, so joining a second
          // league never duplicates data — it just scores the same rows again
          // under different multipliers. occurred_on is TEXT (`YYYY-MM-DD`), not
          // DATE: date-only strings compare and sort identically, and skipping the
          // driver's Date conversion means a session can't shift a day across a
          // timezone boundary on the way out of the database.
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS athlete_activities (
               id TEXT PRIMARY KEY,
               user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               sport TEXT NOT NULL,
               km NUMERIC(10,3) NOT NULL,
               occurred_on TEXT NOT NULL CHECK (occurred_on ~ '^\\d{4}-\\d{2}-\\d{2}$'),
               note TEXT,
               source TEXT NOT NULL DEFAULT 'manual',
               strava_id BIGINT,
               created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
               updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          ),
        )
        .then(() =>
          // the leaderboard query: these members, this window
          this.pool.query(
            "CREATE INDEX IF NOT EXISTS athlete_activities_user_day_idx ON athlete_activities (user_id, occurred_on)",
          ),
        )
        .then(() =>
          // Ledger of every Strava activity already imported. Kept separate from
          // athlete_activities so deleting an imported session doesn't make the
          // next sync re-create it.
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS strava_imports (
               strava_id BIGINT PRIMARY KEY,
               user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          ),
        )
        .then(() =>
          // One-way purge of Strava-sourced league rows.
          //
          // Nothing writes these any more (see lib/league/ingest.ts): a league shows
          // every member their rivals' distance and points, and when those came from
          // Strava that is one athlete's Strava data displayed to another, which API
          // Policy §2.3 prohibits — §5.4 extends the ban to anything "derived from
          // Strava Data", so the totals are caught too. Stopping the writes is not
          // enough on its own; the rows already in the table are still being rendered
          // on other people's boards until they are gone.
          //
          // Runs on every boot rather than as a one-shot migration, deliberately: it
          // is a cheap no-op once the table is clean, and if a Strava path is ever
          // reintroduced by accident this quietly undoes it rather than letting the
          // data sit there. Deleting the ledger rows too, so nothing is left pointing
          // at activities we no longer hold.
          this.pool
            .query("DELETE FROM athlete_activities WHERE source = 'strava'")
            .then((r) => {
              if (r.rowCount) console.warn(`league: purged ${r.rowCount} Strava-sourced rows (API Policy §2.3)`);
              return this.pool.query("DELETE FROM strava_imports");
            }),
        )
        .then(() =>
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS league_invites (
               id TEXT PRIMARY KEY,
               league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
               invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               status TEXT NOT NULL DEFAULT 'pending',
               created_at TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          ),
        )
        .then(() =>
          // one live invite per person per league — re-inviting refreshes, never stacks
          this.pool.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS league_invites_unique_pending
               ON league_invites (league_id, invited_user_id) WHERE status = 'pending'`,
          ),
        )
        .then(() =>
          this.pool.query("CREATE INDEX IF NOT EXISTS league_invites_user_idx ON league_invites (invited_user_id, status)"),
        )
        .then(() =>
          // Product events. Deliberately its own table, NOT the user blob — that
          // blob is wholly client-writable via PUT /api/state, so anything stored
          // there can be rewritten or erased by the client it's measuring.
          this.pool.query(
            `CREATE TABLE IF NOT EXISTS events (
               id BIGSERIAL PRIMARY KEY,
               user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               name TEXT NOT NULL,
               props JSONB,
               at TIMESTAMPTZ NOT NULL DEFAULT now()
             )`,
          ),
        )
        .then(() =>
          // the two queries this exists to answer: per-user timelines (retention
          // curves, activation funnels) and per-event rollups
          this.pool.query("CREATE INDEX IF NOT EXISTS events_user_at_idx ON events (user_id, at DESC)"),
        )
        .then(() => this.pool.query("CREATE INDEX IF NOT EXISTS events_name_at_idx ON events (name, at DESC)"))
        .then(() => undefined);
    }
    return this.ready;
  }

  async listUsersLite(limit = 500): Promise<UserLite[]> {
    await this.init();
    const r = await this.pool.query("SELECT id, username, data FROM users ORDER BY created_at DESC LIMIT $1", [limit]);
    return r.rows.map((row) => ({ id: row.id, username: row.username, data: row.data ?? {} }));
  }

  async follow(followerId: string, followingId: string): Promise<void> {
    await this.init();
    if (followerId === followingId) return;
    await this.pool.query(
      "INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [followerId, followingId],
    );
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, followingId]);
  }

  async getFollowingIds(userId: string): Promise<string[]> {
    await this.init();
    const r = await this.pool.query("SELECT following_id FROM follows WHERE follower_id = $1", [userId]);
    return r.rows.map((row) => row.following_id as string);
  }

  async addKudos(fromId: string, ownerId: string, workoutId: string): Promise<void> {
    await this.init();
    await this.pool.query(
      "INSERT INTO kudos (from_id, owner_id, workout_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [fromId, ownerId, workoutId],
    );
  }

  async removeKudos(fromId: string, ownerId: string, workoutId: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM kudos WHERE from_id = $1 AND owner_id = $2 AND workout_id = $3", [fromId, ownerId, workoutId]);
  }

  async getKudosForOwner(ownerId: string): Promise<KudosRow[]> {
    await this.init();
    const r = await this.pool.query("SELECT from_id, workout_id FROM kudos WHERE owner_id = $1", [ownerId]);
    return r.rows.map((row) => ({ fromId: row.from_id as string, workoutId: row.workout_id as string }));
  }

  private mapStrava(row: Record<string, unknown>): StravaConn {
    return {
      userId: row.user_id as string,
      athleteId: Number(row.athlete_id),
      accessToken: row.access_token as string,
      refreshToken: row.refresh_token as string,
      expiresAt: Number(row.expires_at),
      scope: (row.scope as string) ?? undefined,
      lastSyncAtISO: row.last_sync_at ? new Date(row.last_sync_at as string).toISOString() : undefined,
    };
  }

  async getStravaByUser(userId: string): Promise<StravaConn | null> {
    await this.init();
    const r = await this.pool.query("SELECT * FROM strava_connections WHERE user_id = $1", [userId]);
    return r.rows[0] ? this.mapStrava(r.rows[0]) : null;
  }

  async getStravaByAthlete(athleteId: number): Promise<StravaConn | null> {
    await this.init();
    const r = await this.pool.query("SELECT * FROM strava_connections WHERE athlete_id = $1", [athleteId]);
    return r.rows[0] ? this.mapStrava(r.rows[0]) : null;
  }

  async upsertStrava(c: StravaConn): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO strava_connections (user_id, athlete_id, access_token, refresh_token, expires_at, scope, connected_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (user_id) DO UPDATE SET
         athlete_id = EXCLUDED.athlete_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope`,
      [c.userId, c.athleteId, c.accessToken, c.refreshToken, c.expiresAt, c.scope ?? null],
    );
  }

  async updateStravaTokens(userId: string, t: { accessToken: string; refreshToken: string; expiresAt: number }): Promise<void> {
    await this.init();
    await this.pool.query(
      "UPDATE strava_connections SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE user_id = $4",
      [t.accessToken, t.refreshToken, t.expiresAt, userId],
    );
  }

  async deleteStrava(userId: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM strava_connections WHERE user_id = $1", [userId]);
  }

  async touchStravaSync(userId: string): Promise<void> {
    await this.init();
    await this.pool.query("UPDATE strava_connections SET last_sync_at = now() WHERE user_id = $1", [userId]);
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    await this.init();
    const r = await this.pool.query(
      "SELECT id, username, password_hash, data FROM users WHERE username_lower = $1",
      [username.toLowerCase()],
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { id: row.id, username: row.username, passwordHash: row.password_hash, data: row.data ?? {} };
  }

  async getUserById(id: string): Promise<UserRow | null> {
    await this.init();
    const r = await this.pool.query(
      "SELECT id, username, password_hash, data FROM users WHERE id = $1",
      [id],
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { id: row.id, username: row.username, passwordHash: row.password_hash, data: row.data ?? {} };
  }

  async createUser(username: string, passwordHash: string): Promise<UserRow> {
    await this.init();
    const id = newId();
    try {
      await this.pool.query(
        "INSERT INTO users (id, username, username_lower, password_hash, data) VALUES ($1,$2,$3,$4,$5)",
        [id, username, username.toLowerCase(), passwordHash, {}],
      );
    } catch (e) {
      // unique-violation on username_lower (concurrent signup) → typed 409, not a raw 500
      if ((e as { code?: string }).code === "23505") throw new DuplicateUsernameError();
      throw e;
    }
    return { id, username, passwordHash, data: {} };
  }

  async getData(userId: string): Promise<AppState> {
    await this.init();
    const r = await this.pool.query("SELECT data FROM users WHERE id = $1", [userId]);
    return r.rows[0]?.data ?? {};
  }

  async setData(userId: string, data: AppState): Promise<void> {
    await this.init();
    // blind overwrite (signup/legacy clients) — still bumps the version so CAS writers see it
    await this.pool.query(
      "UPDATE users SET data = $1, data_version = data_version + 1, updated_at = now() WHERE id = $2",
      [data, userId],
    );
  }

  async getDataV(userId: string): Promise<{ state: AppState; version: number } | null> {
    await this.init();
    const r = await this.pool.query("SELECT data, data_version FROM users WHERE id = $1", [userId]);
    if (!r.rows[0]) return null;
    return { state: r.rows[0].data ?? {}, version: Number(r.rows[0].data_version) };
  }

  async setDataIf(userId: string, data: AppState, expectedVersion: number): Promise<number | null> {
    await this.init();
    const r = await this.pool.query(
      `UPDATE users SET data = $1, data_version = data_version + 1, updated_at = now()
       WHERE id = $2 AND data_version = $3 RETURNING data_version`,
      [data, userId, expectedVersion],
    );
    return r.rows[0] ? Number(r.rows[0].data_version) : null;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.init();
    // FK ON DELETE CASCADE removes strava_connections, follows, kudos and events too.
    await this.pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }

  async isSessionLive(userId: string, sid: string, issuedAt: number): Promise<boolean> {
    await this.init();
    // One query, three checks. EXISTS on the primary key is an index probe, and the
    // row is absent entirely for a deleted account — so a token that outlives its user
    // dies here rather than authenticating against nothing.
    const { rows } = await this.pool.query(
      `SELECT u.session_epoch,
              EXISTS(SELECT 1 FROM revoked_sessions r
                      WHERE r.user_id = u.id AND r.sid = $2) AS revoked
         FROM users u WHERE u.id = $1`,
      [userId, sid],
    );
    const row = rows[0];
    if (!row || row.revoked) return false;
    return issuedAt >= Number(row.session_epoch ?? 0);
  }

  async revokeSession(userId: string, sid: string, expiresAt: number): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO revoked_sessions (user_id, sid, expires_at) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, sid) DO NOTHING`,
      [userId, sid, expiresAt],
    );
    // Opportunistic prune — a revocation row is only useful until the token it kills
    // would have expired on its own.
    await this.pool
      .query("DELETE FROM revoked_sessions WHERE expires_at < $1", [Math.floor(Date.now() / 1000)])
      .catch(() => {});
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.init();
    await this.pool.query("UPDATE users SET session_epoch = $2 WHERE id = $1", [
      userId,
      Math.floor(Date.now() / 1000),
    ]);
  }

  async recordEvents(userId: string, events: { name: string; props?: unknown; atISO?: string }[]): Promise<void> {
    if (!events.length) return;
    await this.init();
    // one multi-row INSERT — a batch of events costs a single round trip
    const vals: unknown[] = [];
    const rows = events.map((e, i) => {
      const b = i * 4;
      vals.push(userId, e.name, e.props ?? null, e.atISO ?? new Date().toISOString());
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
    });
    await this.pool.query(`INSERT INTO events (user_id, name, props, at) VALUES ${rows.join(", ")}`, vals);
  }

  // ---- leagues ----

  // NUMERIC and BIGINT both come back from pg as strings — Number() them here so
  // nothing downstream ever does string arithmetic on a distance.
  private mapActivity(row: Record<string, unknown>): LeagueActivity {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      sport: row.sport as Sport,
      km: Number(row.km),
      occurredOn: row.occurred_on as string,
      note: (row.note as string) ?? null,
      source: (row.source as "manual" | "strava") ?? "manual",
      stravaId: row.strava_id == null ? null : Number(row.strava_id),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  private mapLeague(row: Record<string, unknown>): League {
    return {
      id: row.id as string,
      name: row.name as string,
      ownerId: row.owner_id as string,
      inviteCode: row.invite_code as string,
      settings: mergeSettings(row.settings),
      createdAt: new Date(row.created_at as string).toISOString(),
      memberCount: row.member_count == null ? 0 : Number(row.member_count),
      myRole: (row.my_role as LeagueRole) ?? undefined,
    };
  }

  async createLeague(name: string, ownerId: string, settings: LeagueSettings, inviteCode: string): Promise<League> {
    await this.init();
    const id = newId();
    const client = await this.pool.connect();
    try {
      // The league and its owner's membership must land together — a league whose
      // creator isn't a member is unreachable and unfixable through the API.
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO leagues (id, name, owner_id, invite_code, settings) VALUES ($1,$2,$3,$4,$5)",
        [id, name, ownerId, inviteCode, JSON.stringify(settings)],
      );
      await client.query(
        "INSERT INTO league_members (league_id, user_id, role) VALUES ($1,$2,'owner')",
        [id, ownerId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const row = await this.getLeague(id);
    if (!row) throw new Error("League vanished immediately after creation");
    // getLeague has no caller to resolve a role against, so it can't fill this in.
    // Whoever creates a league owns it — say so, or the client that just made one
    // renders it without the admin controls until the next refetch (and the memory
    // store, which does set it, would silently disagree with Postgres).
    return { ...row, myRole: "owner" };
  }

  async getLeague(leagueId: string): Promise<League | null> {
    await this.init();
    const r = await this.pool.query(
      `SELECT l.*, (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS member_count
         FROM leagues l WHERE l.id = $1`,
      [leagueId],
    );
    return r.rows[0] ? this.mapLeague(r.rows[0]) : null;
  }

  async getLeagueByInviteCode(code: string): Promise<League | null> {
    await this.init();
    const r = await this.pool.query(
      `SELECT l.*, (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS member_count
         FROM leagues l WHERE l.invite_code = $1`,
      [code],
    );
    return r.rows[0] ? this.mapLeague(r.rows[0]) : null;
  }

  async listLeaguesForUser(userId: string): Promise<League[]> {
    await this.init();
    const r = await this.pool.query(
      `SELECT l.*, mine.role AS my_role,
              (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS member_count
         FROM leagues l
         JOIN league_members mine ON mine.league_id = l.id AND mine.user_id = $1
        ORDER BY l.created_at ASC`,
      [userId],
    );
    return r.rows.map((row) => this.mapLeague(row));
  }

  async countLeaguesOwned(ownerId: string): Promise<number> {
    await this.init();
    const r = await this.pool.query("SELECT count(*) AS n FROM leagues WHERE owner_id = $1", [ownerId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async updateLeague(
    leagueId: string,
    patch: { name?: string; settings?: LeagueSettings; inviteCode?: string },
  ): Promise<void> {
    await this.init();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) sets.push(`name = $${vals.push(patch.name)}`);
    if (patch.settings !== undefined) sets.push(`settings = $${vals.push(JSON.stringify(patch.settings))}::jsonb`);
    if (patch.inviteCode !== undefined) sets.push(`invite_code = $${vals.push(patch.inviteCode)}`);
    if (!sets.length) return;
    vals.push(leagueId);
    await this.pool.query(`UPDATE leagues SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  }

  async deleteLeague(leagueId: string): Promise<void> {
    await this.init();
    // members + invites cascade; activities are user-scoped and deliberately survive
    await this.pool.query("DELETE FROM leagues WHERE id = $1", [leagueId]);
  }

  async addLeagueMember(leagueId: string, userId: string, role: LeagueRole): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO league_members (league_id, user_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (league_id, user_id) DO NOTHING`,
      [leagueId, userId, role],
    );
  }

  async removeLeagueMember(leagueId: string, userId: string): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM league_members WHERE league_id = $1 AND user_id = $2", [leagueId, userId]);
  }

  async setLeagueRole(leagueId: string, userId: string, role: LeagueRole): Promise<void> {
    await this.init();
    await this.pool.query("UPDATE league_members SET role = $3 WHERE league_id = $1 AND user_id = $2", [
      leagueId,
      userId,
      role,
    ]);
  }

  async listLeagueMembers(leagueId: string): Promise<LeagueMember[]> {
    await this.init();
    const r = await this.pool.query(
      `SELECT m.user_id, m.role, m.joined_at, u.username
         FROM league_members m JOIN users u ON u.id = m.user_id
        WHERE m.league_id = $1
        ORDER BY m.joined_at ASC`,
      [leagueId],
    );
    return r.rows.map((row) => ({
      userId: row.user_id as string,
      username: row.username as string,
      role: row.role as LeagueRole,
      joinedAt: new Date(row.joined_at as string).toISOString(),
    }));
  }

  async getLeagueRole(leagueId: string, userId: string): Promise<LeagueRole | null> {
    await this.init();
    const r = await this.pool.query(
      "SELECT role FROM league_members WHERE league_id = $1 AND user_id = $2",
      [leagueId, userId],
    );
    return (r.rows[0]?.role as LeagueRole) ?? null;
  }

  async handOffOwnedLeagues(ownerId: string): Promise<void> {
    await this.init();
    const owned = await this.pool.query("SELECT id FROM leagues WHERE owner_id = $1", [ownerId]);
    for (const row of owned.rows) {
      const leagueId = row.id as string;
      const heir = await this.pool.query(
        `SELECT user_id FROM league_members
          WHERE league_id = $1 AND user_id <> $2
          ORDER BY joined_at ASC LIMIT 1`,
        [leagueId, ownerId],
      );
      const heirId = heir.rows[0]?.user_id as string | undefined;
      if (!heirId) {
        await this.deleteLeague(leagueId); // they were the only member
        continue;
      }
      await this.pool.query("UPDATE leagues SET owner_id = $2 WHERE id = $1", [leagueId, heirId]);
      await this.pool.query(
        "UPDATE league_members SET role = 'owner' WHERE league_id = $1 AND user_id = $2",
        [leagueId, heirId],
      );
    }
  }

  // ---- activities ----

  async createActivity(input: NewActivity, source: "manual" | "strava" = "manual", stravaId?: number): Promise<LeagueActivity> {
    await this.init();
    const id = newId();
    const r = await this.pool.query(
      `INSERT INTO athlete_activities (id, user_id, sport, km, occurred_on, note, source, strava_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, input.userId, input.sport, input.km, input.occurredOn, input.note, source, stravaId ?? null],
    );
    return this.mapActivity(r.rows[0]);
  }

  async getActivity(id: string): Promise<LeagueActivity | null> {
    await this.init();
    const r = await this.pool.query("SELECT * FROM athlete_activities WHERE id = $1", [id]);
    return r.rows[0] ? this.mapActivity(r.rows[0]) : null;
  }

  async updateActivity(id: string, patch: Partial<Omit<NewActivity, "userId">>): Promise<LeagueActivity | null> {
    await this.init();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.sport !== undefined) sets.push(`sport = $${vals.push(patch.sport)}`);
    if (patch.km !== undefined) sets.push(`km = $${vals.push(patch.km)}`);
    if (patch.occurredOn !== undefined) sets.push(`occurred_on = $${vals.push(patch.occurredOn)}`);
    if (patch.note !== undefined) sets.push(`note = $${vals.push(patch.note)}`);
    if (!sets.length) return this.getActivity(id);
    sets.push("updated_at = now()");
    vals.push(id);
    const r = await this.pool.query(
      `UPDATE athlete_activities SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return r.rows[0] ? this.mapActivity(r.rows[0]) : null;
  }

  async deleteActivity(id: string): Promise<boolean> {
    await this.init();
    const r = await this.pool.query("DELETE FROM athlete_activities WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async listActivitiesForUsers(userIds: string[], from: string, to: string): Promise<LeagueActivity[]> {
    await this.init();
    if (!userIds.length) return [];
    const r = await this.pool.query(
      `SELECT * FROM athlete_activities
        WHERE user_id = ANY($1::text[]) AND occurred_on >= $2 AND occurred_on <= $3
        ORDER BY occurred_on DESC, created_at DESC`,
      [userIds, from, to],
    );
    return r.rows.map((row) => this.mapActivity(row));
  }

  async importStravaActivity(input: NewActivity, stravaId: number): Promise<LeagueActivity | null> {
    await this.init();
    // The ledger insert is the lock: whoever wins it owns the import, so a webhook
    // and a manual sync racing on the same activity can only create one row.
    const claim = await this.pool.query(
      "INSERT INTO strava_imports (strava_id, user_id) VALUES ($1,$2) ON CONFLICT (strava_id) DO NOTHING",
      [stravaId, input.userId],
    );
    if ((claim.rowCount ?? 0) === 0) return null;
    return this.createActivity(input, "strava", stravaId);
  }

  async deleteStravaActivity(userId: string, stravaId: number): Promise<void> {
    await this.init();
    await this.pool.query("DELETE FROM athlete_activities WHERE user_id = $1 AND strava_id = $2", [userId, stravaId]);
    // Leave the ledger row: the activity is gone upstream, so re-importing it
    // would only resurrect what the athlete deleted.
  }

  // ---- invites ----

  async createLeagueInvite(leagueId: string, invitedUserId: string, invitedBy: string): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO league_invites (id, league_id, invited_user_id, invited_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [newId(), leagueId, invitedUserId, invitedBy],
    );
  }

  async listInvitesForUser(userId: string): Promise<LeagueInvite[]> {
    await this.init();
    const r = await this.pool.query(
      `SELECT i.*, l.name AS league_name, u.username AS invited_by_username
         FROM league_invites i
         JOIN leagues l ON l.id = i.league_id
         JOIN users u ON u.id = i.invited_by
        WHERE i.invited_user_id = $1 AND i.status = 'pending'
        ORDER BY i.created_at DESC`,
      [userId],
    );
    return r.rows.map((row) => this.mapInvite(row));
  }

  private mapInvite(row: Record<string, unknown>): LeagueInvite {
    return {
      id: row.id as string,
      leagueId: row.league_id as string,
      leagueName: (row.league_name as string) ?? "",
      invitedUserId: row.invited_user_id as string,
      invitedBy: row.invited_by as string,
      invitedByUsername: (row.invited_by_username as string) ?? "",
      status: row.status as LeagueInvite["status"],
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async getLeagueInvite(inviteId: string): Promise<LeagueInvite | null> {
    await this.init();
    const r = await this.pool.query(
      `SELECT i.*, l.name AS league_name, u.username AS invited_by_username
         FROM league_invites i
         JOIN leagues l ON l.id = i.league_id
         JOIN users u ON u.id = i.invited_by
        WHERE i.id = $1`,
      [inviteId],
    );
    return r.rows[0] ? this.mapInvite(r.rows[0]) : null;
  }

  async respondToInvite(inviteId: string, status: "accepted" | "declined"): Promise<void> {
    await this.init();
    await this.pool.query("UPDATE league_invites SET status = $2 WHERE id = $1", [inviteId, status]);
  }
}

/** Thrown by a Store's createUser when the username is already taken (for a race-safe 409). */
export class DuplicateUsernameError extends Error {
  constructor() {
    super("Username already taken");
    this.name = "DuplicateUsernameError";
  }
}

// ---- in-memory fallback ----

class MemoryStore implements Store {
  private users = new Map<string, UserRow>(); // keyed by id
  private byName = new Map<string, string>(); // lower -> id
  private dataVersions = new Map<string, number>(); // keyed by id — mirrors users.data_version
  private events = new Map<string, { name: string; props?: unknown; at: string }[]>(); // mirrors the events table
  private strava = new Map<string, StravaConn>(); // keyed by userId
  private follows = new Set<string>(); // "followerId::followingId"
  private kudos = new Set<string>(); // "fromId::ownerId::workoutId"
  private revoked = new Map<string, number>(); // "userId::sid" -> token expiry (unix s)
  private sessionEpoch = new Map<string, number>(); // userId -> sign-out-everywhere mark

  async init(): Promise<void> {}
  async getUserByUsername(username: string): Promise<UserRow | null> {
    const id = this.byName.get(username.toLowerCase());
    return id ? this.users.get(id) ?? null : null;
  }
  async getUserById(id: string): Promise<UserRow | null> {
    return this.users.get(id) ?? null;
  }
  async createUser(username: string, passwordHash: string): Promise<UserRow> {
    const lower = username.toLowerCase();
    if (this.byName.has(lower)) throw new DuplicateUsernameError();
    const id = newId();
    const row: UserRow = { id, username, passwordHash, data: {} };
    this.users.set(id, row);
    this.byName.set(lower, id);
    this.dataVersions.set(id, 1);
    return row;
  }
  async getData(userId: string): Promise<AppState> {
    return this.users.get(userId)?.data ?? {};
  }
  async setData(userId: string, data: AppState): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    u.data = data;
    this.dataVersions.set(userId, (this.dataVersions.get(userId) ?? 1) + 1);
  }
  async getDataV(userId: string): Promise<{ state: AppState; version: number } | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    return { state: u.data ?? {}, version: this.dataVersions.get(userId) ?? 1 };
  }
  async setDataIf(userId: string, data: AppState, expectedVersion: number): Promise<number | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const cur = this.dataVersions.get(userId) ?? 1;
    if (cur !== expectedVersion) return null;
    u.data = data;
    this.dataVersions.set(userId, cur + 1);
    return cur + 1;
  }
  async recordEvents(userId: string, events: { name: string; props?: unknown; atISO?: string }[]): Promise<void> {
    if (!this.users.has(userId)) return;
    const list = this.events.get(userId) ?? [];
    for (const e of events) list.push({ ...e, at: e.atISO ?? new Date().toISOString() });
    // dev store: keep it bounded so a long session can't grow without limit
    this.events.set(userId, list.slice(-500));
  }
  async isSessionLive(userId: string, sid: string, issuedAt: number): Promise<boolean> {
    if (!this.users.has(userId)) return false; // deleted account ⇒ dead token
    if (this.revoked.has(`${userId}::${sid}`)) return false;
    return issuedAt >= (this.sessionEpoch.get(userId) ?? 0);
  }
  async revokeSession(userId: string, sid: string, expiresAt: number): Promise<void> {
    this.revoked.set(`${userId}::${sid}`, expiresAt);
    const now = Math.floor(Date.now() / 1000);
    for (const [k, exp] of this.revoked) if (exp < now) this.revoked.delete(k);
  }
  async revokeAllSessions(userId: string): Promise<void> {
    this.sessionEpoch.set(userId, Math.floor(Date.now() / 1000));
  }
  async deleteUser(userId: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.byName.delete(u.username.toLowerCase());
    this.users.delete(userId);
    this.events.delete(userId);
    this.dataVersions.delete(userId);
    this.strava.delete(userId);
    this.sessionEpoch.delete(userId);
    for (const k of [...this.revoked.keys()]) if (k.startsWith(`${userId}::`)) this.revoked.delete(k);
    for (const f of [...this.follows]) {
      const [a, b] = f.split("::");
      if (a === userId || b === userId) this.follows.delete(f);
    }
    for (const k of [...this.kudos]) {
      const [from, owner] = k.split("::");
      if (from === userId || owner === userId) this.kudos.delete(k);
    }
    // league data — mirrors the FK cascades the Postgres store gets for free
    for (const k of [...this.members.keys()]) if (k.endsWith(`::${userId}`)) this.members.delete(k);
    for (const [id, a] of this.activities) if (a.userId === userId) this.activities.delete(id);
    for (const [id, inv] of this.invites) {
      if (inv.invitedUserId === userId || inv.invitedBy === userId) this.invites.delete(id);
    }
  }
  async getStravaByUser(userId: string): Promise<StravaConn | null> {
    return this.strava.get(userId) ?? null;
  }
  async getStravaByAthlete(athleteId: number): Promise<StravaConn | null> {
    for (const c of this.strava.values()) if (c.athleteId === athleteId) return c;
    return null;
  }
  async upsertStrava(conn: StravaConn): Promise<void> {
    this.strava.set(conn.userId, { ...conn });
  }
  async updateStravaTokens(userId: string, t: { accessToken: string; refreshToken: string; expiresAt: number }): Promise<void> {
    const c = this.strava.get(userId);
    if (c) Object.assign(c, t);
  }
  async deleteStrava(userId: string): Promise<void> {
    this.strava.delete(userId);
  }
  async touchStravaSync(userId: string): Promise<void> {
    const c = this.strava.get(userId);
    if (c) c.lastSyncAtISO = new Date().toISOString();
  }
  async listUsersLite(limit = 500): Promise<UserLite[]> {
    return [...this.users.values()].slice(0, limit).map((u) => ({ id: u.id, username: u.username, data: u.data }));
  }
  async follow(followerId: string, followingId: string): Promise<void> {
    if (followerId !== followingId) this.follows.add(`${followerId}::${followingId}`);
  }
  async unfollow(followerId: string, followingId: string): Promise<void> {
    this.follows.delete(`${followerId}::${followingId}`);
  }
  async getFollowingIds(userId: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.follows) {
      const [f, g] = k.split("::");
      if (f === userId) out.push(g);
    }
    return out;
  }
  async addKudos(fromId: string, ownerId: string, workoutId: string): Promise<void> {
    this.kudos.add(`${fromId}::${ownerId}::${workoutId}`);
  }
  async removeKudos(fromId: string, ownerId: string, workoutId: string): Promise<void> {
    this.kudos.delete(`${fromId}::${ownerId}::${workoutId}`);
  }
  async getKudosForOwner(ownerId: string): Promise<KudosRow[]> {
    const out: KudosRow[] = [];
    for (const k of this.kudos) {
      const [fromId, owner, workoutId] = k.split("::");
      if (owner === ownerId) out.push({ fromId, workoutId });
    }
    return out;
  }

  // ---- leagues ----

  private leagues = new Map<string, Omit<League, "memberCount" | "myRole">>();
  private members = new Map<string, { role: LeagueRole; joinedAt: string }>(); // "leagueId::userId"
  private activities = new Map<string, LeagueActivity>();
  private stravaImports = new Set<number>();
  private invites = new Map<string, Omit<LeagueInvite, "leagueName" | "invitedByUsername">>();

  private hydrate(l: Omit<League, "memberCount" | "myRole">, userId?: string): League {
    let memberCount = 0;
    let myRole: LeagueRole | undefined;
    for (const [k, v] of this.members) {
      const [lid, uid] = k.split("::");
      if (lid !== l.id) continue;
      memberCount += 1;
      if (uid === userId) myRole = v.role;
    }
    return { ...l, memberCount, myRole };
  }

  async createLeague(name: string, ownerId: string, settings: LeagueSettings, inviteCode: string): Promise<League> {
    const id = newId();
    const l = { id, name, ownerId, inviteCode, settings, createdAt: new Date().toISOString() };
    this.leagues.set(id, l);
    this.members.set(`${id}::${ownerId}`, { role: "owner", joinedAt: new Date().toISOString() });
    return this.hydrate(l, ownerId);
  }
  async getLeague(leagueId: string): Promise<League | null> {
    const l = this.leagues.get(leagueId);
    return l ? this.hydrate(l) : null;
  }
  async getLeagueByInviteCode(code: string): Promise<League | null> {
    for (const l of this.leagues.values()) if (l.inviteCode === code) return this.hydrate(l);
    return null;
  }
  async listLeaguesForUser(userId: string): Promise<League[]> {
    const out: League[] = [];
    for (const l of this.leagues.values()) {
      if (this.members.has(`${l.id}::${userId}`)) out.push(this.hydrate(l, userId));
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async countLeaguesOwned(ownerId: string): Promise<number> {
    let n = 0;
    for (const l of this.leagues.values()) if (l.ownerId === ownerId) n += 1;
    return n;
  }
  async updateLeague(leagueId: string, patch: { name?: string; settings?: LeagueSettings; inviteCode?: string }): Promise<void> {
    const l = this.leagues.get(leagueId);
    if (!l) return;
    if (patch.name !== undefined) l.name = patch.name;
    if (patch.settings !== undefined) l.settings = patch.settings;
    if (patch.inviteCode !== undefined) l.inviteCode = patch.inviteCode;
  }
  async deleteLeague(leagueId: string): Promise<void> {
    this.leagues.delete(leagueId);
    for (const k of [...this.members.keys()]) if (k.startsWith(`${leagueId}::`)) this.members.delete(k);
    for (const [id, inv] of this.invites) if (inv.leagueId === leagueId) this.invites.delete(id);
  }
  async addLeagueMember(leagueId: string, userId: string, role: LeagueRole): Promise<void> {
    const key = `${leagueId}::${userId}`;
    if (!this.members.has(key)) this.members.set(key, { role, joinedAt: new Date().toISOString() });
  }
  async removeLeagueMember(leagueId: string, userId: string): Promise<void> {
    this.members.delete(`${leagueId}::${userId}`);
  }
  async setLeagueRole(leagueId: string, userId: string, role: LeagueRole): Promise<void> {
    const m = this.members.get(`${leagueId}::${userId}`);
    if (m) m.role = role;
  }
  async listLeagueMembers(leagueId: string): Promise<LeagueMember[]> {
    const out: LeagueMember[] = [];
    for (const [k, v] of this.members) {
      const [lid, uid] = k.split("::");
      if (lid !== leagueId) continue;
      const u = this.users.get(uid);
      if (!u) continue;
      out.push({ userId: uid, username: u.username, role: v.role, joinedAt: v.joinedAt });
    }
    return out.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }
  async getLeagueRole(leagueId: string, userId: string): Promise<LeagueRole | null> {
    return this.members.get(`${leagueId}::${userId}`)?.role ?? null;
  }
  async handOffOwnedLeagues(ownerId: string): Promise<void> {
    for (const l of [...this.leagues.values()]) {
      if (l.ownerId !== ownerId) continue;
      const heir = (await this.listLeagueMembers(l.id)).find((m) => m.userId !== ownerId);
      if (!heir) {
        await this.deleteLeague(l.id);
        continue;
      }
      l.ownerId = heir.userId;
      const m = this.members.get(`${l.id}::${heir.userId}`);
      if (m) m.role = "owner";
    }
  }

  // ---- activities ----

  async createActivity(input: NewActivity, source: "manual" | "strava" = "manual", stravaId?: number): Promise<LeagueActivity> {
    const a: LeagueActivity = {
      id: newId(),
      userId: input.userId,
      sport: input.sport,
      km: input.km,
      occurredOn: input.occurredOn,
      note: input.note,
      source,
      stravaId: stravaId ?? null,
      createdAt: new Date().toISOString(),
    };
    this.activities.set(a.id, a);
    return a;
  }
  async getActivity(id: string): Promise<LeagueActivity | null> {
    return this.activities.get(id) ?? null;
  }
  async updateActivity(id: string, patch: Partial<Omit<NewActivity, "userId">>): Promise<LeagueActivity | null> {
    const a = this.activities.get(id);
    if (!a) return null;
    Object.assign(a, patch);
    return a;
  }
  async deleteActivity(id: string): Promise<boolean> {
    return this.activities.delete(id);
  }
  async listActivitiesForUsers(userIds: string[], from: string, to: string): Promise<LeagueActivity[]> {
    const set = new Set(userIds);
    return [...this.activities.values()]
      .filter((a) => set.has(a.userId) && a.occurredOn >= from && a.occurredOn <= to)
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
  }
  async importStravaActivity(input: NewActivity, stravaId: number): Promise<LeagueActivity | null> {
    if (this.stravaImports.has(stravaId)) return null;
    this.stravaImports.add(stravaId);
    return this.createActivity(input, "strava", stravaId);
  }
  async deleteStravaActivity(userId: string, stravaId: number): Promise<void> {
    for (const [id, a] of this.activities) {
      if (a.userId === userId && a.stravaId === stravaId) this.activities.delete(id);
    }
  }

  // ---- invites ----

  async createLeagueInvite(leagueId: string, invitedUserId: string, invitedBy: string): Promise<void> {
    for (const inv of this.invites.values()) {
      if (inv.leagueId === leagueId && inv.invitedUserId === invitedUserId && inv.status === "pending") return;
    }
    const id = newId();
    this.invites.set(id, {
      id,
      leagueId,
      invitedUserId,
      invitedBy,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  }
  private hydrateInvite(inv: Omit<LeagueInvite, "leagueName" | "invitedByUsername">): LeagueInvite {
    return {
      ...inv,
      leagueName: this.leagues.get(inv.leagueId)?.name ?? "",
      invitedByUsername: this.users.get(inv.invitedBy)?.username ?? "",
    };
  }
  async listInvitesForUser(userId: string): Promise<LeagueInvite[]> {
    return [...this.invites.values()]
      .filter((i) => i.invitedUserId === userId && i.status === "pending")
      .map((i) => this.hydrateInvite(i))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getLeagueInvite(inviteId: string): Promise<LeagueInvite | null> {
    const inv = this.invites.get(inviteId);
    return inv ? this.hydrateInvite(inv) : null;
  }
  async respondToInvite(inviteId: string, status: "accepted" | "declined"): Promise<void> {
    const inv = this.invites.get(inviteId);
    if (inv) inv.status = status;
  }
}

// ---- singleton selection (survives dev HMR via globalThis) ----

const g = globalThis as unknown as { __ipStore?: Store; __ipPool?: PgPool };

function needSSL(url: string): boolean {
  if (/sslmode=require/.test(url)) return true;
  if (process.env.PGSSL === "true") return true;
  // external Railway proxy hosts need SSL; internal *.railway.internal does not
  return /\.rlwy\.net|proxy\.rlwy/.test(url);
}

export function getStore(): Store {
  if (g.__ipStore) return g.__ipStore;
  const url = process.env.DATABASE_URL;
  if (url) {
    // require lazily so local runs without pg native issues still work
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    const pool =
      g.__ipPool ??
      new Pool({
        connectionString: url,
        ssl: needSSL(url) ? { rejectUnauthorized: false } : undefined,
        max: 5,
      });
    g.__ipPool = pool;
    g.__ipStore = new PgStore(pool);
  } else {
    g.__ipStore = new MemoryStore();
  }
  return g.__ipStore;
}

export function usingDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}
