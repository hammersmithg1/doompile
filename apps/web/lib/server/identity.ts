import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Provider = "google" | "yandex" | "development";
export type User = {
  id: string;
  provider: Provider;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  createdAt: string;
  lastLoginAt: string;
  lastSeenAt: string;
};
export type Principal = {
  user: User;
  kind: "web" | "device";
  sessionHash: string;
};
export const opaque = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const dataDirectory = () =>
  resolve(
    /* turbopackIgnore: true */ process.env.DOOMPILE_DATA_DIR || "./data",
  );
const userColumns = `id, provider, subject, email, email_verified AS emailVerified, name,
  created_at AS createdAt, last_login_at AS lastLoginAt, last_seen_at AS lastSeenAt`;
const decodeUser = (row: unknown): User | null =>
  row
    ? { ...(row as User), emailVerified: Boolean((row as User).emailVerified) }
    : null;
export type OAuthAttempt = {
  state: string;
  browserHash: string;
  provider: Provider;
  verifier: string;
  nonce: string;
  returnTo: string;
  expires: number;
};

export class IdentityStore {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(resolve(directory, "identity.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL,
        email TEXT NOT NULL, email_verified INTEGER NOT NULL, name TEXT NOT NULL,
        created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        UNIQUE(provider,subject)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL, label TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS oauth_attempts (
        state TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, provider TEXT NOT NULL,
        verifier TEXT NOT NULL, nonce TEXT NOT NULL, return_to TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_flows (
        code TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, label TEXT NOT NULL,
        user_id TEXT REFERENCES users(id), expires INTEGER NOT NULL
      );`);
  }
  user(id: string): User | null {
    return decodeUser(
      this.db.prepare(`SELECT ${userColumns} FROM users WHERE id=?`).get(id),
    );
  }
  login(
    profile: Pick<
      User,
      "provider" | "subject" | "email" | "emailVerified" | "name"
    >,
  ): User {
    const now = new Date().toISOString();
    // Identity is the provider's immutable subject; matching emails never link accounts.
    this.db
      .prepare(
        `INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,subject)
      DO UPDATE SET email=excluded.email,email_verified=excluded.email_verified,name=excluded.name,
      last_login_at=excluded.last_login_at,last_seen_at=excluded.last_seen_at`,
      )
      .run(
        randomUUID(),
        profile.provider,
        profile.subject,
        profile.email.trim().toLowerCase(),
        profile.emailVerified ? 1 : 0,
        profile.name.slice(0, 200),
        now,
        now,
        now,
      );
    return decodeUser(
      this.db
        .prepare(
          `SELECT ${userColumns} FROM users WHERE provider=? AND subject=?`,
        )
        .get(profile.provider, profile.subject),
    )!;
  }
  issue(userId: string, kind: Principal["kind"], label = "", now = Date.now()) {
    this.prune(now);
    const token = opaque();
    const expires = now + (kind === "web" ? 30 : 365) * 86_400_000;
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
      .run(hash(token), userId, kind, label.slice(0, 100), expires);
    return { token, expires };
  }
  authenticate(
    token: string,
    kind: Principal["kind"],
    now = Date.now(),
  ): Principal | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const digest = hash(token);
    const session = this.db
      .prepare(
        "SELECT user_id FROM sessions WHERE hash=? AND kind=? AND expires>?",
      )
      .get(digest, kind, now) as { user_id: string } | undefined;
    if (!session) return null;
    const user = this.user(session.user_id);
    if (!user) return null;
    if (now - Date.parse(user.lastSeenAt) > 300_000) {
      user.lastSeenAt = new Date(now).toISOString();
      this.db
        .prepare("UPDATE users SET last_seen_at=? WHERE id=?")
        .run(user.lastSeenAt, user.id);
    }
    return { user, kind, sessionHash: digest };
  }
  revoke(sessionHash: string) {
    this.db.prepare("DELETE FROM sessions WHERE hash=?").run(sessionHash);
  }
  addOAuth(attempt: OAuthAttempt) {
    this.prune();
    if (
      (
        this.db.prepare("SELECT count(*) AS n FROM oauth_attempts").get() as {
          n: number;
        }
      ).n >= 1000
    )
      throw new Error("Too many pending sign-ins.");
    this.db
      .prepare("INSERT INTO oauth_attempts VALUES (?,?,?,?,?,?,?)")
      .run(
        attempt.state,
        attempt.browserHash,
        attempt.provider,
        attempt.verifier,
        attempt.nonce,
        attempt.returnTo,
        attempt.expires,
      );
  }
  consumeOAuth(
    state: string,
    browser: string,
    provider: string,
    now = Date.now(),
  ): OAuthAttempt | null {
    const row = this.db
      .prepare(
        `DELETE FROM oauth_attempts WHERE state=? AND browser_hash=? AND provider=? AND expires>?
      RETURNING state,browser_hash AS browserHash,provider,verifier,nonce,return_to AS returnTo,expires`,
      )
      .get(state, hash(browser), provider, now);
    return (row as OAuthAttempt | undefined) ?? null;
  }
  createDevice(label: string) {
    this.prune();
    if (
      (
        this.db.prepare("SELECT count(*) AS n FROM device_flows").get() as {
          n: number;
        }
      ).n >= 1000
    )
      throw new Error("Too many pending connections.");
    const code = opaque(),
      secret = opaque(),
      expires = Date.now() + 600_000;
    this.db
      .prepare("INSERT INTO device_flows VALUES (?,?,?,NULL,?)")
      .run(code, hash(secret), label.slice(0, 100), expires);
    return { code, secret, expires };
  }
  device(code: string) {
    return this.db
      .prepare(
        "SELECT label,user_id AS userId FROM device_flows WHERE code=? AND expires>?",
      )
      .get(code, Date.now()) as
      { label: string; userId: string | null } | undefined;
  }
  approveDevice(code: string, userId: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE device_flows SET user_id=? WHERE code=? AND user_id IS NULL AND expires>?",
        )
        .run(userId, code, Date.now()).changes === 1
    );
  }
  exchangeDevice(code: string, secret: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const flow = this.db
        .prepare(
          "SELECT user_id,label FROM device_flows WHERE code=? AND secret_hash=? AND expires>?",
        )
        .get(code, hash(secret), Date.now()) as
        { user_id: string | null; label: string } | undefined;
      if (!flow) {
        this.db.exec("COMMIT");
        return { status: "expired" as const };
      }
      if (!flow.user_id) {
        this.db.exec("COMMIT");
        return { status: "pending" as const };
      }
      const issued = this.issue(flow.user_id, "device", flow.label);
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE users SET last_login_at=?,last_seen_at=? WHERE id=?")
        .run(now, now, flow.user_id);
      this.db.prepare("DELETE FROM device_flows WHERE code=?").run(code);
      this.db.exec("COMMIT");
      return {
        status: "approved" as const,
        ...issued,
        user: this.user(flow.user_id)!,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  list(offset = 0, limit = 50): { total: number; users: User[] } {
    return {
      total: (
        this.db.prepare("SELECT count(*) AS n FROM users").get() as {
          n: number;
        }
      ).n,
      users: this.db
        .prepare(
          `SELECT ${userColumns} FROM users ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        )
        .all(limit, offset)
        .map((row) => decodeUser(row)!),
    };
  }
  private prune(now = Date.now()) {
    for (const table of ["sessions", "oauth_attempts", "device_flows"])
      this.db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(now);
  }
  close() {
    this.db.close();
  }
}

const globals = globalThis as typeof globalThis & {
  doompileIdentities?: Map<string, IdentityStore>;
};
export function identities(): IdentityStore {
  const directory = dataDirectory();
  const stores = (globals.doompileIdentities ??= new Map<
    string,
    IdentityStore
  >());
  if (!stores.has(directory))
    stores.set(directory, new IdentityStore(directory));
  return stores.get(directory)!;
}
