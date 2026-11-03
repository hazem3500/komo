# Run the komo API in a Node container

The browser widget and CLI use the same API protocol on Cloudflare and Node. This option uses PostgreSQL and does not change an existing Worker/D1 deployment. It starts one API service for your preview sites; each project key maps to one repository and an allowlist of site origins.

## Configure

1. In your website repository, install komo and generate the Node project:

   ```sh
   npm install @hazem3500/komo
   npx komo init --node \
     --endpoint https://comments.example.com \
     --origin https://pr-42.preview.example.com \
     --preview-origin 'https://pr-*.preview.example.com' \
     --repo your-org/your-repo \
     --branch-scope \
     --google-client-id YOUR_GOOGLE_CLIENT_ID
   ```

   This writes `.komo/node.env` and `.komo/owner-key`, adds them to `.gitignore`, and configures the existing widget and agent CLI. The preview wildcard matches one hostname label under a domain you control. The endpoint is the **public API origin**, not a preview URL. For local development it may use HTTP localhost. Keep the generated owner key private.

2. Provide a PostgreSQL database with a dedicated user allowed to create tables and triggers. Replace the `DATABASE_URL` and `GOOGLE_CLIENT_SECRET` placeholders in `.komo/node.env`. Add the printed `https://comments.example.com/auth/google/callback` URL to the Google OAuth client's authorized redirect URIs. In Cloud Run, supply the same variables through service configuration and a secret store. Do not commit the environment file. The Node runtime does not enable hosted provisioning (`KOMO_HOSTED`).

   To enable signed webhooks, generate a 32-byte encryption key with `openssl rand -base64 32` and provide `KOMO_WEBHOOK_KEYS` through your secret manager as `{"current":"key-id","keys":{"key-id":"BASE64_KEY"}}`. Never store the key in source control or expose it in logs. Webhook endpoints must use HTTPS on port 443; the Node sender rejects private or mixed DNS answers and pins the vetted public address for the request.

3. Build this repository's image with `docker build -f Dockerfile.node -t komo-node .`. Run it with the generated variables and HTTPS in front. For a local check, set `PUBLIC_URL=http://localhost:8080` in `.komo/node.env` and run `docker run --env-file /path/to/your-website/.komo/node.env -p 8080:8080 komo-node`. For Cloud Run, set the container port to 8080. Cloud SQL or another reachable PostgreSQL service can be used through `DATABASE_URL`; the database connection URL must be reachable from the container. Startup applies the bundled schema under a database lock. `/health` returns `{"ok":true}` after migrations succeed.

   The image installs the PostgreSQL client (`pg`). To run `@hazem3500/komo/node` outside it, install `pg` next to komo: it is an optional peer, so browser installs of komo never include it.

4. Open the owner-claim URL printed by `komo init --node` and sign in with Google. The setup page claims ownership once; the owner can then manage approved sites and private access. The generated widget config contains your project key. Use the same project key and branch in the bot CLI.

For a guest-only project, you can skip the generator and set `DATABASE_URL`, `PUBLIC_URL`, and `PROJECTS` directly. For example, `PROJECTS={"review":{"repo":"your-org/your-repo","origins":["https://pr-*.preview.example.com"],"allowGuests":true}}`. Anyone on an approved site can then comment; do not use guest-only mode for confidential reviews. `PROJECTS` must remain on one line in an env file. Google sign-in requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Approved origins

Each `origins` entry in `PROJECTS` is an exact origin or a pattern:

- `https://pr-*.preview.example.com`: `*` in the leftmost host label matches one label of letters, digits and hyphens. It never spans dots.
- `https://dev.example.com:*`: a trailing `:*` matches any port on that host, and also no port, which is how browsers send the default port 443. It never widens the host or the scheme, so `https://evil-dev.example.com:3000` and `https://dev.example.com.evil.test:3000` don't match. It combines with a host wildcard, as in `https://*-preview.example.com:*`.
- `http://localhost:*` and `http://127.0.0.1:*`: local development on any port.

The server refuses to start on an invalid entry and names it, for example `PROJECTS.review has an invalid origin "https://dev.example.com:4*"`.

### Serve under a path

