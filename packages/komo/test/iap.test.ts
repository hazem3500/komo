// Proxy sign-in (KOMO_PROXY_AUTH=gcp-iap) on workerd + D1. The same options run
// on Node + PostgreSQL in postgres-auth-options.test.ts.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalApi } from "./wrangler-local";

const origin = "http://localhost:4321";
const audience = "/projects/123/global/backendServices/456";
// komo served at /komo behind a proxy that strips it, with sign-in under the
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
async function popupSignIn(jwt: string) {
  const start = await (
    await request("auth/google/start", "POST", { data: {} })
  ).json();
  const authorize = new URL(start.url);
  expect(authorize.pathname).toBe(`${publicPath}${prefix}/auth/google/authorize`);
  // The proxy strips the public path before forwarding.
  return fetch(
    new URL(authorize.pathname.slice(publicPath.length) + authorize.search, `http://localhost:${port}`),
    {
      headers: { "x-goog-iap-jwt-assertion": jwt },
      redirect: "manual",
    },
  );
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

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
  api = await startLocalApi({
    name: "komo-iap-test",
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
        test: { repo: "owner/site", origins: [origin], allowGuestSnapshots: true },
      }),
      KOMO_PROXY_AUTH: "gcp-iap",
      KOMO_PROXY_AUDIENCE: audience,
      KOMO_AUTH_PATH_PREFIX: prefix,
      KOMO_PUBLIC_PATH: publicPath,
      KOMO_SESSION_MAX_AGE_DAYS: "30",
      // Forced the other way while a proxy signs reviewers in.
      KOMO_ALLOW_GUESTS: "true",
      KOMO_REQUIRE_SESSION_FOR_READS: "false",
    },
    // Sessions from before the cap carry the default century-long expiry.
    seed: `
      INSERT INTO users(id,name,verified) VALUES('google:old','Old',1),('google:recent','Recent',1),('guest:left','Guest',0),('github:left','Coder',1);
      INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES
        ('${sha("old-session")}','google:old','test',${now - 40 * DAY + DEFAULT_LIFETIME}),
        ('${sha("recent-session")}','google:recent','test',${now - 10 * DAY + DEFAULT_LIFETIME}),
        ('${sha("guest-session")}','guest:left','test',${now + DEFAULT_LIFETIME}),
        ('${sha("github-session")}','github:left','test',${now + DEFAULT_LIFETIME});
    `,
  });
  port = api.port;
}, 240000);
afterAll(async () => {
  await api?.stop();
});

describe("proxy sign-in on D1", () => {
  it("offers only Google sign-in and refuses anonymous reads and guests", async () => {
    expect(await (await request("config")).json()).toMatchObject({
      google: true,
      github: false,
      guests: false,
      snapshots: { guests: false },
    });
    const anonymous = await request("threads");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "Sign in to see comments." });
    const guest = await request("auth/guest", "POST", { data: { name: "Guest" } });
    expect(guest.status).toBe(403);
    expect(await guest.json()).toEqual({ error: "Guest comments are disabled." });
    expect(
      (await request("auth/github/start", "POST", { data: {} })).status,
    ).toBe(503);
    expect(
      (await fetch(`http://localhost:${port}/auth/github/authorize?state=x`))
        .status,
    ).toBe(403);
    expect(
      (await fetch(`http://localhost:${port}/auth/google/callback?state=x`))
        .status,
    ).toBe(404);
    // Sign-in handlers exist only under the proxy-protected prefix.
    expect(
      (await fetch(`http://localhost:${port}/auth/google/authorize?state=x`, {
        headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
      })).status,
    ).toBe(404);
    for (const path of ["/auth/proxy/session", "/auth/iap/session"])
      expect(
        (await fetch(`http://localhost:${port}${path}?project=test`, {
          method: "POST",
          headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
        })).status,
      ).toBe(404);
    expect((await fetch(`http://localhost:${port}${prefix}/anything`)).status).toBe(404);
  });

  it("issues a session from the popup only with a valid IAP assertion", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await popupSignIn("")).status).toBe(401);
    for (const jwt of [
      await iapJwt({}, otherKey.privateKey),
      await iapJwt({ aud: "/projects/1/global/backendServices/2" }),
      await iapJwt({ iss: "https://accounts.google.com" }),
      await iapJwt({ exp: now - 120 }),
      await iapJwt({ iat: now + 120 }),
      await iapJwt({ sub: "1234567890" }),
    ])
      expect((await popupSignIn(jwt)).status).toBe(401);

    const page = await popupSignIn(await iapJwt());
    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    const csp = page.headers.get("Content-Security-Policy")!;
    expect(csp).toMatch(/^default-src 'none'; script-src 'nonce-[0-9a-f-]{36}'; frame-ancestors 'none'$/);
    const html = await page.text();
    expect(html).toContain(`<script nonce="${csp.match(/nonce-([0-9a-f-]+)/)![1]}">`);
    const message = JSON.parse(
      html.match(/postMessage\((\{.*?\}),"http:\/\/localhost:4321"\)/)![1],
    );
    expect(message).toMatchObject({
      type: "branch-comments:auth",
      user: { id: "google:1234567890", name: "reviewer", verified: true },
    });
    // IAP carries no picture; hosts supply one with the client `avatar` option.
    expect(message.user.avatarUrl).toBeUndefined();

    const created = await request("threads", "POST", {
      token: message.token,
      data: { body: "Looks off", page: "/", anchor },
    });
    expect(created.status).toBe(201);
    const listed = await (
      await request("threads", "GET", { token: message.token })
    ).json();
    expect(listed.threads.map((t: { id: string }) => t.id)).toContain(
      (await created.json()).id,
    );
  });

  it("does not reuse a popup state", async () => {
    const start = await (
      await request("auth/google/start", "POST", { data: {} })
    ).json();
    const authorize = new URL(start.url);
    const url = new URL(
      authorize.pathname.slice(publicPath.length) + authorize.search,
      `http://localhost:${port}`,
    );
    const jwt = await iapJwt();
    const headers = { "x-goog-iap-jwt-assertion": jwt };
    expect((await fetch(url, { headers })).status).toBe(200);
    expect((await fetch(url, { headers })).status).toBe(400);
  });

  it("gives agents a project session from their proxy identity on both routes", async () => {
    for (const path of ["/auth/proxy/session", "/auth/iap/session"]) {
      const url = `http://localhost:${port}${prefix}${path}?project=test`;
      expect((await fetch(url, { method: "POST" })).status).toBe(401);
      expect(
        (await fetch(`http://localhost:${port}${prefix}${path}?project=missing`, {
          method: "POST",
          headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
        })).status,
      ).toBe(404);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-iap-jwt-assertion": await iapJwt({
            sub: "accounts.google.com:999",
            email: "Agent@Example-Project.iam.gserviceaccount.com",
          }),
        },
      });
      expect(response.status).toBe(201);
      const { token, user } = await response.json();
      expect(user).toMatchObject({ id: "google:999", name: "agent", verified: true });
      expect((await request("threads", "GET", { token })).status).toBe(200);
    }
  });

  it("caps session age and refuses sessions the proxy did not sign in", async () => {
    expect((await request("threads", "GET", { token: "old-session" })).status).toBe(401);
    expect((await request("threads", "GET", { token: "recent-session" })).status).toBe(200);
    const guest = await request("threads", "GET", { token: "guest-session" });
    expect(guest.status).toBe(401);
    expect(await guest.json()).toEqual({ error: "Guest comments are disabled." });
    expect((await request("threads", "GET", { token: "github-session" })).status).toBe(403);
  });
});
