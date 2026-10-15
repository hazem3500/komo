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

- The setup URL manages accounts, limits, and approved sites. Reviewers leave comments on an installed, approved website.
- A public project key identifies a link-accessible review workspace. Site restrictions do not implement private repository membership or prove domain ownership.
- Self-hosted project counts cover the user's connected projects configured on that service, not unrelated deployments.
- Passing local tests is evidence for the cases exercised, not a production load or security audit.