If a reverse proxy serves komo under a path, include it in `PUBLIC_URL`, for example `PUBLIC_URL=https://comments.example.com/komo`. Every URL komo generates then includes `/komo`: sign-in links and popups, OAuth redirect URIs, setup and invitation pages, and snapshot links. Requests are accepted whether or not the proxy strips the path. Register OAuth redirect URIs with the path, for example `https://comments.example.com/komo/auth/google/callback`.

### Sign in through an identity proxy

Behind a proxy that authenticates users and signs each request, komo can trust the proxy's identity instead of running its own OAuth client. This is off by default. One provider is supported:

- **`KOMO_PROXY_AUTH=gcp-iap`:** Google Cloud Identity-Aware Proxy (IAP). Set **`KOMO_PROXY_AUDIENCE`** to the backend audience, `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID`. komo verifies the `x-goog-iap-jwt-assertion` ES256 JWT against Google's IAP keys. It caches them for an hour, and fetches them again for an unknown key ID, at most every 30 seconds. It checks the issuer, audience, expiry and issue time, allowing 60 seconds of clock skew. The subject must be `accounts.google.com:DIGITS`. The account ID is `google:DIGITS`, the same ID Google OAuth sign-in uses, so an existing account signs in as itself. The email is stored in lower case. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` aren't needed.
- **`KOMO_IAP_AUDIENCE`**, the older name, still works: set alone, it means `gcp-iap` with that audience.
- **`KOMO_AUTH_PATH_PREFIX`** (optional, for example `/backoffice`, older name `KOMO_AUTH_PREFIX`): serves the sign-in handlers only under this path, so the proxy can protect just that path. Without the prefix, those handlers return 404. It needs `KOMO_PROXY_AUTH`; set without one, the server doesn't start.

Any other `KOMO_PROXY_AUTH` value stops the server at startup with the list of supported providers.

The sign-in handlers are:

- `PREFIX/auth/google/authorize`: the browser popup. It checks the one-use sign-in state from `/auth/google/start`, mints a session for the proxy's account without a Google redirect, and posts it to the site that opened it. The page sends `Cache-Control: no-store` and a nonce-based Content Security Policy with `frame-ancestors 'none'`.
- `POST PREFIX/auth/proxy/session?project=KEY` (older name `/auth/iap/session`): agents and CLIs exchange their proxy identity for a project session, returned as `{"token":…,"user":…}`. It's limited to 60 sessions an hour per account and project.

While a proxy is on:

- Google is the only sign-in method, and `/config` reports `google: true`. GitHub sign-in returns 503, and the GitHub and Google OAuth handlers return 403 or 404.
- Reads need a session and guests are off, whatever `KOMO_REQUIRE_SESSION_FOR_READS` and `KOMO_ALLOW_GUESTS` say. Reading or writing comments also needs a session from a Google account. Sessions from before the proxy was turned on, from guests or GitHub, are refused.
- Missing, forged, expired, future-dated or wrong-audience assertions are rejected.
- The rest of the API stays outside the proxy: the widget calls it cross-origin with the bearer session from the popup.
- IAP carries only an email, so reviewers show their initial. Pass the widget's `avatar` option to supply photo URLs. Reviewers who signed in with Google OAuth before keep their stored photo.

Make sure clients can't reach the prefixed handlers without going through the proxy. The signed assertion check rejects forged headers either way.

### Reader, guest and session options

Each option is off by default and works on Node and on a self-hosted Worker:

- **`KOMO_REQUIRE_SESSION_FOR_READS=true`:** listing or fetching threads and comments needs a valid session. Other reads, such as snapshots, usage and exports, already need one. Anonymous reads return 401 `Sign in to see comments.` Guest sessions still count, unless guests are off.
- **`KOMO_ALLOW_GUESTS=false`:** refuses guest sign-in on every project with `Guest comments are disabled.`, and refuses existing guest sessions with the same message. `/config` then reports `guests: false` and `snapshots.guests: false`, even if a project sets `allowGuestSnapshots`. While guests are allowed, a project's own `allowGuests: false` still applies.
- **`KOMO_SESSION_MAX_AGE_DAYS=N`** (1 to 36500): new sessions expire after N days, and existing sessions older than N days are refused. Without it, sessions last until sign-out (100 years). Sessions store only their expiry, so a session with more time left than the cap counts as issued with the 100-year lifetime. Lowering the cap therefore also refuses sessions issued under a higher cap that still have more time left than the new one. Personal access tokens keep the expiry chosen when they were created.

