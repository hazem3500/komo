import { projectSites, saveProjectSites } from "./project-sites";
import {
  manageProject,
  privateAccess,
  requireMember,
} from "./project-management";
import { setupPage } from "./setup-page";
import { accountPage } from "./account-page";
import {
  accountProjects,
  authenticateToken,
  createToken,
  isPersonalToken,
  listTokens,
  PAT_SCOPES,
  revokeToken,
  type PatAccess,
} from "./tokens";
import { authOptions, type ProxyAuthProvider, type ProxyIdentity } from "./proxy-auth";
import { paletteEnv } from "./public-env";
import setupClient from "./setup-client.txt";
import {
  enqueueWebhook,
  drainWebhooks,
  type WebhookEvent,
} from "./webhooks";
import {
  projectConfig,
  maintain,
  workspaceConfig,
  provision,
  googleOwner,
  retainReviewerComments,
  type Project,
} from "./workspaces";
import { isEmoji } from "../src/emoji.js";
import { timingSafeEqual } from "node:crypto";
import type { Identity, Thread, Comment } from "../src/types.js";
import {
  blobBytes,
  missingSnapshots,
  readLimited,
  readSnapshot,
  snapshotCap,
  snapshotKind,
  SNAPSHOT_IMPORT_BYTES,
  SNAPSHOT_LIMITS,
  storeSnapshot,
  type SnapshotKind,
} from "./snapshots";
import {
  anchorValue,
  threadScope,
  cliReturnOrigin,
  check,
  ConfigError,
  HttpError,
  localOrigin,
  originAllowed,
  previewPattern,
  pagePath,
  string,
} from "./validation";

type UserRow = {
  id: string;
  name: string;
  verified: number;
  avatar_url?: string;
  accent_color?: string;
};
type ThreadRow = {
  id: string;
  page: string;
  anchor: string;
  resolved: number;
  resolved_by: string | null;
  created_at: number;
  updated_at: number;
  tags: string;
  /** Absent before migration 0019; any value but "all" is page-only. */
  scope?: string | null;
  resolver_name: string | null;
  resolver_verified: number | null;
};
type CommentRow = {
  id: string;
  thread_id: string;
  body: string;
  user_id: string;
  avatar_url?: string;
  accent_color?: string;
  name: string;
  verified: number;
  created_at: number;
  edited_at: number | null;
};
const identity = (row: UserRow): Identity => ({
  id: row.id,
  name: row.name,
  verified: !!row.verified,
  avatarUrl: row.avatar_url || undefined,
  accentColor: row.accent_color || undefined,
});
function webhookEvent(
  event: WebhookEvent["event"],
  projectKey: string,
  repo: string,
  branch: string,
  threadId: string,
  page: string,
  anchor: string,
  author: string,
  body: string | null,
  origin: string
): WebhookEvent {
  let selector = "";
  try {
    selector = (JSON.parse(anchor) as { selector?: string }).selector ?? "";
  } catch {
    // A malformed stored anchor must not fail the comment request.
  }
  return {
    id: crypto.randomUUID(),
    event,
    occurredAt: new Date().toISOString(),
    projectKey,
    repo,
    branch,
    threadId,
    pageUrl: new URL(page, origin).toString(),
    selector,
    author,
    body,
  };
}
const json = (data: unknown, status = 200) => Response.json(data, { status });
const token = () => crypto.randomUUID() + crypto.randomUUID();
// Sessions should not force reviewers back through sign-in: unless
// PALETTE_SESSION_MAX_AGE_DAYS caps them, keep them valid for a century and only
// revoke on logout.
const SESSION_LIFETIME = 100 * 365 * 86400000;
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
async function body(request: Request): Promise<Record<string, unknown>> {
  check(
    request.headers.get("Content-Type")?.split(";")[0] === "application/json",
    415,
    "Use application/json."
  );
  const path = new URL(request.url).pathname;
  // A snapshot import carries one base64 image; every other body keeps 16 KiB.
  const bytes = await readLimited(
    request,
    path === "/project/import" ? SNAPSHOT_IMPORT_BYTES : 16384
  );
  let parsed: Record<string, unknown>;
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    check(
      result && typeof result === "object" && !Array.isArray(result),
      400,
      "Invalid JSON object."
    );
    const allowed = path.startsWith("/project")
      ? path === "/project/import"
        ? ["source", "kind", "records"]
        : path === "/project/join"
          ? ["invite"]
          : path === "/project/invites"
            ? ["email"]
            : path === "/project/members"
              ? ["user"]
              : path === "/project/sites"
                ? ["sites"]
                : path === "/project/webhook"
                  ? ["url", "secret", "events", "enabled"]
                : ["access", "confirm", "threadIds"]
      : path === "/account/tokens"
        ? ["name", "expiresInDays", "scopes", "projects"]
      : ["/auth/google/start", "/auth/github/start"].includes(path)
        ? ["returnOrigin"]
        : path === "/setup/start"
          ? ["repo", "origins"]
          : path === "/setup/poll"
            ? ["id", "secret"]
            : path === "/setup/complete"
              ? ["code"]
              : ["/workspace/sites", "/workspace/verify"].includes(path)
                ? ["project", "origin"]
                : path === "/owner/claim"
                  ? ["key"]
                  : path === "/auth/guest"
                    ? ["name"]
                    : path.endsWith("/reactions")
                      ? ["emoji", "active"]
                      : path === "/me"
                        ? ["name", "avatarUrl", "accentColor"]
                        : path === "/threads"
                          ? ["body", "page", "anchor", "tags", "scope", "snapshotIntent"]
                          : path.endsWith("/comments")
                            ? ["body"]
                            : path.includes("/comments/")
                              ? ["body"]
                              : path.endsWith("/snapshot")
                                ? ["status"]
                                : path.startsWith("/threads/")
                                  ? ["anchor", "resolved", "tag", "untag", "scope"]
                                  : [];
    check(
      Object.keys(result).every((key) => allowed.includes(key)),
      400,
      "Unexpected request fields."
    );
    parsed = result;
  } catch {
    throw new HttpError(400, "Invalid JSON object.");
  }
  check(
    bytes.length <= 16384 || parsed.kind === "snapshots",
    413,
    "Request too large."
  );
  return parsed;
}
async function limit(env: Env, key: string, max: number, seconds = 60) {
  const now = Date.now();
  const bucket = Math.floor(now / (seconds * 1000));
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count"
  )
    .bind(`${key}:${bucket}`, now + seconds * 2000)
    .first<{ count: number }>();
  check(row && row.count <= max, 429, "Too many requests. Try again shortly.");
}
/** How a session was signed in, stored from D1 migration 0021 / PostgreSQL 007. */
type SessionVia = "proxy" | "google" | "github" | "guest";
const missingSessionColumns = (error: unknown) =>
  error instanceof Error &&
  /no such column|has no column named|column .* does not exist/i.test(error.message) &&
  /\b(via|created_at)\b/.test(error.message);
