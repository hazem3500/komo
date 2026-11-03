import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const image = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);
const markup = "<!-- komo: no image snapshot, the element shows images from another origin. --><p>Hi</p>";
const user = { id: "u1", name: "Sam", verified: true };
const anchor = { selector: "#cta", text: "Start", x: 0.5, y: 0.5, width: 0, height: 0, pageX: 1, pageY: 1, viewportWidth: 1280 };
const thread = (id: string, snapshot?: object) => ({
  id, page: "/", anchor, resolved: false, resolvedBy: null, createdAt: 1, updatedAt: 1,
  comments: [{ id: `${id}-c`, body: "Fix this", author: user, createdAt: 1, editedAt: null, reactions: {} }],
  ...(snapshot ? { snapshot } : {}),
});

it("saves a thread's snapshots as files and lists them in the prompt", async () => {
  // The CLI sees its working directory with symlinks resolved (macOS /var is /private/var).
  const directory = await realpath(await mkdtemp(join(tmpdir(), "komo-cli-snapshots-")));
  await mkdir(join(directory, ".komo"));
  await writeFile(join(directory, ".komo/project.json"), JSON.stringify({ project: "fixture", repo: "owner/site" }));
  const reads: { path: string; auth?: string; query: string }[] = [];
  const api = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
    const snapshot = { image: `${base}/threads/t1/snapshot/image?v=1`, html: `${base}/threads/t1/snapshot/html?v=1` };
    const read = url.pathname.match(/^\/threads\/([^/]+)\/snapshot\/(image|html)$/);
    if (read) {
      reads.push({ path: url.pathname, auth: req.headers.authorization, query: url.search });
      res.setHeader("Content-Type", read[2] === "image" ? "image/webp" : "text/plain; charset=utf-8");
      return res.end(read[2] === "image" ? image : markup);
    }
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/config") return res.end(JSON.stringify({ repo: "owner/site" }));
    res.end(JSON.stringify({ threads: [thread("t1", snapshot), thread("t2")], next: null }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const env = {
    ...process.env,
    KOMO_CONFIG_HOME: directory,
    KOMO_ENDPOINT: `http://127.0.0.1:${(api.address() as { port: number }).port}`,
    KOMO_ORIGIN: "http://localhost:3000",
    KOMO_TOKEN: "test-token",
    KOMO_BRANCH: "shared",
  };
  const entry = fileURLToPath(new URL("../cli/index.mjs", import.meta.url));
  const run = async (...args: string[]) =>
    (await promisify(execFile)(process.execPath, [entry, ...args], { env, cwd: directory })).stdout;
  try {
    // Saved beside the project settings, in a folder that keeps itself out of Git.
    const saved = JSON.parse(await run("comments", "snapshots", "t1")).data;
    const folder = join(directory, ".komo/snapshots");
    expect(saved).toEqual({ thread: "t1", files: { image: join(folder, "t1.webp"), html: join(folder, "t1.html.txt") } });
    expect(await readFile(saved.files.image)).toEqual(image);
    expect(await readFile(saved.files.html, "utf8")).toBe(markup);
    expect(await readFile(join(folder, ".gitignore"), "utf8")).toBe("*\n");
    expect((await stat(saved.files.image)).mode & 0o777).toBe(0o600);
    expect(reads.every((read) => read.auth === "Bearer test-token" && read.query.includes("project=fixture"))).toBe(true);

    // A thread without snapshots saves nothing.
    expect(JSON.parse(await run("comments", "snapshots", "t2")).data).toEqual({ thread: "t2", files: {} });

    const out = join(directory, "elsewhere");
    const got = JSON.parse(await run("comments", "get", "t1", "--snapshots", "--out", out)).data;
    expect(got.snapshot.image).toContain("/threads/t1/snapshot/image");
    expect(got.snapshotFiles).toEqual({ image: join(out, "t1.webp"), html: join(out, "t1.html.txt") });
    expect(await readdir(out)).toEqual(["t1.html.txt", "t1.webp"]);

    const plain = await run("comments", "prompt");
    expect(plain).toContain('save it as files with komo comments snapshots "t1"');
    const prompt = await run("comments", "prompt", "--snapshots");
    expect(prompt).toContain(`- Image: ${JSON.stringify(join(folder, "t1.webp"))}`);
    expect(prompt).toContain(`- HTML, as text: ${JSON.stringify(join(folder, "t1.html.txt"))}`);
    expect(prompt.match(/Element snapshot/g)).toHaveLength(1);
    const json = JSON.parse(await run("comments", "prompt", "--snapshots", "--json")).data;
    expect(json.snapshots).toEqual([{ thread: "t1", image: join(folder, "t1.webp"), html: join(folder, "t1.html.txt") }]);

    await expect(run("comments", "list", "--snapshots")).rejects.toThrow("Use --snapshots with komo comments get or prompt.");
  } finally {
    api.close();
    await rm(directory, { recursive: true, force: true });
  }
});