The flags take only `true` or `false`. An invalid value stops the Node server at startup, and makes every Worker request fail with the option named in the logs.

### Deploy behind Google Cloud IAP

Build the image with `docker build -f Dockerfile.node -t komo-node .`. It runs `pnpm --filter @hazem3500/komo build`, which builds the server with `build:node`, and starts `node packages/komo/dist/node.mjs`. Outside Docker, run `pnpm install --frozen-lockfile && pnpm --filter @hazem3500/komo build`, then `node packages/komo/dist/node.mjs`.

Put only `PREFIX/auth/google/authorize` and `PREFIX/auth/proxy/session` behind IAP. Leave the rest of the API outside it.

| Variable | Purpose | Default | Example |
| --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | required | `postgresql://komo:PASSWORD@postgres:5432/komo` |
| `PUBLIC_URL` | Public URL, including any path the gateway strips | required | `https://comments.example.com/komo` |
| `PROJECTS` | Project keys, repositories and approved origins, on one line | required | `{"site":{"repo":"your-org/your-repo","origins":["https://*-web.preview.example.com","https://dev.example.com:*"],"allowGuests":false}}` |
| `PORT` | Listen port | `8080` | `8080` |
| `KOMO_PROXY_AUTH` | Identity proxy provider | off | `gcp-iap` |
| `KOMO_PROXY_AUDIENCE` | IAP audience (older name `KOMO_IAP_AUDIENCE`) | unset | `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID` |
| `KOMO_AUTH_PATH_PREFIX` | Path IAP protects for sign-in (older name `KOMO_AUTH_PREFIX`) | none | `/backoffice` |
| `KOMO_SESSION_MAX_AGE_DAYS` | Session lifetime cap | unset (100 years) | `30` |
| `KOMO_TRUSTED_PROXY_HOPS` | Proxies that append `X-Forwarded-For` before komo (older name `KOMO_PROXY_HOPS`) | `0` | `3` |
| `KOMO_REQUIRE_SESSION_FOR_READS` | Reads need a session | `false` | forced `true` by the proxy; leave unset |
| `KOMO_ALLOW_GUESTS` | Guest sign-in | `true` | forced `false` by the proxy; leave unset |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth | unset | not needed with IAP |
| `KOMO_TOKEN_PEPPER` | Secret mixed into access token hashes | unset | a long random secret |
| `KOMO_WEBHOOK_KEYS` | Webhook secret encryption keys | unset | see Configure, step 2 |

### Move a patched upstream server to this package

For a server that ran upstream komo with a local IAP patch:

