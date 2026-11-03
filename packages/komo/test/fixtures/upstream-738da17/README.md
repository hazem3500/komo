# Upstream PostgreSQL schema at 738da17

Verbatim copies from the upstream komo repository (https://github.com/tjcages/komo) at commit `738da176c7f26824e889d2050f2e99132282bd5a`:

| Fixture                  | Upstream path                                | Git blob   |
| ------------------------ | -------------------------------------------- | ---------- |
| `postgres.ts`            | `packages/komo/server/postgres.ts`           | `171227cf` |
| `postgres/001_initial.sql` | `packages/komo/server/postgres/001_initial.sql` | `a5d72565` |

`postgres.ts` is upstream's Node database adapter. Its `migrate()` is the bookkeeping a database created by that commit went through: one `komo_schema(version integer PRIMARY KEY)` row with `version = 1`, written in the same transaction as `001_initial.sql` under advisory lock `7217495`. There are no checksums or file names in the bookkeeping.

`test/postgres-upstream-upgrade.test.ts` builds a database with these files, then upgrades it with this package's runner. Do not edit them: they stand for databases that already exist. To check them, run `git show 738da176c7f26824e889d2050f2e99132282bd5a:<upstream path> | git hash-object --stdin`.

This fork shares upstream's history and MIT licence; see `packages/komo/LICENSE`, which these files are distributed under unchanged.
