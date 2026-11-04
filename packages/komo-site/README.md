# Palette website

```sh
pnpm build
pnpm dev
```

Static pages with animated examples and the real Palette widget. The public demo uses the dedicated hosted API and retains each user’s latest three comments (the `/fake-github/` demo keeps 20).

`pnpm deploy:site` deploys the website to komo.offbr.co. The API and its existing database are managed separately with `pnpm deploy:api`.

API changes in a preview can use `KOMO_API_PREVIEW_VERSION` on the uploaded website version. Add that API version to the active deployment at **0%**, keeping the current version at **100%**, then upload the site with `--var KOMO_API_PREVIEW_VERSION:<version-id>`. Only `*-komo-site.off-brand.workers.dev` hosts receive that override; `/health` reports the API version for verification. Incoming client override headers are discarded. Ordinary site uploads continue using the production API.
