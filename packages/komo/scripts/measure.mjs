import { build } from "esbuild";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(`${tmpdir()}/komo-size-`);
const result = await build({
  entryPoints: ["dist/index.js"],
  outdir: directory,
  bundle: true,
  splitting: true,
  minify: true,
  format: "esm",
  metafile: true,
  external: ["./design-mode.js"],
});
const outputs = result.metafile.outputs;
const inlineTextEditing = (await readdir("dist"))
  .filter((file) => /^inline-text-editor.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const entry = Object.keys(outputs).find(
  (path) => outputs[path].entryPoint === "dist/index.js"
);
const initial = new Set();
function visit(path) {
  if (initial.has(path)) return;
  initial.add(path);
  for (const item of outputs[path].imports)
    if (!item.external && item.kind !== "dynamic-import") visit(item.path);
}
visit(entry);
async function sizes(paths) {
  const files = await Promise.all(
    [...paths]
      .filter((path) => path.endsWith(".js"))
      .map((path) => readFile(resolve(path)))
  );
  return {
    raw: files.reduce((sum, b) => sum + b.length, 0),
    gzip: files.reduce((sum, b) => sum + gzipSync(b).length, 0),
    brotli: files.reduce((sum, b) => sum + brotliCompressSync(b).length, 0),
  };
}
const [pack] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  })
);
const report = {
  initial: await sizes(initial),
  coreFeatures: await sizes(Object.keys(outputs)),
  optionalDesignMode: await sizes(new Set(["dist/design-mode.js"])),
  optionalInlineTextEditing: await sizes(new Set(inlineTextEditing)),
  package: {
    tarball: pack.size,
    unpacked: pack.unpackedSize,
    files: pack.entryCount,
  },
};
console.log(JSON.stringify(report, null, 2));
await writeFile(
  resolve(directory, "report.json"),
  JSON.stringify(report, null, 2)
);
// Core was 196 KB; links, thread tags, shortcuts, and anchor recovery add ~2 KB.
// React DOM is the largest core cost and the next place to recover budget.
if (report.initial.gzip > 100_000 || report.coreFeatures.gzip > 199_000)
  throw new Error("komo exceeds its core production consumer bundle budget.");
// The inline-text feature adds a small button/state bridge to the optional
// Design mode entry. Its editor remains a separate on-demand chunk below.
// Raised from 7,000 for double-click inline editing (37 bytes); the caret logic stays in the editor chunk.
if (report.optionalDesignMode.gzip > 7_100)
  throw new Error("komo's optional design mode chunk exceeds its gzip budget.");
// Raised from 2,800 so text inside nested markup, links, and buttons can be edited in place.
if (report.optionalInlineTextEditing.gzip > 3_000)
  throw new Error("komo's on-demand inline text editor chunk exceeds its gzip budget.");
