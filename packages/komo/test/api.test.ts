import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Thread } from "../src/types";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let directory = "",
  worker: ChildProcess | undefined,
  port = 0,
  output = "";
const origin = "http://localhost:4321";
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
  source: "src/pages/products/workers.astro",
};
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  token?: string,
  branch = "feature/a",
  repo = "owner/site",
  project = "test"
) {
  const url = new URL(path, `http://localhost:${port}`);
  url.searchParams.set("project", project);
  url.searchParams.set("repo", repo);
  url.searchParams.set("branch", branch);
  const headers: Record<string, string> = {
    Origin: project === "_komo" ? `http://localhost:${port}` : origin,
  };
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "branch-comments-test-"));
  const freePort = () =>
    new Promise<number>((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const value = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(value));
      });
    });
  port = await freePort();
  // api and iap tests start wrangler dev in parallel; left to its default, each
  // probes 9229 for the inspector and both can bind it at once, so one fails.
  const inspectorPort = await freePort();
  const config = JSON.parse(
    await readFile(new URL("../server/wrangler.jsonc", import.meta.url), "utf8")
  );
  config.name = "comments-test";
  const apiPath = fileURLToPath(new URL("../server/index.ts", import.meta.url));
  config.main = join(directory, "worker.ts");
  // Mock only Google's upstream responses in the test Worker; exercise the real
  // OAuth callback, state cookie, database provisioning and scoped session code.
  await writeFile(
    config.main,
    `
    import api from ${JSON.stringify(apiPath)};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        const code = new URLSearchParams(init?.body).get("code");
        // "fixture-profile:<json>" codes carry the userinfo profile to return.
        if (code?.startsWith("fixture-profile:")) return Response.json({access_token:code});
        return code === "fixture-setup-success"
          ? Response.json({access_token:"fixture-google-access"})
          : Response.json({error:"invalid_grant"}, {status:400});
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        const bearer = String(init?.headers?.Authorization ?? "");
        if (bearer.startsWith("Bearer fixture-profile:"))
          return Response.json(JSON.parse(bearer.slice("Bearer fixture-profile:".length)));
        return Response.json({sub:"in-project-fixture",name:"Setup Owner",email_verified:true,email:"setup@example.test"});
      }
      return originalFetch(input, init);
    };
    export default api;
  `
  );
  delete config.account_id;
  config.vars.PROJECTS = JSON.stringify({
    test: { repo: "owner/site", origins: [origin] },
    cli: { repo: "owner/site", origins: [origin] },
    other: { repo: "owner/site", origins: [origin] },
    photos: { repo: "owner/site", origins: [origin] },
    demo: { repo: "owner/site", origins: [origin], retainedCommentsPerUser: 3 },
    owned: {
      repo: "owner/site",
      origins: [origin, "https://docs.example.com"],
      requireOwner: true,
    },
    unclaimed: {
      repo: "owner/site",
      origins: [origin],
      requireOwner: true,
      bootstrapHash: createHash("sha256")
        .update("test-owner-key")
        .digest("hex"),
    },
  });
  config.vars.KOMO_HOSTED = "true";
  config.vars.KOMO_WEBHOOK_KEYS = JSON.stringify({
    current: "test-key",
    keys: { "test-key": Buffer.alloc(32, 7).toString("base64") },
  });
  config.vars.GOOGLE_CLIENT_ID = "fixture-client";
  config.vars.GOOGLE_CLIENT_SECRET = "fixture-secret-not-a-real-credential";
  config.d1_databases = [
    {
      binding: "DB",
      database_name: "test",
      database_id: "test",
      migrations_dir: fileURLToPath(
        new URL("../server/migrations", import.meta.url)
      ),
    },
  ];
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify(config));
  await promisify(execFile)(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      join(directory, "state"),
      "--config",
      configPath,
    ],
    { cwd: root, timeout: 45000 }
  );
  const seed = join(directory, "seed.sql");
  const h = (value: string) => createHash("sha256").update(value).digest("hex");
  await writeFile(
    seed,
    `
    INSERT INTO users(id,name,verified) VALUES('google:fixture','Owner',1),('guest:fixture','Guest',0),('google:photo-legacy','Legacy',1);
    INSERT INTO users(id,name,verified,avatar_url) VALUES('google:photo-custom','Custom',1,'https://photos.example/custom.jpg'),('google:photo-cleared','Cleared',1,'');
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<65)
    INSERT INTO threads(id,project,repo,branch,page,anchor,created_at,updated_at)
    SELECT printf('import:%03d',i),'test','owner/site','pagination','/','${JSON.stringify(anchor)}',100,100 FROM n;
    INSERT INTO project_owners(project,user_id) VALUES('owned','google:fixture');
    INSERT INTO project_members(project,user_id) VALUES('other','google:fixture'),('removed-project','google:fixture');
    INSERT INTO users(id,name,verified) VALUES('google:usage','Usage owner',1);
    INSERT INTO workspaces(id,owner_id,repo,origins,created_at) VALUES('usage-project','google:usage','owner/site','["http://localhost:4321"]',1);
    INSERT INTO project_owners(project,user_id) VALUES('usage-project','google:usage');
    INSERT INTO project_quotas(project,max_comments,max_bytes,comments) VALUES('usage-project',250,10485760,249);
    INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES('${h("usage-owner-token")}','google:usage','usage-project',9999999999999);

    INSERT INTO users(id,name,verified,email) VALUES('google:management','Manager',1,'owner@example.com'),('google:member','Member',1,'member@example.com'),('google:stranger','Stranger',1,'stranger@example.com');
    INSERT INTO workspaces(id,owner_id,repo,origins,created_at) VALUES('managed','google:management','owner/site','["http://localhost:4321"]',1),('destination','google:management','owner/site','["http://localhost:4321"]',1);
    INSERT INTO project_owners(project,user_id) VALUES('managed','google:management'),('destination','google:management');
    INSERT INTO project_quotas(project,max_comments,max_bytes) VALUES('managed',250,10485760),('destination',250,10485760);
    INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES
      ('${h("managed-owner")}','google:management','managed',9999999999999),
      ('${h("destination-owner")}','google:management','destination',9999999999999),
      ('${h("managed-member")}','google:member','managed',9999999999999),
      ('${h("managed-stranger")}','google:stranger','managed',9999999999999),
      ('${h("manage-control")}','google:management','_komo',9999999999999);
    INSERT INTO project_quotas(project,max_comments,max_bytes) VALUES('owned',1,100000),('demo',100,100000);
    INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES
      ('${h("owner-token")}','google:fixture','_komo',9999999999999),
      ('${h("guest-management-token")}','guest:fixture','_komo',9999999999999),
      ('${h("owned-token")}','google:fixture','owned',9999999999999),
      ('${h("claim-token")}','google:fixture','unclaimed',9999999999999),
      ('${h("guest-claim-token")}','guest:fixture','unclaimed',9999999999999);
  `
  );
  await promisify(execFile)(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      join(directory, "state"),
      "--config",
      configPath,
      "--file",
      seed,
    ],
    { cwd: root, timeout: 45000 }
  );
  worker = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      configPath,
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      join(directory, "state"),
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true }
  );
  worker.stdout?.on("data", (chunk) => (output += String(chunk)));
  worker.stderr?.on("data", (chunk) => (output += String(chunk)));
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (
          await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok
      )
        return;
    } catch {
      /* Wait for workerd. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Worker failed to start: ${output}`);
});
afterAll(async () => {
  if (worker?.pid) {
    try {
      process.kill(-worker.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("connects from the intended site with a one-use Google handoff and project-scoped session", async () => {
  const site = "https://new-site.example";
  const setup = (await (
    await request("setup/start", "POST", {
      repo: "owner/new-site",
      origins: [site, "https://other-site.example"],
    })
  ).json()) as { id: string; secret: string };
  const connect = (
    origin: string,
    sites = [origin, "https://production.example"]
  ) =>
    fetch(
      `http://localhost:${port}/setup/connect?code=${setup.id}&origin=${encodeURIComponent(origin)}&sites=${encodeURIComponent(JSON.stringify(sites))}`,
      { redirect: "manual" }
    );
  expect((await connect("https://attacker.example")).status).toBe(403);
  expect((await connect(`${site}/path`)).status).toBe(403);
  expect((await connect(site, ["https://production.example"])).status).toBe(
    400
  );
  expect((await connect(site, [site, "http://untrusted.example"])).status).toBe(
    400
  );
  const start = await connect(site);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("Location")!);
  expect(authorize.origin).toBe("https://accounts.google.com");
  const state = authorize.searchParams.get("state")!;
  const callback = `http://localhost:${port}/auth/google/callback?state=${encodeURIComponent(state)}&code=fixture-setup-success`;
  expect((await fetch(callback)).status).toBe(400);
  const signedIn = await fetch(callback, {
    headers: { Cookie: `__Host-comments-oauth=${state}` },
  });
  expect(signedIn.status).toBe(200);
  const html = await signedIn.text();
  const payload = JSON.parse(
    html.match(/postMessage\((.+),"https:\/\/new-site\.example"\)/)![1]
  );
  expect(payload).toMatchObject({
    type: "komo:setup",
    code: setup.id,
    repo: "owner/new-site",
    user: { id: "google:in-project-fixture", verified: true },
  });
  const scoped = (project: string, origin = site) =>
    fetch(`http://localhost:${port}/me?project=${project}`, {
      headers: { Origin: origin, Authorization: `Bearer ${payload.token}` },
    });
  expect((await scoped(payload.project)).status).toBe(200);
  expect(
    (await scoped(payload.project, "https://production.example")).status
  ).toBe(200);
  expect((await scoped("_komo", `http://localhost:${port}`)).status).toBe(401);
  const approved = await fetch(
    `http://localhost:${port}/config?project=${payload.project}`,
    { headers: { Origin: site } }
  );
  expect(approved.status).toBe(200);
  expect(approved.headers.get("Access-Control-Allow-Origin")).toBe(site);
  expect(
    (await scoped(payload.project, "https://other-site.example")).status
  ).toBe(403);
  const poll = await (
    await request("setup/poll", "POST", { id: setup.id, secret: setup.secret })
  ).json();
  expect(poll.project).toBe(payload.project);
  expect(poll.token).toBeUndefined();
  expect((await connect(site)).status).toBe(409);
  expect(
    (
      await fetch(callback, {
        headers: { Cookie: `__Host-comments-oauth=${state}` },
      })
    ).status
  ).toBe(400);
});

describe("shared comments against real workerd and SQLite", () => {
  it("adds normalized thread tags idempotently and returns them in listings", async () => {
    const call = (
      path: string,
      method = "GET",
      data?: unknown,
      token?: string
    ) => request(path, method, data, token, "tags", "owner/site", "test");
    const guest = await (
      await call("/auth/guest", "POST", { name: "Tag reviewer" })
    ).json();
    const created = await (
      await call(
        "/threads",
        "POST",
        { page: "/", anchor, body: "Group this feedback" },
        guest.token,
      )
    ).json();
    const first = await call(
      `/threads/${created.id}`,
      "PATCH",
      { tag: "Navigation" },
      guest.token
    );
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual({ ok: true, tags: ["navigation"] });
    const repeated = await call(
      `/threads/${created.id}`,
      "PATCH",
      { tag: "navigation" },
      guest.token
    );
    expect(await repeated.json()).toEqual({ ok: true, tags: ["navigation"] });
    const listed = await (
      await call("/threads", "GET")
    ).json();
    expect(
      listed.threads.find((thread: Thread) => thread.id === created.id).tags
    ).toEqual(["navigation"]);
    expect(
      (
        await call(
          `/threads/${created.id}`,
          "PATCH",
          { tag: "bad/tag" },
          guest.token
        )
      ).status
    ).toBe(400);
    const removed = await call(
      `/threads/${created.id}`,
      "PATCH",
      { untag: "Navigation" },
      guest.token
    );
    expect(await removed.json()).toEqual({ ok: true, tags: [] });
  });
  it("accepts normalized tags when a thread is created", async () => {
    const call = (
      path: string,
      method = "GET",
      data?: unknown,
      token?: string
    ) => request(path, method, data, token, "tags-create", "owner/site", "test");
    const guest = await (
      await call("/auth/guest", "POST", { name: "Tag author" })
    ).json();
    const created = await call(
      "/threads",
      "POST",
      { page: "/", anchor, body: "Tagged at creation", tags: ["Bug", "copy", "bug"] },
      guest.token,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = await created.json();
    const listed = await (await call("/threads", "GET")).json();
    expect(listed.threads.find((thread: Thread) => thread.id === id).tags).toEqual(["bug", "copy"]);
    for (const tags of ["bug", ["bad/tag"], Array.from({ length: 13 }, (_, index) => `t${index}`)])
      expect(
        (await call("/threads", "POST", { page: "/", anchor, body: "Bad tags", tags }, guest.token)).status
      ).toBe(400);
  });
  it("resolves project-only configuration to the existing repository", async () => {
    const canonical = await request(
      "/threads",
      "GET",
      undefined,
      undefined,
      "feature/a"
    );
    const inferred = await request(
      "/threads",
      "GET",
      undefined,
      undefined,
      "feature/a",
      "test"
    );
    expect(inferred.status).toBe(200);
    expect(await inferred.json()).toEqual(await canonical.json());
    const mismatch = await request(
      "/threads",
      "GET",
      undefined,
      undefined,
      "feature/a",
      "wrong/repo"
    );
    expect(mismatch.status).toBe(403);
  });
  it("keeps a demo reviewer's newest three messages across pages and branches, preserving other reviewers", async () => {
    const call = (
      path: string,
      method = "GET",
      data?: unknown,
      token?: string,
      branch = "shared"
    ) => request(path, method, data, token, branch, "owner/site", "demo");
    const alice = await (
      await call("/auth/guest", "POST", { name: "Alice demo" })
    ).json();
    const bob = await (
      await call("/auth/guest", "POST", { name: "Bob demo" })
    ).json();
    const create = async (body: string, branch = "shared") => {
      const response = await call(
        "/threads",
        "POST",
        { page: "/", anchor, body },
        alice.token,
        branch
      );
      expect(response.status).toBe(201);
      return response.json();
    };
    const first = await create("Old root");
    await call(
      `/threads/${first.id}/comments`,
      "POST",
      { body: "Keep Bob's reply" },
      bob.token
    );
    const second = await create("Old empty thread", "other-page");
    const oldScope = await (
      await call("/threads", "GET", undefined, undefined, "other-page")
    ).json();
    await create("Third");
    await call(
      `/threads/${first.id}/comments`,
      "POST",
      { body: "Newest reply" },
      alice.token
    );
    let list = await (await call("/threads")).json();
    expect(
      list.threads
        .find((t: Thread) => t.id === first.id)
        .comments.map((c: { body: string }) => c.body)
    ).toEqual(["Keep Bob's reply", "Newest reply"]);
    await Promise.all([create("Concurrent A"), create("Concurrent B")]);
    list = await (await call("/threads")).json();
    const messages = list.threads.flatMap((t: Thread) => t.comments);
    expect(
      messages.filter(
        (c: { author: { id: string } }) => c.author.id === alice.user.id
      )
    ).toHaveLength(3);
    expect(
      messages.some((c: { body: string }) => c.body === "Keep Bob's reply")
    ).toBe(true);
    const pruned = await (
      await call("/threads", "GET", undefined, undefined, "other-page")
    ).json();
    expect(pruned.threads.some((t: Thread) => t.id === second.id)).toBe(false);
    expect(pruned.revision).not.toBe(oldScope.revision);
    const usage = await (
      await call("/usage", "GET", undefined, alice.token)
    ).json();
    expect(usage.comments.used).toBe(4);
    const regular = await (
      await request("/auth/guest", "POST", { name: "Regular reviewer" })
    ).json();
    for (let i = 0; i < 4; i++) {
      expect(
        (
          await request(
            "/threads",
            "POST",
            { page: "/", anchor, body: `Keep ${i}` },
            regular.token,
            "retention-off"
          )
        ).status
      ).toBe(201);
    }
    const unchanged = await (
      await request("/threads", "GET", undefined, undefined, "retention-off")
    ).json();
    expect(unchanged.threads).toHaveLength(4);
  });
  it("rejects using the management session as an unmetered comment project", async () => {
    expect(
      (
        await request(
          "/threads",
          "POST",
          { body: "Bypass", page: "/", anchor },
          "owner-token",
          "shared",
          "_komo",
          "_komo"
        )
      ).status
    ).toBe(404);
  });

  it("persists moved anchors and rejects moves by unrelated guests", async () => {
    const owner = await (
      await request("/auth/guest", "POST", { name: "Mover" })
    ).json();
    const other = await (
      await request("/auth/guest", "POST", { name: "Other" })
    ).json();
    const branch = "feature/moving";
    const captured = { ...anchor, context: { tag: "button", label: "Save", scope: "main > form", styles: "display: flex" } };
    const { id } = await (
      await request(
        "/threads",
        "POST",
        { page: "/", anchor: captured, body: "Move me" },
        owner.token,
        branch
      )
    ).json();
    const initial = await (await request("/threads", "GET", undefined, undefined, branch)).json();
    expect(initial.threads[0].anchor).toEqual(captured);
    const moved = { ...captured, x: 0.6, y: 0.2, unstacked: true };
    expect(
      (
        await request(
          `/threads/${id}`,
          "PATCH",
          { anchor: moved },
          other.token,
          branch
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          `/threads/${id}`,
          "PATCH",
          { anchor: moved },
          owner.token,
          "wrong-branch"
        )
      ).status
    ).toBe(404);
    expect(
      (
        await request(
          `/threads/${id}`,
          "PATCH",
          { anchor: { ...moved, x: 2 } },
          owner.token,
          branch
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(
          `/threads/${id}`,
          "PATCH",
          { anchor: moved },
          owner.token,
          branch
        )
      ).status
    ).toBe(200);
    const result = await (
      await request("/threads", "GET", undefined, undefined, branch)
    ).json();
    expect(result.threads[0].anchor).toEqual(moved);
    const compact = await (await request("/threads?authors=1", "GET", undefined, undefined, branch)).json();
    expect(compact.threads[0].comments[0].author).toBe(owner.user.id);
    expect(compact.authors[owner.user.id]).toEqual(result.threads[0].comments[0].author);
    expect(compact.threads.map((thread: any) => ({
      ...thread,
      resolvedBy: thread.resolvedBy === null ? null : compact.authors[thread.resolvedBy],
      comments: thread.comments.map((comment: any) => ({...comment, author: compact.authors[comment.author]})),
    }))).toEqual(result.threads);
    expect(result.threads[0].resolved).toBe(false);
    expect((await request(`/threads/${id}`, "PATCH", { resolved: true }, owner.token, branch)).status).toBe(200);
    const resolvedCompact = await (await request("/threads?authors=1", "GET", undefined, undefined, branch)).json();
    expect(resolvedCompact.threads[0].resolvedBy).toBe(owner.user.id);
    expect(resolvedCompact.authors[owner.user.id].name).toBe(owner.user.name);
  });
  it("lets a configured project's owner add and remove any approved site", async () => {
    const sites = async (data?: unknown) =>
      (
        await request(
          "/project/sites",
          data ? "PATCH" : "GET",
          data,
          "owned-token",
          "shared",
          "owner/site",
          "owned"
        )
      ).json();
    expect(await sites()).toEqual({
      sites: ["https://docs.example.com", origin].sort(),
      fixed: [],
    });
    const docs = async () =>
      fetch(
        `http://localhost:${port}/config?project=owned&repo=owner/site&branch=shared`,
        { headers: { Origin: "https://docs.example.com" } }
      );
    expect((await docs()).status).toBe(200);
    expect(
      await sites({ sites: [origin, "https://*-preview.example.com"] })
    ).toEqual({
      sites: ["https://*-preview.example.com", origin].sort(),
      fixed: [],
    });
    expect((await docs()).status).toBe(403);
    const preview = await fetch(
      `http://localhost:${port}/config?project=owned&repo=owner/site&branch=shared`,
      { headers: { Origin: "https://pr-9-preview.example.com" } }
    );
    expect(preview.status).toBe(200);
    const locked = await request(
      "/project/sites",
      "PATCH",
      { sites: ["https://*-preview.example.com"] },
      "owned-token",
      "shared",
      "owner/site",
      "owned"
    );
    expect(locked.status).toBe(400);
    expect((await locked.json()).error).toBe(
      "You can’t remove the site you’re on."
    );
    await sites({ sites: [origin, "https://docs.example.com"] });
    expect((await docs()).status).toBe(200);
  });
  it("offers Google sign-in when credentials are configured", async () => {
    const config = await (await request("/config")).json();
    expect(config.google).toBe(true);
    expect((await request("/auth/google/start", "POST", {})).status).toBe(200);
    expect(
      (
        await request("/auth/google/start", "POST", {
          returnOrigin: "http://127.0.0.1:54321",
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request("/auth/google/start", "POST", {
          returnOrigin: "https://evil.example",
        })
      ).status
    ).toBe(400);
  });

  it("stores the Google picture as the avatar and returns it on /me and comment authors", async () => {
    // Its own project keeps these sign-ins out of other tests' rate limits and listings.
    const call = (path: string, method = "GET", data?: unknown, token?: string) =>
      request(path, method, data, token, "feature/a", "owner/site", "photos");
    const signIn = async (profile: Record<string, unknown>) => {
      const { url } = await (await call("/auth/google/start", "POST", {})).json();
      const authorize = await fetch(url, { redirect: "manual" });
      const state = new URL(authorize.headers.get("Location")!).searchParams.get(
        "state"
      )!;
      const code = `fixture-profile:${JSON.stringify(profile)}`;
      const page = await fetch(
        `http://localhost:${port}/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
        { headers: { Cookie: `__Host-comments-oauth=${state}` } }
      );
      expect(page.status).toBe(200);
      return JSON.parse(
        (await page.text()).match(
          /postMessage\((.+),"http:\/\/localhost:4321"\)/
        )![1]
      ) as { token: string; user: { id: string; avatarUrl?: string } };
    };
    const picture = "https://lh3.googleusercontent.com/a/fixture=s96-c";
    const fresh = await signIn({ sub: "photo-new", name: "Photo Person", picture });
    expect(fresh.user).toMatchObject({ id: "google:photo-new", avatarUrl: picture });
    expect(
      (await (await call("me", "GET", undefined, fresh.token)).json()).user
        .avatarUrl
    ).toBe(picture);
    const created = await (
      await call("threads", "POST", { page: "/photo", anchor, body: "With a photo" }, fresh.token)
    ).json();
    const list = await (
      await call("threads", "GET", undefined, fresh.token)
    ).json();
    expect(
      list.threads.find((thread: Thread) => thread.id === created.id)
        .comments[0].author.avatarUrl
    ).toBe(picture);

    // Only HTTPS pictures are kept; a missing one keeps the initial.
    for (const [sub, bad] of [
      ["photo-http", "http://lh3.googleusercontent.com/a/x"],
      ["photo-js", "javascript:alert(1)"],
      ["photo-creds", "https://user:pw@photos.example/x.jpg"],
      ["photo-none", undefined],
    ])
      expect(
        (await signIn({ sub, name: "No Photo", picture: bad })).user.avatarUrl
      ).toBeUndefined();

    // Existing users without a photo get it on their next sign-in; a photo
    // they chose, or cleared, is kept.
    expect(
      (await signIn({ sub: "photo-legacy", name: "Legacy", picture })).user
        .avatarUrl
    ).toBe(picture);
    expect(
      (await signIn({ sub: "photo-custom", name: "Custom", picture })).user
        .avatarUrl
    ).toBe("https://photos.example/custom.jpg");
    expect(
      (await signIn({ sub: "photo-cleared", name: "Cleared", picture })).user
        .avatarUrl
    ).toBeUndefined();

    const guest = await (
      await call("auth/guest", "POST", { name: "Photo guest" })
    ).json();
    expect(guest.user.avatarUrl).toBeUndefined();
  });
  it("supports two independent users, replies, reactions, resolution, and author-only editing", async () => {
    expect(
      (await request("/auth/guest", "POST", { name: "Alice", verified: true }))
        .status
    ).toBe(400);
    const alice = await (
      await request("/auth/guest", "POST", { name: "Alice" })
    ).json();
    const bob = await (
      await request("/auth/guest", "POST", { name: "Bob" })
    ).json();
    expect(alice.user.verified).toBe(false);
    const created = await request(
      "/threads",
      "POST",
      { page: "/products/workers/", anchor, body: "Increase the spacing." },
      alice.token
    );
    expect(created.status).toBe(201);
    const { id, commentId: createdCommentId } = await created.json();
    const get = async () =>
      (await (await request("/threads")).json()).threads as Thread[];
    let thread = (await get())[0];
    expect(thread.id).toBe(id);
    expect(thread.comments[0].id).toBe(createdCommentId);
    expect(thread.page).toBe("/products/workers");
    expect(thread.comments[0].author.name).toBe("Alice");
    expect(
      (
        await request(
          `/threads/${id}/comments`,
          "POST",
          { body: "Working on this." },
          bob.token
        )
      ).status
    ).toBe(201);
    thread = (await get())[0];
    expect(thread.comments).toHaveLength(2);
    const commentId = thread.comments[0].id;
    expect(
      (
        await request(
          `/threads/${id}/comments/${commentId}`,
          "PATCH",
          { body: "Forged" },
          bob.token
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          `/threads/${id}/comments/${commentId}`,
          "PATCH",
          { body: "Use 24px spacing." },
          alice.token
        )
      ).status
    ).toBe(200);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(
            `/threads/${id}/comments/${commentId}/reactions`,
            "POST",
            { emoji: "👍", active: true },
            bob.token
          )
        ).status
      ).toBe(200);
    thread = (await get())[0];
    expect(thread.comments[0].body).toBe("Use 24px spacing.");
    expect(thread.comments[0].reactions["👍"]).toEqual([bob.user.id]);
    const react = (emoji: string, active: boolean, token = bob.token) =>
      request(
        `/threads/${id}/comments/${commentId}/reactions`,
        "POST",
        { emoji, active },
        token
      );
    await react("👍", true, alice.token);
    await react("❤️", true);
    thread = (await get())[0];
    expect(thread.comments[0].reactions).toEqual({
      "👍": [alice.user.id],
      "❤️": [bob.user.id],
    });
    expect((await react("👩🏽‍💻", true)).status).toBe(200);
    expect((await get())[0].comments[0].reactions).toEqual({
      "👍": [alice.user.id],
      "👩🏽‍💻": [bob.user.id],
    });
    for (const invalid of ["hello", "👍👍", "<script>", ""]) {
      expect((await react(invalid, true)).status).toBe(400);
    }
    await react("❤️", true);
    await react("❤️", false);
    expect((await get())[0].comments[0].reactions).toEqual({
      "👍": [alice.user.id],
    });
    await Promise.all([react("🎉", true), react("👀", true)]);
    const bobReactions = Object.values(
      (await get())[0].comments[0].reactions
    ).filter((users) => users.includes(bob.user.id));
    expect(bobReactions).toHaveLength(1);

    expect(
      (await request(`/threads/${id}`, "PATCH", { resolved: true }, bob.token))
        .status
    ).toBe(200);
    thread = (await get())[0];
    expect(thread.resolved).toBe(true);
    expect(thread.resolvedBy?.id).toBe(bob.user.id);
    expect(
      (await request(`/threads/${id}`, "PATCH", { resolved: false }, bob.token))
        .status
    ).toBe(200);
    expect(
      (
        await request(
          `/threads/${id}/comments/${commentId}`,
          "DELETE",
          undefined,
          alice.token
        )
      ).status
    ).toBe(200);
    thread = (await get())[0];
    expect(thread.comments).toHaveLength(2);
    expect(thread.comments[0].body).toBe("[Comment deleted]");
    expect(thread.comments[0].reactions).toEqual({});
    expect(
      (await request("/me", "DELETE", undefined, alice.token)).status
    ).toBe(200);
    expect((await request("/me", "GET", undefined, alice.token)).status).toBe(
      401
    );
  });
  it("isolates repo, project, and branch, including mutation targets", async () => {
    const user = await (
      await request("/auth/guest", "POST", { name: "Reviewer" })
    ).json();
    const threads = await (await request("/threads")).json();
    const id = threads.threads[0].id;
    expect(
      (
        await (
          await request("/threads", "GET", undefined, undefined, "feature/b")
        ).json()
      ).threads
    ).toEqual([]);
    expect(
      (
        await request(
          `/threads/${id}`,
          "PATCH",
          { resolved: true },
          user.token,
          "feature/b"
        )
      ).status
    ).toBe(404);
    expect(
      (
        await request(
          "/threads",
          "GET",
          undefined,
          undefined,
          "feature/a",
          "other/repo"
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          "/threads",
          "POST",
          { page: "/", anchor, body: "Wrong project" },
          user.token,
          "feature/a",
          "owner/site",
          "other"
        )
      ).status
    ).toBe(401);
  });
  it("rejects OAuth callbacks from another browser before contacting GitHub", async () => {
    const callback = await fetch(
      `http://localhost:${port}/auth/github/callback?state=untrusted&code=untrusted`,
      { headers: { Cookie: "__Host-comments-oauth=different" } }
    );
    expect(callback.status).toBe(400);
    const authorize = await fetch(
      `http://localhost:${port}/auth/github/authorize?state=expired`,
      { redirect: "manual" }
    );
    expect(authorize.status).toBe(400);
  });
  it("requires a session and rejects malicious input", async () => {
    expect(
      (
        await request("/threads", "POST", {
          page: "/",
          anchor,
          body: "Anonymous",
        })
      ).status
    ).toBe(401);
    const user = await (
      await request("/auth/guest", "POST", { name: "Validator" })
    ).json();
    expect(
      (
        await request(
          "/threads",
          "POST",
          { page: "//evil.com", anchor, body: "Bad path" },
          user.token
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(
          "/threads",
          "POST",
          { page: "/", anchor: { ...anchor, x: -1 }, body: "Bad anchor" },
          user.token
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(
          "/threads",
          "POST",
          { page: "/", anchor, body: " " },
          user.token
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(
          "/threads",
          "POST",
          { page: "/", anchor, body: "a".repeat(20000) },
          user.token
        )
      ).status
    ).toBe(413);
    const denied = await fetch(
      `http://localhost:${port}/threads?project=test&repo=owner/site&branch=feature/a`,
      { headers: { Origin: "https://evil.com" } }
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    // Any local dev port works without being listed.
    const local = await fetch(
      `http://localhost:${port}/threads?project=test&repo=owner/site&branch=feature/a`,
      { headers: { Origin: "http://localhost:8123" } }
    );
    expect(local.status).toBe(200);
    expect(local.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:8123"
    );
    const refused = await fetch(
      `http://localhost:${port}/config?project=test&repo=owner/site&branch=feature/a`,
      { headers: { Origin: "https://evil.com" } }
    );
    expect(refused.status).toBe(403);
    expect(refused.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://evil.com"
    );
    expect(await refused.json()).toEqual({
      error: "This site is not approved for this komo project.",
      code: "site_not_approved",
    });
    const preflight = await fetch(
      `http://localhost:${port}/config?project=test&repo=owner/site&branch=feature/a`,
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.com",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      }
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://evil.com"
    );
    expect((await request("/auth/github/start", "POST", {})).status).toBe(503);
  });
});

describe("profile editing", () => {
  it("updates only the signed-in reviewer and persists their identity", async () => {
    const first = (await (
      await request("auth/guest", "POST", { name: "Before" })
    ).json()) as { token: string; user: { id: string } };
    const second = (await (
      await request("auth/guest", "POST", { name: "Unchanged" })
    ).json()) as { token: string };
    expect(
      (
        await request("me", "PATCH", {
          name: "After",
          avatarUrl: "https://example.com/photo.png",
        })
      ).status
    ).toBe(401);
    expect(
      (await request("me", "PATCH", { name: "", avatarUrl: "" }, first.token))
        .status
    ).toBe(400);
    expect(
      (
        await request(
          "me",
          "PATCH",
          { name: "After", avatarUrl: "javascript:alert(1)" },
          first.token
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(
          "me",
          "PATCH",
          {
            name: "After",
            avatarUrl: "https://example.com/photo.png",
          },
          first.token
        )
      ).status
    ).toBe(200);
    const saved = await (
      await request("me", "GET", undefined, first.token)
    ).json();
    expect(saved.user).toMatchObject({
      id: first.user.id,
      name: "After",
      avatarUrl: "https://example.com/photo.png",
      verified: false,
    });
    expect(
      (await (await request("me", "GET", undefined, second.token)).json()).user
        .name
    ).toBe("Unchanged");
    await request("me", "PATCH", { name: "After", avatarUrl: "" }, first.token);
    expect(
      (await (await request("me", "GET", undefined, first.token)).json()).user
        .avatarUrl
    ).toBeUndefined();
  });
});

describe("reviewer accent colors", () => {
  it("persists colors on identities and comments, rejects invalid colors, and preserves omitted colors", async () => {
    const session = await (
      await request("auth/guest", "POST", { name: "Color reviewer" })
    ).json();
    const created = await (
      await request(
        "threads",
        "POST",
        { page: "/accent", anchor, body: "Accent test" },
        session.token
      )
    ).json();
    for (const accentColor of ["red", "#abc", "#123456; color:red", 123]) {
      expect(
        (
          await request(
            "me",
            "PATCH",
            { name: "Color reviewer", avatarUrl: "", accentColor },
            session.token
          )
        ).status
      ).toBe(400);
    }
    expect(
      (
        await request(
          "me",
          "PATCH",
          { name: "Color reviewer", avatarUrl: "", accentColor: "#AABBCC" },
          session.token
        )
      ).status
    ).toBe(200);
    await request(
      "me",
      "PATCH",
      { name: "Renamed", avatarUrl: "" },
      session.token
    );
    expect(
      (await (await request("me", "GET", undefined, session.token)).json()).user
        .accentColor
    ).toBe("#aabbcc");
    const list = await (
      await request("threads", "GET", undefined, session.token)
    ).json();
    expect(
      list.threads.find((thread: Thread) => thread.id === created.id)
        .comments[0].author.accentColor
    ).toBe("#aabbcc");
  });
});

describe("workspace ownership and hosted limits", () => {
  it("reports unlimited self-hosted usage and counts only connected configured projects", async () => {
    const guest = await (
      await request("auth/guest", "POST", { name: "Usage reviewer" })
    ).json();
    const usage = await (
      await request("usage", "GET", undefined, guest.token)
    ).json();
    expect(usage.hosted).toBe(false);
    expect(usage.projects).toEqual({ used: 1, limit: null });
    expect(usage.comments.limit).toBeNull();
    expect(usage.comments.used).toBeGreaterThanOrEqual(0);
    const owned = await (
      await request(
        "usage",
        "GET",
        undefined,
        "owned-token",
        "shared",
        "owner/site",
        "owned"
      )
    ).json();
    expect(owned.projects).toEqual({ used: 2, limit: null });
    expect(owned.comments.limit).toBe(1);
  });

  it("reports private account and shared project usage, then enforces the 250 boundary", async () => {
    const usage = (token?: string) =>
      request(
        "usage",
        "GET",
        undefined,
        token,
        "shared",
        "owner/site",
        "usage-project"
      );
    expect((await usage()).status).toBe(401);
    expect(await (await usage("usage-owner-token")).json()).toEqual({
      hosted: true,
      projects: { used: 1, limit: 3 },
      comments: { used: 249, limit: 250 },
    });
    const guest = await (
      await request(
        "auth/guest",
        "POST",
        { name: "Reviewer" },
        undefined,
        "shared",
        "owner/site",
        "usage-project"
      )
    ).json();
    expect((await (await usage(guest.token)).json()).projects).toBeNull();
    const writes = await Promise.all(
      [1, 2].map((i) =>
        request(
          "threads",
          "POST",
          { body: `Last comment ${i}`, page: "/", anchor },
          "usage-owner-token",
          "shared",
          "owner/site",
          "usage-project"
        )
      )
    );
    expect(writes.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await (await usage("usage-owner-token")).json()).comments).toEqual({
      used: 250,
      limit: 250,
    });
    expect((await request("usage", "GET", undefined, guest.token)).status).toBe(
      401
    );
  });

  it("blocks guests until a Google owner claims the self-hosted workspace", async () => {
    expect(
      (
        await request(
          "auth/guest",
          "POST",
          { name: "Guest" },
          undefined,
          "shared",
          "owner/site",
          "unclaimed"
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          "owner/claim",
          "POST",
          { key: "test-owner-key" },
          "guest-claim-token",
          "shared",
          "owner/site",
          "unclaimed"
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          "owner/claim",
          "POST",
          { key: "wrong" },
          "claim-token",
          "shared",
          "owner/site",
          "unclaimed"
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          "owner/claim",
          "POST",
          { key: "test-owner-key" },
          "claim-token",
          "shared",
          "owner/site",
          "unclaimed"
        )
      ).status
    ).toBe(200);
    expect(
      (
        await request(
          "owner/claim",
          "POST",
          { key: "test-owner-key" },
          "claim-token",
          "shared",
          "owner/site",
          "unclaimed"
        )
      ).status
    ).toBe(409);
    expect(
      (
        await request(
          "auth/guest",
          "POST",
          { name: "Guest" },
          undefined,
          "shared",
          "owner/site",
          "unclaimed"
        )
      ).status
    ).toBe(201);
  });
  it("atomically enforces the stored comment cap", async () => {
    const results = await Promise.all(
      [1, 2].map((i) =>
        request(
          "threads",
          "POST",
          { body: `Feedback ${i}`, page: "/", anchor },
          "owned-token",
          "shared",
          "owner/site",
          "owned"
        )
      )
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const list = (await (
      await request(
        "threads",
        "GET",
        undefined,
        undefined,
        "shared",
        "owner/site",
        "owned"
      )
    ).json()) as { threads: Thread[] };
    expect(list.threads).toHaveLength(1);
  });
  it("creates hosted workspaces only for Google owners and limits projects", async () => {
    const start = async () =>
      (await (
        await request("setup/start", "POST", {
          repo: "owner/site",
          origins: [origin, "https://unverified.example"],
        })
      ).json()) as { id: string; secret: string };
    const first = await start();
    expect(
      (
        await request(
          "setup/complete",
          "POST",
          { code: first.id },
          "guest-management-token",
          "shared",
          "_komo",
          "_komo"
        )
      ).status
    ).toBe(403);
    expect(
      (await request("setup/poll", "POST", { id: first.id, secret: "wrong" }))
        .status
    ).toBe(404);
    for (let i = 0; i < 4; i++) {
      const setup = i === 0 ? first : await start();
      const result = await request(
        "setup/complete",
        "POST",
        { code: setup.id },
        "owner-token",
        "shared",
        "_komo",
        "_komo"
      );
      expect(result.status).toBe(i < 3 ? 201 : 409);
      if (i === 0) {
        const poll = (await (
          await request("setup/poll", "POST", {
            id: setup.id,
            secret: setup.secret,
          })
        ).json()) as { project: string };
        expect(poll.project).toMatch(/^komo_/);
        const reviewer = await (
          await request(
            "auth/guest",
            "POST",
            { name: "New project reviewer" },
            undefined,
            "shared",
            "owner/site",
            poll.project
          )
        ).json();
        expect(
          (
            await (
              await request(
                "usage",
                "GET",
                undefined,
                reviewer.token,
                "shared",
                "owner/site",
                poll.project
              )
            ).json()
          ).comments
        ).toEqual({ used: 0, limit: 250 });
        const api = new URL(`http://localhost:${port}/config`);
        api.searchParams.set("project", poll.project);
        expect(
          (
            await fetch(api, {
              headers: { Origin: "https://unverified.example" },
            })
          ).status
        ).toBe(403);
        const manage = (
          path: string,
          token = "owner-token",
          method = "GET",
          data?: unknown
        ) => request(path, method, data, token, "shared", "_komo", "_komo");
        expect(
          (
            await manage(
              `workspace?workspace=${poll.project}`,
              "guest-management-token"
            )
          ).status
        ).toBe(403);
        expect((await manage("workspace?workspace=usage-project")).status).toBe(
          403
        );
        expect((await manage("usage?workspace=usage-project")).status).toBe(
          403
        );
        expect((await manage(`usage?workspace=${poll.project}`)).status).toBe(
          200
        );
        expect(
          (
            await manage("workspace/sites", "guest-management-token", "POST", {
              project: poll.project,
              origin: "https://unverified.example",
            })
          ).status
        ).toBe(403);
        expect(
          (
            await manage("workspace/sites", "owner-token", "POST", {
              project: "usage-project",
              origin: "https://unverified.example",
            })
          ).status
        ).toBe(403);
        for (const invalid of [
          "http://example.com",
          "https://*.example.com",
          "https://example.com/path",
        ]) {
          expect(
            (
              await manage("workspace/sites", "owner-token", "POST", {
                project: poll.project,
                origin: invalid,
              })
            ).status
          ).toBe(400);
        }
        expect(
          (
            await manage("workspace/sites", "owner-token", "POST", {
              project: poll.project,
              origin: "https://unverified.example",
            })
          ).status
        ).toBe(200);
        expect(
          (
            await fetch(api, {
              headers: { Origin: "https://unverified.example" },
            })
          ).status
        ).toBe(200);
        expect(
          (await (await manage(`workspace?workspace=${poll.project}`)).json())
            .sites
        ).toEqual(["https://unverified.example"]);
        // Configured projects use the same approve page.
        expect(
          (
            await manage("workspace/sites", "owner-token", "POST", {
              project: "owned",
              origin: "https://approved.example",
            })
          ).status
        ).toBe(200);
        expect(
          (await (await manage("workspace?workspace=owned")).json()).sites
        ).toContain("https://approved.example");
        const sameSite = new URL(
          `http://localhost:${port}/workspace?workspace=${poll.project}&project=_komo`
        );
        expect(
          (
            await fetch(sameSite, {
              headers: {
                Authorization: "Bearer owner-token",
                "Sec-Fetch-Site": "same-origin",
              },
            })
          ).status
        ).toBe(200);
        expect(
          (
            await fetch(sameSite, {
              headers: {
                Authorization: "Bearer owner-token",
                "Sec-Fetch-Site": "cross-site",
              },
            })
          ).status
        ).toBe(403);
        expect(
          (
            await request(
              "setup/complete",
              "POST",
              { code: setup.id },
              "owner-token",
              "shared",
              "_komo",
              "_komo"
            )
          ).status
        ).toBe(409);
      }
    }
  });
});

it("runs the agent CLI against the real Worker and persisted threads", async () => {
  const session = await (
    await request(
      "/auth/guest",
      "POST",
      { name: "CLI fixture" },
      undefined,
      "shared",
      "owner/site",
      "cli"
    )
  ).json();
  const cliRoot = join(directory, "cli-project");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cliRoot, ".komo"), { recursive: true });
  await mkdir(join(cliRoot, "nested"));
  await writeFile(
    join(cliRoot, ".komo/project.json"),
    JSON.stringify({
      project: "cli",
      endpoint: `http://localhost:${port}`,
      origin,
      repo: "owner/site",
      scope: "project",
    })
  );
  await writeFile(join(cliRoot, "anchor.json"), JSON.stringify(anchor));
  const cli = async (...args: string[]) => {
    const result = await promisify(execFile)(
      process.execPath,
      [join(root, "packages/komo/cli/index.mjs"), ...args],
      {
        cwd: join(cliRoot, "nested"),
        env: {
          ...process.env,
          KOMO_TOKEN: session.token,
          KOMO_CONFIG_HOME: join(directory, "credentials"),
          KOMO_BRANCH: "shared",
        },
      }
    );
    return JSON.parse(result.stdout);
  };
  const created = await cli(
    "comments",
    "create",
    "--page",
    "/cli",
    "--anchor-file",
    "../anchor.json",
    "--body",
    "Make the hero clearer."
  );
  const threadId = created.data.id;
  expect(created.scope.branch).toBe("shared");
  await cli("comments", "tag", threadId, "nav");
  await cli("comments", "tag", threadId, "temporary");
  expect((await cli("comments", "untag", threadId, "temporary")).data.tags).toEqual(["nav"]);
  const listing = await cli("comments", "list", "--page", "/cli");
  expect(listing.data.threads.map((thread: Thread) => thread.id)).toContain(
    threadId
  );
  expect(
    (await cli("comments", "list", "--page", "/cli", "--tag", "nav"))
      .data.threads.map((thread: Thread) => thread.id)
  ).toContain(threadId);
  const reply = await cli(
    "comments",
    "reply",
    threadId,
    "--body",
    "Fixed and checked."
  );
  await cli(
    "comments",
    "edit",
    threadId,
    reply.data.id,
    "--body",
    "Fixed and checked on mobile."
  );
  await cli("comments", "react", threadId, reply.data.id, "--emoji", "👍");
  const prompt = await cli("comments", "prompt", "--page", "/cli", "--json");
  expect(prompt.data.prompt).toContain("Fixed and checked on mobile.");
  expect(prompt.data.prompt).toContain('Scope: "/cli"');
  await cli("comments", "resolve", threadId);
  expect((await cli("comments", "list")).data.threads).toHaveLength(0);
  expect((await cli("comments", "prompt", "--json")).data.prompt).toBe(
    "No open comments."
  );
  await cli("comments", "reopen", threadId);
  await cli("comments", "move", threadId, "--anchor-file", "../anchor.json");
  expect((await cli("comments", "get", threadId)).data.anchor.unstacked).toBe(
    true
  );
  await cli("comments", "delete", threadId, reply.data.id);
  expect(
    (await cli("comments", "get", threadId)).data.comments.find(
      (comment: { id: string; body: string }) => comment.id === reply.data.id
    )?.body
  ).toBeUndefined();
});

describe("owner management and private projects", () => {
  const call = (
    path: string,
    method = "GET",
    data?: unknown,
    token = "managed-owner",
    project = "managed"
  ) => request(path, method, data, token, "shared", "owner/site", project);
  it("keeps webhook secrets encrypted and refuses delivery without a secure sender", async () => {
    const secret = "test-signing-secret-0123456789abcdef";
    expect((await call("/project/webhook")).status).toBe(200);
    const saved = await call("/project/webhook", "PATCH", {
      url: "https://hooks.example.com/komo",
      secret,
      events: ["comment.created", "comment.replied"],
      enabled: false,
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(secret);
    const settings = await (await call("/project/webhook")).json();
    expect(settings).toMatchObject({
      url: "https://hooks.example.com/komo",
      events: ["comment.created", "comment.replied"],
      enabled: false,
      secretConfigured: true,
      deliveryAvailable: false,
    });
    expect(JSON.stringify(settings)).not.toContain(secret);
    expect(
      (
        await call("/project/webhook", "PATCH", {
          url: "https://127.0.0.1/hook",
          secret,
          events: ["comment.created"],
          enabled: false,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call("/project/webhook", "PATCH", {
          url: "https://hooks.example.com/komo",
          events: ["comment.created"],
          enabled: true,
        })
      ).status
    ).toBe(503);
  });
  it("enforces invitations, rejects other emails and revokes existing sessions", async () => {
    expect(
      (await call("/project", "GET", undefined, "managed-stranger")).status
    ).toBe(403);
    expect(
      (await call("/project", "PATCH", { access: "private" })).status
    ).toBe(200);
    expect((await call("/threads", "GET", undefined, "")).status).toBe(401);
    expect(
      (await call("/threads", "GET", undefined, "managed-stranger")).status
    ).toBe(403);
    expect(
      (await call("/usage", "GET", undefined, "managed-stranger")).status
    ).toBe(403);
    expect(
      (await call("/auth/guest", "POST", { name: "Guest" }, "")).status
    ).toBe(403);
    expect((await call("/threads")).status).toBe(200);
    const invitation = await (
      await call("/project/invites", "POST", { email: "member@example.com" })
    ).json();
    expect(invitation.url).toContain("#invite=");
    expect(
      (
        await call(
          "/project/join",
          "POST",
          { invite: invitation.invite },
          "managed-stranger"
        )
      ).status
    ).toBe(403);
    expect(
      (
        await call(
          "/project/join",
          "POST",
          { invite: invitation.invite },
          "managed-member"
        )
      ).status
    ).toBe(200);
    expect(
      (
        await call(
          "/project/join",
          "POST",
          { invite: invitation.invite },
          "managed-member"
        )
      ).status
    ).toBe(403);
    expect(
      (await call("/threads", "GET", undefined, "managed-member")).status
    ).toBe(200);
    expect(
      (await call("/project/export", "GET", undefined, "managed-member")).status
    ).toBe(403);
    expect(
      (await call("/project/members", "DELETE", { user: "google:member" }))
        .status
    ).toBe(200);
    expect(
      (await call("/threads", "GET", undefined, "managed-member")).status
    ).toBe(401);
    expect((await call("/project", "PATCH", { access: "public" })).status).toBe(
      200
    );
    expect((await call("/threads", "GET", undefined, "")).status).toBe(200);
  });
  it("exports and imports scoped feedback without credentials or verified identities, and frees quota", async () => {
    const created = await (
      await call("/threads", "POST", {
        page: "/",
        anchor,
        body: "Move this feedback",
      })
    ).json();
    expect(
      (
        await call(`/threads/${created.id}/comments`, "POST", {
          body: "Include my reply",
        })
      ).status
    ).toBe(201);
    await call(`/threads/${created.id}`, "PATCH", { resolved: true });
    const snapshot = await (await call("/project/export?table=threads")).json();
    await call(`/threads/${created.id}/comments`, "POST", {
      body: "New feedback during export",
    });
    expect(
      (
        await call(
          `/project/export?table=comments&revision=${snapshot.revision}`
        )
      ).status
    ).toBe(409);
    const tables: Record<string, unknown[]> = {};
    for (const kind of ["users", "threads", "comments", "reactions"]) {
      const response = await call(`/project/export?table=${kind}`);
      expect(response.status).toBe(200);
      tables[kind] = (await response.json()).rows;
      expect(JSON.stringify(tables[kind])).not.toMatch(
        /token_hash|owner@example.com|expires_at/
      );
      if (!tables[kind].length) continue;
      const imported = await call(
        "/project/import",
        "POST",
        { source: "managed", kind, records: tables[kind] },
        "destination-owner",
        "destination"
      );
      expect(imported.status).toBe(200);
      expect((await imported.json()).imported).toBe(tables[kind].length);
      const retry = await (
        await call(
          "/project/import",
          "POST",
          { source: "managed", kind, records: tables[kind] },
          "destination-owner",
          "destination"
        )
      ).json();
      expect(retry.imported).toBe(0);
    }
    const result = await (
      await call(
        "/threads",
        "GET",
        undefined,
        "destination-owner",
        "destination"
      )
    ).json();
    expect(result.threads).toHaveLength(1);
    expect(
      result.threads[0].comments.map((c: { body: string }) => c.body)
    ).toEqual([
      "Move this feedback",
      "Include my reply",
      "New feedback during export",
    ]);
    expect(result.threads[0].comments[0].author.verified).toBe(false);
    const imported = result.threads[0];
    expect(imported.id).toMatch(/^import:/);
    const cliRead = await promisify(execFile)(process.execPath,
      [join(root, "packages/komo/cli/index.mjs"), "comments", "get", imported.id],
      {cwd: directory, env: {...process.env, KOMO_ENDPOINT: `http://localhost:${port}`, KOMO_PROJECT: "destination", KOMO_REPO: "owner/site", KOMO_BRANCH: "shared", KOMO_ORIGIN: origin, KOMO_TOKEN: "destination-owner"}});
    expect(JSON.parse(cliRead.stdout).data.id).toBe(imported.id);
    const mutateImported = (path: string, method: string, data: unknown) =>
      call(path, method, data, "destination-owner", "destination");
    expect((await mutateImported(`/threads/${imported.id}`, "PATCH", {resolved: false})).status).toBe(200);
    expect((await mutateImported(`/threads/${imported.id}`, "PATCH", {anchor: {...anchor, x: 0.4}})).status).toBe(200);
    expect((await mutateImported(`/threads/${imported.id}/comments`, "POST", {body: "Reply after import"})).status).toBe(201);
    const importedComment = `/threads/${imported.id}/comments/${imported.comments[0].id}`;
    expect((await mutateImported(`${importedComment}/reactions`, "POST", {emoji: "👍", active: true})).status).toBe(200);
    // Import never grants ownership of the historical author's messages.
    expect((await mutateImported(importedComment, "PATCH", {body: "Not mine"})).status).toBe(403);
    expect((await call(`/threads/${imported.id}`, "PATCH", {resolved: true})).status).toBe(404);
    expect((await request(`/threads/${imported.id}`, "PATCH", {resolved: true}, "destination-owner", "other", "owner/site", "destination")).status).toBe(404);

    expect(
      (await call("/project/clear-resolved", "POST", { confirm: "wrong" }))
        .status
    ).toBe(400);
    expect(
      (await call("/project/clear-resolved", "POST", { confirm: "managed" }))
        .status
    ).toBe(200);
    expect((await (await call("/usage")).json()).comments.used).toBe(0);
    expect(
      (
        await (
          await call(
            "/threads",
            "GET",
            undefined,
            "destination-owner",
            "destination"
          )
        ).json()
      ).threads
    ).toHaveLength(1);
  });
  it("cleans only selected resolved threads, preserving open and other-project feedback", async () => {
    const create = async (body: string) =>
      (
        await (
          await call("/threads", "POST", { page: "/cleanup", anchor, body })
        ).json()
      ).id;
    const chosen = await create("Delete this resolved thread");
    const other = await create("Keep this resolved thread");
    const open = await create("Keep this open thread");
    await call(`/threads/${chosen}`, "PATCH", { resolved: true });
    await call(`/threads/${other}`, "PATCH", { resolved: true });
    const destination = (
      await (
        await call(
          "/threads",
          "GET",
          undefined,
          "destination-owner",
          "destination"
        )
      ).json()
    ).threads[0].id;
    const data = { confirm: "managed", threadIds: [chosen, open, destination] };
    expect(
      (await call("/project/clear-resolved", "POST", data, "managed-stranger"))
        .status
    ).toBe(403);
    expect(
      (
        await call("/project/clear-resolved", "POST", {
          confirm: "managed",
          threadIds: [],
        })
      ).status
    ).toBe(400);
    const result = await (
      await call("/project/clear-resolved", "POST", data)
    ).json();
    expect(result.deleted).toBe(1);
    const remaining = (await (await call("/threads")).json()).threads.map(
      (t: { id: string }) => t.id
    );
    expect(remaining).toContain(open);
    expect(remaining).toContain(other);
    expect(remaining).not.toContain(chosen);
    expect(
      (
        await (
          await call(
            "/threads",
            "GET",
            undefined,
            "destination-owner",
            "destination"
          )
        ).json()
      ).threads
    ).toHaveLength(1);
  });
  it("deletes only the confirmed owned workspace and restores its owner slot", async () => {
    expect(
      (await call("/project", "DELETE", { confirm: "destination" })).status
    ).toBe(400);
    expect(
      (
        await call(
          "/project",
          "DELETE",
          { confirm: "destination" },
          "destination-owner",
          "destination"
        )
      ).status
    ).toBe(200);
    expect(
      (await call("/config", "GET", undefined, "", "destination")).status
    ).toBe(404);
    expect((await call("/config")).status).toBe(200);
    const usage = await (await call("/usage")).json();
    expect(usage.projects.used).toBe(1);
  });
});

it("paginates tied timestamps with scoped cursors while preserving offset clients", async () => {
  const read = async (query: string, branch = "pagination") =>
    (await request(`/threads?${query}`, "GET", undefined, undefined, branch)).json();
  const first = await read("authors=1");
  expect(first.threads).toHaveLength(50);
  expect(JSON.parse(first.nextCursor)).toEqual([100, "import:050"]);
  const query = `cursor=${encodeURIComponent(first.nextCursor)}`;
  const next = await read(`${query}&revision=${first.revision}&authors=1`);
  expect(next.threads).toHaveLength(15);
  expect(next.nextCursor).toBeNull();
  const legacy = await read("offset=50&authors=1");
  expect(next.threads).toEqual(legacy.threads);
  expect(new Set([...first.threads, ...next.threads].map(t => t.id)).size).toBe(65);
  expect((await read(query, "no-such-branch")).threads).toEqual([]);
  expect((await read(`revision=${first.revision}`)).notModified).toBe(true);
  for (const cursor of ["bad", "[]", '[1,{}]', '[null,"id"]'])
    expect((await request(`/threads?cursor=${encodeURIComponent(cursor)}`, "GET", undefined, undefined, "pagination")).status).toBe(400);
});

describe("personal access tokens", () => {
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const sql = async (query: string) => {
    const { stdout } = await promisify(execFile)(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        join(directory, "state"),
        "--config",
        join(directory, "wrangler.json"),
        "--json",
        "--command",
        query,
      ],
      { cwd: root, timeout: 45000 }
    );
    return JSON.parse(stdout)[0].results as Record<string, unknown>[];
  };
  const account = (
    path: string,
    method: string,
    session: string | undefined,
    data?: unknown
  ) => request(path, method, data, session, "shared", "owner/site", "_komo");
  const create = async (
    session: string,
    data: Record<string, unknown> = {}
  ) => {
    const response = await account("/account/tokens", "POST", session, {
      name: "CI bot",
      scopes: ["comments:read", "comments:write"],
      expiresInDays: 30,
      ...data,
    });
    return { response, body: (await response.json()) as any };
  };
  const post = (token: string, project: string, text = "From a bot") =>
    request(
      "/threads",
      "POST",
      { page: "/bots", anchor, body: text },
      token,
      "shared",
      "owner/site",
      project
    );
  beforeAll(async () => {
    await sql(
      `INSERT INTO users(id,name,verified) VALUES('google:stranger-pat','Stranger',1);
       INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES('${sha("stranger-pat-session")}','google:stranger-pat','_komo',9999999999999);
       INSERT INTO users(id,name,verified) VALUES('google:pat-misc','Misc',1),('google:pat-cli','CLI',1);
       INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES('${sha("pat-misc-session")}','google:pat-misc','_komo',9999999999999),('${sha("pat-cli-session")}','google:pat-cli','_komo',9999999999999);`
    );
  }, 120000);

  it("serves the account page with a locked-down CSP", async () => {
    const response = await fetch(`http://localhost:${port}/account`);
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy")!;
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)![1];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    const html = await response.text();
    expect(html).toContain("Access tokens");
    expect(html).toContain(`<script nonce="${nonce}">`);
    // The inline client must at least parse.
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
    expect(() => new Script(script)).not.toThrow();
  });

  it("refuses guests and anonymous callers", async () => {
    for (const method of ["GET", "POST"]) {
      const guest = await account(
        "/account/tokens",
        method,
        "guest-management-token",
        method === "POST"
          ? { name: "x", scopes: ["comments:read"] }
          : undefined
      );
      expect(guest.status).toBe(403);
      expect((await guest.json()).error).toContain("Sign in with Google");
      expect(
        (await account("/account/tokens", method, undefined, undefined)).status
      ).toBe(401);
    }
  });

  it("creates, lists, uses and revokes a token without storing it", async () => {
    const { response, body } = await create("owner-token");
    expect(response.status).toBe(201);
    const token = body.token as string;
    expect(token).toMatch(/^komo_pat_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(body.item).toMatchObject({
      name: "CI bot",
      last4: token.slice(-4),
      scopes: ["comments:read", "comments:write"],
      projects: null,
      lastUsedAt: null,
    });
    expect(body.item.expiresAt).toBeGreaterThan(Date.now());

    const listed = await (
      await account("/account/tokens", "GET", "owner-token")
    ).json();
    const item = listed.tokens.find((t: any) => t.id === body.item.id);
    expect(item.prefix).toBe(`komo_pat_${body.item.id}`);
    expect(JSON.stringify(listed)).not.toContain(token.slice(-43));
    expect(listed.projects).toEqual(
      expect.arrayContaining(["other", "owned"])
    );

    const me = await request("/me", "GET", undefined, token, "shared", "owner/site", "test");
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe("google:fixture");

    // Nothing at rest contains the token or its secret.
    const secret = token.slice(-43);
    const rows = await sql(
      `SELECT * FROM personal_access_tokens WHERE id='${body.item.id}'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].last_used_at).not.toBeNull();
    const everything = JSON.stringify([
      rows,
      await sql("SELECT * FROM audit_log"),
      await sql("SELECT * FROM sessions"),
      await sql("SELECT * FROM rate_limits"),
    ]);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(token);

    // Use is audit-logged at most once a minute per token.
    for (let i = 0; i < 3; i++)
      await request("/me", "GET", undefined, token, "shared", "owner/site", "test");
    const audit = await sql(
      `SELECT action FROM audit_log WHERE target='${body.item.id}' ORDER BY at`
    );
    expect(audit.map((row) => row.action)).toEqual([
      "token.create",
      "token.use",
    ]);

    expect(
      (await account(`/account/tokens/${body.item.id}`, "DELETE", "owner-token")).status
    ).toBe(200);
    expect(
      (await account(`/account/tokens/${body.item.id}`, "DELETE", "owner-token")).status
    ).toBe(404);
    const after = await (
      await account("/account/tokens", "GET", "owner-token")
    ).json();
    expect(after.tokens.some((t: any) => t.id === body.item.id)).toBe(false);
    const revoked = await request("/me", "GET", undefined, token, "shared", "owner/site", "test");
    expect(revoked.status).toBe(401);
    expect(
      (await sql(`SELECT action FROM audit_log WHERE target='${body.item.id}' ORDER BY at`)).map(
        (row) => row.action
      )
    ).toContain("token.revoke");
  });

  it("rejects bad, expired, and other users' tokens", async () => {
    const { body } = await create("pat-misc-session", { name: "Short lived" });
    const token = body.token as string;
    const use = (value: string) =>
      request("/me", "GET", undefined, value, "shared", "owner/site", "test");
    expect((await use(token)).status).toBe(200);
    expect((await use(`${token.slice(0, -4)}AAAA`)).status).toBe(401);
    expect((await use("komo_pat_garbage")).status).toBe(401);
    expect(
      (await use(`komo_pat_${"x".repeat(12)}_${"y".repeat(43)}`)).status
    ).toBe(401);
    await sql(
      `UPDATE personal_access_tokens SET expires_at=1 WHERE id='${body.item.id}'`
    );
    const expired = await use(token);
    expect(expired.status).toBe(401);
    expect((await expired.json()).error).toContain("expired");
    const listed = await (
      await account("/account/tokens", "GET", "pat-misc-session")
    ).json();
    expect(
      listed.tokens.find((t: any) => t.id === body.item.id).expired
    ).toBe(true);
    // Another user cannot revoke it.
    expect(
      (await account(`/account/tokens/${body.item.id}`, "DELETE", "owner-token")).status
    ).toBe(404);
  });

  it("enforces scopes and keeps tokens away from account management", async () => {
    const readOnly = (await create("owner-token", { name: "reader", scopes: ["comments:read"] })).body.token;
    const writer = (await create("owner-token", { name: "writer", scopes: ["comments:write"] })).body.token;
    const denied = await post(readOnly, "test");
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toContain("comments:write");
    const written = await post(writer, "test", "Written by a token");
    expect(written.status).toBe(201);
    const { id } = await written.json();
    const edited = (token: string) =>
      request(`/threads/${id}`, "PATCH", { resolved: true }, token, "shared", "owner/site", "test");
    expect((await edited(readOnly)).status).toBe(403);
    expect((await edited(writer)).status).toBe(200);
    // Comments written by a token belong to its owner.
    const read = await (
      await request("/threads", "GET", undefined, readOnly, "shared", "owner/site", "test")
    ).json();
    expect(
      read.threads.find((t: any) => t.id === id).comments[0].author.id
    ).toBe("google:fixture");

    // Tokens cannot mint tokens, edit profiles, or reach management routes.
    for (const [path, method, data] of [
      ["/account/tokens", "POST", { name: "x", scopes: ["comments:read"] }],
      ["/account/tokens", "GET", undefined],
    ] as const)
      expect((await account(path, method, writer, data)).status).toBe(403);
    expect(
      (await request("/me", "PATCH", { name: "Hijack", avatarUrl: "" }, writer, "shared", "owner/site", "test")).status
    ).toBe(403);
    expect(
      (await request("/usage", "GET", undefined, writer, "shared", "owner/site", "test")).status
    ).toBe(403);
    expect(
      (await request("/me", "DELETE", undefined, writer, "shared", "owner/site", "test")).status
    ).toBe(403);
    expect(
      (await account("/account/tokens", "POST", writer, { name: "x", scopes: ["comments:read"] })).status
    ).toBe(403);
  });

  it("limits tokens to selected projects and to the owner's own access", async () => {
    const limited = (
      await create("owner-token", { name: "other only", projects: ["other"] })
    ).body;
    expect(limited.item.projects).toEqual(["other"]);
    expect((await post(limited.token, "other")).status).toBe(201);
    const wrong = await post(limited.token, "test");
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error).toContain("project");
    expect(
      (await create("owner-token", { projects: ["test"] })).response.status
    ).toBe(400);
    expect(
      (await create("owner-token", { projects: ["nope"] })).response.status
    ).toBe(400);
    for (const bad of [
      { scopes: [] },
      { scopes: ["admin"] },
      { name: "" },
      { expiresInDays: 9999 },
      { expiresInDays: "soon" },
    ])
      expect((await create("stranger-pat-session", bad)).response.status).toBe(400);

    // A token never exceeds its owner: private projects still need an invite.
    await sql(
      `INSERT INTO project_settings(project,access) VALUES('demo','private');
       INSERT INTO project_access(project,user_id) VALUES('demo','google:fixture');`
    );
    try {
      const owner = (await create("owner-token", { name: "private reader", scopes: ["comments:read"] })).body.token;
      const stranger = (await create("stranger-pat-session", { name: "stranger", scopes: ["comments:read"] })).body.token;
      const writeOnly = (await create("owner-token", { name: "no read", scopes: ["comments:write"] })).body.token;
      const read = (token: string) =>
        request("/threads", "GET", undefined, token, "shared", "owner/site", "demo");
      expect((await read(owner)).status).toBe(200);
      expect((await read(stranger)).status).toBe(403);
      expect((await read(writeOnly)).status).toBe(403);
      expect((await request("/threads", "GET", undefined, undefined, "shared", "owner/site", "demo")).status).toBe(401);
    } finally {
      await sql(
        `DELETE FROM project_access WHERE project='demo'; DELETE FROM project_settings WHERE project='demo';`
      );
    }
  });

  it("rate-limits token creation", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (await create("manage-control", { name: `bot ${i}`, scopes: ["comments:read"] })).response.status
      );
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statuses[10]).toBe(429);
  });

  it("signs in the CLI with a stdin token, whoami, logout, and env precedence", async () => {
    const created = (await create("pat-cli-session", { name: "CLI bot" })).body;
    const token = created.token as string;
    const other = (await create("pat-cli-session", { name: "Env bot" })).body.token as string;
    const home = join(directory, "pat-credentials");
    const project = join(directory, "pat-project");
    const { mkdir, readdir, stat } = await import("node:fs/promises");
    await mkdir(join(project, ".komo"), { recursive: true });
    await writeFile(
      join(project, ".komo/project.json"),
      JSON.stringify({
        project: "cli",
        endpoint: `http://localhost:${port}`,
        origin,
        repo: "owner/site",
        scope: "project",
      })
    );
    const cli = (args: string[], stdin?: string, env: Record<string, string> = {}) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          [join(root, "packages/komo/cli/index.mjs"), ...args],
          {
            cwd: project,
            env: { ...process.env, KOMO_TOKEN: "", KOMO_CONFIG_HOME: home, KOMO_BRANCH: "shared", ...env },
          }
        );
        let stdout = "", stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(stdin ?? "");
      });

    // A token on the command line is refused and never saved.
    for (const args of [
      ["login", "--token", token],
      ["login", `--token=${token}`],
      ["login", token],
    ]) {
      const refused = await cli(args);
      expect(refused.code).not.toBe(0);
      expect(refused.stderr).toContain("stdin");
    }
    expect(await readdir(home).catch(() => [])).toEqual([]);
    // A bad token on stdin is verified against the API and not saved.
    const bad = await cli(["login", "--token"], `komo_pat_${"a".repeat(12)}_${"b".repeat(43)}\n`);
    expect(bad.code).not.toBe(0);
    expect(await readdir(home).catch(() => [])).toEqual([]);
    expect((await cli(["login", "--token"], "not-a-token")).code).not.toBe(0);

    const login = await cli(["login", "--token"], `${token}\n`);
    expect(login.code).toBe(0);
    expect(JSON.parse(login.stdout).data.user.id).toBe("google:pat-cli");
    expect(login.stdout + login.stderr).not.toContain(token.slice(-43));
    const [file] = await readdir(home);
    expect(file).toMatch(/^pat-[0-9a-f]{64}\.json$/);
    expect((await stat(join(home, file))).mode & 0o777).toBe(0o600);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(join(home, file), "utf8")).token).toBe(token);

    const whoami = JSON.parse((await cli(["whoami"])).stdout);
    expect(whoami.data).toMatchObject({ auth: "token", user: { id: "google:pat-cli" } });
    expect((await cli(["comments", "list"])).code).toBe(0);

    // Stored token beats a login session; KOMO_TOKEN beats both.
    const sessionFile = join(
      home,
      `${sha(`http://localhost:${port}\ncli`)}.json`
    );
    await writeFile(sessionFile, JSON.stringify({ token: "stale-session" }));
    expect(JSON.parse((await cli(["whoami"])).stdout).data.auth).toBe("token");
    const envWho = await cli(["whoami"], undefined, { KOMO_TOKEN: other });
    expect(JSON.parse(envWho.stdout).data.auth).toBe("env");
    const brokenEnv = await cli(["whoami"], undefined, {
      KOMO_TOKEN: `komo_pat_${"c".repeat(12)}_${"d".repeat(43)}`,
    });
    expect(brokenEnv.code).not.toBe(0);
    expect(brokenEnv.stderr).toContain("invalid, expired, or revoked");

    // Revoking on the server fails the CLI with a clear message.
    await account(`/account/tokens/${created.item.id}`, "DELETE", "pat-cli-session");
    const revoked = await cli(["whoami"]);
    expect(revoked.code).not.toBe(0);
    expect(revoked.stderr).toContain("revoked");

    const logout = await cli(["logout"]);
    expect(logout.code).toBe(0);
    expect(await readdir(home)).toEqual([]);
    const after = await cli(["whoami"]);
    expect(after.code).not.toBe(0);
    expect(after.stderr).toContain("Not signed in");
  });
});
