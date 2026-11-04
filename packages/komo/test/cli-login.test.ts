import { runInNewContext } from "node:vm";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("keeps login credentials private and rejects a foreign callback origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "komo-login-test-"));
  let returnOrigin = "",
    revoked = false,
    failure = 0;
  const user = { id: "google:test", name: "CLI reviewer", verified: true };
  const api = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (failure) {
      res.statusCode = failure;
      res.end(JSON.stringify({error: "Unavailable"}));
      return;
    }
    if (req.url?.startsWith("/auth/google/start")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      returnOrigin = JSON.parse(body).returnOrigin;
      res.end(
        JSON.stringify({
          url: `http://127.0.0.1:${(api.address() as { port: number }).port}/auth/google/authorize?state=fixture`,
        })
      );
    } else if (req.url?.startsWith("/config"))
      res.end(JSON.stringify({ repo: "owner/site" }));
    else if (req.headers.authorization === "Bearer test-session-secret") {
      if (req.method === "DELETE") revoked = true;
      res.end(JSON.stringify({ user }));
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Invalid token" }));
    }
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const entry = fileURLToPath(new URL("../cli/index.mjs", import.meta.url));
  const env = {
    ...process.env,
    PALETTE_CONFIG_HOME: directory,
    PALETTE_PROJECT: "fixture",
    PALETTE_ENDPOINT: endpoint,
    PALETTE_ORIGIN: "http://localhost:3000",
    PALETTE_TOKEN: "",
    KOMO_TOKEN: "",
  };
  const child = spawn(process.execPath, [entry, "login", "--no-open"], {
    env,
    cwd: directory,
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve)
  );
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Login did not start")),
        5000
      );
      child.stderr.on("data", (data) => {
        stderr += data;
        const match = stderr.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
    });
    expect(new URL(url).origin).toBe(returnOrigin);
    const page = await fetch(url);
    expect(page.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );
    const html = await page.text();
    expect(html).toContain("Continue with Google");
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
    for (const ok of [false, true]) {
      let listener: (event: unknown) => Promise<void>;
      let closed = false;
      const popup = {};
      const nodes = new Map<
        string,
        { textContent?: string; disabled?: boolean; onclick?: () => void }
      >();
      runInNewContext(script, {
        document: {
          querySelector: (selector: string) => {
            if (!nodes.has(selector)) nodes.set(selector, {});
            return nodes.get(selector);
          },
        },
        window: {
          open: () => popup,
          close: () => {
            closed = true;
          },
          addEventListener: (_: string, callback: typeof listener) => {
            listener = callback;
          },
        },
        location: { pathname: new URL(url).pathname },
        fetch: async () => ({
          ok,
          text: async () =>
            ok ? "Connected. You can close this tab." : "Sign-in failed.",
        }),
        setTimeout: (callback: () => void) => callback(),
      });
      nodes.get("button")!.onclick!();
      await listener!({
        origin: endpoint,
        source: popup,
        data: { type: "branch-comments:auth", token: "fixture" },
      });
      expect(closed).toBe(ok);
      expect(nodes.get("#status")!.textContent).toBe(
        ok ? "Connected. You can close this tab." : "Sign-in failed."
      );
    }
    const post = (origin: string, token: string) =>
      fetch(url, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    expect(
      (await post("https://evil.example", "test-session-secret")).status
    ).toBe(403);
    expect((await post(returnOrigin, "wrong-token")).status).toBe(400);
    expect((await readdir(directory)).length).toBe(0);
    expect((await post(returnOrigin, "test-session-secret")).status).toBe(200);
    expect(await exited).toBe(0);
    expect(JSON.parse(stdout).data.user).toEqual(user);
    expect(stdout + stderr).not.toContain("test-session-secret");
    const [file] = await readdir(directory);
    expect(
      JSON.parse(await readFile(join(directory, file), "utf8")).token
    ).toBe("test-session-secret");
    expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600);
    await promisify(execFile)(process.execPath, [entry, "logout"], {
      env,
      cwd: directory,
    });
    expect(revoked).toBe(true);
    expect(await readdir(directory)).toHaveLength(0);
    const saved = join(directory, file);
    await writeFile(saved, JSON.stringify({token: "test-session-secret"}));
    failure = 500;
    await expect(promisify(execFile)(process.execPath, [entry, "logout"], {env, cwd: directory})).rejects.toThrow();
    expect(JSON.parse(await readFile(saved, "utf8")).token).toBe("test-session-secret");
    for (const status of [404, 401]) {
      failure = status;
      await writeFile(saved, JSON.stringify({token: "test-session-secret"}));
      const result = await promisify(execFile)(process.execPath, [entry, "logout"], {env, cwd: directory});
      expect(JSON.parse(result.stdout).data.signedOut).toBe(true);
      expect(await readdir(directory)).toHaveLength(0);
    }
  } finally {
    child.kill();
    api.close();
    api.closeAllConnections();
    await rm(directory, { recursive: true, force: true });
  }
});

it("reads a session saved under ~/.config/komo before the rename, and logout removes it", async () => {
  const home = await mkdtemp(join(tmpdir(), "palette-legacy-home-"));
  const user = { id: "google:test", name: "CLI reviewer", verified: true };
  let revoked = false;
  const api = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/config")) res.end(JSON.stringify({ repo: "owner/site" }));
    else if (req.headers.authorization === "Bearer legacy-session") {
      if (req.method === "DELETE") revoked = true;
      res.end(JSON.stringify({ user }));
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Invalid token" }));
    }
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const entry = fileURLToPath(new URL("../cli/index.mjs", import.meta.url));
  const env = {
    ...process.env,
    HOME: home,
    PALETTE_CONFIG_HOME: "",
    KOMO_CONFIG_HOME: "",
    PALETTE_TOKEN: "",
    KOMO_TOKEN: "",
    PALETTE_PROJECT: "fixture",
    PALETTE_ENDPOINT: endpoint,
  };
  const key = createHash("sha256").update(`${endpoint}\nfixture`).digest("hex");
  const legacy = join(home, ".config", "komo", `${key}.json`);
  try {
    await mkdir(dirname(legacy), { recursive: true });
    await writeFile(legacy, JSON.stringify({ token: "legacy-session" }));
    const whoami = await promisify(execFile)(process.execPath, [entry, "whoami"], { env, cwd: home });
    expect(JSON.parse(whoami.stdout).data).toMatchObject({ user, auth: "session" });
    await promisify(execFile)(process.execPath, [entry, "logout"], { env, cwd: home });
    expect(revoked).toBe(true);
    await expect(stat(legacy)).rejects.toThrow();
  } finally {
    api.close();
    api.closeAllConnections();
    await rm(home, { recursive: true, force: true });
  }
});