1. Back up and upgrade the database as in [Upgrade a database from upstream komo](#upgrade-a-database-from-upstream-komo). This package adds no migrations of its own for these options.
2. Keep `KOMO_IAP_AUDIENCE`, or rename it to `KOMO_PROXY_AUTH=gcp-iap` plus `KOMO_PROXY_AUDIENCE`. `KOMO_PROXY_HOPS` keeps its meaning.
3. Replace a patched session lifetime with `KOMO_SESSION_MAX_AGE_DAYS`. Sessions issued with that lifetime stay valid until they expire. Sessions issued with upstream's 100-year lifetime are dated from when they were issued.
4. Set `PUBLIC_URL` to the external URL, including the path the gateway strips, and `KOMO_AUTH_PATH_PREFIX` to the path IAP protects. `/auth/google/start` then returns `https://HOST/PATH/PREFIX/auth/google/authorize`, so a proxy rewrite of that response is no longer needed. komo serves the prefixed handlers itself.
5. Point health checks at `GET /health`. komo doesn't answer `GET /` with 200.

## Connect a preview and bot

Use the existing widget options; only its API endpoint changes:

```js
initKomo({
  endpoint: "https://comments.example.com",
  project: "YOUR_GENERATED_PROJECT_KEY",
  repo: "your-org/your-repo",
  scope: "branch",
  branch: "pr-42",
});
```

Point the existing CLI at the same endpoint, project, repository, and branch. `komo login` uses Google when configured; `KOMO_TOKEN` accepts a personal access token (create one at `/account?project=KEY` on your server; see Bots and CI in the README) or a previously issued session token for a non-interactive bot. Store that token as a secret. Access tokens are limited by their scopes and projects; session tokens have the same permissions as their user. Optionally set `KOMO_TOKEN_PEPPER` to a long random secret to mix into stored token hashes; changing it revokes every access token. For example:

```sh
komo comments list --endpoint https://comments.example.com --project YOUR_GENERATED_PROJECT_KEY --repo your-org/your-repo --branch pr-42 --origin https://pr-42.preview.example.com
komo comments reply THREAD_ID --body "Fixed and verified" --endpoint https://comments.example.com --project YOUR_GENERATED_PROJECT_KEY --repo your-org/your-repo --branch pr-42 --origin https://pr-42.preview.example.com
komo comments resolve THREAD_ID --endpoint https://comments.example.com --project YOUR_GENERATED_PROJECT_KEY --repo your-org/your-repo --branch pr-42 --origin https://pr-42.preview.example.com
```

The `--origin` value must be one approved preview origin. Each PR needs the same branch value in widget and bot to isolate its feedback. On the same project, an owner can edit approved sites after Google sign-in. Wildcard origins match one hostname label only, so `pr-*.preview.example.com` does not allow arbitrary subdomains of `example.com`.

## Upgrade a database from upstream komo

A database created by upstream komo's Node server is upgraded in place. That server records schema version 1 in `komo_schema`. On first boot, this server takes the migration lock and finds version 1. It applies `002_thread_tags.sql` through `006_thread_scope.sql` in one transaction and records version 6. These migrations only add tables, and columns that have defaults. Existing threads get no tags and page scope, and webhooks stay off. No rows are rewritten or deleted. Existing sessions keep working, so reviewers stay signed in. If a step fails, the transaction rolls back and the server exits with the schema unchanged. Later boots find version 6 and change nothing. `test/postgres-upstream-upgrade.test.ts` checks this against upstream commit `738da17`.

1. Back up first, with a `pg_dump` from the same or a newer PostgreSQL major version: `pg_dump --format=custom --no-owner --file komo-before-upgrade.dump "$DATABASE_URL"`.
2. Stop the old server. Then start this one with the same `DATABASE_URL`. `/health` returns `{"ok":true}` after the migrations finish.

To roll back, restore the backup. Redeploying the old image is not enough: the upstream server refuses version 6 with `Unsupported PostgreSQL schema version`. Stop the server and create an empty database. Run `pg_restore --no-owner --exit-on-error --dbname "$NEW_DATABASE_URL" komo-before-upgrade.dump`, then start the old image with that URL. The backup doesn't include feedback written after the upgrade. To keep a copy, run `komo project export --out comments.json` against this server before you restore.

## Database boundary

The API's storage contract is `prepare().bind().first()/all()/run()` plus atomic `batch()`. `server/postgres.ts` implements it with a PostgreSQL pool, parameterized statements, and one transaction per batch. `server/postgres/001_initial.sql` mirrors the SQLite schema and its quota, revision, retention, and deletion triggers; later numbered files, such as `005_snapshots.sql` for element snapshots (`bytea`), mirror later D1 migrations. Add a numbered PostgreSQL migration whenever the D1 schema changes. Existing D1 migrations and the Worker entry point stay separate. The Node server runs the same request handler; transport and storage are the only new adapters.

The Node process runs retention cleanup after requests, as the self-hosted Worker does. It handles `SIGTERM` by closing its HTTP listener and database pool. Database connection failures prevent startup; request errors return the existing API error format. Rate limits use the direct socket IP by default, and never trust a client's `X-Forwarded-For`. Behind trusted reverse proxies, set `KOMO_TRUSTED_PROXY_HOPS` (older name `KOMO_PROXY_HOPS`, 0 to 8) to the number of proxies that append to `X-Forwarded-For` before the app. The client address is then that many entries from the right; entries further left are ignored. If the header has fewer entries, or that entry isn't an IP address, the socket IP is used. Check your load balancer’s forwarding behavior for the correct value, and only set it when requests can't bypass those proxies. Client-supplied `CF-Connecting-IP` is ignored. The Cloudflare Worker uses Cloudflare's `CF-Connecting-IP`.
