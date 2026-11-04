import { createServer } from "node:http";
import { Readable } from "node:stream";
import { loadPostgres, postgresDatabase } from "./postgres";
import worker from "./index";
import { sendWebhookPinned } from "./node-webhooks";
import { authOptions, publicLocation } from "./proxy-auth";
import { checkProjects, clientAddress, trustedProxyHops } from "./node-config";

const databaseUrl = process.env.DATABASE_URL;
const projects = process.env.PROJECTS;
const publicUrl = process.env.PUBLIC_URL;
if (!databaseUrl || !projects || !publicUrl)
  throw Error("DATABASE_URL, PUBLIC_URL, and PROJECTS are required");
// PUBLIC_URL may include a path (https://example.com/palette) when a proxy serves
// the app under it; requests are accepted with or without that path.
const { origin: publicOrigin, path: publicPath } = publicLocation(publicUrl);
checkProjects(projects);
const proxyHops = trustedProxyHops(process.env);
const db = postgresDatabase(databaseUrl, await loadPostgres());
// Each setting is read as PALETTE_<name>, then by its older KOMO_<name>.
const option = (name: string) =>
  process.env[`PALETTE_${name}`] || process.env[`KOMO_${name}`] || undefined;
const env = {
  DB: db,
  PROJECTS: projects,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
  PALETTE_WEBHOOK_KEYS: process.env.PALETTE_WEBHOOK_KEYS ?? process.env.KOMO_WEBHOOK_KEYS,
  PALETTE_TOKEN_PEPPER: option("TOKEN_PEPPER"),
  PALETTE_WEBHOOK_SEND: sendWebhookPinned,
  PALETTE_PROXY_AUTH: option("PROXY_AUTH"),
  PALETTE_PROXY_AUDIENCE: option("PROXY_AUDIENCE"),
  PALETTE_IAP_AUDIENCE: option("IAP_AUDIENCE"),
  PALETTE_AUTH_PATH_PREFIX: option("AUTH_PATH_PREFIX"),
  PALETTE_AUTH_PREFIX: option("AUTH_PREFIX"),
  PALETTE_REQUIRE_SESSION_FOR_READS: option("REQUIRE_SESSION_FOR_READS"),
  PALETTE_ALLOW_GUESTS: option("ALLOW_GUESTS"),
  PALETTE_SESSION_MAX_AGE_DAYS: option("SESSION_MAX_AGE_DAYS"),
  PALETTE_PUBLIC_PATH: publicPath || undefined,
} as unknown as Env;
// Fail at startup, before touching the database, on an invalid sign-in option.
authOptions(env);
await db.migrate();
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid PORT");
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", publicOrigin);
    if (
      publicPath &&
      (url.pathname === publicPath || url.pathname.startsWith(`${publicPath}/`))
    )
      url.pathname = url.pathname.slice(publicPath.length) || "/";
    if (url.origin !== publicOrigin) {
      outgoing.writeHead(400);
      outgoing.end();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    // Ignore client-supplied Cloudflare IP headers. The API uses this trusted value for rate limits.
    headers.set(
      "CF-Connecting-IP",
      clientAddress(
        incoming.headers["x-forwarded-for"],
        proxyHops,
        incoming.socket.remoteAddress,
      ),
    );
    const request = new Request(url, {
      method: incoming.method,
      headers,
      body: ["GET", "HEAD"].includes(incoming.method ?? "GET")
        ? undefined
        : (Readable.toWeb(incoming) as ReadableStream),
      duplex: "half",
    } as RequestInit);
    const pending: Promise<unknown>[] = [];
    const context = {
      waitUntil(task: Promise<unknown>) {
        pending.push(
          task.catch((error) => console.error("background_task_failed", error)),
        );
      },
    };
    const response = await worker.fetch(
      request as unknown as Parameters<typeof worker.fetch>[0],
      env,
      context as unknown as ExecutionContext,
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(outgoing);
    else outgoing.end();
    void Promise.all(pending);
  } catch (error) {
    console.error("node_request_failed", error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(`Palette API listening on ${port}`),
);
process.on("SIGTERM", () => server.close(() => void db.close()));
process.on("SIGINT", () => server.close(() => void db.close()));
