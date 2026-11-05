# Run the Palette API in a Node container

The browser widget and CLI use the same API protocol on Cloudflare and Node. This option uses PostgreSQL and does not change an existing Worker/D1 deployment. It starts one API service for your preview sites; each project key maps to one repository and an allowlist of site origins.

## Configure

1. In your website repository, install Palette and generate the Node project:

   ```sh
   npm install @hazem3500/palette
   npx palette init --node \
     --endpoint https://comments.example.com \
     --origin https://pr-42.preview.example.com \
     --preview-origin 'https://pr-*.preview.example.com' \
     --repo your-org/your-repo \
     --branch-scope \
     --google-client-id YOUR_GOOGLE_CLIENT_ID
   ```

   This writes `.palette/node.env` and `.palette/owner-key`, adds them to `.gitignore`, and configures the existing widget and agent CLI. The preview wildcard matches one hostname label under a domain you control. The endpoint is the **public API origin**, not a preview URL. For local development it may use HTTP localhost. Keep the generated owner key private.

2. Provide a PostgreSQL database with a dedicated user allowed to create tables and triggers. Replace the `DATABASE_URL` and `GOOGLE_CLIENT_SECRET` placeholders in `.palette/node.env`. Add the printed `https://comments.example.com/auth/google/callback` URL to the Google OAuth client's authorized redirect URIs. In Cloud Run, supply the same variables through service configuration and a secret store. Do not commit the environment file. The Node runtime does not enable hosted provisioning (`PALETTE_HOSTED`).

   To enable signed webhooks, generate a 32-byte encryption key with `openssl rand -base64 32` and provide `PALETTE_WEBHOOK_KEYS` through your secret manager as `{"current":"key-id","keys":{"key-id":"BASE64_KEY"}}`. Never store the key in source control or expose it in logs. Webhook endpoints must use HTTPS on port 443; the Node sender rejects private or mixed DNS answers and pins the vetted public address for the request.

3. Build this repository's image with `docker build -f Dockerfile.node -t komo-node .`. Run it with the generated variables and HTTPS in front. For a local check, set `PUBLIC_URL=http://localhost:8080` in `.palette/node.env` and run `docker run --env-file /path/to/your-website/.palette/node.env -p 8080:8080 komo-node`. For Cloud Run, set the container port to 8080. Cloud SQL or another reachable PostgreSQL service can be used through `DATABASE_URL`; the database connection URL must be reachable from the container. Startup applies the bundled schema under a database lock. `/health` returns `{"ok":true}` after migrations succeed.

   The image installs the PostgreSQL client (`pg`). To run `@hazem3500/palette/node` outside it, install `pg` next to Palette: it is an optional peer, so browser installs of Palette never include it.

4. Open the owner-claim URL printed by `palette init --node` and sign in with Google. The setup page claims ownership once; the owner can then manage approved sites and private access. The generated widget config contains your project key. Use the same project key and branch in the bot CLI.

For a guest-only project, you can skip the generator and set `DATABASE_URL`, `PUBLIC_URL`, and `PROJECTS` directly. For example, `PROJECTS={"review":{"repo":"your-org/your-repo","origins":["https://pr-*.preview.example.com"],"allowGuests":true}}`. Anyone on an approved site can then comment; do not use guest-only mode for confidential reviews. `PROJECTS` must remain on one line in an env file. Google sign-in requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Approved origins

Each `origins` entry in `PROJECTS` is an exact origin or a pattern:

- `https://pr-*.preview.example.com`: `*` in the leftmost host label matches one label of letters, digits and hyphens. It never spans dots.
- `https://dev.example.com:*`: a trailing `:*` matches any port on that host, and also no port, which is how browsers send the default port 443. It never widens the host or the scheme, so `https://evil-dev.example.com:3000` and `https://dev.example.com.evil.test:3000` don't match. It combines with a host wildcard, as in `https://*-preview.example.com:*`.
- `http://localhost:*` and `http://127.0.0.1:*`: local development on any port.

The server refuses to start on an invalid entry and names it, for example `PROJECTS.review has an invalid origin "https://dev.example.com:4*"`.

### Serve under a path

If a reverse proxy serves Palette under a path, include it in `PUBLIC_URL`, for example `PUBLIC_URL=https://comments.example.com/komo`. Every URL Palette generates then includes `/komo`: sign-in links and popups, OAuth redirect URIs, setup and invitation pages, and snapshot links. Requests are accepted whether or not the proxy strips the path. Register OAuth redirect URIs with the path, for example `https://comments.example.com/komo/auth/google/callback`.

