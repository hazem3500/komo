import { timingSafeEqual } from "node:crypto";
import { check, string } from "./validation";

// Personal access tokens let a bot act as its owner with a narrower grant.
// Format: komo_pat_<12-char lookup id>_<43-char secret>. Only a salted SHA-256
// of the secret is stored (plus an optional server pepper), never the token.
export const PAT_PREFIX = "komo_pat_";
export const PAT_SCOPES = ["comments:read", "comments:write"] as const;
export type PatAccess = "read" | "write" | "any";
const PAT_PATTERN = /^komo_pat_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const MAX_ACTIVE_TOKENS = 25;
const MAX_LIFETIME_DAYS = 365;
const USE_LOG_INTERVAL = 60000;
const AUDIT_RETENTION = 180 * 86400000;

type TokenRow = {
  id: string;
  user_id: string;
  name: string;
  last4: string;
  salt: string;
  token_hash: string;
  scopes: string;
  projects: string | null;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};
type TokenUser = {
  id: string;
  name: string;
  verified: number;
  avatar_url?: string;
  accent_color?: string;
};

async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
const digest = (env: Env, salt: string, secret: string) =>
  sha256(`${env.KOMO_TOKEN_PEPPER ?? ""}\0${salt}\0${secret}`);
function randomId(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  while (result.length < length)
    for (const byte of crypto.getRandomValues(new Uint8Array(length)))
      // 252 = 7 * 36: discard the remainder range to avoid modulo bias.
      if (byte < 252 && result.length < length)
        result += alphabet[byte % alphabet.length];
  return result;
}
const randomSecret = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const list = (value: string | null): string[] | null => {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const isPersonalToken = (bearer: string) =>
  bearer.startsWith(PAT_PREFIX);

export function auditStatement(
  env: Env,
  actor: string,
  action: string,
  target: string,
  detail: Record<string, unknown>
) {
  return env.DB.prepare(
    "INSERT INTO audit_log(id,at,actor,action,target,detail) VALUES(?,?,?,?,?,?)"
  ).bind(
    crypto.randomUUID(),
    Date.now(),
    actor,
    action,
    target,
    JSON.stringify(detail)
  );
}

export const pruneAudit = (db: D1Database, now: number) =>
  db.prepare("DELETE FROM audit_log WHERE at<?").bind(now - AUDIT_RETENTION);

/** Projects an account holder may limit a token to: owned or joined. */
export async function accountProjects(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    "SELECT id AS project FROM workspaces WHERE owner_id=? UNION SELECT project FROM project_members WHERE user_id=? UNION SELECT project FROM project_owners WHERE user_id=?"
  )
    .bind(userId, userId, userId)
    .all<{ project: string }>();
  return rows.results.map((row) => row.project).sort();
}

const publicToken = (row: TokenRow, now: number) => ({
  id: row.id,
  name: row.name,
  prefix: `${PAT_PREFIX}${row.id}`,
  last4: row.last4,
  scopes: list(row.scopes) ?? [],
  projects: list(row.projects),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  lastUsedAt: row.last_used_at,
  expired: row.expires_at !== null && row.expires_at <= now,
});

export async function listTokens(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    "SELECT * FROM personal_access_tokens WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC,id"
  )
    .bind(userId)
    .all<TokenRow>();
  const now = Date.now();
  return rows.results.map((row) => publicToken(row, now));
}

