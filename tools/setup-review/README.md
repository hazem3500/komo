# Setup review

This isolated preview bundles the real komo widget inside the existing komo website template and styles. It does not ship in the npm package or the production website.

```sh
pnpm build
node tools/setup-review/build.mjs
python3 -m http.server 4351 --directory tools/setup-review/dist
```

Open `/setup-review/` for the in-project account form. Add production and preview addresses, choose **Connect**, and complete the clearly labeled sample connection. The comments sidebar opens without navigation. `/setup-review/?mode=peek` replays the real first-load drawer entrance. Hover near the bottom edge to reveal the full dock.

The review harness substitutes sample API responses and a sample popup result. It never sends credentials, creates a workspace, or writes production comments. The API integration test independently exercises the real Worker, D1 migrations, OAuth cookie/state checks, site approvals, quota enforcement, and project-scoped sessions with only Google’s upstream responses mocked.

For the sidebar-close regression, open `?mode=connected`, open comments, and close the sidebar on a viewport taller than the page content. During the closing animation, the page surface must keep a viewport-sized minimum height; it must not snap to its shorter content height and expose a black band. After completion, its original inline minimum height and the body background must be restored. Repeat at 390 × 844 for the mobile sheet and after reopening the sidebar.

Deploy this directory to a preview branch of the existing Pages project:

```sh
pnpm exec wrangler pages deploy tools/setup-review/dist --project-name komo --branch in-project-setup --commit-dirty=true
```

Production release requires applying `0012_setup_sites.sql` before deploying the API, publishing the package, and updating consuming sites. Existing Google callbacks retain their registered URL. The migration adds a nullable column; previous Worker versions ignore it on rollback. Do not merge or release as part of preview review.