### Sign in through an identity proxy

Behind a proxy that authenticates users and signs each request, Palette can trust the proxy's identity instead of running its own OAuth client. This is off by default. One provider is supported:

- **`PALETTE_PROXY_AUTH=gcp-iap`:** Google Cloud Identity-Aware Proxy (IAP). Set **`PALETTE_PROXY_AUDIENCE`** to the backend audience, `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID`. Palette verifies the `x-goog-iap-jwt-assertion` ES256 JWT against Google's IAP keys. It caches them for an hour, and fetches them again for an unknown key ID, at most every 30 seconds. A key fetch times out after 5 seconds. After a failed fetch it waits 30 seconds before trying again, and keeps verifying with the last keys for up to 24 hours. It checks the issuer, audience, expiry and issue time, allowing 60 seconds of clock skew. The subject must be `accounts.google.com:DIGITS`. The account ID is `google:DIGITS`, the same ID Google OAuth sign-in uses, so an existing account signs in as itself. The email is stored in lower case. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` aren't needed.
- **`PALETTE_IAP_AUDIENCE`**, the older name, still works: set alone, it means `gcp-iap` with that audience.
- **`PALETTE_AUTH_PATH_PREFIX`** (optional, for example `/backoffice`, older name `PALETTE_AUTH_PREFIX`): serves the sign-in handlers only under this path, so the proxy can protect just that path. Without the prefix, those handlers return 404. It needs `PALETTE_PROXY_AUTH`; set without one, the server doesn't start.

Any other `PALETTE_PROXY_AUTH` value stops the server at startup with the list of supported providers.

The sign-in handlers are:

- `PREFIX/auth/google/authorize`: the browser popup. It checks the one-use sign-in state from `/auth/google/start`, mints a session for the proxy's account without a Google redirect, and posts it to the site that opened it. The page sends `Cache-Control: no-store` and a nonce-based Content Security Policy with `frame-ancestors 'none'`.
- `POST PREFIX/auth/proxy/session?project=KEY` (older name `/auth/iap/session`): agents and CLIs exchange their proxy identity for a project session, returned as `{"token":…,"user":…}`. It's limited to 60 sessions an hour per account and project. It's only for clients that send no `Origin` header. A request whose `Origin` isn't the server's own is refused, and the response never carries CORS headers, so a web page can't turn a visitor's proxy sign-in into a token it can read.

While a proxy is on:

- Google is the only sign-in method, and `/config` reports `google: true`. GitHub sign-in returns 503, and the GitHub and Google OAuth handlers return 403 or 404.
- Reads need a session and guests are off, whatever `PALETTE_REQUIRE_SESSION_FOR_READS` and `PALETTE_ALLOW_GUESTS` say.
- Only sessions the proxy signed in are accepted, on every route. Each session records how it was signed in. Sessions from before the proxy was turned on are refused with 401 `Your session expired. Sign in again.`, whether from Google OAuth, GitHub or a guest, and reviewers sign in again through the proxy.
- Personal access tokens are refused with 403, and `/config` reports `tokens: false`. A token would keep working after the proxy stopped vouching for its owner. Agents use `/auth/proxy/session` instead.
- Missing, forged, expired, future-dated or wrong-audience assertions are rejected.
- The rest of the API stays outside the proxy: the widget calls it cross-origin with the bearer session from the popup.
- IAP carries only an email, so reviewers show their initial. Pass the widget's `avatar` option to supply photo URLs. Reviewers who signed in with Google OAuth before keep their stored photo.

Make sure clients can't reach the prefixed handlers without going through the proxy. The signed assertion check rejects forged headers either way.

Proxy sign-in completes without a consent screen: a reviewer already signed in to the proxy gets a session as soon as the popup opens. Any page on an approved origin can open that popup, so keep `origins` tight. A `:*` port wildcard approves every port on that host, including any local development server.

### Reader, guest and session options

Each option is off by default and works on Node and on a self-hosted Worker:

