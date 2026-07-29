import type { Pool as PgPool } from "pg";

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
