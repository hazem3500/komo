import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  drainWebhooks,
  enqueueWebhook,
  encryptWebhookSecret,
  signWebhook,
  type WebhookEvent,
} from "../server/webhooks";
const ring = JSON.stringify({
  current: "fixture",
  keys: { fixture: Buffer.alloc(32, 7).toString("base64") },
});
const event: WebhookEvent = {
  id: "event-1",
  event: "comment.created",
  occurredAt: "2026-01-01T00:00:00Z",
  projectKey: "p",
  repo: "r",
  branch: "b",
  threadId: "t",
  pageUrl: "https://example.com",
  selector: "h1",
  author: "A",
  body: "hello",
};
afterEach(() => vi.useRealTimers());
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "palette-outbox-"));
  const path = join(directory, "state.sqlite");
  let sqlite = new DatabaseSync(path);
  sqlite.exec(
    `CREATE TABLE threads(id TEXT); CREATE TABLE comments(id TEXT); INSERT INTO comments VALUES('c'); CREATE TABLE project_settings(project TEXT,webhook_url TEXT,webhook_secret TEXT,webhook_enabled INTEGER,webhook_events TEXT);`,
  );
  sqlite.exec(
    readFileSync(
      new URL("../server/migrations/0022_webhook_outbox.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite
    .prepare("INSERT INTO project_settings VALUES(?,?,?,?,?)")
    .run(
      "p",
      "https://hooks.example.com",
      await encryptWebhookSecret(ring, "p", "s".repeat(40)),
      1,
      '["comment.created"]',
    );
  const prepare = (sql: string, values: unknown[] = []): unknown => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...(values as never[])) ?? null,
    run: async () => sqlite.prepare(sql).run(...(values as never[])),
  });
  const DB = { prepare } as unknown as D1Database;
  await enqueueWebhook(DB, "p", event, "c").run();
  return {
    get sqlite() {
      return sqlite;
    },
    restart() {
      sqlite.close();
      sqlite = new DatabaseSync(path);
    },
    close() {
      sqlite.close();
      rmSync(directory, { recursive: true });
    },
    DB,
    PALETTE_WEBHOOK_KEYS: ring,
  };
}
it("persists failed attempts, retries with identical body/id and a fresh valid signature after restart", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1800000000000);
  const f = await fixture();
  const sent: { body: string; headers: Record<string, string> }[] = [];
  const send = async (
    _: string,
    body: string,
    headers: Record<string, string>,
  ) => {
    sent.push({ body, headers });
    if (sent.length === 1) throw Error("offline");
  };
  await drainWebhooks({ ...f, PALETTE_WEBHOOK_SEND: send });
  expect(
    f.sqlite.prepare("SELECT state,attempts FROM webhook_outbox").get(),
  ).toEqual({ state: "pending", attempts: 1 });
  f.restart();
  vi.setSystemTime(Date.now() + 10000);
  await drainWebhooks({
    DB: f.DB,
    PALETTE_WEBHOOK_KEYS: ring,
    PALETTE_WEBHOOK_SEND: send,
  });
  expect(sent).toHaveLength(2);
  expect(sent[0].body).toBe(sent[1].body);
  expect(sent[1].headers["X-Palette-Delivery"]).toBe(event.id);
  expect(sent[0].headers["X-Palette-Signature"]).not.toBe(
    sent[1].headers["X-Palette-Signature"],
  );
  expect(sent[1].headers["X-Palette-Signature"]).toBe(
    await signWebhook(
      "s".repeat(40),
      Math.floor(Date.now() / 1000),
      sent[1].body,
    ),
  );
  expect(f.sqlite.prepare("SELECT state FROM webhook_outbox").get()).toEqual({
    state: "delivered",
  });
  f.close();
});
it("claims once across concurrent drains and recovers an expired lease", async () => {
  const f = await fixture();
  f.sqlite
    .prepare(
      "UPDATE webhook_outbox SET claim_until=?,claim_token='dead',attempts=1",
    )
    .run(Date.now() + 30000);
  let calls = 0;
  const env = {
    ...f,
    PALETTE_WEBHOOK_SEND: async () => {
      calls++;
    },
  };
  await drainWebhooks(env);
  expect(calls).toBe(0);
  f.sqlite.prepare("UPDATE webhook_outbox SET claim_until=0").run();
  await Promise.all([drainWebhooks(env), drainWebhooks(env)]);
  expect(calls).toBe(1);
  f.close();
});
it("exhausts six failures, including a final interrupted attempt, and never sends without a destination", async () => {
  const f = await fixture();
  let calls = 0;
  for (let i = 0; i < 6; i++) {
    f.sqlite.prepare("UPDATE webhook_outbox SET next_attempt=0").run();
    await drainWebhooks({
      ...f,
      PALETTE_WEBHOOK_SEND: async () => {
        calls++;
        throw Error("offline");
      },
    });
  }
  expect(calls).toBe(6);
  expect(f.sqlite.prepare("SELECT state FROM webhook_outbox").get()).toEqual({
    state: "exhausted",
  });
  f.sqlite.exec("UPDATE webhook_outbox SET state='pending',claim_until=0");
  await drainWebhooks({
    ...f,
    PALETTE_WEBHOOK_SEND: async () => {
      calls++;
    },
  });
  expect(calls).toBe(6);
  f.sqlite.exec("DELETE FROM webhook_outbox; DELETE FROM project_settings");
  await enqueueWebhook(f.DB, "p", event, "c").run();
  expect(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM webhook_outbox").get(),
  ).toEqual({ n: 0 });
  f.close();
});

it("bounds a hung send and leaves a retryable record", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const drain = drainWebhooks({
    ...f,
    PALETTE_WEBHOOK_SEND: async () => new Promise<void>(() => {}),
  });
  await vi.advanceTimersByTimeAsync(5001);
  await drain;
  expect(
    f.sqlite.prepare("SELECT state,attempts FROM webhook_outbox").get(),
  ).toEqual({ state: "pending", attempts: 1 });
  f.close();
});

it("does not let a stale drainer acknowledge a replacement claim", async () => {
  const f = await fixture();
  let release!: () => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const old = drainWebhooks({
    ...f,
    PALETTE_WEBHOOK_SEND: async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  await sending;
  f.sqlite.prepare("UPDATE webhook_outbox SET claim_until=0").run();
  await drainWebhooks({
    ...f,
    PALETTE_WEBHOOK_SEND: async () => {
      throw Error("offline");
    },
  });
  release();
  await old;
  expect(
    f.sqlite.prepare("SELECT state,attempts FROM webhook_outbox").get(),
  ).toEqual({ state: "pending", attempts: 2 });
  f.close();
});
