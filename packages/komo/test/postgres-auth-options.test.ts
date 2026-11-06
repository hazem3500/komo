// Sign-in, read, guest, session and path options on Node + PostgreSQL, through
// the same handler dist/node.mjs serves. iap.test.ts covers workerd + D1.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { loadPostgres, postgresDatabase } from "../server/postgres";
import worker from "../server/index";
import { accountProjects } from "../server/tokens";

vi.mock("../server/setup-client.txt", () => ({ default: "" }));
const connection = process.env.KOMO_TEST_POSTGRES_URL;
const run = connection ? it : it.skip;
const schema = `komo_test_${crypto.randomUUID().replaceAll("-", "")}`;
const origin = "http://localhost:3000";
const audience = "/projects/123/global/backendServices/456";
const DAY = 86400000;
const DEFAULT_LIFETIME = 100 * 365 * DAY;
const PROJECTS = JSON.stringify({
  review: { repo: "team/site", origins: [origin], allowGuestSnapshots: true },
  closed: { repo: "team/site", origins: [origin], allowGuests: false },
});
const anchor = { x: 0, y: 0, width: 0.4, height: 0.2, pageX: 0, pageY: 10, viewportWidth: 1200, selector: "#hero", text: "Hero" };
let admin: Pool;
let db: ReturnType<typeof postgresDatabase>;
let key: CryptoKeyPair;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const environment = (options: Record<string, string> = {}) =>
  ({ DB: db, PROJECTS, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", ...options }) as unknown as Env;
async function call(
  env: Env,
  path: string,
  {
    method = "GET",
    data,
    token,
    jwt,
    project = "review",
    from = origin,
  }: { method?: string; data?: unknown; token?: string; jwt?: string; project?: string; from?: string | null } = {},
) {
  const url = new URL(path, "https://comments.example.com");
  if (!url.searchParams.has("project")) url.searchParams.set("project", project);
  url.searchParams.set("repo", "team/site");
  url.searchParams.set("branch", "pr-42");
  return worker.fetch(
    new Request(url, {
      method,
      headers: {
        ...(from ? { Origin: from } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(jwt ? { "x-goog-iap-jwt-assertion": jwt } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    }) as unknown as Parameters<typeof worker.fetch>[0],
    env,
    { waitUntil: () => {} } as unknown as ExecutionContext,
  );
}
async function iapJwt(claims: Record<string, unknown> = {}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: "ES256", kid: "test-kid" });
  const payload = encode({
    iss: "https://cloud.google.com/iap",
    aud: audience,
    sub: "accounts.google.com:555",
    email: "Lead@Example.com",
    iat: now,
    exp: now + 600,
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    new TextEncoder().encode(`${head}.${payload}`),
  );
  return `${head}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}
/** A stored session; `via` and `createdAt` stay NULL like rows from before migration 007. */
async function addSession(
  token: string,
  user: string,
  expiresAt: number,
  { project = "review", via = null, createdAt = null }: { project?: string; via?: string | null; createdAt?: number | null } = {},
) {
  await db.prepare("INSERT INTO users(id,name,verified) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING")
    .bind(user, user.split(":")[0], user.startsWith("guest:") ? 0 : 1)
    .run();
  await db.prepare("INSERT INTO sessions(token_hash,user_id,project,expires_at,via,created_at) VALUES(?,?,?,?,?,?)")
    .bind(sha(token), user, project, expiresAt, via, createdAt)
    .run();
}
const expiry = async (token: string) =>
  Number((await db.prepare("SELECT expires_at FROM sessions WHERE token_hash=?").bind(sha(token)).first<{ expires_at: number }>())!.expires_at);

beforeAll(async () => {
  if (!connection) return;
  admin = new Pool({ connectionString: connection });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connection);
  url.searchParams.set("options", `-c search_path=${schema}`);
  db = postgresDatabase(url.href, await loadPostgres());
  await db.migrate();
  key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", key.publicKey)), kid: "test-kid" };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "https://www.gstatic.com/iap/verify/public_key-jwk"
      ? Promise.resolve(Response.json({ keys: [jwk] }))
      : realFetch(input, init),
  );
});
afterAll(async () => {
  if (!connection) return;
  vi.unstubAllGlobals();
  await db.close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

run("all-project grants include public joins and current private grants, not stale private membership", async () => {
  const user = "google:membership";
  await db.prepare("INSERT INTO users(id,name,verified) VALUES(?,?,1)").bind(user, "Reviewer").run();
  for (const project of ["public-joined", "private-joined", "default-public"])
    await db.prepare("INSERT INTO project_members(project,user_id) VALUES(?,?)").bind(project, user).run();
  await db.prepare("INSERT INTO project_settings(project,access) VALUES('public-joined','public'),('private-joined','private'),('private-invited','private')").run();
  await db.prepare("INSERT INTO project_access(project,user_id) VALUES('private-invited',?)").bind(user).run();
  await db.prepare("INSERT INTO project_owners(project,user_id) VALUES('owned',?)").bind(user).run();
  expect(await accountProjects(environment(), user, true)).toEqual(["default-public", "owned", "private-invited", "public-joined"]);
  expect(await accountProjects(environment(), user)).toEqual(["default-public", "owned", "private-joined", "public-joined"]);
  await db.prepare("UPDATE project_settings SET access='private' WHERE project='public-joined'").run();
  await db.prepare("DELETE FROM project_access WHERE project='private-invited'").run();
  expect(await accountProjects(environment(), user, true)).toEqual(["default-public", "owned"]);
});

describe("auth options on PostgreSQL", () => {
  run("keeps anonymous reads and guests by default", async () => {
    const env = environment();
    expect((await call(env, "/threads")).status).toBe(200);
    expect(await (await call(env, "/config")).json()).toMatchObject({ guests: true, google: false, snapshots: { guests: true } });
    expect((await call(env, "/auth/guest", { method: "POST", data: { name: "Guest" } })).status).toBe(201);
  });

  run("KOMO_REQUIRE_SESSION_FOR_READS needs a session for reads but still allows guests", async () => {
    const env = environment({ KOMO_REQUIRE_SESSION_FOR_READS: "true" });
    const anonymous = await call(env, "/threads");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "Sign in to see comments." });
    expect((await call(env, "/threads?id=missing")).status).toBe(401);
    expect((await call(env, "/threads", { token: "not-a-session" })).status).toBe(401);
    const guest = (await (await call(env, "/auth/guest", { method: "POST", data: { name: "Guest" } })).json()) as { token: string };
    expect((await call(env, "/threads", { token: guest.token })).status).toBe(200);
    expect(await (await call(env, "/config")).json()).toMatchObject({ guests: true });
  });

  run("KOMO_ALLOW_GUESTS=false refuses guest sign-in, guest sessions and guest snapshots", async () => {
    const open = environment();
    const before = (await (await call(open, "/auth/guest", { method: "POST", data: { name: "Early" } })).json()) as { token: string };
    // Per-project allowGuests still applies while the global switch is on.
    expect((await call(open, "/auth/guest", { method: "POST", data: { name: "Guest" }, project: "closed" })).status).toBe(403);

    const env = environment({ KOMO_ALLOW_GUESTS: "false" });
    const refused = await call(env, "/auth/guest", { method: "POST", data: { name: "Guest" } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Guest comments are disabled." });
    expect(await (await call(env, "/config")).json()).toMatchObject({ guests: false, snapshots: { guests: false } });
    // Reads stay public; a guest session from before is refused for writes.
    expect((await call(env, "/threads")).status).toBe(200);
    const write = await call(env, "/threads", { method: "POST", token: before.token, data: { body: "Hi", page: "/", anchor } });
    expect(write.status).toBe(401);
    expect(await write.json()).toEqual({ error: "Guest comments are disabled." });
  });

  run("KOMO_SESSION_MAX_AGE_DAYS caps new sessions and rejects older ones", async () => {
    const now = Date.now();
    // From before migration 007: no created_at, dated by the default lifetime.
    await addSession("default-41d", "google:aged", now - 41 * DAY + DEFAULT_LIFETIME);
    await addSession("default-29d", "google:young", now - 29 * DAY + DEFAULT_LIFETIME);
    // A 30-day session issued 10 days ago by a server that capped sessions
    // itself: its shorter lifetime makes it look older, so a cap refuses it.
    await addSession("short-lived", "google:capped", now + 20 * DAY);

    const uncapped = environment({ KOMO_REQUIRE_SESSION_FOR_READS: "true" });
    for (const token of ["default-41d", "default-29d", "short-lived"])
      expect((await call(uncapped, "/threads", { token })).status).toBe(200);
    const fresh = (await (await call(uncapped, "/auth/guest", { method: "POST", data: { name: "Default" } })).json()) as { token: string };
    expect(await expiry(fresh.token)).toBeGreaterThan(now + 99 * 365 * DAY);
    const stored = await db.prepare("SELECT via,created_at FROM sessions WHERE token_hash=?").bind(sha(fresh.token)).first<{ via: string; created_at: number }>();
    expect(stored?.via).toBe("guest");
    expect(Number(stored?.created_at)).toBeGreaterThanOrEqual(now);

    const env = environment({ KOMO_REQUIRE_SESSION_FOR_READS: "true", KOMO_SESSION_MAX_AGE_DAYS: "30" });
    expect((await call(env, "/threads", { token: "default-41d" })).status).toBe(401);
    expect((await call(env, "/me", { token: "default-41d" })).status).toBe(401);
    expect((await call(env, "/threads", { token: "default-29d" })).status).toBe(200);
    expect((await call(env, "/threads", { token: "short-lived" })).status).toBe(401);
    const capped = (await (await call(env, "/auth/guest", { method: "POST", data: { name: "Capped" } })).json()) as { token: string };
    const expires = await expiry(capped.token);
    expect(expires).toBeGreaterThan(now + 30 * DAY - 60000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY);
    expect((await call(env, "/threads", { token: capped.token })).status).toBe(200);
  });

  run("lowering the cap from 30 to 7 days refuses every older session, whatever its expiry", async () => {
    const now = Date.now();
    const thirty = environment({ KOMO_REQUIRE_SESSION_FOR_READS: "true", KOMO_SESSION_MAX_AGE_DAYS: "30" });
    const seven = environment({ KOMO_REQUIRE_SESSION_FOR_READS: "true", KOMO_SESSION_MAX_AGE_DAYS: "7" });
    // Issued under the 30-day cap on day 0, seen on each later day.
    for (const day of [1, 6, 8, 10, 22, 23, 24, 29]) {
      const token = `cap-day-${day}`;
      await addSession(token, `google:day${day}`, now - day * DAY + 30 * DAY, { via: "google", createdAt: now - day * DAY });
      expect((await call(thirty, "/threads", { token })).status, `30 days, day ${day}`).toBe(200);
      expect((await call(seven, "/threads", { token })).status, `7 days, day ${day}`).toBe(day < 7 ? 200 : 401);
    }
    // Rows without created_at stay refused as they near expiry: dating never moves forward.
    for (const left of [20, 5, 1]) {
      const token = `legacy-${left}`;
      await addSession(token, `google:legacy${left}`, now + left * DAY);
      expect((await call(seven, "/threads", { token })).status, `${left} days left`).toBe(401);
    }
  });

  run("a proxy signs reviewers in, forces strict reads and keeps prefixed URLs", async () => {
    // The legacy names, with the forced options asked the other way.
    const env = environment({
      KOMO_IAP_AUDIENCE: audience,
      KOMO_AUTH_PREFIX: "/backoffice",
      KOMO_PUBLIC_PATH: "/komo",
      KOMO_ALLOW_GUESTS: "true",
      KOMO_REQUIRE_SESSION_FOR_READS: "false",
      KOMO_SESSION_MAX_AGE_DAYS: "30",
      GITHUB_CLIENT_ID: "github-id",
      GITHUB_CLIENT_SECRET: "github-secret",
    });
    const config = (await (await call(env, "/config")).json()) as Record<string, unknown>;
    expect(config).toMatchObject({ google: true, github: false, guests: false, tokens: false, snapshots: { guests: false } });
    expect(config.repo).toBeUndefined();
    expect((await call(env, "/threads")).status).toBe(401);
    expect((await call(env, "/auth/guest", { method: "POST", data: { name: "Guest" } })).status).toBe(403);
    expect((await call(env, "/auth/github/start", { method: "POST" })).status).toBe(503);
    expect((await call(env, "/auth/github/authorize?state=x")).status).toBe(403);
    expect((await call(env, "/auth/github/callback?state=x")).status).toBe(403);
    expect((await call(env, "/auth/google/callback?state=x")).status).toBe(404);
    expect((await call(env, "/auth/google/authorize?state=x", { jwt: await iapJwt() })).status).toBe(404);

    // An existing Google OAuth account signs in as itself. Its OAuth session,
    // and an access token it made, work without the proxy but not behind it.
    await db.prepare("INSERT INTO users(id,name,verified,avatar_url) VALUES(?,?,1,?)")
      .bind("google:555", "Lead Reviewer", "https://photos.example/lead.jpg")
      .run();
    await addSession("lead-oauth", "google:555", Date.now() + DAY, { via: "google", createdAt: Date.now() });
    const open = environment({ KOMO_PUBLIC_PATH: "/komo" });
    expect((await call(open, "/threads", { token: "lead-oauth" })).status).toBe(200);
    const pat = await call(open, "/account/tokens", {
      method: "POST",
      token: "lead-oauth",
      data: { name: "ci", scopes: ["comments:read", "comments:write"] },
    });
    expect(pat.status).toBe(201);
    const { token: accessToken } = (await pat.json()) as { token: string };
    expect((await call(open, "/threads", { token: accessToken })).status).toBe(200);
    expect((await call(env, "/threads", { token: "lead-oauth" })).status).toBe(401);
    const refusedToken = await call(env, "/threads", { token: accessToken });
    expect(refusedToken.status).toBe(403);
    expect(await refusedToken.json()).toEqual({ error: "Access tokens are off behind the sign-in proxy. Use /auth/proxy/session." });
    const start = (await (await call(env, "/auth/google/start", { method: "POST" })).json()) as { url: string };
    const authorize = new URL(start.url);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://comments.example.com/komo/backoffice/auth/google/authorize");
    const popup = await call(env, `/backoffice/auth/google/authorize${authorize.search}`, { jwt: await iapJwt() });
    expect(popup.status).toBe(200);
    expect(popup.headers.get("Cache-Control")).toBe("no-store");
    const nonce = popup.headers.get("Content-Security-Policy")!.match(/^default-src 'none'; script-src 'nonce-([0-9a-f-]{36})'; frame-ancestors 'none'$/)![1];
    const html = await popup.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    const message = JSON.parse(html.match(/postMessage\((\{.*?\}),"http:\/\/localhost:3000"\)/)![1]);
    expect(message).toMatchObject({
      type: "branch-comments:auth",
      user: { id: "google:555", name: "Lead Reviewer", verified: true, avatarUrl: "https://photos.example/lead.jpg" },
    });
    expect((await db.prepare("SELECT email FROM users WHERE id=?").bind("google:555").first<{ email: string }>())?.email).toBe("lead@example.com");
    expect(await expiry(message.token)).toBeLessThanOrEqual(Date.now() + 30 * DAY);
    expect((await call(env, "/threads", { token: message.token })).status).toBe(200);
    expect(((await (await call(env, "/config", { token: message.token })).json()) as { repo?: string }).repo).toBe("team/site");
    expect((await call(env, "/account/tokens", { token: message.token })).status).toBe(403);
    // The state is single-use.
    expect((await call(env, `/backoffice/auth/google/authorize${authorize.search}`, { jwt: await iapJwt() })).status).toBe(400);

    for (const path of ["/backoffice/auth/proxy/session", "/backoffice/auth/iap/session"]) {
      expect((await call(env, path, { method: "POST", from: null })).status).toBe(401);
      expect((await call(env, path, { method: "POST", from: null, jwt: await iapJwt({ aud: "/projects/1/global/backendServices/2" }) })).status).toBe(401);
      // A page, even on an approved site, can't exchange its visitor's sign-in.
      for (const from of [origin, "https://elsewhere.example"]) {
        const refused = await call(env, path, { method: "POST", from, jwt: await iapJwt() });
        expect(refused.status).toBe(403);
        expect(refused.headers.get("Access-Control-Allow-Origin")).toBeNull();
      }
      expect((await call(env, path, { method: "POST", from: "https://comments.example.com", jwt: await iapJwt() })).status).toBe(201);
      const exchanged = await call(env, path, { method: "POST", from: null, jwt: await iapJwt({ sub: "accounts.google.com:777", email: "Bot@Example.com" }) });
      expect(exchanged.status).toBe(201);
      const body = (await exchanged.json()) as { token: string; user: { id: string } };
      expect(body.user).toMatchObject({ id: "google:777", name: "bot", verified: true });
      expect((await call(env, "/threads", { token: body.token })).status).toBe(200);
    }
    expect((await call(env, "/auth/proxy/session", { method: "POST", from: null, jwt: await iapJwt() })).status).toBe(404);

    // Sessions from before the proxy was turned on don't read through it.
    await addSession("left-guest", "guest:left", Date.now() + DAY);
    await addSession("left-github", "github:left", Date.now() + DAY);
    for (const token of ["left-guest", "left-github"]) {
      expect((await call(env, "/threads", { token })).status).toBe(401);
      expect((await call(env, "/usage", { token })).status).toBe(401);
    }
  });

  run("generated links keep the path from PUBLIC_URL", async () => {
    const env = environment({ KOMO_PUBLIC_PATH: "/komo", GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret" });
    const start = (await (await call(env, "/auth/google/start", { method: "POST" })).json()) as { url: string };
    expect(start.url).toMatch(/^https:\/\/comments\.example\.com\/komo\/auth\/google\/authorize\?state=/);
    const redirect = await call(env, `/auth/google/authorize${new URL(start.url).search}`);
    expect(redirect.status).toBe(302);
    expect(new URL(redirect.headers.get("Location")!).searchParams.get("redirect_uri")).toBe(
      "https://comments.example.com/komo/auth/google/callback",
    );
    expect(await (await call(env, "/setup")).text()).toContain('src="/komo/setup-client.js"');
    await addSession("owner-session", "google:owner", Date.now() + DAY);
    await db.prepare("INSERT INTO project_owners(project,user_id) VALUES(?,?)").bind("review", "google:owner").run();
    const invite = await call(env, "/project/invites", { method: "POST", token: "owner-session", data: { email: "new@example.com" } });
    expect(invite.status).toBe(201);
    expect(((await invite.json()) as { url: string }).url).toMatch(/^https:\/\/comments\.example\.com\/komo\/setup\?project=review#invite=/);
  });

  run("fails every request with a named error on an invalid option", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call(environment({ KOMO_PROXY_AUTH: "other-proxy", KOMO_PROXY_AUDIENCE: "x" }), "/health");
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith("comments_request_failed", expect.objectContaining({ config: expect.stringContaining('PALETTE_PROXY_AUTH "other-proxy" is not supported') }));
    error.mockRestore();
  });
});
