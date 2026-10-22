# Production readiness

Status: working preview / controlled beta. Not ready for an unrestricted public launch.

## Verified

- Dedicated hosted Worker and D1 database, Google owner onboarding, persistent reviewer sessions, guest comments, and owner-approved sites.
- Three hosted projects per Google owner and 250 stored comments per project; concurrent quota enforcement covered against real workerd/SQLite.
- Payload validation, session scoping, rate limits, suspension controls, and scheduled cleanup.
- Published `@hazem3500/komo@0.1.1`, clean public-registry installation, and exact integrity match with the browser-tested release artifact.
- Separate self-hosted deployment path and successful Worker bundle dry run.
- Setup uses management sessions only. Its UI does not expose comment creation; comment APIs continue rejecting management sessions.

- Optimistic review writes, serial persistence, rollback notices, draft recovery, and temporary-ID reconciliation pass 37 package tests and delayed/failing browser checks.
- Public product/docs site, animated Cloudflare walkthrough, and a real shared demo at https://komo.offbr.co. The demo retains each reviewer’s newest three messages; customer projects are unaffected.

## Release blockers

1. **Google branding approval.** The app is In production. The komo name, public home/privacy/terms links, authorized domain, and comment-indicator logo are saved. Google’s automatic review flagged the logo as insufficiently distinctive; an additional review is prepared and awaits the owner’s final acknowledgments and submission. Basic `openid profile` sign-in works; the logo is not yet approved for the consent screen.
2. **Customer provisioning boundaries.** The published package passes the hosted journey in a fresh website: Google owner creation, site approval, posting, cross-browser replies, reactions, resolution/undo, and refresh persistence. Local real-SQLite tests enforce the 250-comment and three-project boundaries. Self-hosting passes bundle validation; a new customer's full Cloudflare provisioning/recovery remains a separate acceptance check. See [customer journey acceptance](./CUSTOMER-JOURNEY.md).
3. **Account and project management.** Add site revocation, project removal, ownership recovery/transfer, and account data export/deletion. Agree how retained comments and quota counters behave when a project is removed.
4. **Operations and capacity.** Establish error/availability alerts, a tested backup restoration procedure, rollback instructions, and an abuse-response process. Load-test the polling model and review request budgets before public signup. The current 100,000-request daily service cap is a starter safeguard: continuous four-second polling consumes about 21,600 requests per active browser per day, before writes and setup requests.
5. **Limits and migration.** Provide a usable path when a project fills: export/migrate to self-hosting or an explicit upgrade process. Hosted billing and import/export migration are not implemented.

## Product boundaries

- Element snapshots (an image and trimmed HTML per thread) are opt-in on the client (`snapshots.image` / `snapshots.html`, both off by default) and may contain page content or user data.
  - Captured: the commented element only, as a WebP image at quality 0.8 by default (lower, then smaller, to fit `maxBytes`) and its trimmed HTML without scripts, styles or handlers. komo's own UI is never captured.
  - Redacted: input, textarea and password values always; elements the host's `redact` callback matches; anything inside `data-komo-no-snapshot` is left out.
  - Access: readable only with a session, served inert (`text/plain` HTML, `Content-Security-Policy: sandbox`, `nosniff`, private caching). The review UI fetches thumbnails with the session token only when they are on screen, shows them through blob URLs it revokes on unmount, and shows HTML as text. The CLI saves them to a self-ignoring `.komo/snapshots` folder.
  - Guests: refused unless a project sets `allowGuestSnapshots`.
  - Retention: kept for the thread's lifetime, counted against quotas and a per-project snapshot cap, and deleted with their thread (resolved cleanup, retention, project deletion).
  - Deletion: the thread's author or a signed-in reviewer removes one from the comment's actions menu (with confirmation) or with `DELETE /threads/:id/snapshot/:kind`.

- The setup URL manages accounts, limits, and approved sites. Reviewers leave comments on an installed, approved website.
- A public project key identifies a link-accessible review workspace. Site restrictions do not implement private repository membership or prove domain ownership.
- Self-hosted project counts cover the user's connected projects configured on that service, not unrelated deployments.
- Passing local tests is evidence for the cases exercised, not a production load or security audit.
