#!/usr/bin/env node
import { mkdir, readFile, writeFile, access, cp, rm } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { branchName, clientModule, gitValue, projectLayout, repository, setting } from "./config.mjs";

import { installAgentWorkflow } from "./workflow.mjs";
import { agentCommands, agentHelp, runAgent } from "./agent.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cwd = process.cwd();
const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const layout = projectLayout(cwd);
const settingsDir = resolve(cwd, layout.dir);
const settingsPath = join(settingsDir, "project.json");
const generatedPath = resolve(cwd, layout.module);
const run = (program, argv, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(program, argv, {
      cwd,
      stdio: ["inherit", "pipe", "inherit"],
      shell: false,
      ...options,
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      process.stdout.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolveRun(output)
        : reject(Error(`${program} exited with ${code}`))
    );
  });
async function request(endpoint, path, data) {
  const response = await fetch(new URL(path, endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || `Request failed (${response.status}).`);
  return result;
}
async function sync() {
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const config = { ...settings };
  delete config.origin;
  if (config.scope === "branch") {
    config.branch = branchName(process.env, cwd);
    if (!config.branch)
      throw Error("Cannot detect the branch. Set PALETTE_BRANCH for this build.");
  }
  await writeFile(generatedPath, clientModule(config));
  console.log(`Updated ${layout.module}`);
}
async function protectLocalFiles() {
  const path = resolve(cwd, ".gitignore");
  const existing = (await exists(path)) ? await readFile(path, "utf8") : "";
  const additions = [
    ...["owner-key", "setup.json", ".dev.vars", "node.env", ".wrangler/"].map((file) => `${layout.dir}/${file}`),
    layout.module,
  ].filter((line) => !existing.split("\n").includes(line));
  if (additions.length)
    await writeFile(path, `${existing}\n# Palette\n${additions.join("\n")}\n`);
}
async function deploy() {
  const dir = settingsDir,
    path = join(dir, "wrangler.json");
  const statePath = join(dir, "deployment.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const wr = (...argv) =>
    run("npx", ["--yes", "wrangler@4", ...argv, "--config", path]);
  await wr("login");
  let config = JSON.parse(await readFile(path, "utf8"));
  if (!config.d1_databases?.length) {
    await wr("d1", "create", config.name, "--binding", "DB", "--update-config");
    config = JSON.parse(await readFile(path, "utf8"));
  }
  config.d1_databases[0].migrations_dir = "migrations";
  await writeFile(path, JSON.stringify(config, null, 2));
  await cp(join(packageRoot, "server/migrations"), join(dir, "migrations"), {
    recursive: true,
  });
  await wr("d1", "migrations", "apply", "DB", "--remote");
  const output = await wr("deploy");
  const endpoint =
    flag("--endpoint") ||
    state.endpoint ||
    output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/)?.[0];
  if (!endpoint)
    throw Error(
      "No API URL returned. Run palette deploy --endpoint YOUR_WORKER_URL."
    );
  await writeFile(statePath, JSON.stringify({ ...state, endpoint }, null, 2));
  console.log("Store the Google OAuth client secret:");
  await wr("secret", "put", "GOOGLE_CLIENT_SECRET");
  await writeFile(
    settingsPath,
    `${JSON.stringify(
      {
        endpoint,
        project: state.project,
        repo: state.repo,
        scope: state.scope,
        origin: state.origin,
      },
      null,
      2
    )}\n`
  );
  await sync();
  await installAgentWorkflow(cwd);
  const key = await readFile(join(dir, "owner-key"), "utf8");
  console.log(
    `Register ${endpoint}/auth/google/callback in Google Console.\nOpen ${endpoint}/setup?project=${state.project}#${key} to claim ownership with Google.`
  );
}
async function init() {
  if (await exists(join(settingsDir, "deployment.json")))
    throw Error("Self-host setup exists. Run palette deploy to resume.");
  const previous = (await exists(settingsPath))
    ? JSON.parse(await readFile(settingsPath, "utf8"))
    : null;
  const resuming = previous?.onboarding?.inProject === true;
  if (
    !resuming &&
    ((await exists(settingsPath)) || (await exists(generatedPath)))
  )
    throw Error(
      `Palette is already configured. Edit ${layout.dir}/project.json, then run palette sync.`
    );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (text, fallback = "") => {
    if (!process.stdin.isTTY) {
      if (fallback) return fallback;
      throw Error(
        `${text} Supply the corresponding CLI flag in non-interactive mode.`
      );
    }
    return (
      (
        await rl.question(`${text}${fallback ? ` [${fallback}]` : ""}: `)
      ).trim() || fallback
    );
  };
  try {
    const selfHosted = args.includes("--self-host");
    const nodeHosted = args.includes("--node");
    if (selfHosted && nodeHosted) throw Error("Choose --node or --self-host.");
    const detected = repository(gitValue(["remote", "get-url", "origin"], cwd));
    const project = `komo_${randomUUID().replaceAll("-", "")}`;
    const repo =
      flag("--repo") || (resuming ? previous.repo : "") || detected || project;
    const origin =
      flag("--origin") ||
      (resuming ? previous.origin : "") ||
      process.env.CF_PAGES_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      process.env.DEPLOY_PRIME_URL ||
      "http://localhost:3000";
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      !["https:", "http:"].includes(parsed.protocol) ||
      (parsed.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(parsed.hostname))
    )
      throw Error("Use an exact HTTPS origin, or localhost.");
    const origins = [
      ...new Set([
        origin,
        ...[
          process.env.CF_PAGES_URL,
          process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
          process.env.DEPLOY_PRIME_URL,
        ]
          .filter(Boolean)
          .map((site) => new URL(site).origin),
      ]),
    ];
    const scope = args.includes("--branch-scope")
      ? "branch"
      : resuming
        ? previous.scope
        : "project";
    let config;
    if (!selfHosted && !nodeHosted) {
      const endpoint =
        flag("--endpoint") ||
        setting(process.env, "ENDPOINT") ||
        (resuming ? previous.endpoint : "");
      if (!endpoint)
        throw Error(
          "Palette has no default server. Pass --endpoint URL or set PALETTE_ENDPOINT to your Palette server, or self-host with palette init --node (see NODE.md) or palette init --self-host."
        );
      const api = new URL(endpoint);
      if (
        api.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(api.hostname)
      )
        throw Error("The API endpoint must use HTTPS.");
      const setupPath = join(settingsDir, "setup.json");
      let setup =
        resuming && (await exists(setupPath))
          ? JSON.parse(await readFile(setupPath, "utf8"))
          : null;
      if (
        !setup ||
        setup.expiresAt <= Date.now() ||
        flag("--origin") ||
        flag("--repo") ||
        endpoint !== previous?.endpoint
      ) {
        setup = {
          ...(await request(endpoint, "/setup/start", { repo, origins })),
          expiresAt: Date.now() + 600000,
        };
      }
      await mkdir(dirname(settingsPath), { recursive: true });
      await protectLocalFiles();
      await writeFile(setupPath, JSON.stringify(setup), { mode: 0o600 });
      await writeFile(
        settingsPath,
        `${JSON.stringify({ endpoint, project: `setup_${setup.id}`, repo, scope, origin, onboarding: { inProject: true, code: setup.id, sites: origins.filter((site) => site.startsWith("https://")) } }, null, 2)}\n`
      );
      await sync();
      await installAgentWorkflow(cwd);
      console.log(
        `\nMount Palette in your app:\n\nimport { initPalette } from './${layout.module}';\ninitPalette();\n\nOpen ${origin} and choose Connect in the sidebar.\nKeep this terminal open while you start your app in another terminal.\nHosted recovery: ${setup.url}\n`
      );
      console.log("Waiting for your project to connect…");
      const end = setup.expiresAt;
      while (Date.now() < end) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
        const result = await request(endpoint, "/setup/poll", {
          id: setup.id,
          secret: setup.secret,
        });
        if (!result.pending) {
          config = {
            endpoint: result.endpoint,
            project: result.project,
            repo: result.repo,
            scope,
            origin,
          };
          break;
        }
      }
      if (!config)
        throw Error("Sign-in timed out. Run palette init again to resume setup.");
      await rm(setupPath, { force: true });
    } else if (nodeHosted) {
      const endpoint = flag("--endpoint") || (await ask("Public API URL"));
      const api = new URL(endpoint);
      if (
        api.origin !== endpoint ||
        (api.protocol !== "https:" &&
          !["localhost", "127.0.0.1"].includes(api.hostname))
      ) throw Error("Use an HTTPS API origin, or localhost.");
      const previewOrigin = flag("--preview-origin");
      if (previewOrigin &&
        !/^https:\/\/[a-z0-9-]*\*[a-z0-9-]*\.[a-z0-9.-]+$/.test(previewOrigin))
        throw Error("Use a single-label HTTPS preview wildcard.");
      const googleClient =
        flag("--google-client-id") || (await ask("Google OAuth client ID"));
      const key = randomBytes(32).toString("hex");
      const dir = settingsDir;
      await mkdir(dir, { recursive: true });
      await protectLocalFiles();
      const projectConfig = {
        repo,
        origins: [...new Set([...origins, ...(previewOrigin ? [previewOrigin] : [])])],
        requireOwner: true,
        bootstrapHash: createHash("sha256").update(key).digest("hex"),
      };
      await writeFile(join(dir, "owner-key"), key, { mode: 0o600 });
      await writeFile(join(dir, "node.env"), [
        "DATABASE_URL=REPLACE_WITH_POSTGRES_URL",
        `PUBLIC_URL=${endpoint}`,
        `PROJECTS=${JSON.stringify({ [project]: projectConfig })}`,
        `GOOGLE_CLIENT_ID=${googleClient}`,
        "GOOGLE_CLIENT_SECRET=REPLACE_WITH_GOOGLE_SECRET",
        "PORT=8080",
        "",
      ].join("\n"), { mode: 0o600 });
      config = { endpoint, project, repo, scope, origin };
      await writeFile(settingsPath, `${JSON.stringify(config, null, 2)}\n`);
      await sync();
      await installAgentWorkflow(cwd);
      console.log(
        `Edit ${layout.dir}/node.env with your PostgreSQL URL and Google secret.\nDeploy the Node container with those variables.\nRegister ${endpoint}/auth/google/callback in Google Console.\nOpen ${endpoint}/setup?project=${project}#${key} to claim ownership after the API is live.\n`
      );
      return;
    } else {
      if (
        !(await exists(resolve(cwd, "node_modules/@hazem3500/palette/package.json")))
      )
        throw Error(
          "Install Palette in this project before self-hosting: npm install @hazem3500/palette (or install the preview tarball before publication)."
        );
      await protectLocalFiles();
      const name = `komo-${basename(cwd)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 32)}-${project.slice(-6)}`;
      const googleClient =
        flag("--google-client-id") || (await ask("Google OAuth client ID"));
      const key = randomBytes(32).toString("hex");
      const dir = settingsDir;
      await mkdir(dir, { recursive: true });
      await cp(
        join(packageRoot, "server/migrations"),
        join(dir, "migrations"),
        { recursive: true }
      );
      await writeFile(
        join(dir, "index.ts"),
        'export { default } from "@hazem3500/palette/server";\n'
      );
      const wrangler = {
        name,
        main: "index.ts",
        compatibility_date: "2026-07-02",
        compatibility_flags: ["nodejs_compat"],
        observability: { enabled: true },
        vars: {
          PROJECTS: JSON.stringify({
            [project]: {
              repo,
              origins,
              requireOwner: true,
              bootstrapHash: createHash("sha256").update(key).digest("hex"),
            },
          }),
          GOOGLE_CLIENT_ID: googleClient,
          GITHUB_CLIENT_ID: "",
          GITHUB_CLIENT_SECRET: "",
        },
      };
      const path = join(dir, "wrangler.json");
      await writeFile(path, JSON.stringify(wrangler, null, 2));
      await writeFile(join(dir, "owner-key"), key, { mode: 0o600 });
      await writeFile(
        join(dir, "deployment.json"),
        JSON.stringify({ project, repo, scope, origin }, null, 2)
      );
      await deploy();
      return;
    }
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(config, null, 2)}\n`);
    await protectLocalFiles();
    await sync();
    await installAgentWorkflow(cwd);
    console.log("Added the Palette comment workflow to AGENTS.md");
    console.log(
      `\nMount after the page loads:\n\nimport { initPalette } from '@hazem3500/palette';\ninitPalette(${JSON.stringify({ ...config, origin: undefined, ...(config.scope === "branch" ? { branch: branchName(process.env, cwd) } : {}) }, null, 2)});\n\nFor automatic branch detection, use the generated ${layout.module} helper and run palette sync before your build.\n`
    );
  } finally {
    rl.close();
  }
}
try {
  if (args.includes("--help") || !command)
    console.log(
      `Palette\n\n  palette init --endpoint API_URL  Connect to an existing Palette server\n  palette init --self-host  Deploy your own Worker and D1 database\n  palette init --node       Prepare a Node/PostgreSQL project\n  palette deploy        Resume self-hosted deployment\n  palette sync          Regenerate client settings; detect the current branch\n\nOptions: --origin URL --endpoint API_URL --repo OWNER/REPO --branch-scope\nSelf-host: --google-client-id ID; Node: --preview-origin HTTPS_WILDCARD\n\nComments are shared across deployments unless --branch-scope is set.${
        agentHelp
      }`
    );
  else if (agentCommands.includes(command)) await runAgent(args);
  else if (command === "init") await init();
  else if (command === "deploy") await deploy();
  else if (command === "sync") await sync();
  else throw Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(
    agentCommands.includes(command)
      ? JSON.stringify({
          ok: false,
          error: { message: error.message, status: error.status ?? null },
        })
      : error.message
  );
  process.exitCode = 1;
}
