import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authPrefix, publicLocation } from "../server/iap";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "http://localhost:4321";
const audience = "/projects/123/global/backendServices/456";
// The Lab serves komo at /komo behind a proxy that strips it, with sign-in
// under the IAP-protected /backoffice prefix.
const publicPath = "/komo";
const prefix = "/backoffice";
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
let directory = "",
  worker: ChildProcess | undefined,
  port = 0,
  output = "",
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
  directory = await mkdtemp(join(tmpdir(), "komo-iap-test-"));
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
    await readFile(
      new URL("../server/wrangler.jsonc", import.meta.url),
      "utf8",
    ),
  );
  config.name = "komo-iap-test";
  const apiPath = fileURLToPath(new URL("../server/index.ts", import.meta.url));
  config.main = join(directory, "worker.ts");
  // Serve the test key as IAP's published JWK set; everything else is real.
  await writeFile(
    config.main,
    `
    import api from ${JSON.stringify(apiPath)};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input) === "https://www.gstatic.com/iap/verify/public_key-jwk"
        ? Response.json({ keys: [${JSON.stringify(jwk)}] })
        : originalFetch(input, init);
    export default api;
  `,
  );
  delete config.account_id;
  config.vars.PROJECTS = JSON.stringify({
    test: { repo: "owner/site", origins: [origin], allowGuests: false },
  });
  config.vars.KOMO_IAP_AUDIENCE = audience;
  config.vars.KOMO_AUTH_PREFIX = prefix;
  config.vars.KOMO_PUBLIC_PATH = publicPath;
  config.d1_databases = [
    {
      binding: "DB",
      database_name: "iap",
      database_id: "iap",
      migrations_dir: fileURLToPath(
        new URL("../server/migrations", import.meta.url),
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
    { cwd: root, timeout: 45000 },
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
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  worker.stdout?.on("data", (chunk) => (output += String(chunk)));
  worker.stderr?.on("data", (chunk) => (output += String(chunk)));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/health`)).ok) return;
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

describe("IAP sign-in", () => {
  it("offers only Google sign-in and refuses anonymous reads and guests", async () => {
    expect(await (await request("config")).json()).toMatchObject({
      google: true,
      guests: false,
    });
    expect((await request("threads")).status).toBe(401);
    expect(
      (await request("auth/guest", "POST", { data: { name: "Guest" } })).status,
    ).toBe(403);
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
    // Sign-in handlers exist only under the IAP prefix.
    expect(
      (await fetch(`http://localhost:${port}/auth/google/authorize?state=x`, {
        headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
      })).status,
    ).toBe(404);
    expect(
      (await fetch(`http://localhost:${port}/auth/iap/session?project=test`, {
        method: "POST",
        headers: { "x-goog-iap-jwt-assertion": await iapJwt() },
      })).status,
    ).toBe(404);
    expect((await fetch(`http://localhost:${port}${prefix}/anything`)).status).toBe(404);
  });

  it("issues a session from the popup only with a valid IAP assertion", async () => {
    expect((await popupSignIn("")).status).toBe(401);
    expect(
      (await popupSignIn(await iapJwt({}, otherKey.privateKey))).status,
    ).toBe(401);
    expect(
      (
        await popupSignIn(
          await iapJwt({ aud: "/projects/1/global/backendServices/2" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await popupSignIn(
          await iapJwt({ exp: Math.floor(Date.now() / 1000) - 1 }),
        )
      ).status,
    ).toBe(401);

    const page = await popupSignIn(await iapJwt());
    expect(page.status).toBe(200);
    const html = await page.text();
    const message = JSON.parse(
      html.match(/postMessage\((\{.*?\}),"http:\/\/localhost:4321"\)/)![1],
    );
    expect(message).toMatchObject({
      type: "branch-comments:auth",
      user: { id: "google:1234567890", name: "reviewer", verified: true },
    });

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

  it("gives agents a project session from their IAP identity", async () => {
    const url = `http://localhost:${port}${prefix}/auth/iap/session?project=test`;
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-iap-jwt-assertion": await iapJwt({
          sub: "accounts.google.com:999",
          email: "agent@example-project.iam.gserviceaccount.com",
        }),
      },
    });
    expect(response.status).toBe(201);
    const { token, user } = await response.json();
    expect(user).toMatchObject({ id: "google:999", verified: true });
    expect((await request("threads", "GET", { token })).status).toBe(200);
  });
});

describe("IAP configuration", () => {
  it("parses PUBLIC_URL with an optional path", () => {
    expect(publicLocation("https://labs.example.com")).toEqual({ origin: "https://labs.example.com", path: "" });
    expect(publicLocation("https://labs.example.com/komo/")).toEqual({ origin: "https://labs.example.com", path: "/komo" });
    expect(publicLocation("http://localhost:8080")).toEqual({ origin: "http://localhost:8080", path: "" });
    for (const bad of ["http://labs.example.com", "https://labs.example.com/komo?x=1", "https://user:pw@labs.example.com", "https://labs.example.com/ko mo"])
      expect(() => publicLocation(bad)).toThrow("PUBLIC_URL");
  });
  it("validates the sign-in prefix", () => {
    expect(authPrefix(undefined)).toBe("");
    expect(authPrefix("/backoffice/")).toBe("/backoffice");
    for (const bad of ["backoffice", "/back office", "/../x?"]) expect(() => authPrefix(bad)).toThrow("KOMO_AUTH_PREFIX");
  });
});
