import { projectHelp, runProject } from "./project.mjs";
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
  chmod,
  stat,
} from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { branchName } from "./config.mjs";
import { agentWorkflow, agentPrompt } from "../dist/agent-prompt.js";

import { installAgentWorkflow } from "./workflow.mjs";

const actions = {
  list: "List threads; defaults to open. --status open|resolved|all, --page /path, --limit 50, --offset 0",
  get: "Read one complete thread: get THREAD_ID",
  prompt: "Export open feedback as Markdown; --page /path, --json",
  create: "Create a thread: --page /path --anchor-file FILE --body TEXT",
  reply: "Reply to a thread: reply THREAD_ID --body TEXT",
  resolve: "Resolve a thread: resolve THREAD_ID",
  reopen: "Reopen a thread: reopen THREAD_ID",
  edit: "Edit your message: edit THREAD_ID COMMENT_ID --body TEXT",
  delete: "Delete your message: delete THREAD_ID COMMENT_ID",
  react:
    "Set your reaction: react THREAD_ID COMMENT_ID --emoji EMOJI [--remove]",
  tag: "Tag a comment: tag COMMENT_ID TAG [--remove]",
  move: "Move a thread: move THREAD_ID --anchor-file FILE",
};
export const agentCommands = [
  "login",
  "logout",
  "whoami",
  "comments",
  "schema",
  "agents",
  "project",
];
export const agentHelp = `
Agent commands:
  komo login                 Sign in with Google once for this project
  komo whoami                Check the current session
  komo logout                Revoke and remove the saved session
  komo comments list         Read open feedback as JSON
  komo comments get ID       Read a thread with all replies and context
  komo comments prompt       Export open feedback as an agent prompt
  komo comments reply ID --body "Fixed; verified on mobile."
  komo comments tag COMMENT_ID nav
  komo comments list --tag nav
  komo comments resolve ID   Resolve after verification
  komo comments reopen ID    Reopen a thread
  komo agents setup          Install the default workflow in AGENTS.md
  komo schema                Machine-readable command reference

${projectHelp}
Default workflow:
${agentWorkflow}

${Object.entries(actions)
  .map(([name, description]) => `  ${name}: ${description}`)
  .join("\n")}

Settings: .komo/project.json (searched upward), or --project KEY.
Overrides: --endpoint URL --origin SITE_URL --repo OWNER/REPO --branch NAME
Bodies: --body TEXT, --body-file FILE, or --body-file - for stdin.
Credentials: Google login, or KOMO_TOKEN for non-interactive use. Never commit tokens.
Results are JSON except prompt (Markdown unless --json). Errors are JSON on stderr.
`;

