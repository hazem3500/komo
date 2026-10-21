import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { loadPostgres, postgresDatabase } from "../server/postgres";
import worker from "../server/index";

vi.mock("../server/setup-client.txt", () => ({ default: "" }));
const connection = process.env.KOMO_TEST_POSTGRES_URL;
const run = connection ? it : it.skip;
const schema = `komo_test_${crypto.randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: ReturnType<typeof postgresDatabase>;
let env: Env;

beforeAll(async () => {
  if (!connection) return;
  admin = new Pool({ connectionString: connection });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connection);
  url.searchParams.set("options", `-c search_path=${schema}`);
  db = postgresDatabase(url.href, await loadPostgres());
  await db.migrate();
  env = {
    DB: db,
    PROJECTS: JSON.stringify({
      review: { repo: "team/site", origins: ["http://localhost:3000"] },
    }),
  } as unknown as Env;
});
afterAll(async () => {
  if (!connection) return;
  await db.close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

run(
  "Node PostgreSQL preserves quota rollback, API protocol, and deletion accounting",
  async () => {
    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      token?: string,
    ) => {
      const response = await worker.fetch(
        new Request(
          `http://localhost:8080${path}?project=review&repo=team%2Fsite&branch=pr-42`,
          {
            method,
            headers: {
              Origin: "http://localhost:3000",
              ...(body ? { "Content-Type": "application/json" } : {}),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          },
        ) as unknown as Parameters<typeof worker.fetch>[0],
        env,
        { waitUntil: () => {} } as unknown as ExecutionContext,
      );
      return {
        status: response.status,
        data: (await response.json()) as Record<string, any>,
      };
    };
    const reviewer = await request("/auth/guest", "POST", { name: "Reviewer" });
    const bot = await request("/auth/guest", "POST", { name: "Bot" });
    expect(reviewer.status).toBe(201);
    expect(bot.status).toBe(201);
    await db
      .prepare(
        "INSERT INTO project_quotas(project,max_comments,max_bytes) VALUES(?,?,?)",
      )
      .bind("review", 1, 100000)
      .run();
    const anchor = {
      x: 0,
      y: 0,
      width: 0.4,
      height: 0.2,
      pageX: 0,
      pageY: 10,
      viewportWidth: 1200,
      selector: "#hero",
      text: "Hero",
    };
    const first = await request(
      "/threads",
      "POST",
      { body: "Fix this", page: "/preview", anchor },
      reviewer.data.token,
    );
    expect(first.status).toBe(201);
    const blocked = await request(
      "/threads",
      "POST",
      { body: "Blocked", page: "/preview", anchor },
      reviewer.data.token,
    );
    expect(blocked.status).toBe(409);
    const reply = await request(
      `/threads/${first.data.id}/comments`,
      "POST",
      { body: "Fixed" },
      bot.data.token,
    );
    // The one-comment quota also applies to replies.
    expect(reply.status).toBe(409);
    await db
      .prepare("UPDATE project_quotas SET max_comments=? WHERE project=?")
      .bind(2, "review")
      .run();
    expect(
      (
        await request(
          `/threads/${first.data.id}/comments`,
          "POST",
          { body: "Fixed" },
          bot.data.token,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(
          `/threads/${first.data.id}/comments/${first.data.commentId}/reactions`,
          "POST",
          { emoji: "👍", active: true },
          bot.data.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/threads/${first.data.id}`,
          "PATCH",
          { resolved: true },
          bot.data.token,
        )
      ).status,
    ).toBe(200);
    const listed = await request("/threads");
    expect(listed.data.threads[0].resolved).toBe(true);
    expect(listed.data.threads[0].comments).toHaveLength(2);
    expect(typeof listed.data.threads[0].createdAt).toBe("number");
    expect(typeof listed.data.revision).toBe("number");
    const deleted = await db
      .prepare(
        "DELETE FROM threads WHERE project=? AND resolved=1 AND id IN (SELECT value FROM json_each(?)) RETURNING id",
      )
      .bind("review", JSON.stringify([first.data.id]))
      .all<{ id: string }>();
    expect(deleted.results).toEqual([{ id: first.data.id }]);
    expect(
      await db
        .prepare("SELECT comments,bytes FROM project_quotas WHERE project=?")
        .bind("review")
        .first<{ comments: number; bytes: number }>(),
    ).toEqual({ comments: 0, bytes: 0 });
  },
);

run(
  "Node PostgreSQL stores only a hash of personal access tokens and enforces them",
  async () => {
    const hash = async (value: string) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    await db
      .prepare("INSERT INTO users(id,name,verified) VALUES(?,?,1),(?,?,0)")
      .bind("google:pat-owner", "Owner", "guest:pat", "Guest")
      .run();
    for (const [session, user] of [
      ["pat-owner-session", "google:pat-owner"],
      ["pat-guest-session", "guest:pat"],
    ])
      await db
        .prepare(
          "INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES(?,?,?,?)",
        )
        .bind(await hash(session), user, "review", 9999999999999)
        .run();
    const call = async (
      path: string,
      method: string,
      token?: string,
      body?: unknown,
    ) => {
      const response = await worker.fetch(
        new Request(
          `http://localhost:8080${path}${path.includes("?") ? "&" : "?"}project=review&repo=team%2Fsite&branch=pr-pat`,
          {
            method,
            headers: {
              Origin:
                path.startsWith("/account") ? "http://localhost:8080" : "http://localhost:3000",
              ...(body ? { "Content-Type": "application/json" } : {}),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          },
        ) as unknown as Parameters<typeof worker.fetch>[0],
        env,
        { waitUntil: () => {} } as unknown as ExecutionContext,
      );
      return {
        status: response.status,
        data: (await response.json()) as Record<string, any>,
      };
    };
    expect(
      (await call("/account/tokens", "GET", "pat-guest-session")).status,
    ).toBe(403);
    const made = await call("/account/tokens", "POST", "pat-owner-session", {
      name: "Pg bot",
      scopes: ["comments:read"],
      expiresInDays: 7,
      projects: [],
    });
    expect(made.status).toBe(201);
    const token = made.data.token as string;
    expect(token).toMatch(/^komo_pat_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    const rows = await db
      .prepare("SELECT * FROM personal_access_tokens")
      .all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain(token.slice(-43));
    expect(rows.results[0].token_hash).toMatch(/^[0-9a-f]{64}$/);

    expect((await call("/me", "GET", token)).data.user.id).toBe(
      "google:pat-owner",
    );
    expect((await call("/threads", "GET", token)).status).toBe(200);
    // Read-only: writes are refused.
    expect(
      (
        await call("/threads", "POST", token, {
          body: "x",
          page: "/p",
          anchor: { x: 0, y: 0, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1 },
        })
      ).status,
    ).toBe(403);
    const audit = await db
      .prepare("SELECT action FROM audit_log WHERE target=? ORDER BY at")
      .bind(made.data.item.id)
      .all<{ action: string }>();
    expect(audit.results.map((row) => row.action)).toEqual([
      "token.create",
      "token.use",
    ]);
    expect(
      (await call(`/account/tokens/${made.data.item.id}`, "DELETE", "pat-owner-session")).status,
    ).toBe(200);
    expect((await call("/me", "GET", token)).status).toBe(401);
    await db
      .prepare("UPDATE personal_access_tokens SET revoked_at=NULL,expires_at=1")
      .run();
    expect((await call("/me", "GET", token)).status).toBe(401);
  },
);

run(
  "Node PostgreSQL stores, replaces, serves, and deletes element snapshots with quota accounting",
  async () => {
    const hash = async (value: string) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    await db
      .prepare("INSERT INTO users(id,name,verified) VALUES(?,?,1)")
      .bind("google:snap-pg", "Snapper")
      .run();
    await db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES(?,?,?,?)",
      )
      .bind(await hash("snap-pg-session"), "google:snap-pg", "review", 9999999999999)
      .run();
    const send = async (
      path: string,
      method = "GET",
      init: { body?: BodyInit; type?: string; token?: string } = {},
    ) =>
      worker.fetch(
        new Request(
          `http://localhost:8080${path}${path.includes("?") ? "&" : "?"}project=review&repo=team%2Fsite&branch=pr-snap`,
          {
            method,
            headers: {
              Origin: "http://localhost:3000",
              ...(init.type ? { "Content-Type": init.type } : {}),
              ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
            },
            body: init.body,
          },
        ) as unknown as Parameters<typeof worker.fetch>[0],
        env,
        { waitUntil: () => {} } as unknown as ExecutionContext,
      );
    const token = "snap-pg-session";
    const quota = async () =>
      (await db
        .prepare("SELECT comments,bytes FROM project_quotas WHERE project=?")
        .bind("review")
        .first<{ comments: number; bytes: number }>())!;
    const baseline = await quota();
    const created = await send("/threads", "POST", {
      type: "application/json",
      token,
      body: JSON.stringify({
        body: "Snapshot this",
        page: "/snap",
        anchor: { x: 0, y: 0, width: 0.4, height: 0.2, pageX: 0, pageY: 10, viewportWidth: 1200, selector: "#hero", text: "Hero" },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const afterThread = await quota();
    const png = (size: number) => {
      const bytes = new Uint8Array(size).fill(1);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      return bytes;
    };
    const upload = (body: BodyInit, type?: string, as = token, query = "") =>
      send(`/threads/${id}/snapshot${query}`, "POST", { type, token: as, body });
    expect((await upload(png(40000), "image/png")).status).toBe(201);
    expect((await quota()).bytes).toBe(afterThread.bytes + 40000 + 256);
    const replacement = png(60000);
    expect((await upload(replacement, "image/png")).status).toBe(201);
    expect((await quota()).bytes).toBe(afterThread.bytes + 60000 + 256);
    const image = await send(`/threads/${id}/snapshot/image`, "GET", { token });
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(replacement);
    const form = new FormData();
    form.set("file", new Blob(["<p onclick=x()>Hi</p>"], { type: "text/html" }));
    expect((await upload(form, undefined, token, "?kind=html")).status).toBe(201);
    const html = await send(`/threads/${id}/snapshot/html`, "GET", { token });
    expect(html.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(html.headers.get("Content-Security-Policy")).toMatch(/^sandbox\b/);
    expect(html.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await html.text()).toBe("<p onclick=x()>Hi</p>");
    // The project's 100,000-byte quota includes snapshots.
    expect((await upload(png(99000), "image/png")).status).toBe(409);
    const listed = (await (await send("/threads")).json()) as {
      threads: { id: string; snapshot?: Record<string, string> }[];
    };
    expect(Object.keys(listed.threads[0].snapshot!).sort()).toEqual(["html", "image"]);
    const count = async () =>
      (await db.prepare("SELECT COUNT(*) AS n FROM snapshots").first<{ n: number }>())!.n;
    expect(await count()).toBe(2);
    const guest = (await (
      await send("/auth/guest", "POST", {
        type: "application/json",
        body: JSON.stringify({ name: "Guest" }),
      })
    ).json()) as { token: string };
    expect((await upload(png(100), "image/png", guest.token)).status).toBe(403);
    await db
      .prepare("DELETE FROM project_members WHERE project=? AND user_id LIKE 'guest:%'")
      .bind("review")
      .run();
    // Export snapshots as base64 and import them with their parent thread.
    await db
      .prepare("INSERT INTO project_owners(project,user_id) VALUES(?,?)")
      .bind("review", "google:snap-pg")
      .run();
    const exportTable = async (table: string) =>
      ((await (await send(`/project/export?table=${table}`, "GET", { token })).json()) as {
        rows: Record<string, unknown>[];
      }).rows;
    const threadRows = (await exportTable("threads")).filter((row) => row.id === id);
    const snapshotRows = await exportTable("snapshots");
    expect(snapshotRows.map((row) => row.kind).sort()).toEqual(["html", "image"]);
    await db.prepare("DELETE FROM threads WHERE id=?").bind(id).run();
    expect(await count()).toBe(0);
    expect(await quota()).toEqual(baseline);
    const importRows = async (kind: string, records: unknown[]) =>
      (await (
        await send("/project/import", "POST", {
          type: "application/json",
          token,
          body: JSON.stringify({ source: "copy", kind, records }),
        })
      ).json()) as { imported: number };
    expect((await importRows("threads", threadRows)).imported).toBe(1);
    for (const row of snapshotRows)
      expect((await importRows("snapshots", [row])).imported).toBe(1);
    expect((await importRows("snapshots", [snapshotRows[0]])).imported).toBe(0);
    const copy = (await (await send("/threads")).json()) as {
      threads: { id: string; snapshot?: Record<string, string> }[];
    };
    const copied = copy.threads.find((thread) => thread.id.startsWith("import:"))!;
    expect(Object.keys(copied.snapshot!).sort()).toEqual(["html", "image"]);
    const copiedImage = await send(`/threads/${copied.id}/snapshot/image`, "GET", { token });
    expect(new Uint8Array(await copiedImage.arrayBuffer())).toEqual(replacement);
    await db.prepare("DELETE FROM threads WHERE id=?").bind(copied.id).run();
    expect(await count()).toBe(0);
    expect(await quota()).toEqual(baseline);
  },
);
