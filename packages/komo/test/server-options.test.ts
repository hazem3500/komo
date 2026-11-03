// Reader, guest, session and path options without a sign-in proxy, on workerd +
// D1. postgres-auth-options.test.ts runs the same options on PostgreSQL.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startLocalApi } from "./wrangler-local";

const origin = "http://localhost:4321";
const DAY = 86400000;
const DEFAULT_LIFETIME = 100 * 365 * DAY;
let api: Awaited<ReturnType<typeof startLocalApi>>;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function request(path: string, { method = "GET", token, data }: { method?: string; token?: string; data?: unknown } = {}) {
  const url = new URL(path, `http://localhost:${api.port}`);
  url.searchParams.set("project", "test");
  url.searchParams.set("repo", "owner/site");
  url.searchParams.set("branch", "pr-1");
  return fetch(url, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

beforeAll(async () => {
  const now = Date.now();
  api = await startLocalApi({
    name: "komo-options-test",
    vars: {
      PROJECTS: JSON.stringify({
        test: { repo: "owner/site", origins: [origin], allowGuestSnapshots: true },
      }),
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      KOMO_REQUIRE_SESSION_FOR_READS: "true",
      KOMO_ALLOW_GUESTS: "false",
      KOMO_SESSION_MAX_AGE_DAYS: "30",
      KOMO_PUBLIC_PATH: "/komo",
    },
    seed: `
      INSERT INTO users(id,name,verified) VALUES('google:old','Old',1),('google:recent','Recent',1),('guest:left','Guest',0);
      INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES
        ('${sha("old-session")}','google:old','test',${now - 31 * DAY + DEFAULT_LIFETIME}),
        ('${sha("recent-session")}','google:recent','test',${now - 1 * DAY + DEFAULT_LIFETIME}),
        ('${sha("guest-session")}','guest:left','test',${now + DAY});
    `,
  });
}, 240000);
afterAll(async () => {
  await api?.stop();
});

it("needs a session to read and refuses guests on D1", async () => {
  expect(await (await request("config")).json()).toMatchObject({
    google: true,
    guests: false,
    snapshots: { guests: false },
  });
  const anonymous = await request("threads");
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "Sign in to see comments." });
  const guest = await request("auth/guest", { method: "POST", data: { name: "Guest" } });
  expect(guest.status).toBe(403);
  expect(await guest.json()).toEqual({ error: "Guest comments are disabled." });
  expect((await request("threads", { token: "guest-session" })).status).toBe(401);
  expect((await request("threads", { token: "recent-session" })).status).toBe(200);
});

it("rejects sessions older than KOMO_SESSION_MAX_AGE_DAYS on D1", async () => {
  expect((await request("threads", { token: "old-session" })).status).toBe(401);
  expect((await request("me", { token: "old-session" })).status).toBe(401);
});

it("keeps the public path in sign-in and setup URLs on D1", async () => {
  const start = (await (await request("auth/google/start", { method: "POST", data: {} })).json()) as { url: string };
  expect(new URL(start.url).pathname).toBe("/komo/auth/google/authorize");
  expect(await (await fetch(`http://localhost:${api.port}/setup`)).text()).toContain('src="/komo/setup-client.js"');
});
