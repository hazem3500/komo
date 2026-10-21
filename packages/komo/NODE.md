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

### Serve under a path

If a reverse proxy serves komo under a path, include it in `PUBLIC_URL`, for example `PUBLIC_URL=https://labs.example.com/komo`. Sign-in links and redirect URLs then include `/komo`. Requests are accepted whether or not the proxy strips the path. Register OAuth redirect URIs with the path, for example `https://labs.example.com/komo/auth/google/callback`.

### Google Cloud Identity-Aware Proxy (IAP) sign-in

Behind a Google Cloud load balancer with IAP, komo can trust IAP's signed identity instead of running its own Google OAuth client. This is off by default. To turn it on:

- **`KOMO_IAP_AUDIENCE`:** set it to the IAP backend audience, `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID`. komo then verifies the `x-goog-iap-jwt-assertion` header against Google's IAP signing keys, checking the issuer, audience and expiry. It mints a session for that Google account, so `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` aren't needed.
- **`KOMO_AUTH_PREFIX`** (optional, for example `/backoffice`): serves the sign-in handlers only under this prefix, so the load balancer can protect just that path with IAP. The handlers are `PREFIX/auth/google/authorize` (the browser popup) and `POST PREFIX/auth/iap/session?project=KEY` (agents exchange their IAP identity for a project session). The same handlers without the prefix return 404.

While IAP is on:

- Google is the only sign-in method. Guest and GitHub sign-in are refused.
- Reading or writing comments requires a session from an IAP-verified account.
- Missing, forged, expired or wrong-audience assertions are rejected.
- The rest of the API stays outside IAP: the widget calls it cross-origin with the bearer session from the popup.
- IAP carries only an email, so reviewers show their initial. Pass the widget's `avatar` option to supply photo URLs; reviewers who signed in with Google OAuth before keep their stored photo.

Make sure clients can't reach the prefixed handlers without going through IAP. The signed assertion check rejects forged headers either way.

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

## Database boundary

The API's storage contract is `prepare().bind().first()/all()/run()` plus atomic `batch()`. `server/postgres.ts` implements it with a PostgreSQL pool, parameterized statements, and one transaction per batch. `server/postgres/001_initial.sql` mirrors the SQLite schema and its quota, revision, retention, and deletion triggers; later numbered files, such as `005_snapshots.sql` for element snapshots (`bytea`), mirror later D1 migrations. Add a numbered PostgreSQL migration whenever the D1 schema changes. Existing D1 migrations and the Worker entry point stay separate. The Node server runs the same request handler; transport and storage are the only new adapters.

The Node process runs retention cleanup after requests, as the self-hosted Worker does. It handles `SIGTERM` by closing its HTTP listener and database pool. Database connection failures prevent startup; request errors return the existing API error format. Rate limits use the direct socket IP by default. Behind a trusted reverse proxy, set `KOMO_PROXY_HOPS` to the number of proxy-added `X-Forwarded-For` entries before the app; check your load balancer’s forwarding behavior for the correct value. Only enable this when requests cannot bypass that proxy. Client-supplied `CF-Connecting-IP` is ignored.
