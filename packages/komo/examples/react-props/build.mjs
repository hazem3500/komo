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
// Development builds (jsx-dev, NODE_ENV=development) so React keeps its debug fields, with a
// source map for the demo's source resolver. The React 18 build aliases the React 18
// install from the komo-react18-fixture workspace package; both share the same source.
const fixture = resolve(here, "../../../komo-react18-fixture/node_modules");
for (const [name, alias] of [
  ["react-props.js", {}],
  ["react-props-18.js", { react: resolve(fixture, "react"), "react-dom": resolve(fixture, "react-dom") }],
]) {
  await build({
    entryPoints: [resolve(here, "src/main.tsx")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    jsxDev: true,
    define: { "process.env.NODE_ENV": '"development"' },
    alias,
    sourcemap: "external",
    outfile: resolve(output, name),
  });
}
console.log(`Generated typed manifest for ${manifest.components.length} component(s): ${output}`);