- **`PALETTE_REQUIRE_SESSION_FOR_READS=true`:** listing or fetching threads and comments needs a valid session. Other reads, such as snapshots, usage and exports, already need one. Anonymous reads return 401 `Sign in to see comments.`, and `/config` leaves out `repo` for callers without a session. Guest sessions still count, unless guests are off.
- **`PALETTE_ALLOW_GUESTS=false`:** refuses guest sign-in on every project with `Guest comments are disabled.`, and refuses existing guest sessions with the same message. `/config` then reports `guests: false` and `snapshots.guests: false`, even if a project sets `allowGuestSnapshots`. While guests are allowed, a project's own `allowGuests: false` still applies.
- **`PALETTE_SESSION_MAX_AGE_DAYS=N`** (1 to 36500): new sessions expire after N days, and sessions issued more than N days ago are refused, so lowering the cap applies to every existing session. Without it, sessions last until sign-out (100 years). Sessions record when they were issued from D1 migration `0021_session_origin` and PostgreSQL migration `007_session_origin`. Older sessions are dated by the 100-year lifetime, which is exact for them. A session that some other server issued with a shorter lifetime looks older than it is, so a cap refuses it. Personal access tokens keep the expiry chosen when they were created.

The flags take only `true` or `false`. An invalid value stops the Node server at startup, and makes every Worker request fail with the option named in the logs.

On a self-hosted Worker, apply the D1 migrations (`wrangler d1 migrations apply`) before turning on `PALETTE_PROXY_AUTH` or `PALETTE_SESSION_MAX_AGE_DAYS`. Without migration 0021, sessions are still issued as before, but those two options fail every authenticated request with a log naming the migration. The Node server applies its migrations at startup.

### Deploy behind Google Cloud IAP

Build the image with `docker build -f Dockerfile.node -t komo-node .`. It runs `pnpm --filter @hazem3500/palette build`, which builds the server with `build:node`, and starts `node packages/komo/dist/node.mjs`. Outside Docker, run `pnpm install --frozen-lockfile && pnpm --filter @hazem3500/palette build`, then `node packages/komo/dist/node.mjs`.

Put only `PREFIX/auth/google/authorize` and `PREFIX/auth/proxy/session` behind IAP. Leave the rest of the API outside it.

Google Cloud's external Application Load Balancer appends two `X-Forwarded-For` entries, the client's address and then the load balancer's forwarding rule address. Behind it alone, set `PALETTE_TRUSTED_PROXY_HOPS=2`. Add one for each proxy after it that appends the address it received from, such as nginx with `$proxy_add_x_forwarded_for`: a load balancer plus nginx is `3`. A proxy that passes the header through unchanged adds nothing.

Deployments configured before the rename keep working unchanged: each `PALETTE_*` variable below is also read under its older `KOMO_*` name (`KOMO_ALLOW_GUESTS`, `KOMO_TRUSTED_PROXY_HOPS` and so on) when the `PALETTE_*` name is unset or empty. When both are set, `PALETTE_*` wins.

| Variable | Purpose | Default | Example |
| --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | required | `postgresql://komo:PASSWORD@postgres:5432/komo` |
| `PUBLIC_URL` | Public URL, including any path the gateway strips | required | `https://comments.example.com/komo` |
| `PROJECTS` | Project keys, repositories and approved origins, on one line | required | `{"site":{"repo":"your-org/your-repo","origins":["https://*-web.preview.example.com","https://dev.example.com:*"],"allowGuests":false}}` |
| `PORT` | Listen port | `8080` | `8080` |
| `PALETTE_PROXY_AUTH` | Identity proxy provider | off | `gcp-iap` |
| `PALETTE_PROXY_AUDIENCE` | IAP audience (older name `PALETTE_IAP_AUDIENCE`) | unset | `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID` |
| `PALETTE_AUTH_PATH_PREFIX` | Path IAP protects for sign-in (older name `PALETTE_AUTH_PREFIX`) | none | `/backoffice` |
| `PALETTE_SESSION_MAX_AGE_DAYS` | Session lifetime cap | unset (100 years) | `30` |
| `PALETTE_TRUSTED_PROXY_HOPS` | `X-Forwarded-For` entries trusted proxies append (older name `PALETTE_PROXY_HOPS`) | `0` | `2` behind the load balancer alone; `3` with one appending proxy, such as nginx, after it |
| `PALETTE_REQUIRE_SESSION_FOR_READS` | Reads need a session | `false` | forced `true` by the proxy; leave unset |
| `PALETTE_ALLOW_GUESTS` | Guest sign-in | `true` | forced `false` by the proxy; leave unset |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth | unset | not needed with IAP |
| `PALETTE_TOKEN_PEPPER` | Secret mixed into access token hashes | unset | a long random secret |
| `PALETTE_WEBHOOK_KEYS` | Webhook secret encryption keys | unset | see Configure, step 2 |