async function session(
  env: Env,
  project: string,
  userId: string,
  via: SessionVia
) {
  const accessToken = token();
  const tokenHash = await hash(accessToken);
  const now = Date.now();
  const expires = now + (authOptions(env).sessionMaxAge ?? SESSION_LIFETIME);
  const member = () =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO project_members(project,user_id) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM project_settings WHERE project=? AND access='private') OR EXISTS(SELECT 1 FROM project_owners WHERE project=? AND user_id=?) OR EXISTS(SELECT 1 FROM project_access WHERE project=? AND user_id=?)"
    ).bind(project, userId, project, project, userId, project, userId);
  try {
    await env.DB.batch([
      member(),
      env.DB.prepare(
        "INSERT INTO sessions(token_hash,user_id,project,expires_at,via,created_at) VALUES(?,?,?,?,?,?)"
      ).bind(tokenHash, userId, project, expires, via, now),
    ]);
  } catch (error) {
    // A Worker database without migration 0021 stores sessions as before.
    if (!missingSessionColumns(error)) throw error;
    await env.DB.batch([
      member(),
      env.DB.prepare(
        "INSERT INTO sessions(token_hash,user_id,project,expires_at) VALUES(?,?,?,?)"
      ).bind(tokenHash, userId, project, expires),
    ]);
  }
  return accessToken;
}
// Personal access tokens only pass where a route names the access it needs.
async function authenticate(
  request: Request,
  env: Env,
  project: string,
  access?: PatAccess
): Promise<Identity> {
  const bearer = request.headers
    .get("Authorization")
    ?.match(/^Bearer (.{1,200})$/)?.[1];
  check(bearer, 401, "Enter your name to comment.");
  const { proxy, proxyAccessTokens, sessionMaxAge, allowGuests } = authOptions(env);
  if (isPersonalToken(bearer)) {
    check(
      !proxy || proxyAccessTokens,
      403,
      "Access tokens are off behind the sign-in proxy. Use /auth/proxy/session."
    );
    return identity(
      await authenticateToken(env, bearer, project, access, request)
    );
  }
  const now = Date.now();
  let row: UserRow | null;
  try {
    row = await env.DB.prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.project=? AND s.expires_at>?" +
        // Behind a proxy, only sessions the proxy signed in.
        (proxy ? " AND s.via='proxy'" : "") +
        // Sessions from before migration 0021 have no created_at: date them by
        // the default lifetime, which makes any shorter-lived one look older.
        (sessionMaxAge ? " AND COALESCE(s.created_at,s.expires_at-?)>?" : "")
    )
      .bind(
        await hash(bearer),
        project,
        now,
        ...(sessionMaxAge ? [SESSION_LIFETIME, now - sessionMaxAge] : [])
      )
      .first<UserRow>();
  } catch (error) {
    if (missingSessionColumns(error))
      throw new ConfigError(
        "PALETTE_PROXY_AUTH and PALETTE_SESSION_MAX_AGE_DAYS need D1 migration 0021_session_origin. Apply the migrations."
      );
    throw error;
  }
  check(
    row,
    401,
    proxy
      ? "Your session expired. Sign in again."
      : "Your session expired. Enter your name again."
  );
  // 401 so clients drop a guest session left from before guests were turned off.
  check(
    allowGuests || !row.id.startsWith("guest:"),
    401,
    "Guest comments are disabled."
  );
  return identity(row);
}
// Both hosted recovery and in-project OAuth use the same one-use setup claim.
async function completeSetup(
  env: Env,
  user: Identity,
  code: string,
  origin?: string,
  sites: string[] = origin ? [origin] : []
) {
  const setup = await env.DB.prepare(
    "DELETE FROM setup_requests WHERE id=? AND project IS NULL AND expires_at>? RETURNING *"
  )
    .bind(code, Date.now())
    .first<{ poll_hash: string; config: string; expires_at: number }>();
  check(setup, 409, "Setup expired or already completed. Run palette init again.");
  const config = JSON.parse(setup.config);
  let created: { project: string; repo: string };
  try {
    if (origin)
      check(
        originAllowed(origin, config.origins),
        403,
        "Return to the site where you started setup."
      );
    created = await provision(env, user, config);
  } catch (error) {
    // A quota or validation error must not turn a retry into an expired request.
    await env.DB.prepare(
      "INSERT INTO setup_requests(id,poll_hash,config,expires_at) VALUES(?,?,?,?)"
    )
      .bind(code, setup.poll_hash, setup.config, setup.expires_at)
      .run();
    throw error;
  }
  // The site setup ran on proves the deploy host, so its previews come too.
  const preview = origin && previewPattern(origin);
  const httpsSites = [
    ...new Set([...sites, ...(preview ? [preview] : [])]),
  ].filter((site) => site.startsWith("https://"));
  if (httpsSites.length) {
    await env.DB.batch(
      httpsSites.map((site) =>
        env.DB.prepare(
          "INSERT INTO workspace_domains(project,origin,verified_at) VALUES(?,?,?)"
        ).bind(created.project, site, Date.now())
      )
    );
  }
  await env.DB.prepare(
    "INSERT INTO setup_requests(id,poll_hash,config,project,expires_at) VALUES(?,?,?,?,?)"
  )
    .bind(
      code,
      setup.poll_hash,
      setup.config,
      created.project,
      setup.expires_at
    )
    .run();
  return created;
}

async function oauthAuthorize(
  request: Request,
  env: Env,
  provider: "github" | "google"
) {
  const url = new URL(request.url);
  const state = string(url.searchParams.get("state"), 200, "state");
  const saved = await env.DB.prepare(
    "SELECT verifier FROM oauth_states WHERE state_hash=? AND expires_at>? AND provider=?"
  )
    .bind(await hash(state), Date.now(), provider)
    .first<{ verifier: string }>();
  check(saved, 400, "Sign-in expired. Return to the site and try again.");
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(saved.verifier)
    )
  );
  const challenge = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const authorize = new URL(
    provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://github.com/login/oauth/authorize"
  );
  authorize.search = new URLSearchParams({
    client_id:
      provider === "google" ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}/auth/${provider}/callback`,
    ...(provider === "google"
      ? { response_type: "code", scope: "openid profile email" }
      : {}),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.href,
      "Set-Cookie": `__Host-comments-oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}
