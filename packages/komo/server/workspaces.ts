import { check, string, originAllowed } from "./validation";
import type { Identity } from "../src/types";
import { pruneAudit } from "./tokens";
import { editedOrigins, siteEdits } from "./project-sites";
import { HOSTED_SNAPSHOT_BYTES } from "./snapshots";
export type Project = {
  repo: string;
  origins: string[];
  allowGuests?: boolean;
  allowGuestResolve?: boolean;
  requireOwner?: boolean;
  bootstrapHash?: string;
  suspended?: boolean;
  writesPerDay?: number;
  retainedCommentsPerUser?: number;
  /** Let guest sessions attach element snapshots. Off unless set. */
  allowGuestSnapshots?: boolean;
  /** Total snapshot bytes stored per project. */
  maxSnapshotBytes?: number;
};

export function retainReviewerComments(
  db: D1Database,
  project: string,
  user: string,
  limit: number | undefined
): D1PreparedStatement[] {
  if (!limit || !Number.isInteger(limit) || limit < 1) return [];
  // Remove only this reviewer's threads that would become empty. Do this before
  // pruning their comments so candidate IDs remain available; delete triggers
  // preserve quota/revision accounting. Newest retained comments are untouched.
  return [
    db.prepare(`WITH kept AS MATERIALIZED (
      SELECT c.id FROM comments c JOIN threads t ON t.id=c.thread_id
      WHERE c.user_id=? AND t.project=? ORDER BY c.created_at DESC,c.rowid DESC LIMIT ?
    ) DELETE FROM threads WHERE project=?
      AND id IN (SELECT thread_id FROM comments WHERE user_id=?)
      AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.thread_id=threads.id
        AND (c.user_id<>? OR c.id IN (SELECT id FROM kept)))`)
      .bind(user, project, limit, project, user, user),
    db.prepare(`DELETE FROM comments WHERE user_id=?
      AND thread_id IN (SELECT id FROM threads WHERE project=?)
      AND id NOT IN (SELECT c.id FROM comments c JOIN threads t ON t.id=c.thread_id
        WHERE c.user_id=? AND t.project=? ORDER BY c.created_at DESC,c.rowid DESC LIMIT ?)`)
      .bind(user, project, user, project, limit),
  ];
}
export async function projectConfig(
  env: Env,
  project: string
): Promise<Project | undefined> {
  const staticConfig = (JSON.parse(env.PROJECTS) as Record<string, Project>)[
    project
  ];
  if (staticConfig)
    return {
      ...staticConfig,
      origins: editedOrigins(
        staticConfig.origins,
        await siteEdits(env, project)
      ),
    };
  const row = await env.DB.prepare(
    "SELECT repo,origins,suspended FROM workspaces WHERE id=?"
  )
    .bind(project)
    .first<{ repo: string; origins: string; suspended: number }>();
  if (!row) return undefined;
  const verified = await env.DB.prepare(
    "SELECT origin FROM workspace_domains WHERE project=?"
  )
    .bind(project)
    .all<{ origin: string }>();
  // Localhost is allowed for every project at the router.
  return {
    repo: row.repo,
    origins: verified.results.map((item) => item.origin),
    requireOwner: true,
    suspended: !!row.suspended,
    writesPerDay: 500,
    maxSnapshotBytes: HOSTED_SNAPSHOT_BYTES,
  };
}
export async function googleOwner(env: Env, project: string, user: Identity) {
  check(
    user.verified && user.id.startsWith("google:"),
    403,
    "Sign in with Google to manage this workspace."
  );
  const owner = await env.DB.prepare(
    "SELECT user_id FROM project_owners WHERE project=?"
  )
    .bind(project)
    .first<{ user_id: string }>();
  check(
    owner?.user_id === user.id,
    403,
    "Only the workspace owner can do that."
  );
}
export function workspaceConfig(config: Record<string, unknown>): {
  repo: string;
  origins: string[];
} {
  const repo = string(config.repo, 200, "repository");
  const origins = config.origins;
  check(
    Array.isArray(origins) &&
      origins.length > 0 &&
      origins.length <= 10 &&
      origins.every(
        (origin) =>
          typeof origin === "string" &&
          origin.length <= 300 &&
          originAllowed(origin, [origin]) &&
          (origin.startsWith("https://") ||
            /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      ),
    400,
    "Use exact HTTPS site origins or localhost."
  );
  return { repo, origins };
}

export async function provision(
  env: Env,
  user: Identity,
  config: Record<string, unknown>
) {
  check(
    user.verified && user.id.startsWith("google:"),
    403,
    "A Google account is required to create a workspace."
  );
  const { repo, origins } = workspaceConfig(config);
  const id = `komo_${crypto.randomUUID().replaceAll("-", "")}`;
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces(id,owner_id,repo,origins,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM workspaces WHERE owner_id=?)<3"
    ).bind(id, user.id, repo, JSON.stringify(origins), Date.now(), user.id),
    env.DB.prepare(
      "INSERT INTO project_owners(project,user_id) SELECT id,owner_id FROM workspaces WHERE id=?"
    ).bind(id),
    env.DB.prepare(
      "INSERT INTO project_quotas(project,max_comments,max_bytes) SELECT id,250,10485760 FROM workspaces WHERE id=?"
    ).bind(id),
  ]);
  check(
    results[0].meta.changes,
    409,
    "Your account has reached three hosted projects."
  );
  return { project: id, repo };
}

// Cron owns hosted cleanup. Self-hosted deployments without cron get one attempt
// per database/isolate/hour; concurrent requests share the same deadline.
const nextCleanup = new WeakMap<D1Database, number>();
export async function maintain(db: D1Database, scheduled = false) {
  const now = Date.now();
  if (!scheduled && now < (nextCleanup.get(db) ?? 0)) return;
  nextCleanup.set(db, now + 3600000);
  try {
    await db.batch([
      ...["rate_limits", "sessions", "project_invites", "oauth_states", "setup_requests"].map(
        table => db.prepare(`DELETE FROM ${table} WHERE expires_at<?`).bind(now)
      ),
      pruneAudit(db, now),
      db.prepare("DELETE FROM users WHERE id LIKE 'guest:%' AND id NOT IN (SELECT user_id FROM sessions) AND id NOT IN (SELECT user_id FROM comments) AND id NOT IN (SELECT user_id FROM project_members)"),
    ]);
  } catch (error) {
    // Retry transient failures after a minute, not on every incoming request.
    nextCleanup.set(db, now + 60000);
    throw error;
  }
}