### Move a patched upstream server to this package

For a server that ran upstream komo with a local IAP patch:

1. Back up and upgrade the database as in [Upgrade a database from upstream komo](#upgrade-a-database-from-upstream-komo). Migration `007_session_origin.sql` adds two nullable columns to `sessions`, recording how and when each session was signed in. Existing rows keep NULL.
2. Keep `PALETTE_IAP_AUDIENCE`, or rename it to `PALETTE_PROXY_AUTH=gcp-iap` plus `PALETTE_PROXY_AUDIENCE`. `PALETTE_PROXY_HOPS` keeps its meaning.
3. Replace a patched session lifetime with `PALETTE_SESSION_MAX_AGE_DAYS`. Behind the proxy, sessions issued before the upgrade aren't accepted, because nothing records that the proxy signed them in. Each reviewer and agent signs in through IAP once more. The popup does this without a prompt, and agents call `/auth/proxy/session`. Personal access tokens stop working behind the proxy.
4. Set `PUBLIC_URL` to the external URL, including the path the gateway strips, and `PALETTE_AUTH_PATH_PREFIX` to the path IAP protects. `/auth/google/start` then returns `https://HOST/PATH/PREFIX/auth/google/authorize`, so a proxy rewrite of that response is no longer needed. Palette serves the prefixed handlers itself.
5. Point health checks at `GET /health`. Palette doesn't answer `GET /` with 200.
6. Startup is stricter. A server now stops with a named error on:
   - a `PALETTE_PROXY_HOPS` value that isn't a single digit from 0 to 8, such as `01` or ` 1`;
   - `PALETTE_AUTH_PREFIX` set without a proxy;
   - a sign-in prefix with `.` or `..` segments;
   - a `PROJECTS` origin that isn't a valid pattern.

## Connect a preview and bot

Use the existing widget options; only its API endpoint changes:

```js
initPalette({
  endpoint: "https://comments.example.com",
  project: "YOUR_GENERATED_PROJECT_KEY",
  repo: "your-org/your-repo",
  scope: "branch",
  branch: "pr-42",
});
```

Point the existing CLI at the same endpoint, project, repository, and branch. `palette login` uses Google when configured; `PALETTE_TOKEN` accepts a personal access token (create one at `/account?project=KEY` on your server; see Bots and CI in the README) or a previously issued session token for a non-interactive bot. Store that token as a secret. Access tokens are limited by their scopes and projects; session tokens have the same permissions as their user. Optionally set `PALETTE_TOKEN_PEPPER` to a long random secret to mix into stored token hashes; changing it revokes every access token. For example:

```sh
palette comments list --endpoint https://comments.example.com --project YOUR_GENERATED_PROJECT_KEY --repo your-org/your-repo --branch pr-42 --origin https://pr-42.preview.example.com
palette comments reply THREAD_ID --body "Fixed and verified" --endpoint https://comments.example.com --project YOUR_GENERATED_PROJECT_KEY --repo your-org/your-repo --branch pr-42 --origin https://pr-42.preview.example.com
palette comments resolve THREAD_ID --endpoint https://comments.example.com --project YOUR_GENERATED_PROJECT_KEY --repo your-org/your-repo --branch pr-42 --origin https://pr-42.preview.example.com
```

The `--origin` value must be one approved preview origin. Each PR needs the same branch value in widget and bot to isolate its feedback. On the same project, an owner can edit approved sites after Google sign-in. Wildcard origins match one hostname label only, so `pr-*.preview.example.com` does not allow arbitrary subdomains of `example.com`.

## Upgrade a database from upstream komo

A database created by upstream komo's Node server is upgraded in place. That server records schema version 1 in `komo_schema`. On first boot, this server takes the migration lock and finds version 1. It applies `002_thread_tags.sql` through `007_session_origin.sql` in one transaction and records version 7. These migrations only add tables, columns that have defaults, and the nullable session columns `via` and `created_at`. Existing threads get no tags and page scope, webhooks stay off, and existing sessions keep NULL in the new columns. No rows are rewritten or deleted. Existing sessions keep working, so reviewers stay signed in, unless a sign-in proxy is turned on: then only sessions the proxy signs in are accepted. If a step fails, the transaction rolls back and the server exits with the schema unchanged. Later boots find version 7 and change nothing. `test/postgres-upstream-upgrade.test.ts` checks this against upstream commit `738da17`.

1. Back up first, with a `pg_dump` from the same or a newer PostgreSQL major version: `pg_dump --format=custom --no-owner --file komo-before-upgrade.dump "$DATABASE_URL"`.
2. Stop the old server. Then start this one with the same `DATABASE_URL`. `/health` returns `{"ok":true}` after the migrations finish.

To roll back, restore the backup. Redeploying the old image is not enough: the upstream server refuses version 7 with `Unsupported PostgreSQL schema version`. Stop the server and create an empty database. Run `pg_restore --no-owner --exit-on-error --dbname "$NEW_DATABASE_URL" komo-before-upgrade.dump`, then start the old image with that URL. The backup doesn't include feedback written after the upgrade. To keep a copy, run `palette project export --out comments.json` against this server before you restore.

## Database boundary

The API's storage contract is `prepare().bind().first()/all()/run()` plus atomic `batch()`. `server/postgres.ts` implements it with a PostgreSQL pool, parameterized statements, and one transaction per batch. `server/postgres/001_initial.sql` mirrors the SQLite schema and its quota, revision, retention, and deletion triggers; later numbered files, such as `005_snapshots.sql` for element snapshots (`bytea`), mirror later D1 migrations. Add a numbered PostgreSQL migration whenever the D1 schema changes. Existing D1 migrations and the Worker entry point stay separate. The Node server runs the same request handler; transport and storage are the only new adapters.

The Node process runs retention cleanup after requests, as the self-hosted Worker does. It handles `SIGTERM` by closing its HTTP listener and database pool. Database connection failures prevent startup; request errors return the existing API error format. Rate limits use the direct socket IP by default, and never trust a client's `X-Forwarded-For`. Behind trusted reverse proxies, set `PALETTE_TRUSTED_PROXY_HOPS` (older name `PALETTE_PROXY_HOPS`, 0 to 8) to the number of `X-Forwarded-For` entries those proxies append before the app. Most proxies append one; Google Cloud's external Application Load Balancer appends two (see [Deploy behind Google Cloud IAP](#deploy-behind-google-cloud-iap)). The client address is then that many entries from the right; entries further left are ignored. If the header has fewer entries, or that entry isn't an IP address, the socket IP is used. Check your load balancer’s forwarding behavior for the correct value, and only set it when requests can't bypass those proxies. Client-supplied `CF-Connecting-IP` is ignored. The Cloudflare Worker uses Cloudflare's `CF-Connecting-IP`.

### Proxy access tokens (operator opt-in)

Proxy access tokens are off by default. To enable management and use, keep
`PALETTE_PROXY_AUTH=gcp-iap`, `PALETTE_PROXY_AUDIENCE` set to your IAP audience,
and your existing `PALETTE_AUTH_PATH_PREFIX` (for example `/backoffice`); additionally set
`PALETTE_PROXY_ACCESS_TOKENS=true` (Worker vars or Node environment). The legacy
`KOMO_PROXY_ACCESS_TOKENS` alias works when the Palette setting is unset.
Preserve your existing public path and proxy routing configuration.

Mint, list and revoke require a verified Google account's valid project session
issued through the proxy. A PAT cannot manage tokens. By default, mint requests must supply
`projects` as a nonempty explicit grant, `expiresInDays` from 1 to 365, and at
least one of `comments:read` / `comments:write`. The account UI offers these
constraints; the list response adds `policy: { explicitProjects: true,
maxLifetimeDays: 365, noExpiry: false }`. `config.tokens` advertises the opt-in.

The operator opts into credentials that remain usable independently of IAP access
until they expire or are revoked; removing IAP access alone does not revoke a PAT.

Without the separate allowances below, existing tokens with no expiry or no explicit
project grant are refused behind the proxy. Finite lifetimes over 365 days are always refused. Bounded, explicitly scoped
existing tokens remain usable. Nonproxy token policy is unchanged. Snapshot GET
requires `comments:read`, the granted project and an allowed Origin. No deployment
is enabled by this configuration example.

### Webhook delivery and snapshot readiness

Apply PostgreSQL migration 008 (automatic at Node startup) or D1 migration
0022 before running this version. Comment creation, replies and resolution
commit their selected webhook into `webhook_outbox` in the same transaction as
the mutation. No destination is configured by default. The outbox pins the URL,
encrypted signing secret, event ID and exact JSON bytes at creation. Changing or
disabling project webhook settings affects future events; queued events retain
their destination. Keep old encryption keys available until those entries drain.

Node drains every 10 seconds. Workers must configure a recurring Cron Trigger
(for example every minute); the exported Worker `scheduled` handler drains the
outbox. Custom runtimes can import `drainWebhooks` from the server export and
call `await drainWebhooks(env)` periodically. Request `waitUntil` only accelerates
these committed deliveries. Worker deployments must supply their existing
`PALETTE_WEBHOOK_SEND` transport; it must reject non-2xx responses, reject within
5 seconds, validate DNS against private addresses, pin the validated address,
and never follow redirects. No unsafe fetch transport is installed implicitly.
The built-in Node transport enforces public DNS/IP pinning and bounded DNS/send
timeouts, and now rejects all non-2xx responses.

Each drain claims at most 20 entries, one at a time, with an atomic conditional
UPDATE and a 30-second lease. Six attempts maximum, including interrupted
attempts; failed attempts wait 10, 20, 40, 80 and 160 seconds (plus scheduling
latency). Expired claims can be recovered by another process. Completion uses
the claim token so a stale worker cannot acknowledge a newer claim. The drain
stops waiting for an attempt after 5 seconds. Custom transports must enforce
that bound themselves: a Promise timeout cannot cancel their network effects.
Delivery is at least once: a crash after remote acceptance can cause duplicates.
Deduplicate by `X-Palette-Delivery` (legacy `X-Komo-Delivery` is identical).
Each attempt signs the stored body with a fresh current Unix-second timestamp;
header aliases and the `timestamp + "." + body` HMAC format are unchanged.

Operators can inspect `id,project,attempts,state,next_attempt,claim_until` in
`webhook_outbox`; attempt/lease times are Unix milliseconds.
`delivered` and `exhausted` are retained; no automatic purge or
external delivery-management endpoint is provided. After fixing a receiver,
explicitly reset an exhausted entry's `attempts=0,state='pending',next_attempt=0,
claim_until=0,claim_token=''` to replay its same ID/body. Do not reset an active
lease. Purge retained entries using your database retention policy; bodies may
contain comment content. Outbox rows are independent of thread deletion.

`config.snapshots.readiness: true` advertises this protocol; clients omit new
intent fields and terminal reports on older servers.
`POST /threads` accepts optional boolean `snapshotIntent`. Its `comment.created`
event gains `snapshotStatus: 'pending'` for true or `'skipped'` for false.
Omitting intent leaves status unknown and preserves the existing event fields,
so older clients can still upload later without claiming an intentional skip.
Legacy intent is never inferred from an image 404. There is no new snapshot event.

Authenticated `GET /threads/:id/snapshot` returns `{status,kinds}`. `status` is
`pending`, `ready`, `skipped`, `failed`, or `unknown` (legacy/imported threads).
`kinds` lists stored `image`/`html` captures. Any successfully stored kind means
ready; it does not promise both kinds. The upload transaction sets ready.
Pending capture older than ten minutes reads as failed, bounding abandoned
client captures. A later successful upload can still make it ready.
`POST /threads/:id/snapshot` with JSON `{status:'skipped'}` or `{status:'failed'}`
terminates a pending capture; clients report intentional omissions and upload
failures this way. A failed status report falls back to the ten-minute deadline.
Deleting the final stored kind makes status skipped. Kind-specific GET routes
retain their existing 404 semantics. Snapshot status reads use existing
project/repo/branch authentication and PAT `comments:read`; writes retain guest
consent and author/reviewer checks and PAT `comments:write`. No token enablement
policy changes are included.

Proxy token operator allowances: `PALETTE_PROXY_TOKEN_ALL_PROJECTS=true` enables All your projects; `PALETTE_PROXY_TOKEN_NO_EXPIRY=true` enables Never expires. Both default to false and require `PALETTE_PROXY_ACCESS_TOKENS=true`. Their `KOMO_` aliases apply when the corresponding `PALETTE_` value is unset. Finite expiry remains capped at 365 days. All-project grants include current and future projects the account owns or has joined, checked on every use; removing membership removes access unless another ownership or membership grant remains. Disable an allowance to reject existing tokens using it, or revoke individual tokens when offboarding. Non-proxy token policy is unchanged.
