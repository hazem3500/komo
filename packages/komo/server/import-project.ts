import { check, string, pagePath, anchorValue } from "./validation";
import { digest } from "./digest";
import { isEmoji } from "../src/emoji";

export async function importProject(
  env: Env,
  project: string,
  data: Record<string, unknown>
) {
  const source = string(data.source, 100, "source project");
  const kind = string(data.kind, 20, "table");
  check(
    Array.isArray(data.records) &&
      data.records.length > 0 &&
      data.records.length <= 50,
    400,
    "Import 1–50 records at a time."
  );
  const repo =
    (
      await env.DB.prepare("SELECT repo FROM workspaces WHERE id=?")
        .bind(project)
        .first<{ repo: string }>()
    )?.repo ?? JSON.parse(env.PROJECTS)[project]?.repo;
  check(repo, 404, "Unknown destination project.");
  const id = async (value: unknown, identity = false) =>
    (identity ? "guest:import:" : "import:") +
    (await digest(`${project}\n${source}\n${string(value, 200, "source ID")}`));
  const time = (value: unknown) => {
    check(
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
      400,
      "Invalid timestamp."
    );
    return value;
  };
  const statements: D1PreparedStatement[] = [];
  for (const value of data.records) {
    check(
      value && typeof value === "object" && !Array.isArray(value),
      400,
      "Invalid record."
    );
    const row = value as Record<string, unknown>;
    if (kind === "users") {
      const accent = row.accent_color;
      check(
        accent === undefined ||
          accent === null ||
          (typeof accent === "string" && /^#[a-f0-9]{6}$/i.test(accent)),
        400,
        "Invalid accent color."
      );
      const photo = row.avatar_url;
      check(
        photo === undefined ||
          photo === null ||
          (typeof photo === "string" &&
            photo.length <= 12000 &&
            (/^(https:\/\/|data:image\/jpeg;base64,)/.test(photo) ||
              photo === "")),
        400,
        "Invalid avatar."
      );
      const authorId = await id(row.id, true);
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO users(id,name,verified,avatar_url,accent_color) VALUES(?,?,0,?,?) RETURNING id"
        ).bind(
          authorId,
          string(row.name, 60, "author name"),
          photo ?? null,
          accent ?? null
        ),
        env.DB.prepare(
          "INSERT OR IGNORE INTO project_members(project,user_id) VALUES(?,?)"
        ).bind(project, authorId)
      );
    } else if (kind === "threads") {
      let rawAnchor = row.anchor;
      if (typeof rawAnchor === "string") {
        try {
          rawAnchor = JSON.parse(rawAnchor);
        } catch {
          check(false, 400, "Invalid imported anchor.");
        }
      }
      const anchor = anchorValue(rawAnchor);
      check(
        row.resolved === 0 || row.resolved === 1,
        400,
        "Invalid resolved state."
      );
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO threads(id,project,repo,branch,page,anchor,resolved,resolved_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id"
        ).bind(
          await id(row.id),
          project,
          repo,
          string(row.branch, 250, "branch"),
          pagePath(row.page),
          JSON.stringify(anchor),
          row.resolved,
          row.resolved_by ? await id(row.resolved_by, true) : null,
          time(row.created_at),
          time(row.updated_at)
        )
      );
    } else if (kind === "comments") {
      const thread = await id(row.thread_id),
        author = await id(row.user_id, true);
      check(
        await env.DB.prepare("SELECT id FROM threads WHERE id=? AND project=?")
          .bind(thread, project)
          .first(),
        400,
        "Import the parent thread first."
      );
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO comments(id,thread_id,user_id,body,created_at,edited_at) VALUES(?,?,?,?,?,?) RETURNING id"
        ).bind(
          await id(row.id),
          thread,
          author,
          string(row.body, 4000, "comment"),
          time(row.created_at),
          row.edited_at == null ? null : time(row.edited_at)
        )
      );
    } else if (kind === "reactions") {
      const comment = await id(row.comment_id);
      check(
        await env.DB.prepare(
          "SELECT c.id FROM comments c JOIN threads t ON t.id=c.thread_id WHERE c.id=? AND t.project=?"
        )
          .bind(comment, project)
          .first(),
        400,
        "Import the comment first."
      );
      check(
        typeof row.emoji === "string" && isEmoji(row.emoji),
        400,
        "Invalid reaction."
      );
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO reactions(comment_id,user_id,emoji) VALUES(?,?,?) RETURNING comment_id"
        ).bind(comment, await id(row.user_id, true), row.emoji)
      );
    } else if (kind === "comment_tags") {
      const comment = await id(row.comment_id),
        author = await id(row.user_id, true);
      check(
        await env.DB.prepare(
          "SELECT c.id FROM comments c JOIN threads t ON t.id=c.thread_id WHERE c.id=? AND t.project=?"
        )
          .bind(comment, project)
          .first(),
        400,
        "Import the comment first."
      );
      check(
        typeof row.tag === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(row.tag),
        400,
        "Invalid comment tag."
      );
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO comment_tags(comment_id,tag,user_id,created_at) VALUES(?,?,?,?) RETURNING comment_id"
        ).bind(comment, row.tag, author, time(row.created_at))
      );
    } else check(false, 400, "Unknown import table.");
  }
  const results = await env.DB.batch(statements);
  return Response.json({
    ok: true,
    imported: results.reduce(
      (total, result, index) =>
        total + (kind === "users" && index % 2 ? 0 : result.results.length),
      0
    ),
  });
}