async function oauthCallback(
  request: Request,
  env: Env,
  provider: "github" | "google"
) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const cookie =
    request.headers
      .get("Cookie")
      ?.match(/(?:^|;\s*)__Host-comments-oauth=([^;]+)/)?.[1] ?? "";
  const encoder = new TextEncoder();
  check(
    state.length > 0 &&
      cookie.length === state.length &&
      timingSafeEqual(encoder.encode(state), encoder.encode(cookie)),
    400,
    "Sign-in browser does not match. Return to the site and try again."
  );
  const saved = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? AND provider=? RETURNING *"
  )
    .bind(await hash(state), Date.now(), provider)
    .first<{
      verifier: string;
      project: string;
      origin: string;
      exchange_hash: string;
      approved_origins: string | null;
    }>();
  check(
    saved &&
      code &&
      (provider === "google"
        ? env.GOOGLE_CLIENT_SECRET
        : env.GITHUB_CLIENT_SECRET),
    400,
    "Sign-in expired or was cancelled. Close this window and try again."
  );
  const response = await fetch(
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id:
          provider === "google" ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID,
        client_secret:
          provider === "google"
            ? env.GOOGLE_CLIENT_SECRET
            : env.GITHUB_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}/auth/${provider}/callback`,
        code_verifier: saved.verifier,
      }),
    }
  );
  const result = await response.json<{ access_token?: string }>();
  check(response.ok && result.access_token, 401, "Sign-in failed.");
  const profileResponse = await fetch(
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://api.github.com/user",
    {
      headers: {
        Authorization: `Bearer ${result.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "branch-comments",
      },
    }
  );
  check(profileResponse.ok, 401, "Could not verify identity.");
  const profile = await profileResponse.json<{
    sub?: string;
    picture?: string;
    avatar_url?: string;
    accent_color?: string;
    id: number;
    login: string;
    name: string | null;
    email?: string;
    email_verified?: boolean;
  }>();
  check(
    provider === "google"
      ? typeof profile.sub === "string" && !!profile.sub && !!profile.name
      : Number.isInteger(profile.id) && !!profile.login,
    401,
    "Invalid identity."
  );
  const id = `${provider}:${provider === "google" ? profile.sub : profile.id}`;
  // The provider photo (Google's OIDC `picture`) becomes the avatar: plain
  // HTTPS only, otherwise the initial. Existing users without one (NULL) get it
  // on their next sign-in; a photo they set or cleared in Palette is kept.
  let safeAvatar: string | null = null;
  try {
    const photo = new URL(profile.picture || profile.avatar_url || "");
    if (
      photo.protocol === "https:" &&
      !photo.username &&
      !photo.password &&
      photo.href.length <= 2048
    )
      safeAvatar = photo.href;
  } catch {
    /* Missing or malformed: keep the initial. */
  }
  await env.DB.prepare(
    "INSERT INTO users(id,name,verified,avatar_url) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET avatar_url=excluded.avatar_url WHERE users.avatar_url IS NULL AND excluded.avatar_url IS NOT NULL"
  )
    .bind(id, (profile.name || profile.login).slice(0, 60), safeAvatar)
    .run();
  if (
    provider === "google" &&
    profile.email_verified === true &&
    typeof profile.email === "string"
  )
    await env.DB.prepare("UPDATE users SET email=? WHERE id=?")
      .bind(profile.email.toLowerCase(), id)
      .run();
  const user = identity(
    (await env.DB.prepare("SELECT * FROM users WHERE id=?")
      .bind(id)
      .first<UserRow>())!
  );
  return finishSignIn(env, saved, user, provider);
}
type SignInState = {
  project: string;
  origin: string;
  approved_origins: string | null;
};
// Mints the session (finishing a hosted setup first) and hands it to the popup.
async function finishSignIn(
  env: Env,
  saved: SignInState,
  user: Identity,
  provider: "github" | "google",
  via: SessionVia = provider
) {
  const setupCode =
    env.PALETTE_HOSTED === "true" &&
    saved.approved_origins &&
    saved.project.startsWith("setup:")
      ? saved.project.slice(6)
      : undefined;
  check(
    !setupCode || provider === "google",
    403,
    "Use Google to set up inline feedback."
  );
  const created = setupCode
    ? await completeSetup(
        env,
        user,
        setupCode,
        saved.origin,
        saved.approved_origins
          ? JSON.parse(saved.approved_origins)
          : [saved.origin]
      )
    : undefined;
  const accessToken = await session(
    env,
    created?.project ?? saved.project,
    user.id,
    via
  );
  return signedInPage(
    {
      type: created ? "komo:setup" : "branch-comments:auth",
      ...(created ? { ...created, code: setupCode } : {}),
      token: accessToken,
      user,
    },
    saved.origin
  );
}
// The popup posts the session back to the site that opened it, then closes.
function signedInPage(message: Record<string, unknown>, origin: string) {
  const nonce = crypto.randomUUID();
  const body = JSON.stringify(message).replace(/</g, "\\u003c");
  const target = JSON.stringify(origin).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Signed in</title><p>You’re signed in. You can close this window and return to your comments.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${body},${target});window.close();}</script>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,
        "Cache-Control": "no-store",
        "Set-Cookie":
          "__Host-comments-oauth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      },
    }
  );
}
// Records the account a sign-in proxy vouched for as a verified reviewer.
async function proxyUser(env: Env, signedIn: ProxyIdentity) {
  await env.DB.prepare(
    "INSERT INTO users(id,name,verified) VALUES(?,?,1) ON CONFLICT(id) DO NOTHING"
  )
    .bind(signedIn.id, signedIn.email.split("@")[0].slice(0, 60))
    .run();
  await env.DB.prepare("UPDATE users SET email=?,verified=1 WHERE id=?")
    .bind(signedIn.email, signedIn.id)
    .run();
  return identity(
    (await env.DB.prepare("SELECT * FROM users WHERE id=?")
      .bind(signedIn.id)
      .first<UserRow>())!
  );
}
// Behind a sign-in proxy the authorize step is the whole sign-in: the proxy
// has already authenticated the browser, so there is no redirect or callback.
async function proxySignIn(
  request: Request,
  env: Env,
  proxy: ProxyAuthProvider
) {
  const url = new URL(request.url);
  const state = string(url.searchParams.get("state"), 200, "state");
  const signedIn = await proxy.identify(request);
  const saved = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? AND provider=? RETURNING project,origin,approved_origins"
  )
    .bind(await hash(state), Date.now(), proxy.signIn)
    .first<SignInState>();
  check(saved, 400, "Sign-in expired. Return to the site and try again.");
  return finishSignIn(
    env,
    saved,
    await proxyUser(env, signedIn),
    proxy.signIn,
    "proxy"
  );
}
// For agents and CLIs: a caller the proxy authenticated exchanges that
// identity for a project session, the non-interactive counterpart of the popup.
async function proxySession(
  request: Request,
  env: Env,
  proxy: ProxyAuthProvider
) {
  const url = new URL(request.url);
  // Only CLIs and agents, which send no Origin: a web page must not turn a
  // visitor's proxy sign-in into a token it can read.
  const origin = request.headers.get("Origin");
  check(
    !origin || origin === url.origin,
    403,
    "Exchange a proxy session from a CLI or agent, not a web page."
  );
  const signedIn = await proxy.identify(request);
  const project = string(url.searchParams.get("project"), 100, "project");
  const config = await projectConfig(env, project);
  check(config, 404, "Unknown comments project.");
  check(!config.suspended, 403, "This workspace is suspended.");
  await limit(env, `${project}:proxy-session:${signedIn.id}`, 60, 3600);
  const user = await proxyUser(env, signedIn);
  return json(
    { token: await session(env, project, user.id, "proxy"), user },
    201
  );
}
const PROXY_SESSION_PATHS = ["/auth/proxy/session", "/auth/iap/session"];
async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  // Invalid sign-in options fail every request, health checks included.
  const auth = authOptions(env);
  if (url.pathname === "/health") return json({ ok: true, version: env.PALETTE_VERSION?.id });
  if (url.pathname === "/setup-client.js" && request.method === "GET")
    return new Response(setupClient, {
      headers: { "Content-Type": "text/javascript; charset=utf-8" },
    });
  if (env.PALETTE_PAUSED === "true")
    throw new HttpError(503, "Inline feedback is temporarily paused.");
  if (env.EDGE_LIMIT) {
    const allowed = await env.EDGE_LIMIT.limit({
      key: request.headers.get("CF-Connecting-IP") ?? "local",
    });
    check(allowed.success, 429, "Too many requests. Try again shortly.");
  }
  // Keep exact shared quotas: the per-location edge limiter cannot enforce a
  // service-wide daily budget. Unchanged polls still consume these counters.
  if (env.PALETTE_HOSTED === "true")
    await limit(env, "service:requests", 100000, 86400);
  if (
    url.pathname === "/setup/connect" &&
    request.method === "GET" &&
    env.PALETTE_HOSTED === "true"
  ) {
    check(
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
      503,
      "Google sign-in is not configured."
    );
    await limit(
      env,
      `connect:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
      20,
      3600
    );
    const code = string(url.searchParams.get("code"), 100, "setup code");
    const origin = string(url.searchParams.get("origin"), 300, "site origin");
    const setup = await env.DB.prepare(
      "SELECT config FROM setup_requests WHERE id=? AND project IS NULL AND expires_at>?"
    )
      .bind(code, Date.now())
      .first<{ config: string }>();
    check(
      setup,
      409,
      "Setup expired or already completed. Run palette init again."
    );
    check(
      originAllowed(origin, JSON.parse(setup.config).origins),
      403,
      "Open the site configured by palette init."
    );
    let sites: unknown;
    try {
      sites = JSON.parse(
        url.searchParams.get("sites") || JSON.stringify([origin])
      );
    } catch {
      throw new HttpError(400, "Invalid site addresses.");
    }
    check(
      Array.isArray(sites) &&
        sites.length > 0 &&
        sites.length <= 10 &&
        sites.includes(origin) &&
        sites.every(
          (site) =>
            typeof site === "string" &&
            site.length <= 300 &&
            originAllowed(site, [site]) &&
            (site.startsWith("https://") || site === origin)
        ),
      400,
      "Use up to ten exact HTTPS sites, including your current site."
    );
    const approved = [...new Set(sites)];
    const state = token();
    await env.DB.prepare(
      "INSERT INTO oauth_states(state_hash,verifier,project,origin,expires_at,exchange_hash,provider,approved_origins) VALUES(?,?,?,?,?,?,?,?)"
    )
      .bind(
        await hash(state),
        token(),
        `setup:${code}`,
        origin,
        Date.now() + 600000,
        await hash(token()),
        "google",
        JSON.stringify(approved)
      )
      .run();
    const authorize = new URL("/auth/google/authorize", url);
    authorize.searchParams.set("state", state);
    return oauthAuthorize(new Request(authorize), env, "google");
  }
  if (url.pathname === "/setup") return setupPage(env.PALETTE_PUBLIC_PATH ?? "");
  if (url.pathname === "/account" && request.method === "GET")
    return accountPage(env, url);
  if (
    url.pathname === "/setup/start" &&
    request.method === "POST" &&
    env.PALETTE_HOSTED === "true"
  ) {
    await limit(
      env,
      `setup:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
      10,
      3600
    );
    check(
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
      503,
      "Hosted setup is awaiting Google sign-in configuration. Use --self-host or try again later."
    );
    const config = workspaceConfig(await body(request));
    const id = crypto.randomUUID(),
      secret = token();
    await env.DB.prepare(
      "INSERT INTO setup_requests(id,poll_hash,config,expires_at) VALUES(?,?,?,?)"
    )
      .bind(id, await hash(secret), JSON.stringify(config), Date.now() + 600000)
      .run();
    return json({ id, secret, url: `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}/setup?code=${id}` });
  }
  if (
    url.pathname === "/setup/poll" &&
    request.method === "POST" &&
    env.PALETTE_HOSTED === "true"
  ) {
    await limit(
      env,
      `poll:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
      30
    );
    const data = await body(request);
    const row = await env.DB.prepare(
      "SELECT project,config FROM setup_requests WHERE id=? AND poll_hash=? AND expires_at>?"
    )
      .bind(
        string(data.id, 100, "setup ID"),
        await hash(string(data.secret, 200, "setup secret")),
        Date.now()
      )
      .first<{ project: string | null; config: string }>();
    check(row, 404, "Setup expired. Run palette init again.");
    return json(
      row.project
        ? {
            project: row.project,
            repo: JSON.parse(row.config).repo,
            endpoint: `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}`,
          }
        : { pending: true }
    );
  }
  const oauthPath = url.pathname.match(
    /^\/auth\/(github|google)\/(authorize|callback)$/
  );
  if (auth.proxy) {
    // Proxy sign-in replaces OAuth. Its handlers live only under
    // PALETTE_AUTH_PATH_PREFIX when set, the path the proxy protects.
    const prefix = auth.signInPrefix;
    const signInPath =
      !prefix || url.pathname.startsWith(`${prefix}/auth/`)
        ? url.pathname.slice(prefix.length)
        : "";
    if (signInPath === `/auth/${auth.proxy.signIn}/authorize`)
      return proxySignIn(request, env, auth.proxy);
    if (PROXY_SESSION_PATHS.includes(signInPath) && request.method === "POST")
      return proxySession(request, env, auth.proxy);
    check(
      !oauthPath || oauthPath[1] === auth.proxy.signIn,
      403,
      "Sign in with your Google account."
    );
    check(
      !oauthPath &&
        !PROXY_SESSION_PATHS.includes(url.pathname) &&
        !(prefix && url.pathname.startsWith(`${prefix}/`)),
      404,
      "Not found."
    );
  }
  if (oauthPath)
    return oauthPath[2] === "authorize"
      ? oauthAuthorize(request, env, oauthPath[1] as "github" | "google")
      : oauthCallback(request, env, oauthPath[1] as "github" | "google");
  const project = string(url.searchParams.get("project"), 100, "project");
  const config: Project | undefined =
    project === "_komo" && env.PALETTE_HOSTED === "true"
      ? { repo: "_komo", origins: [url.origin], allowGuests: false }
      : await projectConfig(env, project);
  check(config, 404, "Unknown comments project.");
  const origin =
    request.headers.get("Origin") ??
    (request.headers.get("Sec-Fetch-Site") === "same-origin" ? url.origin : "");
  const accountRoute = /^\/account\/tokens(?:\/[a-z0-9]{12})?$/.test(
    url.pathname
  );
  if (
    !(
      originAllowed(origin, config.origins) ||
      (origin === url.origin && accountRoute) ||
      (project !== "_komo" && localOrigin(origin)) ||
      (origin === url.origin &&
        [
          "/auth/google/start",
          "/project",
          "/project/join",
          "/project/invites",
          "/project/members",
          "/project/export",
          "/project/import",
          "/project/clear-resolved",
          "/project/webhook",
          "/owner/claim",
          "/config",
          "/me",
          "/usage",
        ].includes(url.pathname))
    )
  )
    throw new HttpError(
      403,
      "This site is not approved for this project.",
      "site_not_approved"
    );
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  check(
    project !== "_komo" ||
      url.pathname.startsWith("/project") ||
      accountRoute ||
      [
        "/setup/complete",
        "/workspace/verify",
        "/workspace/sites",
        "/workspace",
        "/usage",
        "/auth/google/start",
        "/me",
        "/config",
      ].includes(url.pathname),
    404,
    "Unknown management route."
  );
  check(
    ["GET", "POST", "PATCH", "DELETE"].includes(request.method),
    405,
    "Method not allowed."
  );
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  check(!config.suspended, 403, "This workspace is suspended.");
  await limit(env, `${project}:read:${ip}`, 180);
  await limit(env, `${project}:requests`, 100000, 86400);
  if (request.method !== "GET") {
    await limit(env, `${project}:write:${ip}`, 90);
    await limit(env, `${project}:writes`, config.writesPerDay ?? 10000, 86400);
  }
  const owner = config.requireOwner
    ? await env.DB.prepare("SELECT user_id FROM project_owners WHERE project=?")
        .bind(project)
        .first<{ user_id: string }>()
    : null;
  if (
    url.pathname === "/setup/complete" &&
    request.method === "POST" &&
    project === "_komo" &&
    env.PALETTE_HOSTED === "true"
  ) {
    const user = await authenticate(request, env, project);
    check(
      user.verified && user.id.startsWith("google:"),
      403,
      "Sign in with Google to own a workspace."
    );
    const data = await body(request);
    const code = string(data.code, 100, "setup code");
    const created = await completeSetup(env, user, code);
    return json(created, 201);
  }
  if (
    ["/workspace/sites", "/workspace/verify"].includes(url.pathname) &&
    request.method === "POST" &&
    project === "_komo"
  ) {
    const user = await authenticate(request, env, project);
    const data = await body(request);
    const target = string(data.project, 100, "project");
    await googleOwner(env, target, user);
    const origin = string(data.origin, 300, "origin");
    check(
      (await projectConfig(env, target)) &&
        origin.startsWith("https://") &&
        originAllowed(origin, [origin]),
      400,
      "Use an exact HTTPS origin for a hosted workspace."
    );
    // Shared with the sidebar editor: covers hosted and configured projects.
    const sites = await projectSites(env, target);
    if (!sites.includes(origin))
      await saveProjectSites(env, target, [...sites, origin]);
    return json({ ok: true });
  }
  if (
    url.pathname === "/workspace" &&
    request.method === "GET" &&
    project === "_komo"
  ) {
    const user = await authenticate(request, env, project);
    const target = string(url.searchParams.get("workspace"), 100, "workspace");
    await googleOwner(env, target, user);
    const config = await projectConfig(env, target);
    check(config, 404, "Workspace not found.");
    const workspace = await env.DB.prepare(
      "SELECT origins FROM workspaces WHERE id=?"
    )
      .bind(target)
      .first<{ origins: string }>();
    return json({
      repo: config.repo,
      sites: await projectSites(env, target),
      suggested: workspace
        ? (JSON.parse(workspace.origins) as string[]).filter((origin) =>
            origin.startsWith("https://")
          )
        : [],
    });
  }
  if (accountRoute) {
    check(
      !auth.proxy || auth.proxyAccessTokens,
      403,
      "Access tokens are off behind the sign-in proxy. Use /auth/proxy/session."
    );
    // Sessions only: an access token can never mint or revoke access tokens.
    const user = await authenticate(request, env, project);
    check(
      user.verified && user.id.startsWith("google:"),
      403,
      "Sign in with Google to manage access tokens."
    );
    const tokenId = url.pathname.match(/^\/account\/tokens\/([a-z0-9]{12})$/)?.[1];
    if (url.pathname === "/account/tokens" && request.method === "GET")
      return json({
        tokens: await listTokens(env, user.id),
        projects: await accountProjects(env, user.id),
        scopes: PAT_SCOPES,
        ...(auth.proxy ? { policy: { explicitProjects: true, maxLifetimeDays: 365 } } : {}),
      });
    if (url.pathname === "/account/tokens" && request.method === "POST") {
      await limit(env, `pat:create:${user.id}`, 10, 3600);
      return json(await createToken(env, user.id, await body(request)), 201);
    }
    if (tokenId && request.method === "DELETE") {
      await revokeToken(env, user.id, tokenId);
      return json({ ok: true });
    }
    throw new HttpError(405, "Method not allowed.");
  }
  if (url.pathname === "/project" || url.pathname.startsWith("/project/")) {
    const user = await authenticate(request, env, project);
    const target =
      project === "_komo"
        ? string(url.searchParams.get("workspace"), 100, "workspace")
        : project;
    return manageProject(request, env, target, user, () => body(request));
  }
  if (url.pathname === "/owner/claim" && request.method === "POST") {
    const user = await authenticate(request, env, project);
    check(
      user.verified && user.id.startsWith("google:"),
      403,
      "Sign in with Google to own a workspace."
    );
    const data = await body(request);
    check(
      config.bootstrapHash &&
        (await hash(string(data.key, 200, "setup key"))) ===
          config.bootstrapHash,
      403,
      "Invalid owner setup key."
    );
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO project_owners(project,user_id) VALUES(?,?)"
    )
      .bind(project, user.id)
      .run();
    check(result.meta.changes, 409, "This workspace already has an owner.");
    return json({ ok: true });
  }
  if (
    config.requireOwner &&
    !owner &&
    !["/config", "/auth/google/start", "/me"].includes(url.pathname)
  )
    throw new HttpError(
      403,
      "A Google-authenticated owner must finish workspace setup first."
    );
  if (env.PALETTE_HOSTED !== "true") ctx.waitUntil(maintain(env.DB));
  if (url.pathname === "/config" && request.method === "GET")
    return json({
      // The repository is feedback metadata: keep it from anonymous callers
      // when reads need a session.
      ...(!auth.requireSessionForReads ||
      (await authenticate(request, env, project).then(
        () => true,
        () => false
      ))
        ? { repo: config.repo }
        : {}),
      github:
        !auth.proxy && !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      google: auth.proxy
        ? auth.proxy.signIn === "google"
        : !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      guests:
        auth.allowGuests &&
        config.allowGuests !== false &&
        (!config.requireOwner || !!owner) &&
        !(await privateAccess(env, project)),
      private: await privateAccess(env, project),
      guestResolve: config.allowGuestResolve !== false,
      tokens: !auth.proxy || auth.proxyAccessTokens,
      // Element snapshots are opt-in on the client; guests need project consent.
      snapshots: {
        readiness: true,
        guests: auth.allowGuests && config.allowGuestSnapshots === true,
        maxImageBytes: SNAPSHOT_LIMITS.image,
        maxHtmlBytes: SNAPSHOT_LIMITS.html,
      },
    });
  if (url.pathname === "/usage" && request.method === "GET") {
    const user = await authenticate(request, env, project);
    const target =
      project === "_komo"
        ? string(url.searchParams.get("workspace"), 100, "workspace")
        : project;
    if (project === "_komo") await googleOwner(env, target, user);
    else if (await privateAccess(env, target))
      await requireMember(env, target, user);
    const quota = await env.DB.prepare(
      "SELECT comments,max_comments FROM project_quotas WHERE project=?"
    )
      .bind(target)
      .first<{ comments: number; max_comments: number }>();
    const workspace = await env.DB.prepare(
      "SELECT id FROM workspaces WHERE id=?"
    )
      .bind(target)
      .first();
    const owned =
      workspace && user.verified && user.id.startsWith("google:")
        ? await env.DB.prepare(
            "SELECT COUNT(*) AS used FROM workspaces WHERE owner_id=?"
          )
            .bind(user.id)
            .first<{ used: number }>()
        : null;
    const count = quota
      ? quota.comments
      : ((
          await env.DB.prepare(
            "SELECT COUNT(*) AS used FROM comments c JOIN threads t ON t.id=c.thread_id WHERE t.project=?"
          )
            .bind(target)
            .first<{ used: number }>()
        )?.used ?? 0);
    let projects: { used: number; limit: number | null } | null = owned
      ? { used: owned.used, limit: 3 }
      : null;
    if (!workspace) {
      const connected = await env.DB.prepare(
        "SELECT project FROM project_members WHERE user_id=? UNION SELECT project FROM project_owners WHERE user_id=?"
      )
        .bind(user.id, user.id)
        .all<{ project: string }>();
      const configured = JSON.parse(env.PROJECTS) as Record<string, Project>;
      const ids = new Set([
        target,
        ...connected.results.map((row) => row.project),
      ]);
      projects = {
        used: [...ids].filter((id) => Object.hasOwn(configured, id)).length,
        limit: null,
      };
    }
    return json({
      hosted: !!workspace,
      projects,
      comments: { used: count, limit: quota?.max_comments ?? null },
    });
  }
  if (url.pathname === "/auth/guest" && request.method === "POST") {
    check(auth.allowGuests, 403, "Guest comments are disabled.");
    check(
      !(await privateAccess(env, project)),
      403,
      "This project requires an invited Google account."
    );
    check(config.allowGuests !== false, 403, "Guest comments are disabled.");
    await limit(env, `${project}:guest:${ip}`, 20, 3600);
    const data = await body(request);
    const name = string(data.name, 60, "name");
    const id = `guest:${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO users(id,name) VALUES(?,?)")
      .bind(id, name)
      .run();
    return json(
      {
        token: await session(env, project, id, "guest"),
        user: { id, name, verified: false },
      },
      201
    );
  }
  if (
    ["/auth/github/start", "/auth/google/start"].includes(url.pathname) &&
    request.method === "POST"
  ) {
    const provider = url.pathname.includes("/google/") ? "google" : "github";
    check(
      auth.proxy
        ? provider === auth.proxy.signIn
        : provider === "google"
          ? env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
      503,
      "Sign-in is not configured."
    );
    await limit(env, `${project}:oauth:${ip}`, 20, 3600);
    const data = request.body ? await body(request) : {};
    const returnOrigin = cliReturnOrigin(data.returnOrigin, origin);
    const state = token();
    const verifier = token();
    const exchange = token();
    await env.DB.prepare(
      "INSERT INTO oauth_states(state_hash,verifier,project,origin,expires_at,exchange_hash,provider) VALUES(?,?,?,?,?,?,?)"
    )
      .bind(
        await hash(state),
        verifier,
        project,
        returnOrigin,
        Date.now() + 600000,
        await hash(exchange),
        provider
      )
      .run();
    return json({
      // PALETTE_PUBLIC_PATH covers apps served under a path behind a proxy that strips it.
      url: `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}${auth.signInPrefix}/auth/${provider}/authorize?state=${encodeURIComponent(state)}`,
    });
  }
  if (url.pathname === "/me") {
    const user = await authenticate(
      request,
      env,
      project,
      request.method === "GET" ? "any" : undefined
    );
    if (request.method === "DELETE") {
      const bearer = request.headers.get("Authorization")!.slice(7);
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await hash(bearer))
        .run();
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const data = await body(request);
      const name = string(data.name, 60, "name");
      check(
        typeof data.avatarUrl === "string" && data.avatarUrl.length <= 12000,
        400,
        "Invalid photo URL."
      );
      const accentColor = data.accentColor ?? user.accentColor;
      check(
        accentColor === undefined ||
          (typeof accentColor === "string" &&
            /^#[0-9a-f]{6}$/i.test(accentColor)),
        400,
        "Choose a valid accent color."
      );
      const normalizedAccent = accentColor?.toLowerCase();
      const avatarUrl = data.avatarUrl.trim();
      const uploadedPhoto =
        /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarUrl);
      if (avatarUrl && !uploadedPhoto) {
        check(avatarUrl.length <= 2048, 400, "Photo URL is too long.");
        let photo: URL;
        try {
          photo = new URL(avatarUrl);
        } catch {
          throw new HttpError(400, "Use an HTTPS photo URL.");
        }
        check(
          photo.protocol === "https:" && !photo.username && !photo.password,
          400,
          "Use an HTTPS photo URL."
        );
      }
      await env.DB.prepare(
        "UPDATE users SET name=?,avatar_url=?,accent_color=? WHERE id=?"
      )
        .bind(name, avatarUrl, normalizedAccent ?? null, user.id)
        .run();
      return json({
        user: {
          ...user,
          name,
          avatarUrl: avatarUrl || undefined,
          accentColor: normalizedAccent,
        },
      });
    }
    check(request.method === "GET", 405, "Method not allowed.");
    return json({ user });
  }
  const access: PatAccess = request.method === "GET" ? "read" : "write";
  // No anonymous reads. Behind a proxy, authenticate() accepts only sessions
  // the proxy signed in.
  if (auth.requireSessionForReads) {
    check(
      request.method !== "GET" || request.headers.get("Authorization"),
      401,
      "Sign in to see comments."
    );
    await authenticate(request, env, project, access);
  }
  if (await privateAccess(env, project)) {
    await requireMember(
      env,
      project,
      await authenticate(request, env, project, access)
    );
  }
  const requestedRepo = url.searchParams.get("repo");
  const repo =
    !requestedRepo || requestedRepo === project
      ? config.repo
      : string(requestedRepo, 200, "repository");
  const branch = string(url.searchParams.get("branch"), 250, "branch");
  check(repo === config.repo, 403, "Repository does not match this project.");
  if (url.pathname === "/threads" && request.method === "GET") {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    check(
      Number.isInteger(offset) && offset >= 0 && offset <= 100000,
      400,
      "Invalid offset."
    );
    let cursor: [number, string] | undefined;
    if (url.searchParams.has("cursor")) {
      try {
        cursor = JSON.parse(string(url.searchParams.get("cursor"), 200, "cursor"));
      } catch {
        throw new HttpError(400, "Invalid cursor.");
      }
      check(
        Array.isArray(cursor) && cursor.length === 2 &&
        Number.isSafeInteger(cursor[0]) && cursor[0] >= 0 &&
        typeof cursor[1] === "string" && cursor[1].length > 0 && cursor[1].length <= 100,
        400, "Invalid cursor."
      );
    }
    const revision =
      (
        await env.DB.prepare(
          "SELECT version FROM scope_revisions WHERE project=? AND repo=? AND branch=?"
        )
          .bind(project, repo, branch)
          .first<{ version: number }>()
      )?.version ?? 0;
    if (!cursor && offset === 0 && url.searchParams.get("revision") === String(revision))
      return json({ notModified: true, revision });
    const requestedId = url.searchParams.get("id");
    const rows = await env.DB.prepare(
      `SELECT t.*,u.name AS resolver_name,u.verified AS resolver_verified FROM threads t LEFT JOIN users u ON u.id=t.resolved_by WHERE t.project=? AND t.repo=? AND t.branch=?${requestedId ? " AND t.id=?" : ""}${cursor ? " AND (t.created_at,t.id)>(?,?)" : ""} ORDER BY t.created_at,t.id LIMIT 50 OFFSET ?`
    )
      .bind(
        project,
        repo,
        branch,
        ...(requestedId ? [string(requestedId, 100, "thread ID")] : []),
        ...(cursor ?? []),
        cursor ? 0 : offset
      )
      .all<ThreadRow>();
    const last = rows.results.at(-1);
    const nextCursor = rows.results.length === 50 && last ? JSON.stringify([last.created_at, last.id]) : null;
    const ids = rows.results.map((row) => row.id);
    if (!ids.length) return json({ threads: [], next: null, revision });
    const placeholders = ids.map(() => "?").join(",");
    const comments = await env.DB.prepare(
      `SELECT c.*,u.name,u.verified,u.avatar_url,u.accent_color FROM comments c JOIN users u ON u.id=c.user_id WHERE c.thread_id IN (${placeholders}) ORDER BY c.created_at,c.id`
    )
      .bind(...ids)
      .all<CommentRow>();
    const reactions = await env.DB.prepare(
      `SELECT r.* FROM reactions r JOIN comments c ON c.id=r.comment_id WHERE c.thread_id IN (${placeholders})`
    )
      .bind(...ids)
      .all<{ comment_id: string; user_id: string; emoji: string }>();
    const snapshots: { thread_id: string; kind: SnapshotKind; created_at: number }[] = [];
    try {
      snapshots.push(
        ...(
          await env.DB.prepare(
            `SELECT thread_id,kind,created_at FROM snapshots WHERE thread_id IN (${placeholders})`
          )
            .bind(...ids)
            .all<{ thread_id: string; kind: SnapshotKind; created_at: number }>()
        ).results
      );
    } catch (error) {
      if (!missingSnapshots(error)) throw error;
    }
    const snapshotsByThread = new Map<string, NonNullable<Thread["snapshot"]>>();
    const scope = new URLSearchParams({ project, repo, branch });
    for (const item of snapshots) {
      const group = snapshotsByThread.get(item.thread_id) ?? {};
      scope.set("v", String(item.created_at));
      group[item.kind] =
        `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}/threads/${item.thread_id}/snapshot/${item.kind}?${scope}`;
      snapshotsByThread.set(item.thread_id, group);
    }
    const commentsByThread = new Map<string, CommentRow[]>();
    for (const comment of comments.results) {
      const group = commentsByThread.get(comment.thread_id) ?? [];
      group.push(comment);
      commentsByThread.set(comment.thread_id, group);
    }
    const reactionsByComment = new Map<string, Comment["reactions"]>();
    for (const reaction of reactions.results) {
      const group = reactionsByComment.get(reaction.comment_id) ?? {};
      (group[reaction.emoji] ??= []).push(reaction.user_id);
      reactionsByComment.set(reaction.comment_id, group);
    }
    const threads: Thread[] = rows.results.map((row) => ({
      id: row.id,
      page: pagePath(row.page),
      anchor: JSON.parse(row.anchor),
      tags: parseTags(row.tags),
      // Omitted for page-only threads, so their payload is unchanged for older clients.
      ...(row.scope === "all" ? { scope: "all" as const } : {}),
      resolved: !!row.resolved,
      resolvedBy: row.resolved_by
        ? {
            id: row.resolved_by,
            name: row.resolver_name ?? "Reviewer",
            verified: !!row.resolver_verified,
          }
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(snapshotsByThread.has(row.id)
        ? { snapshot: snapshotsByThread.get(row.id) }
        : {}),
      comments: (commentsByThread.get(row.id) ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        author: {
          id: c.user_id,
          name: c.name,
          verified: !!c.verified,
          avatarUrl: c.avatar_url || undefined,
          accentColor: c.accent_color || undefined,
        },
        createdAt: c.created_at,
        editedAt: c.edited_at,
        reactions: reactionsByComment.get(c.id) ?? {},
      })),
    }));
    if (url.searchParams.get("authors") === "1") {
      const authors: Record<string, Identity> = Object.create(null);
      const authorId = (author: Identity) => {
        authors[author.id] = { ...authors[author.id], ...author };
        return author.id;
      };
      return json({
        threads: threads.map(thread => ({
          ...thread,
          resolvedBy: thread.resolvedBy ? authorId(thread.resolvedBy) : null,
          comments: thread.comments.map(comment => ({ ...comment, author: authorId(comment.author) })),
        })),
        authors,
        nextCursor,
        next: ids.length === 50 ? offset + 50 : null,
        revision,
      });
    }
    return json({
      threads,
      nextCursor,
      next: ids.length === 50 ? offset + 50 : null,
      revision,
    });
  }
  const user = await authenticate(request, env, project, access);
  await limit(env, `${project}:session:${user.id}`, 60);
  const now = Date.now();
  if (url.pathname === "/threads" && request.method === "POST") {
    const data = await body(request);
    const text = string(data.body, 4000, "comment");
    const page = pagePath(data.page);
    const anchor = anchorValue(data.anchor);
    const scope = data.scope === undefined ? "page" : threadScope(data.scope);
    let tags: string[] = [];
    if (data.tags !== undefined) {
      check(Array.isArray(data.tags), 400, "Invalid tags.");
      tags = [...new Set((data.tags as unknown[]).map(tagValue))].sort();
      check(tags.length <= 12, 400, "A thread can have at most 12 tags.");
    }
    const id = crypto.randomUUID();
    const firstCommentId = crypto.randomUUID();
    check(data.snapshotIntent === undefined || typeof data.snapshotIntent === "boolean", 400, "Invalid snapshot intent.");
    const snapshotStatus = data.snapshotIntent === undefined ? null : data.snapshotIntent ? "pending" : "skipped";
    await env.DB.batch([
      // Page-only threads rely on the column default, as before the scope column existed.
      scope === "all"
        ? env.DB.prepare(
            "INSERT INTO threads(id,project,repo,branch,page,anchor,tags,scope,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
          ).bind(id, project, repo, branch, page, JSON.stringify(anchor), JSON.stringify(tags), scope, now, now)
        : env.DB.prepare(
            "INSERT INTO threads(id,project,repo,branch,page,anchor,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
          ).bind(id, project, repo, branch, page, JSON.stringify(anchor), JSON.stringify(tags), now, now),
      env.DB.prepare(
        "INSERT INTO comments(id,thread_id,user_id,body,created_at) VALUES(?,?,?,?,?)"
      ).bind(firstCommentId, id, user.id, text, now),
      env.DB.prepare("UPDATE threads SET snapshot_status=? WHERE id=?").bind(snapshotStatus, id),
      enqueueWebhook(env.DB, project, { ...webhookEvent(
          "comment.created",
          project,
          repo,
          branch,
          id,
          page,
          JSON.stringify(anchor),
          user.name,
          text,
          origin || url.origin
        ), ...(snapshotStatus ? { snapshotStatus } : {}) }, firstCommentId),
      ...retainReviewerComments(
        env.DB,
        project,
        user.id,
        config.retainedCommentsPerUser
      ),
    ]);
    ctx.waitUntil(drainWebhooks(env));
    return json({ id, commentId: firstCommentId }, 201);
  }
  const snapshotRoute = url.pathname.match(
    /^\/threads\/([\w:-]{1,100})\/snapshot(?:\/(image|html))?$/
  );
  if (snapshotRoute) {
    const [, threadId, pathKind] = snapshotRoute;
    const thread = await env.DB.prepare(
      "SELECT id,snapshot_status,created_at FROM threads WHERE id=? AND project=? AND repo=? AND branch=?"
    )
      .bind(threadId, project, repo, branch)
      .first<{ id: string; snapshot_status: string | null; created_at: number }>();
    check(thread, 404, "Thread not found on this branch.");
    if (request.method === "GET") {
      if (!pathKind) {
        const rows = await env.DB.prepare("SELECT kind FROM snapshots WHERE thread_id=?").bind(threadId).all<{kind:string}>();
        let status = rows.results.length ? "ready" : thread.snapshot_status ?? "unknown";
        if (status === "pending" && now - thread.created_at > 600000) status = "failed";
        return json({ status, kinds: rows.results.map(row => row.kind) });
      }
      const kind = snapshotKind(pathKind);
      const row = await env.DB.prepare(
        "SELECT mime,bytes FROM snapshots WHERE thread_id=? AND kind=?"
      )
        .bind(threadId, kind)
        .first<{ mime: string; bytes: unknown }>();
      check(row, 404, "This thread has no snapshot of that kind.");
      const bytes = blobBytes(row.bytes);
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          // HTML is evidence for agents and sandboxed viewers, never live markup.
          "Content-Type":
            kind === "html" ? "text/plain; charset=utf-8" : row.mime,
          "Content-Length": String(bytes.length),
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Cache-Control": "private, max-age=300",
        },
      });
    }
    check(
      request.method === "POST" || request.method === "DELETE",
      405,
      "Method not allowed."
    );
    // Snapshots may hold page content: guests need the project's explicit consent.
    check(
      user.verified || (auth.allowGuests && config.allowGuestSnapshots === true),
      403,
      "Guests cannot attach snapshots in this project."
    );
    const author = await env.DB.prepare(
      "SELECT user_id FROM comments WHERE thread_id=? ORDER BY created_at,id LIMIT 1"
    )
      .bind(threadId)
      .first<{ user_id: string }>();
    check(
      user.verified || author?.user_id === user.id,
      403,
      "Only the author or a signed-in reviewer can change this snapshot."
    );
    if (request.method === "DELETE") {
      const kind = snapshotKind(pathKind);
      const [deleted] = await env.DB.batch([
        env.DB.prepare("DELETE FROM snapshots WHERE thread_id=? AND kind=?").bind(
          threadId,
          kind
        ),
        env.DB.prepare("UPDATE threads SET snapshot_status=CASE WHEN EXISTS (SELECT 1 FROM snapshots WHERE thread_id=?) THEN 'ready' ELSE 'skipped' END,updated_at=? WHERE id=?").bind(
          threadId,
          now,
          threadId
        ),
      ]);
      return json({ ok: true, deleted: deleted.meta.changes });
    }
    if (!pathKind && request.headers.get("Content-Type")?.startsWith("application/json")) {
      const data = await body(request);
      check(data.status === "skipped" || data.status === "failed", 400, "Report skipped or failed capture.");
      await env.DB.prepare("UPDATE threads SET snapshot_status=?,updated_at=? WHERE id=? AND snapshot_status='pending'").bind(data.status, now, threadId).run();
      return json({ ok: true });
    }
    await limit(env, `${project}:snapshot:${user.id}`, 60, 600);
    const snapshot = await readSnapshot(
      request,
      pathKind ?? url.searchParams.get("kind")
    );
    const [stored] = await env.DB.batch([
      storeSnapshot(
        env.DB,
        project,
        threadId,
        snapshot,
        now,
        snapshotCap(config.maxSnapshotBytes),
        true
      ),
      env.DB.prepare("UPDATE threads SET snapshot_status='ready',updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM snapshots WHERE thread_id=?)").bind(
        now,
        threadId,
        threadId
      ),
    ]);
    check(
      stored.meta.changes,
      409,
      "This project reached its snapshot storage limit. Remove resolved threads to free space."
    );
    const scope = new URLSearchParams({ project, repo, branch, v: String(now) });
    return json(
      {
        ok: true,
        kind: snapshot.kind,
        size: snapshot.bytes.length,
        url: `${url.origin}${env.PALETTE_PUBLIC_PATH ?? ""}/threads/${threadId}/snapshot/${snapshot.kind}?${scope}`,
      },
      201
    );
  }
  const match = url.pathname.match(
    /^\/threads\/([\w:-]{1,100})(?:\/comments(?:\/([\w:-]{1,100})(?:\/(reactions))?)?)?$/
  );
  check(match, 404, "Not found.");
  const [, threadId, commentId, reaction] = match;
  const thread = await env.DB.prepare(
    "SELECT * FROM threads WHERE id=? AND project=? AND repo=? AND branch=?"
  )
    .bind(threadId, project, repo, branch)
    .first<ThreadRow>();
  check(thread, 404, "Thread not found on this branch.");
  if (url.pathname === `/threads/${threadId}` && request.method === "PATCH") {
    const data = await body(request);
    if (data.untag !== undefined) {
      const tag = tagValue(data.untag);
      const tags = parseTags(thread.tags);
      if (tags.includes(tag)) {
        const next = tags.filter((item) => item !== tag);
        await env.DB.prepare(
          "UPDATE threads SET tags=?,updated_at=? WHERE id=?",
        )
          .bind(JSON.stringify(next), now, threadId)
          .run();
        return json({ ok: true, tags: next });
      }
      return json({ ok: true, tags });
    }
    if (data.tag !== undefined) {
      const tag = tagValue(data.tag);
      const tags = parseTags(thread.tags);
      if (!tags.includes(tag)) {
        check(tags.length < 12, 400, "A thread can have at most 12 tags.");
        tags.push(tag);
        tags.sort();
        await env.DB.prepare(
          "UPDATE threads SET tags=?,updated_at=? WHERE id=?",
        )
          .bind(JSON.stringify(tags), now, threadId)
          .run();
      }
      return json({ ok: true, tags });
    }
    if (data.scope !== undefined) {
      const scope = threadScope(data.scope);
      check(
        Object.keys(data).length === 1,
        400,
        "Change where a comment shows on its own."
      );
      // The author, or anyone allowed to resolve, may change where a comment shows.
      if (!user.verified && config.allowGuestResolve === false) {
        const owner = await env.DB.prepare(
          "SELECT user_id FROM comments WHERE thread_id=? ORDER BY created_at,id LIMIT 1"
        )
          .bind(threadId)
          .first<{ user_id: string }>();
        check(
          owner?.user_id === user.id,
          403,
          "Only the author or a signed-in reviewer can change where this comment shows."
        );
      }
      if ((thread.scope === "all" ? "all" : "page") !== scope)
        await env.DB.prepare(
          "UPDATE threads SET scope=?,updated_at=? WHERE id=?"
        )
          .bind(scope, now, threadId)
          .run();
      return json({ ok: true, scope });
    }
    if (data.anchor !== undefined) {
      const owner = await env.DB.prepare(
        "SELECT user_id FROM comments WHERE thread_id=? ORDER BY created_at,id LIMIT 1"
      )
        .bind(threadId)
        .first<{ user_id: string }>();
      check(
        user.verified || owner?.user_id === user.id,
        403,
        "Only the author or a signed-in reviewer can move this comment."
      );
      const anchor = anchorValue(data.anchor);
      await env.DB.prepare(
        "UPDATE threads SET anchor=?,updated_at=? WHERE id=?"
      )
        .bind(JSON.stringify(anchor), now, threadId)
        .run();
      return json({ ok: true });
    }
    check(
      user.verified || config.allowGuestResolve !== false,
      403,
      "Sign in to resolve comments."
    );
    check(typeof data.resolved === "boolean", 400, "Invalid resolved state.");
    const becameResolved = !thread.resolved && data.resolved;
    const firstComment = becameResolved
      ? await env.DB.prepare("SELECT id FROM comments WHERE thread_id=? ORDER BY created_at,id LIMIT 1")
          .bind(threadId).first<{ id: string }>()
      : null;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE threads SET resolved=?,resolved_by=?,updated_at=? WHERE id=?"
      ).bind(Number(data.resolved), data.resolved ? user.id : null, now, threadId),
      ...(firstComment ? [enqueueWebhook(env.DB, project, webhookEvent(
        "comment.resolved", project, repo, branch, threadId, thread.page,
        thread.anchor, user.name, null, origin || url.origin
      ), firstComment.id)] : []),
    ]);
    ctx.waitUntil(drainWebhooks(env));
    return json({ ok: true });
  }
  if (
    url.pathname === `/threads/${threadId}/comments` &&
    request.method === "POST"
  ) {
    const data = await body(request);
    const text = string(data.body, 4000, "reply");
    const replyId = crypto.randomUUID();
    const result = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO comments(id,thread_id,user_id,body,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM comments WHERE thread_id=?)<200"
      ).bind(replyId, threadId, user.id, text, now, threadId),
      env.DB.prepare("UPDATE threads SET updated_at=? WHERE id=?").bind(
        now,
        threadId
      ),
      enqueueWebhook(env.DB, project, webhookEvent(
          "comment.replied",
          project,
          repo,
          branch,
          threadId,
          thread.page,
          thread.anchor,
          user.name,
          text,
          origin || url.origin
        ), replyId),
      ...retainReviewerComments(
        env.DB,
        project,
        user.id,
        config.retainedCommentsPerUser
      ),
    ]);
    check(
      result[0].meta.changes,
      409,
      "This thread has reached 200 comments. Start another thread."
    );
    ctx.waitUntil(drainWebhooks(env));
    return json({ ok: true, id: replyId }, 201);
  }
  check(commentId, 405, "Method not allowed.");
  const comment = await env.DB.prepare(
    "SELECT * FROM comments WHERE id=? AND thread_id=?"
  )
    .bind(commentId, threadId)
    .first<CommentRow>();
  check(comment, 404, "Comment not found.");
  if (reaction && request.method === "POST") {
    const data = await body(request);
    check(
      isEmoji(data.emoji) && typeof data.active === "boolean",
      400,
      "Invalid reaction."
    );
    await env.DB.batch([
      ...(data.active
        ? [
            env.DB.prepare(
              "DELETE FROM reactions WHERE comment_id=? AND user_id=?"
            ).bind(commentId, user.id),
          ]
        : []),
      data.active
        ? env.DB.prepare(
            "INSERT OR IGNORE INTO reactions(comment_id,user_id,emoji) VALUES(?,?,?)"
          ).bind(commentId, user.id, data.emoji)
        : env.DB.prepare(
            "DELETE FROM reactions WHERE comment_id=? AND user_id=? AND emoji=?"
          ).bind(commentId, user.id, data.emoji),
      env.DB.prepare("UPDATE threads SET updated_at=? WHERE id=?").bind(
        now,
        threadId
      ),
    ]);
    return json({ ok: true });
  }
  check(
    !reaction && comment.user_id === user.id,
    403,
    "Only the author can change this comment."
  );
  if (request.method === "PATCH") {
    const data = await body(request);
    await env.DB.batch([
      env.DB.prepare("UPDATE comments SET body=?,edited_at=? WHERE id=?").bind(
        string(data.body, 4000, "comment"),
        now,
        commentId
      ),
      env.DB.prepare("UPDATE threads SET updated_at=? WHERE id=?").bind(
        now,
        threadId
      ),
    ]);
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    // Preserve the thread and replies when the original comment is deleted.
    await env.DB.batch([
      env.DB.prepare("UPDATE comments SET body=?,edited_at=? WHERE id=?").bind(
        "[Comment deleted]",
        now,
        commentId
      ),
      env.DB.prepare("DELETE FROM reactions WHERE comment_id=?").bind(
        commentId
      ),
      env.DB.prepare("UPDATE threads SET updated_at=? WHERE id=?").bind(
        now,
        threadId
      ),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(405, "Method not allowed.");
}

/** Normalized group tag: lowercase, up to 32 letters, numbers, spaces, dots, underscores, or hyphens. */
function tagValue(value: unknown): string {
  const tag = string(value, 32, "tag").trim().toLocaleLowerCase("en-US");
  check(
    /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u.test(tag),
    400,
    "Use a tag with up to 32 letters, numbers, spaces, dots, underscores, or hyphens.",
  );
  return tag;
}

function parseTags(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}
const settingsFor = new WeakMap<Env, Env>();
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(maintain(env.DB, true));
    ctx.waitUntil(drainWebhooks(paletteEnv(env)));
  },
  async fetch(request, settings, ctx) {
    // Deployments configured before the rename set KOMO_ names. One copy per
    // bindings object keeps the per-env caches (sign-in options) warm.
    let env = settingsFor.get(settings);
    if (!env) settingsFor.set(settings, (env = paletteEnv(settings)));
    let response: Response;
    // An unapproved site may read why /config refused it, and nothing else.
    let refusedSite = false;
    try {
      response = await route(request, env, ctx);
    } catch (error) {
      refusedSite =
        error instanceof HttpError &&
        error.code === "site_not_approved" &&
        new URL(request.url).pathname === "/config";
      if (refusedSite && request.method === "OPTIONS")
        response = new Response(null, { status: 204 });
      else if (error instanceof HttpError)
        response = json(
          error.code
            ? { error: error.message, code: error.code }
            : { error: error.message },
          error.status
        );
      else if (
        error instanceof Error &&
        error.message.includes("komo_quota_exceeded")
      )
        response = json(
          {
            error:
              "This workspace reached its storage or comment limit. Export your feedback or use your own deployment.",
          },
          409
        );
      else {
        console.error("comments_request_failed", {
          path: new URL(request.url).pathname,
          // A misconfigured option names itself; other errors stay private.
          ...(error instanceof ConfigError ? { config: error.message } : {}),
        });
        response = json(
          { error: "Comments are temporarily unavailable. Try again." },
          500
        );
      }
    }
    const project = new URL(request.url).searchParams.get("project");
    let config: { origins: string[] } | undefined;
    try {
      config = project
        ? project === "_komo" && env.PALETTE_HOSTED === "true"
          ? { origins: [new URL(request.url).origin] }
          : await projectConfig(env, project)
        : undefined;
    } catch {
      // Do not leak a successful body or allow CORS without a known site policy.
      response = json({ error: "Comments are temporarily unavailable. Try again." }, 500);
    }
    const headers = new Headers(response.headers);
    const origin = request.headers.get("Origin") ?? "";
    // The proxy session exchange is for CLIs and agents: never readable cross-origin.
    const pathname = new URL(request.url).pathname;
    if (
      !PROXY_SESSION_PATHS.some((path) => pathname.endsWith(path)) &&
      config &&
      (originAllowed(origin, config.origins) ||
        (project !== "_komo" && localOrigin(origin)) ||
        (refusedSite && originAllowed(origin, [origin])))
    ) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS"
      );
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
      headers.set("Access-Control-Max-Age", "600");
    }
    headers.set("Vary", "Origin");
    // Only authenticated snapshot reads opt into a private browser cache.
    if (!(response.ok && headers.get("Cache-Control")?.startsWith("private")))
      headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;

export { drainWebhooks } from "./webhooks";
