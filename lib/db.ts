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
    await this.pool.query(
      "INSERT INTO users (id, username, username_lower, password_hash, data) VALUES ($1,$2,$3,$4,$5)",
      [id, username, username.toLowerCase(), passwordHash, {}],
    );
    return { id, username, passwordHash, data: {} };
  }

  async getData(userId: string): Promise<AppState> {
    await this.init();
    const r = await this.pool.query("SELECT data FROM users WHERE id = $1", [userId]);
    return r.rows[0]?.data ?? {};
  }

  async setData(userId: string, data: AppState): Promise<void> {
    await this.init();
    await this.pool.query("UPDATE users SET data = $1, updated_at = now() WHERE id = $2", [data, userId]);
  }
}

// ---- in-memory fallback ----

class MemoryStore implements Store {
  private users = new Map<string, UserRow>(); // keyed by id
  private byName = new Map<string, string>(); // lower -> id
  private strava = new Map<string, StravaConn>(); // keyed by userId
  private follows = new Set<string>(); // "followerId::followingId"
  private kudos = new Set<string>(); // "fromId::ownerId::workoutId"

  async init(): Promise<void> {}
  async getUserByUsername(username: string): Promise<UserRow | null> {
    const id = this.byName.get(username.toLowerCase());
    return id ? this.users.get(id) ?? null : null;
  }
  async getUserById(id: string): Promise<UserRow | null> {
    return this.users.get(id) ?? null;
  }
  async createUser(username: string, passwordHash: string): Promise<UserRow> {
    const id = newId();
    const row: UserRow = { id, username, passwordHash, data: {} };
    this.users.set(id, row);
    this.byName.set(username.toLowerCase(), id);
    return row;
  }
  async getData(userId: string): Promise<AppState> {
    return this.users.get(userId)?.data ?? {};
  }
  async setData(userId: string, data: AppState): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.data = data;
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
