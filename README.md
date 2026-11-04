# Palette

[![npm version](https://img.shields.io/npm/v/@hazem3500/palette)](https://www.npmjs.com/package/@hazem3500/palette)
[![downloads](https://img.shields.io/npm/dm/@hazem3500/palette)](https://www.npmjs.com/package/@hazem3500/palette)

Comments for your website. Point at an element, mark an area, and leave feedback your team can reply to, resolve, or copy into a coding agent.

Framework independent. Shared persistence. Google identities and guest reviewers.

Review actions update immediately while saving in the background. Failed writes roll back with a notice; unsaved comment text is retained.

## Install

```sh
npm install @hazem3500/palette
npx @hazem3500/palette init
```

Requires Node.js 22 or newer. The package was published as `@hazem3500/komo` before the rename.

The setup command detects your Git repository, creates a project, and asks you to sign in with Google. It prints a public project key and a ready-to-paste inline configuration. It also saves settings to `.palette/project.json` and generates an optional `palette.config.js` helper.

Hosted onboarding is available through the dedicated Palette service. Self-hosting is available through the same CLI.

## Usage

Mount after the page has loaded:

```js
import { initPalette } from '@hazem3500/palette';
initPalette({ project: 'YOUR_PROJECT_KEY' });
```

Optional configuration stays at the call site:

```js
initPalette({
  project: 'YOUR_PROJECT_KEY',
  enabled: import.meta.env.DEV || import.meta.env.PUBLIC_PREVIEW === 'true',
  pageRoot: document.querySelector('#app'),
});
```

### React

With React 18.2 or 19, call the hook once near your app root:

```tsx
'use client'; // Required for Next.js App Router client components.
import { usePalette } from '@hazem3500/palette/react';

export function Palette() {
  usePalette({ project: 'YOUR_PROJECT_KEY' });
  return null;
}
```

Render `<Palette />` in your app or layout. The hook handles mounting, cleanup, and React Strict Mode. Inline configuration objects are supported; unchanged values do not restart Palette. Changing configuration remounts it, and `enabled: false` removes it. Memoize callback options with `useCallback` and pass stable DOM elements for `pageRoot` or `drawerContainer`. Mount only one hook per page; do not combine it with a separate `initPalette()` call. Server rendering does not mount the tool.

The **endpoint is the comments API**, not your website or preview URL. Hosted Palette defaults to `https://komo.offbr.co`. Google sign-in returns to `https://komo.offbr.co/auth/google/callback`, regardless of the website embedding Palette. For self-hosting, pass the Worker URL as `endpoint`. Your current page comes from the browser. Setup detects repository metadata from Git; include its printed `repo` value to enrich agent prompts.

Comments are shared across deployments by default. Use `pnpm exec palette init --branch-scope` to separate them by branch. For automatic branch detection, import from the optional generated `palette.config.js` helper and run `palette sync` before builds. It detects the current branch from deployment environment variables or Git; set `PALETTE_BRANCH` if neither is available. It fails rather than silently grouping unknown branches.

## Features

- Point and area comments anchored to page elements.
- Replies, reactions, author-only editing, resolution, and undo.
- Searchable sidebar, draggable dock, and Google or guest profiles.
- Copy open feedback with selectors, source paths, page URLs, replies, and geometry into an agent.
- A separate Cloudflare Worker and D1 database, hosted or in your own account.

## Agent CLI

`palette init` adds the default comment workflow to `AGENTS.md`, preserving existing instructions. For an existing project, run `palette agents setup` from its root. Commit the instructions so every agent uses them.

Before editing, agents read open comments, export the relevant prompt, and read replies. After verifying a simple fix, an agent can reply with evidence and resolve it at **90%+ confidence**. Complex or uncertain work stays open with a question or progress reply. This is guidance for your coding agent; the CLI does not run an agent or measure its confidence.

Requires `@hazem3500/palette` 0.2.0 or later. Connect your coding agent to the same comments your team sees in the browser:

```sh
npm install @hazem3500/palette@latest
npx @hazem3500/palette login
npx @hazem3500/palette comments list
npx @hazem3500/palette comments get THREAD_ID
npx @hazem3500/palette comments reply THREAD_ID --body "Fixed and verified on mobile."
npx @hazem3500/palette comments resolve THREAD_ID
```

Run these from a project configured with `palette init`. The CLI searches parent directories for `.palette/project.json`. Google sign-in opens a local browser handoff; `--no-open` prints the local sign-in link instead. Credentials are stored outside your repository in `~/.config/komo`, with a private file per API/project. Sessions stay valid until you sign out. `palette logout` revokes the session and removes its file.

For an existing inline installation, pass `--project YOUR_PROJECT_KEY --origin https://your-site.example`. `--origin` is an approved website address; `--endpoint` is the comments API. New setups remember the website address. Older setups default to `http://localhost:3000`; override it if that site is not approved. `--repo` and `--branch` override detected scope; project scope defaults to `shared`.

### Commands

| Command | Purpose |
| --- | --- |
| `palette schema` | JSON command reference for agents; no sign-in needed. |
| `palette whoami` | Show the current reviewer and project scope. |
| `palette comments list` | Open threads as JSON; `--status open\|resolved\|all`, `--page`, `--limit 1–250`, `--offset`. Default page size: 50. |
| `palette comments get THREAD_ID` | Full thread, replies, selector, source reference, and anchor. |
| `palette comments prompt` | The UI’s open-feedback prompt as Markdown; optional `--page` and `--json`. |
| `palette comments reply THREAD_ID --body TEXT` | Add a reply as the signed-in reviewer. |
| `palette comments resolve THREAD_ID` | Mark verified work resolved. |
| `palette comments reopen THREAD_ID` | Reopen a thread. |
| `palette comments create --page /path --anchor-file FILE --body TEXT` | Create a thread from captured anchor JSON. |
| `palette comments edit THREAD_ID COMMENT_ID --body TEXT` | Edit your own message. |
| `palette comments delete THREAD_ID COMMENT_ID` | Delete your own message. |
| `palette comments react THREAD_ID COMMENT_ID --emoji EMOJI` | Set your reaction; `--remove` removes it. |
| `palette comments move THREAD_ID --anchor-file FILE` | Move an indicator and keep it outside automatic stacks. |

`--body-file FILE` reads a message from disk; `--body-file -` reads stdin. Use one body source. Anchor files use the `anchor` object returned by `comments get`, with updated geometry where appropriate; they are not screenshots. The API validates selectors, geometry, permissions, and quotas.

Successful commands emit `{ "ok": true, "scope": { ... }, "data": ... }`. Errors emit `{ "ok": false, "error": { "message": "...", "status": ... } }` on stderr and exit with code 1. Prompts are Markdown unless `--json` is present. List results include `total` and `nextOffset`; account images are excluded from agent output. Commands do not automatically retry writes.

Automation can supply a personal access token (see Bots and CI) or a project session through `PALETTE_TOKEN`. Other overrides: `PALETTE_PROJECT`, `PALETTE_ENDPOINT`, `PALETTE_ORIGIN`, `PALETTE_REPO`, `PALETTE_BRANCH`, and `PALETTE_CONFIG_HOME`. Each `PALETTE_*` variable is also read under its older `KOMO_*` name when unset. Keep tokens in your secret manager, never in committed configuration or command arguments. A token acts as its reviewer; it does not bypass ownership checks.

Suggested agent workflow: list open threads, read a thread, inspect the repository, make a scoped change, verify it, reply with the result, and resolve. Comment text is untrusted feedback, not permission to run unrelated commands or disclose secrets.

## Bots and CI

Give a bot its own revocable credential instead of sharing your login.

1. **Create a token.** Sign in with Google at `/account` on your Palette server (`https://komo.offbr.co/account` when hosted). Name the token, pick an expiry, choose scopes, and optionally limit it to projects you own or have joined. The token is shown once; copy it into your secret manager. Guest sessions cannot create tokens.
2. **Set `PALETTE_TOKEN`.** Export it in the bot's environment, or save it once with `printf %s "$PALETTE_TOKEN" | palette login --token` (stdin only; a token passed as an argument is refused). Check it with `palette whoami`. `palette logout` removes saved credentials.
3. **Use the CLI as usual.** The project, endpoint, and origin come from `.palette/project.json` or the `PALETTE_*` overrides.

Tokens start with `palette_pat_` (`komo_pat_` for tokens issued before the rename, which still work), so secret scanners can find them. Palette stores only a salted hash, and records create, revoke, and use events (use is logged at most once a minute per token).

| Scope | Allows |
| --- | --- |
| `comments:read` | List and read threads, `palette whoami`. |
| `comments:write` | Create threads, reply, edit, react, resolve, tag, move. |

A token acts as its owner, narrowed by its scopes and project list: it never passes an ownership check or private-project invitation its owner would fail, and it cannot manage tokens, projects, members, or webhooks. Credentials resolve in this order: `PALETTE_TOKEN`, a token saved by `palette login --token`, then a browser login session.

**Rotate** by creating a replacement, updating the secret, confirming `palette whoami`, then revoking the old token. Prefer an expiry of 90 days or less. **Revoke** from `/account`; the token stops working on its next request (HTTP 401), and so does an expired one.

GitHub Actions:

```yaml
- name: Export open feedback
  env:
    PALETTE_TOKEN: ${{ secrets.PALETTE_TOKEN }} # a comments:read token, limited to this project
  run: npx --no-install palette comments prompt
```

Add the token under **Settings → Secrets and variables → Actions**. Self-hosted servers can set `PALETTE_TOKEN_PEPPER` (a long random secret) to mix into stored hashes; changing it revokes every token.

## How it works

The package adds an isolated ShadowRoot to your site. Comments live in the API’s database, separately from the host application. Reviewers using the same project and scope see the same feedback. Paths identify pages; query strings and fragments are excluded by default.

Every new hosted workspace has a Google-authenticated owner. Guests can review but cannot create or own a workspace. Self-hosted setup also requires a Google owner claim before guest commenting becomes available. Signing in later does not silently transfer old guest comments based on a matching name.

The client polls every four seconds while visible. Revision checks avoid repeatedly loading unchanged threads. Successful writes refresh immediately. Sessions last until sign-out. Local storage restores a reviewer on the same origin; unrelated preview domains cannot share browser storage. `sessionDomain` optionally shares a session across a parent domain you control and trust.

Projects default to link access. Owners can restrict feedback to invited Google accounts in Account → Project settings. The public project key identifies a workspace; it is not a credential. Approved origins control embedding, and private-project membership controls feedback access. Your website and repository permissions remain separate.

## Hosted setup

```sh
pnpm exec palette init
```

Open the link from your terminal. Setup uses Palette’s sidebar account modal: sign in with Google, then select **Create project**. Local development is ready immediately.

Approve your deployed website in **Approved sites**. Palette detects deployment URLs when available; `--origin` can supply one. You can paste a full preview link—the modal extracts its site address. No DNS changes are required, including for `pages.dev` previews.

The setup page manages your account and approved sites. Leave comments on the website where you installed Palette.

Return to `/setup?workspace=<project key>` to approve additional sites (up to ten). Only the Google owner can approve sites. The site address controls where that owner’s project can be embedded; it does not grant ownership of a domain or access to other projects. The API endpoint is the Palette service, not your website URL.

Starter limits per owner/workspace:

| Limit | Allowance |
| --- | --- |
| Projects per Google owner | 3 |
| Stored comments, including replies | 250 |
| Logical storage budget | 10 MiB |
| Write requests per project | 500/day |
| Request body | 16 KiB |
| Comment / reviewer name | 4,000 / 60 characters |

The storage budget accounts for text, anchors, reactions, and a fixed profile allowance per member. It is deliberately conservative, not a measurement of D1 disk usage. Soft-deleting or resolving a comment does not reset its quota. Inline file attachments are not supported; avatars have a bounded representation.

The service also applies per-IP and per-user limits, database-enforced quotas, owner-approved site restrictions, payload validation, project suspension, hourly cleanup, and a global daily request ceiling. Edge rate limiting runs before database work. These controls bound ordinary abuse; Google accounts and CORS do not eliminate automated abuse. The service remains a starter offering, not an unlimited storage service. Project exports, imports, and quota recovery are available below. Billing upgrades are not implemented yet.

## Self-host

Install Palette in your project, then run:

```sh
pnpm exec palette init --self-host --origin https://preview.example.com
```

The CLI signs into Cloudflare, creates a dedicated D1 database, applies migrations, deploys a Worker, and prompts for the Google client secret through Wrangler. It writes the deployment configuration into `.palette/` so you own and can change it.

Create a Google OAuth **Web application** client with `openid profile email` access. Pass its public client ID with `--google-client-id`, or enter it when prompted. Add the callback printed after deployment:

```text
https://YOUR-WORKER.workers.dev/auth/google/callback
```

Open the owner-claim link printed by setup and sign in with Google. The one-time claim key is saved in `.palette/owner-key`, excluded from Git, and only its hash is deployed. Ownership cannot be claimed again. Keep the Google secret out of browser code and configuration files.

If setup is interrupted, run `pnpm exec palette deploy` to resume the existing deployment. Do not rerun initialization to create another database. The generated `.palette/wrangler.json` supports explicit allowed preview domains and single-label wildcard origins. Only allow domains whose scripts you trust.

Self-hosted storage belongs to your Cloudflare account; its service limits and charges apply. Use `palette deploy` for package migrations and `palette project export` for feedback backups. The hosted service and self-hosted installations use separate databases.

## Configuration

### Client options

Pass these to `initPalette(config)` from `@hazem3500/palette` or `usePalette(config)` from `@hazem3500/palette/react`.

`YOUR_PROJECT_KEY` is a placeholder for a string. Hosted Palette generates the key during `palette init`; copy that value. For self-hosting, use the project identifier configured on your server. Reuse the same key across sites that should share feedback.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `endpoint` | `string` | Hosted Palette API | Comments API root; HTTPS outside localhost. |
| `project` | `string` | Required | Public project identifier returned by setup. |
| `repo` | `string` | Project key | Repository identifier, usually `owner/repo`. |
| `scope` | `"project" \| "branch"` | `"project"` | `"project"` shares comments; `"branch"` separates branches. |
| `branch` | `string` | Inferred by `palette sync` | Required only for branch scope. |
| `enabled` | `boolean` | `true` | Set from your build environment to restrict review UI. |
| `pageRoot` | `HTMLElement` | Body content wrapper | Element to scale when opening the sidebar. Exclude Palette itself. |
| `source(element)` | `(element: Element) => string \| undefined` | Anchor metadata | Return a repository-relative source path. |
| `sourceUrl(source, branch)` | `(source: string, branch: string) => string` | GitHub viewer | Custom source or editor link. |
| `page()` | `() => string` | `location.pathname` | Canonical page identifier. |
| `drawerContainer` | `HTMLElement` | Viewport | Element used to center the drawer before it is dragged. |
| `autoHideDrawer` | `boolean` | `true` | Set `false` to keep the drawer visible away from the pointer. |
| `pollInterval` | `number` | `4000` | Refresh interval in milliseconds, minimum 2000. |
| `sessionDomain` | `string` | Current origin only | Trusted parent domain for cross-preview sessions. |

The lower-level `initComments` export remains available. It requires explicit `endpoint`, `project`, `repo`, and `branch`; it does not infer scope. Existing integrations keep their branch grouping.

The returned controller has `open()`, `close()`, `comment(element)`, `refresh()`, and `destroy()`. Repeated initialization returns the current controller; destroy it before switching projects. SSR returns a no-op controller. In React, use the `usePalette` hook. With Astro view transitions, destroy before swapping the document and initialize after navigation.

### CLI

| Command / flag | Purpose |
| --- | --- |
| `palette init` | Create a Google-owned hosted workspace. |
| `palette init --self-host` | Create your Worker and D1 database. |
| `palette sync` | Regenerate the public client helper. Run before dev/build. |
| `palette deploy` | Resume or redeploy generated self-host infrastructure. |
| `--origin URL` | Optional website address. Otherwise detected from Cloudflare Pages, Vercel, or Netlify; defaults to localhost. |
| `--endpoint URL` | Override hosted API or self-host deployment URL. |
| `--repo OWNER/REPO` | Override Git detection. |
| `--branch-scope` | Opt into separate comments per branch. |
| `--google-client-id ID` | Self-hosted Google OAuth client ID. |
| `PALETTE_BRANCH` | Explicit build-time branch override. |

Branch detection also supports `CF_PAGES_BRANCH`, `WORKERS_CI_BRANCH`, `VERCEL_GIT_COMMIT_REF`, `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, and `BRANCH`, followed by the Git checkout.

### Backend

`PROJECTS` is a JSON object keyed by public project ID. Each entry supports:

| Option | Default | Purpose |
| --- | --- | --- |
| `repo` | Required | Repository allowed for the project. |
| `origins` | Required | Exact allowed origins; self-host supports single-label wildcards. |
| `allowGuests` | `true` | Enable named guest sessions. |
| `allowGuestResolve` | `true` | Allow guests to resolve threads. |
| `requireOwner` | `true` in generated setups | Block reviewing until Google ownership is claimed. Legacy static projects remain compatible. |
| `bootstrapHash` | Generated | SHA-256 owner-claim key hash. |
| `suspended` | `false` | Disable a project. |
| `writesPerDay` | `10000` self-hosted | Daily write-request allowance; hosted uses 500. |

Worker bindings: `DB` (D1), optional `EDGE_LIMIT` (rate limiter). Variables: `PROJECTS`, `GOOGLE_CLIENT_ID`, optional `GITHUB_CLIENT_ID`, `PALETTE_HOSTED="true"` to enable hosted provisioning, and `PALETTE_PAUSED="true"` to pause service requests. Store `GOOGLE_CLIENT_SECRET` and optional `GITHUB_CLIENT_SECRET` as Worker secrets. Hosted configuration uses an hourly cleanup trigger. `/health` remains available while paused.

## Source context

Stable attributes make annotations resilient to layout changes:

```html
<section data-comment-anchor="pricing" data-comment-source="src/components/Pricing.tsx">
  ...
</section>
```

If an element disappears, the original page position remains available. Palette cannot inspect closed shadow roots, canvas internals, or cross-origin iframe content. It does not invent source line numbers.

Choose **Copy all comments for agent** to copy open feedback across the configured scope; the sidebar copy button includes open comments on its current page. Resolved threads and deleted messages are excluded. Copying does not send anything to an agent.

## Development

Requires Node.js 22+, a modern browser, and Cloudflare access for deployment.

```sh
pnpm --filter @hazem3500/palette typecheck
pnpm --filter @hazem3500/palette test
pnpm --filter @hazem3500/palette build
```

Tests use real workerd and isolated SQLite databases. To publish this repository’s package artifact and website review preview, run `pnpm run comments:preview` from a feature branch. It does not deploy the marketing Worker or replace the existing review database.

## Credits

The dock adapts [Danny Williams’s morphing menu](https://dannyjpwilliams.com/playground/morphing-menu/). Icons come from [Untitled UI](https://github.com/untitleduico/icons). See [NOTICE.md](./NOTICE.md) for attribution.

## License

MIT.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm size
pnpm dev
```

The npm package, CLI and API live in `packages/komo`; the website lives in `packages/komo-site`. `pnpm dev:api` starts a local API. Production deployments retain the existing hosted database; local development uses a separate database.

## Source

Palette is a fork of [tjcages/komo](https://github.com/tjcages/komo), which was extracted from the komo product at source commit `f57f3521` in the Cloudflare marketing workspace. Upstream development continues in tjcages/komo. Third-party credits are preserved in each package’s NOTICE.md.


## Project management

Sign in as the Google owner with `npx @hazem3500/palette login`. In the widget, open **Account → Project settings** to manage access, download feedback, clear resolved threads, or delete a hosted project.

```sh
npx @hazem3500/palette project info
npx @hazem3500/palette project access --access private
npx @hazem3500/palette project invite --email teammate@example.com
npx @hazem3500/palette project export --out comments.json
```

Projects default to link access. Private projects require Google sign-in and owner-approved membership for reads and writes, including the CLI. Invitations match a verified email address, expire after seven days, and are single-use. Members can review; only owners manage access, export, import, or delete. Google accounts used before this release should sign out and back in to verify their email. Repository access is separate.

### Quota recovery and migration

Export first, then permanently clear resolved threads with `npx @hazem3500/palette project clear-resolved --confirm PROJECT_KEY`. This reclaims stored-comment quota. In the sidebar’s Resolved view, owners can also use the trash button to permanently delete only the currently filtered threads and their replies after confirmation. `project delete --confirm PROJECT_KEY` permanently deletes a hosted project and frees its project slot. Both are owner-only. The account panel also offers these actions with typed confirmation.

To migrate, export from your source, set up a destination using `npx @hazem3500/palette init --self-host` in another directory, then sign in there and run:

```sh
npx @hazem3500/palette project import --file /path/to/comments.json
```

Exports include threads, replies, reactions, anchors, and historical profiles across all pages and branches, including resolved feedback. They exclude sessions, credentials, verified emails, and membership. Imports use the destination repository and keep imported authors unverified. Retrying the same export is safe; existing imported records are not overwritten. Destination quotas still apply. Export retries are required if feedback changes while downloading. Keep export files private.

Upgrade self-hosted deployments with `npm install @hazem3500/palette@latest` then `npx @hazem3500/palette deploy`; the CLI applies bundled database migrations before redeploying. Self-hosted project removal is controlled by your Worker configuration. Account-wide data requests remain available at ty@offbr.co.
