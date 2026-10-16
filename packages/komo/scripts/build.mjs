import { build, transform } from "esbuild";
import { minify } from "terser";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const styleModule = await build({
  entryPoints: ["src/styles.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { styles } = await import(
  `data:text/javascript;base64,${Buffer.from(styleModule.outputFiles[0].text).toString("base64")}`
);
const css = (
  await transform(styles, { loader: "css", minify: true, target: "es2022" })
).code;
const designStyleModule = await build({
  entryPoints: ["src/design-mode-styles.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { designModeStyles } = await import(
  `data:text/javascript;base64,${Buffer.from(designStyleModule.outputFiles[0].text).toString("base64")}`
);
const designCss = (
  await transform(designModeStyles, { loader: "css", minify: true, target: "es2022" })
).code;
const panelStyleModule = await build({
  entryPoints: ["src/design-panel-styles.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { designPanelStyles } = await import(
  `data:text/javascript;base64,${Buffer.from(panelStyleModule.outputFiles[0].text).toString("base64")}`
);
const panelCss = (
  await transform(designPanelStyles, { loader: "css", minify: true, target: "es2022" })
).code;
const iconModule = await build({
  entryPoints: ["src/icon-markup.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  metafile: true,
});
const { iconMarkup } = await import(
  `data:text/javascript;base64,${Buffer.from(iconModule.outputFiles[0].text).toString("base64")}`
);
await rm("dist", { recursive: true, force: true });
execFileSync("tsc", ["-p", "tsconfig.json", "--emitDeclarationOnly"], {
  stdio: "inherit",
});
const result = await build({
  entryPoints: [
    "src/index.ts",
    "src/setup.ts",
    "src/agent-prompt.ts",
    "src/react.ts",
    "src/design-mode.ts",
  ],
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  metafile: true,
  legalComments: "linked",
  plugins: [
    {
      name: "static-icon-markup",
      setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/]icon-markup\.ts$/ }, () => ({
          contents: `export const iconMarkup = ${JSON.stringify(iconMarkup)}`,
          loader: "js",
        }));
      },
    },
    {
      name: "compact-shadow-styles",
      setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/]styles\.ts$/ }, () => ({
          contents: `export const styles = ${JSON.stringify(css)}`,
          loader: "js",
        }));
        build.onLoad({ filter: /[\\/]src[\\/]design-mode-styles\.ts$/ }, () => ({
          contents: `export const designModeStyles = ${JSON.stringify(designCss)}`,
          loader: "js",
        }));
        build.onLoad({ filter: /[\\/]src[\\/]design-panel-styles\.ts$/ }, () => ({
          contents: `export const designPanelStyles = ${JSON.stringify(panelCss)}`,
          loader: "js",
        }));
      },
    },
  ],
  external: ["react", "react-dom", "emoji-regex", "./design-mode.js"],
});
// Optional design-system adapters (@hazem3500/komo/adapters/*): self-contained entry
// points built separately, so core's chunks and their names stay exactly as they were.
const adapters = await build({
  entryPoints: ["src/adapters/tailwind.ts", "src/adapters/class-theme.ts", "src/adapters/css-variables.ts", "src/adapters/react-fiber.ts"],
  outdir: "dist/adapters",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  metafile: true,
});
// Compress the emitted modules without changing their split boundaries or exports.
// Preserve framework directives ("use client") and linked license notices.
await Promise.all(
  [...Object.keys(result.metafile.outputs), ...Object.keys(adapters.metafile.outputs)]
    .filter((path) => path.endsWith(".js"))
    .map(async (path) => {
      const { code } = await minify(await readFile(path, "utf8"), {
        module: true,
        compress: { passes: 1, directives: false },
        mangle: true,
        format: { comments: "some" },
      });
      await writeFile(path, code);
    }),
);
const packages = new Set();
const notices = [];
for (const input of Object.keys({
  ...iconModule.metafile.inputs,
  ...result.metafile.inputs,
})) {
  if (!input.includes("node_modules")) continue;
  let dir = dirname(resolve(input));
  while (dir !== dirname(dir)) {
    let files;
    try {
      files = await readdir(dir);
    } catch {
      break;
    }
    if (files.includes("package.json")) {
      if (packages.has(dir)) break;
      packages.add(dir);
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      const licenses = files.filter((file) =>
        /^licen[cs]e(?:\.|$)/i.test(file),
      );
      if (!licenses.length)
        throw new Error(`Missing license for bundled dependency ${pkg.name}`);
      notices.push(
        `${pkg.name}@${pkg.version}\n\n${(await Promise.all(licenses.map((file) => readFile(join(dir, file), "utf8")))).join("\n")}`,
      );
      break;
    }
    dir = dirname(dir);
  }
}
await writeFile("dist/THIRD_PARTY_NOTICES.txt", notices.join("\n\n---\n\n"));
