# Package integration and session safety

Reviewed September 22, 2026 in PR #29. These safeguards are in the review build; npm publication and production API rollout are separate steps.

## Verified and fixed

- SSR imports and no-document initialization are safe. The packed npm consumer checks vanilla/setup/React imports, React client directives, types, self-host CLI init/resume, migration copying and the server bundle. Single-instance teardown is idempotent; changing API/project/repository/branch requires destroying the current widget first.
- Cookie identity includes the API and project. HTTPS cookies default to host-only, with `__Host-` protections; explicit parent-domain sharing uses secure cookies. HTTP development keeps sessions in local storage rather than sending bearer cookies to every localhost port. Requests omit ambient credentials and bypass browser response caching.
- `sessionDomain` is opt-in. All sibling hosts can receive a domain cookie, so use it only across sites you control and trust. `sessionEndpoint` is an explicit canonical API identity for gateways to the same service, never a way to join unrelated APIs. The Palette website declares its own trusted preview configuration.
- Legacy project-only cookies are retired. Endpoint-scoped local tokens and previously validated account snapshots can migrate; `/me` validates the session before writing the new cookie. Corrupt account metadata cannot suppress an otherwise valid scoped session. Users with only a legacy cookie and no scoped account record may need to sign in once.
- Account/comment snapshots are bound to their session; repository/branch cache keys use unambiguous tuples. Logout clears all channel snapshots and credentials for that API/project. Remote logout failure leaves the browser signed out. An empty shared-cookie marker prevents other previews reviving stale local tokens; visiting those previews also purges their obsolete local credentials.
- Storage events reconcile same-origin account changes immediately. Focus/visibility reconciliation covers opted-in cross-origin previews. Old GETs and queued edits cannot restore the prior account’s private state; already-issued writes may finish under their original server authorization. Blocked cookies and blocked local storage are tested independently; memory-only sessions remain usable.
- Server private-membership/project/branch checks remain authoritative. Normal API responses are non-cacheable. Operational failures while reading site approval policy now fail closed rather than treating revoked origins as legacy schema. Legacy missing-schema compatibility remains targeted. Imported comment IDs now support normal actions with the same permissions as newly created comments.

- Host mounting no longer wraps/reparents body children. Browser fixtures cover body grid with multiple roots, an existing sole root, explicit roots, and `display: contents`; teardown preserves DOM ownership. Frame sizing includes root padding without changing the approved scale/motion.
- CLI logout clears local credentials for expired/deleted projects while preserving errors for other server failures; imported feedback IDs work through the CLI. Wrangler and Vitest are patched, with zero known vulnerabilities in the full dependency audit.

## Integration boundaries

- The localhost `local` channel is stored in the configured API database and uses project permissions. It is not per-device private storage. Use a separate project/API for isolated development data. Running the local API itself uses its separate local database.
- Instant/offline restoration displays last-known data. It cannot prove that remote permissions remain current while offline. API authorization is rechecked on requests. Cached data and client credentials are accessible to scripts on the embedding site; install on trusted sites.
- Mounting never reparents host content. A sole existing content root, or an explicit mounted `pageRoot` with a layout box, enables Frame. Multiple roots and `display: contents` use Floating. Body/html/detached explicit roots are rejected. Frame accounts for padded containers using a temporary, restored border-box size. Arbitrary host CSS still requires integration review.
- Same-origin polling request sharing remains open. This pass synchronizes sessions; it does not deduplicate polls. Larger bundle restructuring and a measured case for full DOM virtualization also remain open.

## Evidence

All 205 tests across 32 files, build, typecheck, size and fresh packed-consumer gates pass. Real cookie-jar tests cover sibling/API/project isolation, explicit domain sharing, disabled storage, migration, scoped logout and shared-cookie logout. Lifecycle/queue tests cover stale teardown, scope changes, other-tab logout, focus reconciliation and late writes. Real Worker tests cover private/project/branch/author boundaries, imported actions, and fail-closed site-policy failures.

Deployed Chrome checks confirm existing-account migration, repeated cached comments/account/open-sidebar reload, and automatic sign-in on a second explicitly trusted preview. No public feedback was posted or modified. Initial gzip is 96,964 bytes; all-feature gzip is 195,882 bytes, within unchanged budgets. Preview: https://refresh-ux-komo-site.off-brand.workers.dev/ (immutable https://0736a7a4-komo-site.off-brand.workers.dev/).

Preview API dc6e8184-6918-492a-ac0f-612a567eb3bf receives 0% ordinary traffic and is explicitly selected by the preview gateway. Production remains b7b1f705-e8be-4ef4-a5af-b179caa110e1 at 100%. No production schema migration or npm publication was performed.

The 0.5.0 candidate additionally passed real Chrome host-layout fixtures and deployed Floating/Frame reload checks, with no browser errors. Bundle headroom is only 118 gzip bytes for all features; budget limits were not raised. This is a validated release candidate, not a claim of completed device/accessibility QA or an approved production rollout. See [release steps](release-0.5.md).
