// Proxy sign-in (KOMO_PROXY_AUTH=gcp-iap) on workerd + D1. The same options run
// on Node + PostgreSQL in postgres-auth-options.test.ts.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalApi } from "./wrangler-local";

const origin = "http://localhost:4321";
const audience = "/projects/123/global/backendServices/456";
// Palette served at /komo behind a proxy that strips it, with sign-in under the
// proxy-protected /backoffice prefix.
const publicPath = "/komo";
const prefix = "/backoffice";
const DAY = 86400000;
const DEFAULT_LIFETIME = 100 * 365 * DAY;
const anchor = {
  selector: "#hero",
  text: "Workers",
  x: 0.2,
  y: 0.3,
  width: 0.1,
  height: 0.1,
  pageX: 200,
  pageY: 300,
  viewportWidth: 1200,
};
let api: Awaited<ReturnType<typeof startLocalApi>>,
  port = 0,
  iapKey: CryptoKeyPair,
  otherKey: CryptoKeyPair;

const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");
async function iapJwt(
  claims: Record<string, unknown> = {},
  key: CryptoKey = iapKey.privateKey,
) {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: "test-kid" })),
  );
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: "https://cloud.google.com/iap",
        aud: audience,
        sub: "accounts.google.com:1234567890",
        email: "Reviewer@example.com",
        iat: now,
        exp: now + 600,
        ...claims,
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(`${head}.${payload}`),
    ),
  );
  return `${head}.${payload}.${base64url(signature)}`;
}
function request(
  path: string,
  method = "GET",
  { data, token, jwt }: { data?: unknown; token?: string; jwt?: string } = {},
) {
  const url = new URL(path, `http://localhost:${port}`);
  url.searchParams.set("project", "test");
  url.searchParams.set("repo", "owner/site");
  url.searchParams.set("branch", "pr-1");
  const headers: Record<string, string> = { Origin: origin };
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (jwt) headers["x-goog-iap-jwt-assertion"] = jwt;
  return fetch(url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe.each([false, true])("all-project allowance %s", (allProjects) => {
describe.each([false, true])("no-expiry allowance %s", (noExpiry) => {
beforeAll(async () => {
  iapKey = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  otherKey = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", iapKey.publicKey)),
    kid: "test-kid",
  };
  const now = Date.now();
  const oldTokens = [
    ["expiredtoken", now - DAY, now - 2 * DAY, '["test"]'],
    ["perpetualtok", null, now, '["test"]'],
    ["unscopedtokn", now + DAY, now, null],
    ["overlongtokn", now + 366 * DAY, now, '["test"]'],
  ].map(([id, expires, created, projects]) =>
    `INSERT INTO personal_access_tokens(id,user_id,name,last4,salt,token_hash,scopes,projects,created_at,expires_at) VALUES('${id}','google:1234567890','Legacy','aaaa','salt','${sha("\0salt\0" + "a".repeat(43))}','["comments:read"]',${projects === null ? "NULL" : "'" + projects + "'"},${created},${expires ?? "NULL"});`
  ).join("\n");
  api = await startLocalApi({
    name: "palette-iap-pat-test",
    // Serve the test key as IAP's published JWK set; everything else is real.
    prelude: `
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) =>
        String(input) === "https://www.gstatic.com/iap/verify/public_key-jwk"
          ? Response.json({ keys: [${JSON.stringify(jwk)}] })
          : originalFetch(input, init);
    `,
    vars: {
      PROJECTS: JSON.stringify({
        outsider: { repo: "owner/site", origins: [origin] },
        other: { repo: "owner/site", origins: [origin] },
        test: { repo: "owner/site", origins: [origin], allowGuestSnapshots: true },
      }),
      KOMO_PROXY_AUTH: "gcp-iap",
      PALETTE_PROXY_ACCESS_TOKENS: "true",
      KOMO_PROXY_TOKEN_ALL_PROJECTS: String(allProjects),
      PALETTE_PROXY_TOKEN_NO_EXPIRY: String(noExpiry),
      KOMO_PROXY_AUDIENCE: audience,
      KOMO_AUTH_PATH_PREFIX: prefix,
      KOMO_PUBLIC_PATH: publicPath,
      KOMO_SESSION_MAX_AGE_DAYS: "30",
      // Forced the other way while a proxy signs reviewers in.
      KOMO_ALLOW_GUESTS: "true",
      KOMO_REQUIRE_SESSION_FOR_READS: "false",
    },
    // Sessions from before the proxy: a Google OAuth one from yesterday with
    // the default century-long expiry, a guest and a GitHub one. Then proxy
    // sessions 10 and 40 days old.
    seed: `
      INSERT INTO users(id,name,verified) VALUES('google:oauth','OAuth',1),('google:recent','Recent',1),('google:old','Old',1),('guest:left','Guest',0),('github:left','Coder',1);
      INSERT INTO users(id,name,verified) VALUES('google:1234567890','Reviewer',1);
      ${oldTokens}
      INSERT INTO project_owners(project,user_id) VALUES('test','google:1234567890'),('other','google:1234567890');
      INSERT INTO threads(id,project,repo,branch,page,anchor,created_at,updated_at) VALUES('pat-snapshot','test','owner/site','pr-1','/','{}',${now},${now});
      INSERT INTO snapshots(thread_id,kind,mime,bytes,size,created_at) VALUES('pat-snapshot','html','text/html',X'3c703e666978747572653c2f703e',14,${now});
      INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES
        ('${sha("oauth-session")}','google:oauth','test',${now - DAY + DEFAULT_LIFETIME}),
        ('${sha("guest-session")}','guest:left','test',${now + DEFAULT_LIFETIME}),
        ('${sha("github-session")}','github:left','test',${now + DEFAULT_LIFETIME});
      INSERT INTO sessions(token_hash,user_id,project,expires_at,via,created_at) VALUES
        ('${sha("recent-session")}','google:recent','test',${now + 20 * DAY},'proxy',${now - 10 * DAY}),
        ('${sha("old-session")}','google:old','test',${now + 20 * DAY},'proxy',${now - 40 * DAY});
    `,
  });
  port = api.port;
}, 240000);
afterAll(async () => {
  await api?.stop();
});


describe("opted-in proxy access tokens on D1", () => {
  it("requires a proxy session and explicit bounded grants; reads snapshots and revokes", async () => {
    expect((await (await request("config")).json()).tokens).toBe(true);
    for (const token of [undefined, "oauth-session", "guest-session", "github-session", "old-session"])
      expect((await request("account/tokens", "GET", { token })).status).toBe(401);
    const exchanged = await fetch(`http://localhost:${port}${prefix}/auth/proxy/session?project=test`, {
      method: "POST", headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
    });
    expect(exchanged.status).toBe(201);
    let { token: session } = await exchanged.json();
    const grant = { name: "Snapshot reader", scopes: ["comments:read"], projects: ["test"], expiresInDays: 7 };
    for (const data of [...(allProjects ? [] : [{ ...grant, projects: null }, { ...grant, projects: [] }]), ...(noExpiry ? [] : [{ ...grant, expiresInDays: null }]), { ...grant, expiresInDays: 366 }])
      expect((await request("account/tokens", "POST", { token: session, data })).status).toBe(400);
    const mint = async (data: unknown) => {
      const response = await request("account/tokens", "POST", { token: session, data });
      expect(response.status).toBe(201);
      return response.json();
    };
    const reader = await mint(grant);
    const listed = await (await request("account/tokens", "GET", { token: session })).json();
    expect(listed.policy).toEqual({ explicitProjects: !allProjects, maxLifetimeDays: 365, noExpiry: noExpiry });
    expect(listed.tokens.map((t: { id: string }) => t.id)).toContain(reader.item.id);
    for (const method of ["GET", "POST", "DELETE"])
      expect((await request(method === "DELETE" ? `account/tokens/${reader.item.id}` : "account/tokens", method, { token: reader.token, ...(method === "POST" ? { data: grant } : {}) })).status).toBe(403);
    const path = "threads/pat-snapshot/snapshot/html";
    const snapshot = await request(path, "GET", { token: reader.token });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.text()).toBe("<p>fixture</p>");
    for (const [id, status] of [["expiredtoken", 401], ["perpetualtok", noExpiry ? 200 : 403], ["unscopedtokn", allProjects ? 200 : 403], ["overlongtokn", 403]] as const)
      expect((await request(path, "GET", { token: `palette_pat_${id}_${"a".repeat(43)}` })).status, id).toBe(status);
    if (allProjects && noExpiry) {
      const unlimited = await mint({ ...grant, projects: null, expiresInDays: null, scopes: ["comments:read", "comments:write"] });
      expect((await request("threads", "POST", { token: unlimited.token, data: { page: "/", anchor, body: "Automation feedback" } })).status).toBe(201);
      expect(unlimited.item.projects).toBeNull();
      expect(unlimited.item.expiresAt).toBeNull();
      expect((await request(path, "GET", { token: unlimited.token })).status).toBe(200);
      const outsider = new URL(path, `http://localhost:${port}`);
      outsider.searchParams.set("project", "outsider");
      outsider.searchParams.set("repo", "owner/site");
      outsider.searchParams.set("branch", "pr-1");
      expect((await fetch(outsider, { headers: { Origin: origin, Authorization: `Bearer ${unlimited.token}` } })).status).toBe(403);
      await api.sql("INSERT INTO users(id,name,verified) VALUES('google:9876543210','Manager',1); UPDATE project_owners SET user_id='google:9876543210' WHERE project='test';");
      const managerExchange = await fetch(`http://localhost:${port}${prefix}/auth/proxy/session?project=test`, {
        method: "POST", headers: { "x-goog-iap-jwt-assertion": await iapJwt({sub: "accounts.google.com:9876543210", email: "manager@example.com"}) },
      });
      expect(managerExchange.status).toBe(201);
      const {token: manager} = await managerExchange.json();
      const publicSession = await fetch(`http://localhost:${port}${prefix}/auth/proxy/session?project=test`, {
        method: "POST", headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
      });
      expect(publicSession.status).toBe(201);
      session = (await publicSession.json()).token;
      const joined = await (await request("account/tokens", "GET", {token: session})).json();
      expect(joined.projects).toContain("test");
      expect((await request(path, "GET", {token: reader.token})).status).toBe(200);
      expect((await request(path, "GET", {token: unlimited.token})).status).toBe(200);
      expect((await request("threads", "POST", { token: unlimited.token, data: { page: "/", anchor, body: "Public joined project" } })).status).toBe(201);
      const deniedOrigin = new URL("threads", `http://localhost:${port}`);
      deniedOrigin.searchParams.set("project", "test");
      deniedOrigin.searchParams.set("repo", "owner/site");
      deniedOrigin.searchParams.set("branch", "pr-1");
      expect((await fetch(deniedOrigin, {headers: {Origin: "https://outside.example", Authorization: `Bearer ${unlimited.token}`}})).status).toBe(403);
      expect((await request("project", "PATCH", {token: manager, data: {access: "private"}})).status).toBe(200);
      expect((await request(path, "GET", {token: unlimited.token})).status).toBe(403);
      expect((await request("threads", "POST", { token: unlimited.token, data: { page: "/", anchor, body: "No private grant" } })).status).toBe(403);
      const firstInvitation = await request("project/invites", "POST", {token: manager, data: {email: "reviewer@example.com"}});
      expect(firstInvitation.status).toBe(201);
      const firstInvite = (await firstInvitation.json()).invite;
      expect((await request("project/join", "POST", {token: session, data: {invite: firstInvite}})).status).toBe(200);
      expect((await request(path, "GET", {token: unlimited.token})).status).toBe(200);
      expect((await request("threads", "POST", { token: unlimited.token, data: { page: "/", anchor, body: "Private invited project" } })).status).toBe(201);
      expect((await request("project/members", "DELETE", {token: manager, data: {user: "google:1234567890"}})).status).toBe(200);
      expect((await request(path, "GET", {token: unlimited.token})).status).toBe(403);
      const renewed = await fetch(`http://localhost:${port}${prefix}/auth/proxy/session?project=test`, {
        method: "POST", headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
      });
      expect(renewed.status).toBe(201);
      session = (await renewed.json()).token;
      expect((await request(path, "GET", {token: unlimited.token})).status).toBe(403);
      expect((await request("threads", "POST", { token: unlimited.token, data: { page: "/", anchor, body: "Removed private member" } })).status).toBe(403);
      const invitation = await request("project/invites", "POST", {token: manager, data: {email: "reviewer@example.com"}});
      expect(invitation.status).toBe(201);
      const {invite} = await invitation.json();
      expect((await request("project/join", "POST", {token: session, data: {invite}})).status).toBe(200);
      expect((await request(path, "GET", {token: unlimited.token})).status).toBe(200);
      expect((await request("threads", "POST", { token: unlimited.token, data: { page: "/", anchor, body: "Rejoined private project" } })).status).toBe(201);
      await api.sql("UPDATE project_owners SET user_id='google:1234567890' WHERE project='test';");
      expect((await request(`account/tokens/${unlimited.item.id}`, "DELETE", { token: session })).status).toBe(200);
      expect((await request(path, "GET", { token: unlimited.token })).status).toBe(401);
    }
    const writer = await mint({ ...grant, scopes: ["comments:write"] });
    expect((await request(path, "GET", { token: writer.token })).status).toBe(403);
    const other = await mint({ ...grant, projects: ["other"] });
    expect((await request(path, "GET", { token: other.token })).status).toBe(403);
    expect((await request(`account/tokens/${reader.item.id}`, "DELETE", { token: session })).status).toBe(200);
    expect((await request(path, "GET", { token: reader.token })).status).toBe(401);
  });
});

});
});
