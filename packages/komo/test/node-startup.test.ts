// Boots server/node.ts the way dist/node.mjs runs and checks what startup
// accepts and refuses.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

const connection = process.env.KOMO_TEST_POSTGRES_URL;
// Built next to server/postgres so the bundle finds its migrations, as
// dist/node.mjs finds dist/postgres.
const entry = fileURLToPath(new URL(`../server/.node-startup-${crypto.randomUUID()}.mjs`, import.meta.url));
const schema = `komo_test_${crypto.randomUUID().replaceAll("-", "")}`;
let admin: Pool | undefined;

beforeAll(async () => {
  await build({
    entryPoints: [fileURLToPath(new URL("../server/node.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    loader: { ".txt": "text" },
    outfile: entry,
    logLevel: "silent",
  });
  if (connection) {
    admin = new Pool({ connectionString: connection });
    await admin.query(`CREATE SCHEMA ${schema}`);
  }
});
afterAll(async () => {
  await rm(entry, { force: true });
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
function start(env: Record<string, string>) {
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH ?? "", PUBLIC_URL: "http://localhost:8080", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  return { child, exited, output: () => output };
}
// Nothing listens here: these checks must fail before connecting.
const unreachable = "postgres://komo:komo@127.0.0.1:1/komo";

it("names the project and origin of an invalid PROJECTS pattern", async () => {
  const server = start({
    DATABASE_URL: unreachable,
    PROJECTS: JSON.stringify({ review: { repo: "team/site", origins: ["https://dev.example.com:4*"] } }),
  });
  expect(await server.exited).not.toBe(0);
  expect(server.output()).toContain('PROJECTS.review has an invalid origin "https://dev.example.com:4*"');
});

it("refuses an unknown sign-in proxy before touching the database", async () => {
  const server = start({
    DATABASE_URL: unreachable,
    PROJECTS: JSON.stringify({ review: { repo: "team/site", origins: ["https://dev.example.com"] } }),
    KOMO_PROXY_AUTH: "other-proxy",
    KOMO_PROXY_AUDIENCE: "/projects/1/global/backendServices/2",
  });
  expect(await server.exited).not.toBe(0);
  expect(server.output()).toContain('PALETTE_PROXY_AUTH "other-proxy" is not supported. Use one of: gcp-iap.');
});

it("refuses conflicting proxy hop counts", async () => {
  const server = start({
    DATABASE_URL: unreachable,
    PROJECTS: JSON.stringify({ review: { repo: "team/site", origins: ["https://dev.example.com"] } }),
    KOMO_PROXY_HOPS: "2",
    KOMO_TRUSTED_PROXY_HOPS: "3",
  });
  expect(await server.exited).not.toBe(0);
  expect(server.output()).toContain("PALETTE_TRUSTED_PROXY_HOPS and PALETTE_PROXY_HOPS are set to different values.");
});

(connection ? it : it.skip)("boots with a wildcard-port origin and allows it", async () => {
  const url = new URL(connection!);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const port = await freePort();
  const server = start({
    DATABASE_URL: url.href,
    PORT: String(port),
    PROJECTS: JSON.stringify({ review: { repo: "team/site", origins: ["https://dev.example.com:*", "http://localhost:*"] } }),
  });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      ready = await fetch(`http://localhost:${port}/health`).then((r) => r.ok, () => false);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(ready, server.output()).toBe(true);
    const config = (site: string) =>
      fetch(`http://localhost:${port}/config?project=review`, { headers: { Origin: site } });
    for (const site of ["https://dev.example.com:3000", "https://dev.example.com"]) {
      const allowed = await config(site);
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(site);
    }
    expect((await config("https://dev.example.com.evil.test:3000")).status).toBe(403);
  } finally {
    server.child.kill("SIGTERM");
    await server.exited;
  }
});
