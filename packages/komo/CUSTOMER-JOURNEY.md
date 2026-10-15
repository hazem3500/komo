# Customer journey acceptance

September 16, 2026 · `@hazem3500/komo` 0.1.0 published release

## Environment

- Fresh Vite website outside the repository, installed first from the release artifact and then from the public npm registry into a second clean directory.
- Dedicated hosted komo API and a new Google-owned workspace. No mocked API responses or seeded production identities.
- Owner in Dia; independent guest reviewer in the Codex browser.
- [Acceptance website](https://komo-customer-journey.lue-branch-comments-review.pages.dev/).
- The acceptance project uses one owner project slot and stores two comments, including its reply.

## Passed

| Step | Evidence |
| --- | --- |
| Install | Clean public-registry npm install with a fresh cache, scoped CLI help, generated `@hazem3500/komo/setup` import, and Vite production build. Registry SHA-512 integrity exactly matches the artifact tested through onboarding. |
| Initialize | `npx @hazem3500/komo init` opens setup, the Google owner creates the project, and the waiting CLI writes the configuration. No manual endpoint, repository, or branch input. |
| Approve site | Owner approves the returned deployment address in the sidebar. The approved address returns HTTP 200; a different, unapproved deployment returns HTTP 403. |
| Authenticate | Google sign-in from the customer website returns to the widget with the verified profile. |
| Comment | Owner anchors and posts a comment on the customer website's button. |
| Share | An independent browser reads the comment before signing in. |
| Reply | Sending a reply asks for a guest name, preserves the draft, and posts it after the name is submitted. The owner sees it. |
| Persist | Owner and guest identities, the thread, reply, and reaction survive refresh. |
| Resolve | The guest resolves the thread; the open count reaches zero. The resolved filter still shows the thread and reply after refresh. Reopening works. |
| Undo | The original immediate-click race reproduced on the first artifact. The corrected deployed artifact restores the thread when Undo is clicked as soon as the notice appears. |
| Agent export | The page export button confirms “Copied prompt”; prompt content and resolved-thread exclusion are covered by local formatter tests. |
| Usage | The owner sees 2 of 3 projects and 2 / 250 comments. Resolving does not reduce storage usage. |
| Limits | Local real-workerd/SQLite integration tests enforce the three-project limit and the 250-comment boundary, including concurrent writes. Live customer quota was not exhausted for this test. |
| Self-host artifact | Wrangler builds the installed package's `@hazem3500/komo/server` export in a deployment dry run. |

## Found during acceptance

An immediate Undo click could arrive while the original mutation was still refreshing. The pending-write guard discarded Undo after its notice was dismissed. Resolution notices now appear only after the mutation and refresh finish, so Undo is actionable when shown.

## Google production configuration

The branding follow-up saves the komo app name, public home/privacy/terms URLs under `komo.offbr.co`, and the `offbr.co` authorized domain. Google now enables “Publish app”. The owner set the app to In production, and that status was verified in Google Cloud. The new comment-indicator logo is saved. Google’s automatic branding review flagged logo uniqueness; an additional review is prepared and awaits the owner’s final acknowledgments and submission.

The current app requests only `openid profile`. Google's [basic-identity exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) permits sign-in without joining a test-user allowlist. The live owner login passes. Google branding approval remains outstanding; adding broader scopes would require reassessing consent and verification.

## Optimistic update follow-up · 0.1.1 published release

- 36 tests pass, including queued Undo, failure rebasing, stale polling rejection, and temporary-ID reconciliation. Package and website TypeScript checks and scoped lint pass.
- Browser fixture delays each write by five seconds. A reply appears within 51 ms, before server acceptance. A rejected reply disappears, its text returns to the composer, and a floating failure notice appears.
- Resolve followed immediately by Undo preserves the open thread while both writes finish in order.
- A new comment accepts a reply before its first save completes. The queued reply uses the persisted UUID, and both messages remain in the card.
- A clean install of the 0.1.1 tarball runs the scoped CLI. npm publication is verified. The public registry integrity matches the tested artifact.
- The site passes desktop and 390 px layout checks. All generated internal page and asset links resolve. The public home page loads over HTTPS and its install copy control confirms success.
- [Widget preview](https://128ed9f3.lue-branch-comments-review.pages.dev/products/workers/).
- [Website preview](https://76818472.lue-branch-comments-review.pages.dev/).

The slow-save fixture uses an isolated local API to produce deterministic failures. It is separate from the live customer workspace.

## Release artifact

Published package: [`@hazem3500/komo@0.1.0`](https://www.npmjs.com/package/@hazem3500/komo).

Registry and tested tarball integrity:

```text
sha512-q5xlDw00jY1MlbdXqeuioPy5gpQGUVJHZ1tHJ0g15zX2AWMQJEbiomjcYrm7gEvmS08EQP1c2rwQ8p7VfvGUjw==
```

This report covers the starter hosted journey and a self-host bundle check. It does not certify a new customer's Cloudflare provisioning, production load, recovery procedures, or account deletion/export. See [production readiness](./PRODUCTION.md).


## Shared landing demo · September 16

- The offbr-style landing page uses a clean screenshot of this repository's Cloudflare Workers page and a separate, scripted three-agent walkthrough.
- Desktop and 390 px layouts were inspected. Thread selection pauses playback; reply expansion, resolution, and replay work. Reduced-motion preferences stop autoplay and disable transitions. Offscreen and hidden-tab playback is suspended.
- The actual komo widget posts to `komo-landing-demo` on the dedicated hosted API. An independent Dia browser on `komo.offbr.co` sees feedback posted from the deployment preview.
- Four messages were posted through the real UI. After persistence, both browsers and the API show only messages two through four. The oldest message is removed, with two replies retained under the new first message.
- 37 package tests pass. The new real-SQLite test covers concurrent retention, cross-branch pruning, revision invalidation, preserved replies from another reviewer, accurate quota counters, and no retention in ordinary projects.
- The website privacy page explains the public demo and per-reviewer retention. Guest identity is browser-persistent, not a verified-person abuse boundary.

- [Current landing preview](https://0d2ff8f7.lue-branch-comments-review.pages.dev/). Live test messages were removed after verification.