export async function createToken(
  env: Env,
  userId: string,
  data: Record<string, unknown>
) {
  const name = string(data.name, 60, "token name").trim();
  check(name.length > 0, 400, "Name your token.");
  let expiresAt: number | null = null;
  if (data.expiresInDays !== undefined && data.expiresInDays !== null) {
    const days = data.expiresInDays;
    check(
      typeof days === "number" &&
        Number.isInteger(days) &&
        days >= 1 &&
        days <= MAX_LIFETIME_DAYS,
      400,
      `Choose an expiry between 1 and ${MAX_LIFETIME_DAYS} days.`
    );
    expiresAt = Date.now() + days * 86400000;
  }
  check(
    Array.isArray(data.scopes) &&
      data.scopes.length > 0 &&
      data.scopes.every((scope) =>
        (PAT_SCOPES as readonly unknown[]).includes(scope)
      ),
    400,
    `Choose at least one scope: ${PAT_SCOPES.join(", ")}.`
  );
  const scopes = PAT_SCOPES.filter((scope) =>
    (data.scopes as unknown[]).includes(scope)
  );
  let projects: string[] | null = null;
  if (data.projects !== undefined && data.projects !== null) {
    check(
      Array.isArray(data.projects) && data.projects.length <= 50,
      400,
      "Invalid project list."
    );
    if (data.projects.length) {
      projects = [...new Set(data.projects.map(String))].sort();
      const allowed = new Set(await accountProjects(env, userId));
      check(
        projects.every((project) => allowed.has(project)),
        400,
        "You can only limit a token to projects you own or have joined."
      );
    }
  }
  const active = await env.DB.prepare(
    "SELECT COUNT(*) AS used FROM personal_access_tokens WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)"
  )
    .bind(userId, Date.now())
    .first<{ used: number }>();
  check(
    (active?.used ?? 0) < MAX_ACTIVE_TOKENS,
    409,
    `You can have up to ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`
  );
  const id = randomId(12);
  const secret = randomSecret();
  const salt = randomId(16);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO personal_access_tokens(id,user_id,name,last4,salt,token_hash,scopes,projects,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      id,
      userId,
      name,
      secret.slice(-4),
      salt,
      await digest(env, salt, secret),
      JSON.stringify(scopes),
      projects && JSON.stringify(projects),
      now,
      expiresAt
    ),
    auditStatement(env, userId, "token.create", id, {
      name,
      scopes,
      projects,
      expiresAt,
    }),
  ]);
  return {
    token: `${PAT_PREFIX}${id}_${secret}`,
    item: publicToken(
      {
        id,
        user_id: userId,
        name,
        last4: secret.slice(-4),
        salt,
        token_hash: "",
        scopes: JSON.stringify(scopes),
        projects: projects && JSON.stringify(projects),
        created_at: now,
        expires_at: expiresAt,
        last_used_at: null,
        revoked_at: null,
      },
      now
    ),
  };
}

export async function revokeToken(env: Env, userId: string, id: string) {
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE personal_access_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL"
    ).bind(Date.now(), id, userId),
  ]);
  check(results[0].meta.changes, 404, "Token not found.");
  await auditStatement(env, userId, "token.revoke", id, {}).run();
}

/**
 * Resolves a bearer personal access token to its owner. 401 for unknown,
 * revoked, or expired tokens; 403 when the token's scopes or project list
 * do not cover the request. `access` is the permission the route needs;
 * routes that pass none refuse tokens entirely.
 */
export async function authenticateToken(
  env: Env,
  bearer: string,
  project: string,
  access: PatAccess | undefined,
  request: Request
): Promise<TokenUser> {
  const parts = bearer.match(PAT_PATTERN);
  const row = parts
    ? await env.DB.prepare(
        "SELECT * FROM personal_access_tokens WHERE id=?"
      )
        .bind(parts[1])
        .first<TokenRow>()
    : null;
  const expected = await digest(
    env,
    row?.salt ?? "-",
    parts?.[2] ?? bearer
  );
  const encoder = new TextEncoder();
  const stored = encoder.encode(row?.token_hash ?? "0".repeat(64));
  const given = encoder.encode(expected);
  const now = Date.now();
  const valid =
    row &&
    stored.length === given.length &&
    timingSafeEqual(stored, given) &&
    row.revoked_at === null &&
    (row.expires_at === null || row.expires_at > now);
  check(valid, 401, "This access token is invalid, expired, or revoked.");
  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?")
    .bind(row.user_id)
    .first<TokenUser>();
  check(
    user && user.verified && user.id.startsWith("google:"),
    401,
    "This access token is invalid, expired, or revoked."
  );
  check(
    access,
    403,
    "Access tokens can only read and write comments."
  );
  const scopes = list(row.scopes) ?? [];
  check(
    access === "any" ||
      scopes.includes(access === "read" ? "comments:read" : "comments:write"),
    403,
    `This token needs the comments:${access === "read" ? "read" : "write"} scope.`
  );
  const projects = list(row.projects);
  check(
    !projects || projects.includes(project),
    403,
    "This token is not allowed for this project."
  );
  // Record use at most once a minute per token: last_used_at is the throttle.
  const touched = await env.DB.prepare(
    "UPDATE personal_access_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)"
  )
    .bind(now, row.id, now - USE_LOG_INTERVAL)
    .run();
  if (touched.meta.changes)
    await auditStatement(env, row.user_id, "token.use", row.id, {
      project,
      method: request.method,
      path: new URL(request.url).pathname,
    }).run();
  return user;
}