function parse(args) {
  const booleans = new Set(["--json", "--remove", "--no-open"]);
  const values = new Set([
    "--out",
    "--file",
    "--access",
    "--email",
    "--user",
    "--invite",
    "--confirm",
    "--project",
    "--endpoint",
    "--origin",
    "--repo",
    "--branch",
    "--page",
    "--status",
    "--body",
    "--body-file",
    "--anchor-file",
    "--emoji",
    "--tag",
    "--limit",
    "--offset",
  ]);
  const flags = {},
    positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (booleans.has(arg)) flags[arg.slice(2)] = true;
    else if (values.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw Error(`Missing value for ${arg}.`);
      flags[arg.slice(2)] = args[++i];
    } else if (arg.startsWith("--")) throw Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { flags, positional };
}
function safeUrl(value, originOnly = false) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw Error(
      "Use HTTPS, or HTTP on localhost, without credentials, query, or fragment."
    );
  if (originOnly && url.pathname !== "/")
    throw Error("Use a website origin without a path.");
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}
async function configuration(flags, cwd, env) {
  let directory = cwd,
    settings = {};
  while (true) {
    try {
      settings = JSON.parse(
        await readFile(join(directory, ".komo/project.json"), "utf8")
      );
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (dirname(directory) === directory) break;
    directory = dirname(directory);
  }
  const project = flags.project || env.KOMO_PROJECT || settings.project;
  if (!project)
    throw Error("Run komo init in this repository, or pass --project KEY.");
  const endpoint = safeUrl(
    flags.endpoint ||
      env.KOMO_ENDPOINT ||
      settings.endpoint ||
      "https://komo.offbr.co"
  );
  const origin = safeUrl(
    flags.origin ||
      env.KOMO_ORIGIN ||
      settings.origin ||
      "http://localhost:3000",
    true
  );
  const branch =
    flags.branch ||
    env.KOMO_BRANCH ||
    (settings.scope === "branch" ? branchName(env, directory) : "shared");
  if (!branch) throw Error("Cannot detect branch. Pass --branch NAME.");
  return {
    project,
    endpoint,
    origin,
    branch,
    repo: flags.repo || env.KOMO_REPO || settings.repo || project,
  };
}
function credentialPath(config, env) {
  const key = createHash("sha256")
    .update(`${config.endpoint}\n${config.project}`)
    .digest("hex");
  return join(
    env.KOMO_CONFIG_HOME || join(homedir(), ".config", "komo"),
    `${key}.json`
  );
}
async function readToken(path, env) {
  if (env.KOMO_TOKEN) return env.KOMO_TOKEN;
  try {
    return JSON.parse(await readFile(path, "utf8")).token;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}
async function saveToken(path, token) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ token }), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export function apiClient(config, token) {
  return async (path, method = "GET", data) => {
    const url = new URL(path, `${config.endpoint}/`);
    for (const key of ["project", "repo", "branch"])
      url.searchParams.set(key, config[key]);
    const response = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Origin: config.origin,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error(`API returned an invalid response (${response.status}).`);
    }
    if (!response.ok) {
      const error = Error(
        response.status === 401
          ? "Session missing or expired. Run komo login."
          : result.error || `Request failed (${response.status}).`
      );
      error.status = response.status;
      throw error;
    }
    return result;
  };
}
export async function listThreads(request) {
  const threads = [],
    seen = new Set();
  let offset = 0;
  while (offset !== null) {
    if (
      seen.has(offset) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw Error("Invalid pagination from API.");
    seen.add(offset);
    const result = await request(`threads?offset=${offset}`);
    if (!Array.isArray(result.threads))
      throw Error("Invalid thread list from API.");
    threads.push(...result.threads);
    offset = result.next ?? null;
  }
  return threads;
}
async function smallFile(path, maximum) {
  if ((await stat(path)).size > maximum)
    throw Error("Input file is too large.");
  return readFile(path, "utf8");
}
async function inputBody(flags, cwd) {
  if (flags.body !== undefined && flags["body-file"] !== undefined)
    throw Error("Choose --body or --body-file, not both.");
  let text = flags.body;
  if (flags["body-file"] === "-") {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 16000) throw Error("Body is too large.");
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else if (flags["body-file"])
    text = await smallFile(resolve(cwd, flags["body-file"]), 16000);
  if (!text?.trim() || text.length > 4000)
    throw Error("Supply a nonempty body of at most 4,000 characters.");
  return text.trim();
}
async function anchorFile(flags, cwd) {
  if (!flags["anchor-file"])
    throw Error("Supply --anchor-file FILE with the captured anchor JSON.");
  return JSON.parse(await smallFile(resolve(cwd, flags["anchor-file"]), 16000));
}
function id(value, label = "thread") {
  if (!value || !/^[\w:-]{1,100}$/.test(value))
    throw Error(`Supply a valid ${label} ID.`);
  return value;
}

async function login(config, path, flags) {
  const nonce = randomBytes(32).toString("hex");
  let complete, rejectLogin, authUrl;
  const done = new Promise((resolveLogin, reject) => {
    complete = resolveLogin;
    rejectLogin = reject;
  });
  void done.catch(() => {});
  const server = createServer(async (req, res) => {
    const send = (status, text, type = "text/plain") => {
      res.writeHead(status, {
        "Content-Type": `${type}; charset=utf-8`,
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`,
        "Referrer-Policy": "no-referrer",
      });
      res.end(text);
    };
    if (req.headers.host !== new URL(loopback).host || req.url !== `/${nonce}`)
      return send(404, "Not found");
    if (req.method === "GET") {
      const safe = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
      return send(
        200,
        `<!doctype html><meta charset="utf-8"><title>Sign in to komo</title><style>body{background:#191919;color:#eee;font:16px system-ui;max-width:420px;margin:18vh auto;padding:24px}button{font:inherit;padding:14px 20px;border:0;border-radius:12px;background:#c8b5f4}p{line-height:1.5;color:#aaa}</style><h1>Connect your agent</h1><p id="project"></p><p>The CLI can read and update comments as you. Your session stays on this computer.</p><button>Continue with Google</button><p id="status"></p><script nonce="${nonce}">document.querySelector('#project').textContent=${safe(config.project)};let popup;document.querySelector('button').onclick=()=>{popup=window.open(${safe(authUrl)},'komo-cli-auth','width=500,height=700')};window.addEventListener('message',async e=>{if(e.origin!==${safe(new URL(config.endpoint).origin)}||e.source!==popup||e.data?.type!=='branch-comments:auth')return;const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:e.data.token})});document.querySelector('#status').textContent=await response.text();if(response.ok){document.querySelector('button').disabled=true;setTimeout(()=>window.close(),400)}});</script>`,
        "text/html"
      );
    }
    if (
      req.method !== "POST" ||
      req.headers.origin !== loopback ||
      req.headers["content-type"] !== "application/json"
    )
      return send(403, "Not allowed");
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return send(413, "Too large");
        chunks.push(chunk);
      }
      const { token } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof token !== "string" || token.length > 200 || !token.length)
        throw Error("Invalid session.");
      const { user } = await apiClient(config, token)("me");
      if (!user.verified) throw Error("Use Google sign-in to connect the CLI.");
      await saveToken(path, token);
      res.once("finish", () => complete(user));
      send(200, "Connected. You can close this tab.");
    } catch {
      send(400, "Sign-in failed. Please try again.");
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const loopback = `http://127.0.0.1:${server.address().port}`;
  const timeout = setTimeout(
    () => rejectLogin(Error("Sign-in timed out. Run komo login again.")),
    600000
  );
  const cancel = () => rejectLogin(Error("Sign-in cancelled."));
  process.once("SIGINT", cancel);
  try {
    authUrl = (
      await apiClient(config)("auth/google/start", "POST", {
        returnOrigin: loopback,
      })
    ).url;
    if (new URL(authUrl).origin !== new URL(config.endpoint).origin)
      throw Error("Unexpected sign-in URL.");
    const url = `${loopback}/${nonce}`;
    console.error(`Complete Google sign-in in your browser:\n${url}`);
    if (!flags["no-open"]) {
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "rundll32"
            : "xdg-open";
      const argv =
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", url]
          : [url];
      const child = spawn(opener, argv, { stdio: "ignore", detached: true });
      child.on("error", () => {});
      child.unref();
    }
    return await done;
  } finally {
    clearTimeout(timeout);
    process.removeListener("SIGINT", cancel);
    server.close();
    server.closeAllConnections();
  }
}

export async function runAgent(
  args,
  { cwd = process.cwd(), env = process.env } = {}
) {
  const { flags, positional } = parse(args);
  const [command, action = "list", threadId, commentId] = positional;
  if (command === "agents") {
    if (
      action !== "setup" ||
      positional.length !== 2 ||
      Object.keys(flags).length
    )
      throw Error("Use komo agents setup from the project root.");
    console.log(
      JSON.stringify(
        { ok: true, data: await installAgentWorkflow(cwd) },
        null,
        2
      )
    );
    return;
  }
  if (command === "schema") {
    console.log(
      JSON.stringify(
        {
          version: 1,
          commands: actions,
          auth: "komo login",
          output: "JSON; prompt is Markdown unless --json",
          context: ".komo/project.json or --project KEY",
          overrides: ["--endpoint", "--origin", "--repo", "--branch"],
          body: ["--body", "--body-file", "--body-file -"],
          setup: "komo agents setup",
          project: projectHelp,
          guidance: agentWorkflow,
        },
        null,
        2
      )
    );
    return;
  }
  if (command === "comments" && !Object.hasOwn(actions, action))
    throw Error(`Unknown comments action: ${action}`);
  const expected =
    command === "project"
      ? 2
      : command === "comments"
        ? ["edit", "delete", "react"].includes(action)
          ? 4
          : ["get", "reply", "resolve", "reopen", "move"].includes(action)
            ? 3
            : action === "tag"
              ? 4
              : 2
        : 1;
  if (positional.length > expected)
    throw Error("Unexpected positional arguments. Run komo --help.");
  const config = await configuration(flags, cwd, env),
    path = credentialPath(config, env);
  const token = await readToken(path, env),
    request = apiClient(config, token);
  if (command !== "logout" && config.repo === config.project) {
    const metadata = await request("config");
    if (metadata.repo) config.repo = metadata.repo;
  }
  let data;
  if (command === "login") data = { user: await login(config, path, flags) };
  else {
    if (!token)
      throw Error("No saved session. Run komo login, or set KOMO_TOKEN.");
    if (command === "project")
      data = await runProject(action, flags, request, config, cwd);
    else if (command === "whoami") data = await request("me");
    else if (command === "logout") {
      try {
        await request("me", "DELETE");
      } catch (error) {
        if (error.status !== 401 && error.status !== 404) throw error;
      }
      await rm(path, { force: true });
      data = { signedOut: true };
    } else if (["list", "get", "prompt"].includes(action)) {
      let threads = (
        action === "get"
          ? (await request(`threads?id=${id(threadId)}`)).threads
          : await listThreads(request)
      ).map((thread) => ({
        ...thread,
        comments: thread.comments
          .filter((comment) => comment.body !== "[Comment deleted]")
          .map((comment) => ({
            ...comment,
            author: {
              id: comment.author.id,
              name: comment.author.name,
              verified: comment.author.verified,
            },
          })),
        resolvedBy: thread.resolvedBy
          ? {
              id: thread.resolvedBy.id,
              name: thread.resolvedBy.name,
              verified: thread.resolvedBy.verified,
            }
          : null,
      }));
      if (action === "get") {
        data = threads.find((thread) => thread.id === id(threadId));
        if (!data) throw Error("Thread not found in this project and branch.");
      } else {
        if (flags.page)
          threads = threads.filter(
            (thread) =>
              thread.page === flags.page.replace(/\/$/, "") ||
              thread.page === flags.page
          );
        if (action === "prompt") {
          const prompt =
            agentPrompt(threads, {
              ...config,
              ...(flags.page
                ? {
                    page:
                      flags.page === "/" ? "/" : flags.page.replace(/\/$/, ""),
                  }
                : {}),
            }) || "No open comments.";
          if (!flags.json) {
            console.log(prompt);
            return;
          }
          data = { prompt };
        } else {
          const status = flags.status || "open";
          if (!["open", "resolved", "all"].includes(status))
            throw Error("Use --status open, resolved, or all.");
          const filtered = threads.filter(
            (thread) =>
              status === "all" || thread.resolved === (status === "resolved")
          );
          const byTag = flags.tag
            ? filtered.filter((thread) =>
                thread.comments.some((comment) => comment.tags?.includes(flags.tag))
              )
            : filtered;
          const limit = Number(flags.limit ?? 50),
            offset = Number(flags.offset ?? 0);
          if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 250 ||
            !Number.isInteger(offset) ||
            offset < 0
          )
            throw Error("Use --limit 1–250 and a nonnegative --offset.");
          data = {
            threads: byTag.slice(offset, offset + limit),
            total: byTag.length,
            nextOffset:
              offset + limit < byTag.length ? offset + limit : null,
          };
        }
      }
    } else if (action === "create") {
      if (!flags.page?.startsWith("/")) throw Error("Supply --page /path.");
      data = await request("threads", "POST", {
        page: flags.page,
        anchor: await anchorFile(flags, cwd),
        body: await inputBody(flags, cwd),
      });
    } else {
      const thread = `threads/${id(threadId)}`;
      if (["resolve", "reopen"].includes(action))
        data = await request(thread, "PATCH", {
          resolved: action === "resolve",
        });
      else if (action === "reply")
        data = await request(`${thread}/comments`, "POST", {
          body: await inputBody(flags, cwd),
        });
      else if (action === "move")
        data = await request(thread, "PATCH", {
          anchor: { ...(await anchorFile(flags, cwd)), unstacked: true },
        });
      else if (action === "tag") {
        const commentId = id(positional[2], "comment");
        const tag = positional[3];
        if (!tag || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag))
          throw Error(
            "Use a lowercase tag slug of 1–32 letters, numbers, hyphens, or underscores."
          );
        const containing = (await listThreads(request)).find((item) =>
          item.comments.some((comment) => comment.id === commentId)
        );
        if (!containing)
          throw Error("Comment not found in this project and branch.");
        data = await request(
          `threads/${id(containing.id)}/comments/${commentId}/tags`,
          "POST",
          { tag, active: !flags.remove }
        );
      } else {
        const comment = `${thread}/comments/${id(commentId, "comment")}`;
        if (action === "edit")
          data = await request(comment, "PATCH", {
            body: await inputBody(flags, cwd),
          });
        else if (action === "delete") data = await request(comment, "DELETE");
        else if (action === "react") {
          if (!flags.emoji) throw Error("Supply --emoji EMOJI.");
          data = await request(`${comment}/reactions`, "POST", {
            emoji: flags.emoji,
            active: !flags.remove,
          });
        }
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        scope: {
          project: config.project,
          repo: config.repo,
          branch: config.branch,
        },
        data,
      },
      null,
      2
    )
  );
}
