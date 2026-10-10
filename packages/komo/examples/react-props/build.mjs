import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifest } from "./metadata.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const manifest = generateManifest(resolve(here, "src/card.tsx"), root);
const output = resolve(here, ".generated");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2));
await build({
  entryPoints: [resolve(here, "src/main.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  outfile: resolve(output, "react-props.js"),
});
console.log(`Generated typed manifest for ${manifest.components.length} component(s): ${output}`);
