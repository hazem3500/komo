import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { loadPostgres, postgresDatabase } from "../server/postgres";
import { postgresDatabase as upstreamDatabase } from "./fixtures/upstream-738da17/postgres";
import worker from "../server/index";

// A database created by upstream Palette 738da17's Node server, upgraded in place
// by this package's runner as `dist/node.mjs` does at boot.
vi.mock("../server/setup-client.txt", () => ({ default: "" }));
const connection = process.env.KOMO_TEST_POSTGRES_URL;
const run = connection ? it : it.skip;

const UPSTREAM_TABLES = [
  "comments",
  "export_revisions",
  "komo_schema",
  "oauth_states",
  "project_access",
  "project_invites",
  "project_members",
  "project_owners",
  "project_quotas",
  "project_settings",
  "project_sites",
  "rate_limits",
  "reactions",
  "scope_revisions",
  "sessions",
  "setup_requests",
  "threads",
  "users",
  "workspace_domains",
  "workspaces",
];

const name = `komo_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
const now = Date.now();
const YEAR = 365 * 86400000;
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
// Upstream session and OAuth secrets: two concatenated UUIDs, stored hashed.
const secret = () => crypto.randomUUID() + crypto.randomUUID();
const users = {
  owner: "google:104857600000000000001",
  invited: "google:104857600000000000002",
  github: "github:5550001",
  guest: `guest:${crypto.randomUUID()}`,
};
const tokens = {
  owner: secret(),
  invited: secret(),
  github: secret(),
  guest: secret(),
};
const workspace = `komo_${crypto.randomUUID().replaceAll("-", "")}`;
const ids = {
  open: crypto.randomUUID(),
  resolved: crypto.randomUUID(),
  main: crypto.randomUUID(),
  docs: crypto.randomUUID(),
  hosted: crypto.randomUUID(),
};
const comment = {
  open: crypto.randomUUID(),
  openReply: crypto.randomUUID(),
  resolved: crypto.randomUUID(),
  resolvedReply: crypto.randomUUID(),
  main: crypto.randomUUID(),
  docs: crypto.randomUUID(),
  hosted: crypto.randomUUID(),
};
const anchor = (selector: string, text: string, extra = {}) =>
  JSON.stringify({
    selector,
    text,
    x: 0.25,
    y: 0.5,
    width: 0,
    height: 0,
    pageX: 320,
    pageY: 1480,
    viewportWidth: 1440,
    ...extra,
  });
const PROJECTS = {
  review: { repo: "team/site", origins: ["https://pr-*.preview.example.com"] },
  docs: { repo: "team/docs", origins: ["https://docs-preview.example.com"] },
};

let admin: Pool;
let raw: Pool;
let url: string;
let db: ReturnType<typeof postgresDatabase>;
type Catalog = Record<string, unknown[]>;
let upstreamCatalog: Catalog;
let upstreamColumns: Record<string, string[]>;
let upstreamRows: Record<string, unknown[]>;

async function catalog(pool: Pool): Promise<Catalog> {
  const rows = async (sql: string) => (await pool.query(sql)).rows;
  return {
    columns: await rows(
      "SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2",
    ),
    indexes: await rows(
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2",
    ),
    constraints: await rows(
      "SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS def FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2",
    ),
    triggers: await rows(
      "SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2",
    ),
    functions: await rows(
      "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,md5(p.prosrc) AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2",
    ),
  };
}
async function columnsOf(pool: Pool) {
  const result = await pool.query<{ table_name: string; column_name: string }>(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
  );
  const tables: Record<string, string[]> = {};
  for (const row of result.rows)
    (tables[row.table_name] ??= []).push(row.column_name);
  return tables;
}
// Every row of each table, restricted to the given columns, in a stable order.
async function dump(pool: Pool, columns: Record<string, string[]>) {
  const tables: Record<string, unknown[]> = {};
  for (const [table, names] of Object.entries(columns)) {
    const list = names.map((column) => `"${column}"`).join(",");
    const order = names.map((_, index) => index + 1).join(",");
    tables[table] = (
      await pool.query(`SELECT ${list} FROM "${table}" ORDER BY ${order}`)
    ).rows;
  }
  return tables;
}

// Synthetic data written with the statements upstream 738da17 used, so its triggers
// leave the quota, scope and export counters exactly as a live server would.
async function seed(pool: Pool) {
  const q = (sql: string, values: unknown[] = []) => pool.query(sql, values);
  await q(
    "INSERT INTO users(id,name,verified,avatar_url,accent_color,email) VALUES($1,$2,1,$3,$4,$5),($6,$7,1,NULL,NULL,$8),($9,$10,1,$11,NULL,NULL),($12,$13,0,NULL,NULL,NULL)",
    [
      users.owner, "Avery Lane", "https://avatars.example.com/avery.png", "#4f7cff", "avery@example.com",
      users.invited, "Rowan Ellis", "rowan@example.com",
      users.github, "sam-bot", "https://avatars.example.com/sam.png",
      users.guest, "Guest reviewer",
    ],
  );
  await q(
    "INSERT INTO project_quotas(project,max_comments,max_bytes) VALUES('review',1000,10485760),($1,250,10485760)",
    [workspace],
  );
  await q(
    "INSERT INTO workspaces(id,owner_id,repo,origins,suspended,created_at) VALUES($1,$2,'team/app',$3,0,$4)",
    [workspace, users.owner, JSON.stringify(["https://app.example.com"]), now - 40 * 86400000],
  );
  await q("INSERT INTO workspace_domains(project,origin,verified_at) VALUES($1,'https://app.example.com',$2)", [workspace, now - 39 * 86400000]);
  await q("INSERT INTO project_owners(project,user_id) VALUES('review',$1),('docs',$1),($2,$1)", [users.owner, workspace]);
  await q("INSERT INTO project_settings(project,access) VALUES('review','public'),('docs','private')");
  await q("INSERT INTO project_access(project,user_id) VALUES('docs',$1)", [users.invited]);
  await q(
    "INSERT INTO project_invites(token_hash,project,email,expires_at) VALUES($1,'docs','casey@example.com',$2)",
    [await hash(secret()), now + 6 * 86400000],
  );
  await q(
    "INSERT INTO project_members(project,user_id) VALUES('review',$1),('review',$2),('review',$3),('docs',$1),('docs',$4),($5,$1)",
    [users.owner, users.github, users.guest, users.invited, workspace],
  );
  await q(
    "INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES($1,$2,'review',$3),($4,$5,'docs',$6),($7,$8,'review',$9),($10,$11,'review',$12),($13,$2,$14,$3)",
    [
      await hash(tokens.owner), users.owner, now + 100 * YEAR,
      await hash(tokens.invited), users.invited, now + 99 * YEAR,
      await hash(tokens.github), users.github, now + 100 * YEAR,
      // About to expire: still valid when the fork boots.
      await hash(tokens.guest), users.guest, now + 5 * 60000,
      await hash(secret()), workspace,
    ],
  );
  await q(
    "INSERT INTO oauth_states(state_hash,verifier,project,origin,expires_at,exchange_hash,session_token,provider,approved_origins) VALUES($1,$2,'review','https://pr-42.preview.example.com',$3,$4,NULL,'google',$5),($6,$7,'review','http://localhost:7777',$3,$8,$9,'github',NULL)",
    [
      await hash(secret()), secret(), now + 600000, await hash(secret()),
      JSON.stringify(["https://pr-42.preview.example.com"]),
      await hash(secret()), secret(), await hash(secret()), secret(),
    ],
  );
  await q(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES($1,7,$2)",
    [`review:session:${users.owner}:${Math.floor(now / 60000)}`, now + 120000],
  );
  await q(
    "INSERT INTO setup_requests(id,poll_hash,config,project,expires_at) VALUES($1,$2,$3,NULL,$4),($5,$6,$7,$8,$4)",
    [
      crypto.randomUUID(), await hash(secret()), JSON.stringify({ repo: "team/new", origins: ["https://new.example.com"] }), now + 900000,
      crypto.randomUUID(), await hash(secret()), JSON.stringify({ repo: "team/app", origins: ["https://app.example.com"] }), workspace,
    ],
  );
  await q(
    "INSERT INTO project_sites(project,origin,added_at,removed) VALUES('review','https://staging.example.com',$1,0),('review','https://retired.example.com',$2,1)",
    [now - 20 * 86400000, now - 10 * 86400000],
  );
  const thread = (id: string, project: string, repo: string, branch: string, page: string, at: number, anchorJson: string) =>
    q(
      "INSERT INTO threads(id,project,repo,branch,page,anchor,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
      [id, project, repo, branch, page, anchorJson, at],
    );
  const post = (id: string, threadId: string, user: string, body: string, at: number) =>
    q(
      "INSERT INTO comments(id,thread_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)",
      [id, threadId, user, body, at],
    );
  const day = (n: number) => now - n * 86400000;
  await thread(ids.open, "review", "team/site", "pr-42", "/pricing", day(9), anchor("main > section:nth-of-type(2) h2", "Plans", { source: "src/pages/pricing.tsx:18", context: { tag: "h2", label: "Plans" } }));
  await post(comment.open, ids.open, users.owner, "The heading wraps on tablet.", day(9));
  await post(comment.openReply, ids.open, users.guest, "Seeing it at 820px too.", day(8));
  await thread(ids.resolved, "review", "team/site", "pr-42", "/", day(7), anchor("#hero .cta", "Start free", { width: 0.4, height: 0.3, unstacked: true }));
  await post(comment.resolved, ids.resolved, users.guest, "CTA contrast is low.", day(7));
  await post(comment.resolvedReply, ids.resolved, users.github, "Raised contrast in 3f2a1c.", day(6));
  await thread(ids.main, "review", "team/site", "main", "/about", day(5), anchor("footer a", "Careers"));
  await post(comment.main, ids.main, users.owner, "Link is 404.", day(5));
  await thread(ids.docs, "docs", "team/docs", "pr-7", "/guide/install", day(4), anchor("pre code", "npm install"));
  await post(comment.docs, ids.docs, users.invited, "Use pnpm here.", day(4));
  await thread(ids.hosted, workspace, "team/app", "main", "/settings", day(3), anchor("form button", "Save"));
  await post(comment.hosted, ids.hosted, users.owner, "Disable while saving.", day(3));
  // Upstream's edit, reaction, resolve and profile statements.
  await q("UPDATE comments SET body=$1,edited_at=$2 WHERE id=$3", ["The heading wraps on tablet and phone.", day(2), comment.open]);
  await q(
    "INSERT INTO reactions(comment_id,user_id,emoji) VALUES($1,$2,'👍'),($1,$3,'👍'),($1,$3,'👀'),($4,$5,'🎉')",
    [comment.open, users.guest, users.github, comment.resolvedReply, users.owner],
  );
  await q("UPDATE threads SET resolved=1,resolved_by=$1,updated_at=$2 WHERE id=$3", [users.owner, day(1), ids.resolved]);
  await q("UPDATE users SET name=$1,avatar_url=$2,accent_color=$3 WHERE id=$4", ["Avery Lane", "https://avatars.example.com/avery.png", "#4f7cff", users.owner]);
}

beforeAll(async () => {
  if (!connection) return;
  admin = new Pool({ connectionString: connection });
  // Dropping the database at the end closes its idle connections; that isn't a failure.
  admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${name}`);
  const target = new URL(connection);
  target.pathname = `/${name}`;
  url = target.href;
  // Boot upstream's own runner, exactly as its node.mjs did.
  const upstream = upstreamDatabase(url);
  await upstream.migrate();
  await upstream.close();
  raw = new Pool({ connectionString: url });
  raw.on("error", () => {});
  await seed(raw);
  upstreamCatalog = await catalog(raw);
  upstreamColumns = await columnsOf(raw);
  upstreamRows = await dump(raw, upstreamColumns);
});
afterAll(async () => {
  if (!connection) return;
  await db?.close();
  await raw?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
});

