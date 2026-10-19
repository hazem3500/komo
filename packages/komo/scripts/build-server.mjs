import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rename } from "node:fs/promises";

await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".txt": "text" },
  outfile: "dist/server.js",
});
execFileSync("tsc", ["-p", "server/tsconfig.build.json"], { stdio: "inherit" });
await rename("dist/public.d.ts", "dist/server.d.ts");
