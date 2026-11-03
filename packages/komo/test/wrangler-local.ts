// Runs local wrangler commands for tests that boot the API on workerd + D1.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
// No metrics or update checks: wrangler can wait on the network for them.
export const wranglerEnv = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  NO_UPDATE_NOTIFIER: "1",
};

function run(args: string[], timeout: number) {
  return new Promise<void>((resolve, reject) =>
    execFile(
      "pnpm",
      ["exec", "wrangler", ...args],
      { cwd: root, timeout, env: wranglerEnv },
      (error, stdout, stderr) =>
        error
          ? reject(
              new Error(
                `wrangler ${args.slice(0, 3).join(" ")} failed${error.killed ? ` after ${timeout} ms` : ""}: ${error.message}\n${stdout}\n${stderr}`,
              ),
            )
          : resolve(),
    ),
  );
}

/**
 * Applies the D1 migrations to a fresh local state directory. It normally takes
 * seconds; a CI run once hung until killed, so a failed attempt starts over on
 * an empty directory once before failing with wrangler's output.
 */
export async function applyMigrations(configPath: string, state: string) {
  const args = ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", configPath];
  try {
    await run(args, 60000);
  } catch (error) {
    console.warn(String(error));
    await rm(state, { recursive: true, force: true });
    await run(args, 60000);
  }
}

export function executeSql(configPath: string, state: string, file: string) {
  return run(["d1", "execute", "DB", "--local", "--persist-to", state, "--config", configPath, "--file", file], 60000);
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const value = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(value));
    });
  });

/**
 * Boots the API under `wrangler dev` on a migrated local D1 database.
 * `prelude` runs in the worker before the API loads (for example to stub a
 * fetch); `seed` is SQL applied after the migrations.
 */
export async function startLocalApi({
  name,
  vars,
  prelude = "",
  seed,
}: {
  name: string;
  vars: Record<string, string>;
  prelude?: string;
  seed?: string;
}) {
  const directory = await mkdtemp(join(tmpdir(), `${name}-`));
  const state = join(directory, "state");
  const port = await freePort();
  // Left to its default, each wrangler dev probes 9229 for the inspector.
  const inspectorPort = await freePort();
  const config = JSON.parse(
    await readFile(new URL("../server/wrangler.jsonc", import.meta.url), "utf8"),
  );
  config.name = name;
  delete config.account_id;
  const apiPath = fileURLToPath(new URL("../server/index.ts", import.meta.url));
  config.main = join(directory, "worker.ts");
  await writeFile(
    config.main,
    `${prelude}\nimport api from ${JSON.stringify(apiPath)};\nexport default api;\n`,
  );
  config.vars = { ...config.vars, ...vars };
  config.d1_databases = [
    {
      binding: "DB",
      database_name: name,
      database_id: name,
      migrations_dir: fileURLToPath(new URL("../server/migrations", import.meta.url)),
    },
  ];
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify(config));
  await applyMigrations(configPath, state);
  if (seed) {
    await writeFile(join(directory, "seed.sql"), seed);
    await executeSql(configPath, state, join(directory, "seed.sql"));
  }
  const worker = spawn(
    "pnpm",
    ["exec", "wrangler", "dev", "--config", configPath, "--port", String(port), "--inspector-port", String(inspectorPort), "--persist-to", state],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true, env: wranglerEnv },
  );
  let output = "";
  worker.stdout?.on("data", (chunk) => (output += String(chunk)));
  worker.stderr?.on("data", (chunk) => (output += String(chunk)));
  const stop = async () => {
    try {
      if (worker.pid) process.kill(-worker.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
    await rm(directory, { recursive: true, force: true });
  };
  for (let i = 0; i < 160; i++) {
    try {
      const health = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (health.ok) return { port, stop };
    } catch {
      /* Wait for workerd. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop();
  throw new Error(`Worker failed to start: ${output}`);
}