run("an upstream 738da17 database records schema version 1 and has rows in every table", async () => {
  expect(Object.keys(upstreamColumns).sort()).toEqual(UPSTREAM_TABLES);
  expect(upstreamRows.komo_schema).toEqual([{ version: 1 }]);
  for (const table of UPSTREAM_TABLES)
    expect(upstreamRows[table].length, table).toBeGreaterThan(0);
});

run("the fork's boot migration upgrades it in place without changing a row", async () => {
  // As server/node.ts does at boot.
  db = postgresDatabase(url, await loadPostgres());
  await db.migrate();
  expect((await raw.query("SELECT version FROM komo_schema")).rows).toEqual([{ version: 8 }]);

  const after = await dump(raw, upstreamColumns);
  for (const table of UPSTREAM_TABLES.filter((table) => table !== "komo_schema"))
    expect(after[table], table).toEqual(upstreamRows[table]);

  // Nothing upstream created was dropped or redefined.
  const current = await catalog(raw);
  for (const [kind, items] of Object.entries(upstreamCatalog))
    expect(current[kind], kind).toEqual(expect.arrayContaining(items));

  const columns = await columnsOf(raw);
  expect(columns.threads.slice(-3)).toEqual(["tags", "scope", "snapshot_status"]);
  // 007 only adds nullable session columns; upgraded sessions leave them NULL.
  expect(columns.sessions).toEqual([...upstreamColumns.sessions, "via", "created_at"]);
  expect(
    (await raw.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='sessions' AND column_name IN ('via','created_at') ORDER BY 1")).rows,
  ).toEqual([
    { column_name: "created_at", is_nullable: "YES", column_default: null },
    { column_name: "via", is_nullable: "YES", column_default: null },
  ]);
  expect((await raw.query("SELECT DISTINCT via,created_at FROM sessions")).rows).toEqual([{ via: null, created_at: null }]);
  expect((await raw.query("SELECT DISTINCT tags,scope FROM threads")).rows).toEqual([{ tags: "[]", scope: "page" }]);
  expect(
    (await raw.query("SELECT project,webhook_url,webhook_secret,webhook_events,webhook_enabled FROM project_settings ORDER BY project")).rows,
  ).toEqual([
    { project: "docs", webhook_url: null, webhook_secret: null, webhook_events: null, webhook_enabled: 0 },
    { project: "review", webhook_url: null, webhook_secret: null, webhook_events: null, webhook_enabled: 0 },
  ]);
  for (const table of ["personal_access_tokens", "audit_log", "snapshots", "webhook_outbox"])
    expect((await raw.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows, table).toEqual([{ n: 0 }]);
});

run("running the migrations again, or rebooting, changes nothing", async () => {
  const columns = await columnsOf(raw);
  const before = { rows: await dump(raw, columns), catalog: await catalog(raw) };
  await db.migrate();
  const reboot = postgresDatabase(url, await loadPostgres());
  await reboot.migrate();
  await reboot.close();
  expect(await columnsOf(raw)).toEqual(columns);
  expect({ rows: await dump(raw, columns), catalog: await catalog(raw) }).toEqual(before);
});

run("old sessions authenticate and old threads read and write through the API", async () => {
  const env = { DB: db, PROJECTS: JSON.stringify(PROJECTS) } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const call = async (
    path: string,
    { project = "review", repo = "team/site", branch = "pr-42", origin = "https://pr-42.preview.example.com", token, method = "GET", body }: {
      project?: string; repo?: string; branch?: string; origin?: string; token?: string; method?: string; body?: unknown;
    } = {},
  ) => {
    const separator = path.includes("?") ? "&" : "?";
    const response = await worker.fetch(
      new Request(
        `http://localhost:8080${path}${separator}${new URLSearchParams({ project, repo, branch })}`,
        {
          method,
          headers: {
            Origin: origin,
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      ) as unknown as Parameters<typeof worker.fetch>[0],
      env,
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.all(pending.splice(0));
    return { status: response.status, data: (await response.json()) as Record<string, any> };
  };

  expect((await call("/me", { token: tokens.owner })).data.user).toMatchObject({
    id: users.owner, name: "Avery Lane", verified: true, accentColor: "#4f7cff",
  });
  expect((await call("/me", { token: tokens.github })).data.user.id).toBe(users.github);
  // Startup maintenance has run by now and kept the session that expires in minutes.
  expect((await call("/me", { token: tokens.guest })).data.user).toMatchObject({ id: users.guest, verified: false });
  expect((await call("/me", { token: secret() })).status).toBe(401);

  const listed = await call("/threads");
  expect(listed.status).toBe(200);
  const threads = Object.fromEntries(listed.data.threads.map((thread: { id: string }) => [thread.id, thread]));
  expect(Object.keys(threads).sort()).toEqual([ids.open, ids.resolved].sort());
  expect(threads[ids.open]).toMatchObject({
    page: "/pricing",
    tags: [],
    resolved: false,
    resolvedBy: null,
    anchor: { selector: "main > section:nth-of-type(2) h2", text: "Plans", source: "src/pages/pricing.tsx:18", context: { tag: "h2", label: "Plans" } },
  });
  expect(threads[ids.open].scope).toBeUndefined();
  expect(threads[ids.open].comments).toMatchObject([
    {
      id: comment.open,
      body: "The heading wraps on tablet and phone.",
      editedAt: expect.any(Number),
      author: { id: users.owner, avatarUrl: "https://avatars.example.com/avery.png", accentColor: "#4f7cff" },
      reactions: { "👍": expect.arrayContaining([users.guest, users.github]), "👀": [users.github] },
    },
    { id: comment.openReply, author: { id: users.guest, name: "Guest reviewer", verified: false }, editedAt: null },
  ]);
  expect(threads[ids.resolved]).toMatchObject({
    resolved: true,
    resolvedBy: { id: users.owner, name: "Avery Lane", verified: true },
    anchor: { width: 0.4, height: 0.3, unstacked: true },
  });
  expect(threads[ids.resolved].comments[1].reactions).toEqual({ "🎉": [users.owner] });
  expect((await call("/threads", { branch: "main" })).data.threads.map((thread: { id: string }) => thread.id)).toEqual([ids.main]);

  // Private project: only the invited Google account reads it.
  const docs = { project: "docs", repo: "team/docs", branch: "pr-7", origin: "https://docs-preview.example.com" };
  expect((await call("/threads", { ...docs, token: tokens.guest })).status).toBe(401);
  expect((await call("/threads", { ...docs, token: tokens.invited })).data.threads[0]).toMatchObject({
    id: ids.docs,
    comments: [{ id: comment.docs, body: "Use pnpm here." }],
  });
  // Hosted workspace: its owner and verified domain still resolve the project.
  expect(
    (await call("/threads", { project: workspace, repo: "team/app", branch: "main", origin: "https://app.example.com" })).data.threads[0].id,
  ).toBe(ids.hosted);

  // Old rows take new writes: a reply, a tag and the all-pages scope.
  const quota = async () => (await raw.query("SELECT comments,bytes FROM project_quotas WHERE project='review'")).rows[0];
  const before = await quota();
  expect((await call(`/threads/${ids.open}/comments`, { method: "POST", token: tokens.github, body: { body: "Fixed in the next deploy." } })).status).toBe(201);
  expect((await quota()).comments).toBe(before.comments + 1);
  expect((await call(`/threads/${ids.open}`, { method: "PATCH", token: tokens.owner, body: { scope: "all" } })).data).toEqual({ ok: true, scope: "all" });
  expect((await call(`/threads/${ids.open}`, { method: "PATCH", token: tokens.owner, body: { tag: "layout" } })).data).toEqual({ ok: true, tags: ["layout"] });
  const updated = (await call("/threads", { token: tokens.owner })).data.threads.find((thread: { id: string }) => thread.id === ids.open);
  expect(updated).toMatchObject({ scope: "all", tags: ["layout"] });
  expect(updated.comments).toHaveLength(3);

  // The owner's export, the fallback upgrade path, reads the upgraded rows.
  const exported = await call("/project/export?table=threads", { token: tokens.owner });
  expect(exported.status).toBe(200);
  expect(exported.data.rows.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([ids.open, ids.resolved, ids.main]));

  // Behind a sign-in proxy, upgraded sessions don't pass: the proxy didn't
  // sign them in, so reviewers sign in again through it. Without one they do.
  const behindProxy = { DB: db, PROJECTS: JSON.stringify(PROJECTS), KOMO_IAP_AUDIENCE: "/projects/1/global/backendServices/2" } as unknown as Env;
  const proxied = await worker.fetch(
    new Request(`http://localhost:8080/me?project=review`, {
      headers: { Origin: "https://pr-42.preview.example.com", Authorization: `Bearer ${tokens.owner}` },
    }) as unknown as Parameters<typeof worker.fetch>[0],
    behindProxy,
    { waitUntil: () => {} } as unknown as ExecutionContext,
  );
  expect(proxied.status).toBe(401);
  expect((await call("/me", { token: tokens.owner })).status).toBe(200);

  // Sessions and OAuth states survive startup maintenance; only expired rows ever go.
  expect((await raw.query("SELECT COUNT(*)::int AS n FROM sessions")).rows[0].n).toBe(5);
  expect((await raw.query("SELECT COUNT(*)::int AS n FROM oauth_states")).rows[0].n).toBe(2);
});
