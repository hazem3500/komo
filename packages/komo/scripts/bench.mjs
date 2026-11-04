import { build } from "esbuild";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const root = await mkdtemp(join(tmpdir(), "komo-bench-"));
await cp("bench", root, { recursive: true });
await build({
  entryPoints: ["dist/index.js"],
  outdir: join(root, "after"),
  bundle: true,
  splitting: true,
  minify: true,
  format: "esm",
});
const baseline = process.env.PALETTE_BENCH_BASELINE || process.env.KOMO_BENCH_BASELINE;
if (baseline)
  await cp(baseline, join(root, "before"), {
    recursive: true,
  });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const file = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response
      .writeHead(200, {
        "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html",
        "Cache-Control": "no-store",
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    `Open http://127.0.0.1:${server.address().port}/?mode=after — use mode=none for the host baseline; comments=0 for an empty project.`
  )
);
