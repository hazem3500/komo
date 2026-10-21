import type { PoolClient } from "pg";

type Pg = typeof import("pg");

// pg is an optional peer: only the self-hosted Node server needs it, so browser hosts never install it.
export async function loadPostgres(): Promise<Pg> {
  let pg: Pg;
  try {
    const module = await import("pg");
    pg = ((module as unknown as { default?: Pg }).default ?? module) as Pg;
  } catch {
    throw Error("The komo Node server needs the PostgreSQL client. Install it next to komo: npm install pg");
  }
  // API timestamps, counters, and revisions are JavaScript numbers.
  pg.types.setTypeParser(20, (value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      throw Error("PostgreSQL integer exceeds safe range");
    return number;
  });
  return pg;
}
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Keep the D1-shaped boundary used by the API. A batch always has one transaction.
export function postgresDatabase(connectionString: string, pg: Pg) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const query = async (sql: string, values: unknown[], client?: PoolClient) => {
    const text = translate(sql);
    const result = await (client ?? pool).query(text, values);
    return {
      results: result.rows,
      success: true,
      meta: { changes: result.rowCount ?? 0 },
    };
  };
  const prepare = (sql: string, values: unknown[] = []) => ({
    bind(...args: unknown[]) {
      return prepare(sql, args);
    },
    async first<T>() {
      return ((await query(sql, values)).results[0] as T | null) ?? null;
    },
    async all<T>() {
      return (await query(sql, values)) as {
        results: T[];
        success: true;
        meta: { changes: number };
      };
    },
    async run() {
      return query(sql, values);
    },
    sql,
    values,
  });
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results = [];
        for (const statement of statements)
          results.push(await query(statement.sql, statement.values, client));
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async migrate() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7217495)");
        await client.query(
          "CREATE TABLE IF NOT EXISTS komo_schema (version integer PRIMARY KEY)",
        );
        const versions = await client.query<{ version: number }>(
          "SELECT version FROM komo_schema",
        );
        const migrations = [
          "001_initial.sql",
          "002_thread_tags.sql",
          "003_project_webhooks.sql",
          "004_personal_access_tokens.sql",
          "005_snapshots.sql",
        ];
        if (
          versions.rows.length > 1 ||
          (versions.rows[0]?.version ?? 0) > migrations.length
        )
          throw Error("Unsupported PostgreSQL schema version");
        for (
          let version = versions.rows[0]?.version ?? 0;
          version < migrations.length;
          version++
        ) {
          const path = fileURLToPath(
            new URL(`./postgres/${migrations[version]}`, import.meta.url),
          );
          await client.query(await readFile(path, "utf8"));
          await client.query(
            version
              ? "UPDATE komo_schema SET version=$1"
              : "INSERT INTO komo_schema(version) VALUES($1)",
            [version + 1],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function translate(sql: string) {
  let result = sql.replace(/\bINSERT OR IGNORE INTO\b/gi, "INSERT INTO");
  const ignore = result !== sql;
  result = result.replace(/\b([a-z]+)\.rowid\b/gi, "$1.seq");
  result = result.replace("SET count=count+1", "SET count=rate_limits.count+1");
  result = result.replace(
    /json_each\(\?\)/gi,
    "jsonb_array_elements_text(?::jsonb) AS items(value)",
  );
  result = result.replace(/\bMAX\(0,([^()]+)\)/gi, "GREATEST(0,$1)");
  if (ignore) {
    const returning = /\s+RETURNING\b/i.exec(result);
    const at = returning?.index ?? result.length;
    result = result.slice(0, at) + " ON CONFLICT DO NOTHING" + result.slice(at);
  }
  let parameter = 0;
  return result.replace(/\?/g, () => `$${++parameter}`);
}
