import { build } from "esbuild";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
if (report.initial.gzip > 100_000 || report.coreFeatures.gzip > 196_000)
  throw new Error("komo exceeds its core production consumer bundle budget.");
// The React prop inspector is emitted as a separate lazy module. Its 300-byte
// integration bridge lives in this optional entry; core consumer bytes remain
// unchanged, so retain a small, explicit allowance for that capability.
if (report.optionalDesignMode.gzip > 6_400)
  throw new Error("komo's optional design mode chunk exceeds its gzip budget.");
