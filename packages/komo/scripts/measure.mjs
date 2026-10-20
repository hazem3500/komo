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
const designPanel = (await readdir("dist"))
  .filter((file) => /^design-panel.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const selectMenu = (await readdir("dist"))
  .filter((file) => /^select-menu.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const tokenPicker = (await readdir("dist"))
  .filter((file) => /^token-picker.*\.js$/.test(file))
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
// npm 10 prints an array of results; npm 11 prints an object keyed by package name.
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  })
);
const pack = Array.isArray(packed) ? packed[0] : (Object.values(packed)[0] ?? packed);
const report = {
  initial: await sizes(initial),
  coreFeatures: await sizes(Object.keys(outputs)),
  optionalDesignMode: await sizes(new Set(["dist/design-mode.js"])),
  optionalInlineTextEditing: await sizes(new Set(inlineTextEditing)),
  optionalDesignPanel: await sizes(new Set(designPanel)),
  optionalSelectMenu: await sizes(new Set(selectMenu)),
  optionalTokenPicker: await sizes(new Set(tokenPicker)),
  adapterTailwind: await sizes(new Set(["dist/adapters/tailwind.js"])),
  adapterCssVariables: await sizes(new Set(["dist/adapters/css-variables.js"])),
  adapterReactFiber: await sizes(new Set(["dist/adapters/react-fiber.js"])),
  adapterReactPreview: await sizes(new Set(["dist/adapters/react-preview.js"])),
  adapterClassTheme: await sizes(new Set(["dist/adapters/class-theme.js"])),
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
// Raised from 100,000 and 199,000 for group tags: the comment box hooks cost ~220 bytes up front;
// the tag picker itself loads on demand but still counts toward all-features.
// Raised again to 101,000 / 202,000 for the sidebar tag filter and its Tag icon (~530 bytes).
// All-features raised to 206,500 for the on-demand design comment cards, their Before/After morph and B shortcut.
// Initial raised to 101,400 for host event isolation (~340 bytes): it has to run
// at mount, before any host modal opens, so it cannot load on demand.
// 101,600: the new-comment box shows Design mode proposals as a change card (~130 bytes).
// All-features 206,800: pin hover cards resolve in place and show a compact change card (~290 bytes,
// mostly in the on-demand design comment chunk; initial stays within 101,600). Main was already at 206,503.
// 101,800 / 207,000: #33 and #34 each fit alone; together they add ~30 bytes past the old limits.
// 102,100 / 208,200: Before/After in pin hover cards and the floating tag menu.
// The initial bundle is due a trimming pass before more features land in it.
// 102,250 / 208,250: Design mode frames the page while active, the floating panel avoids
// and drags, and comment dialogs stay in the visible area (~270 bytes; the rest is on demand).
// 102,450 / 208,450: comments open beside the region they discuss, and Design mode
// comments collapse the sidebar (~200 bytes in positionDialog, which runs at mount).
// +50 for the Floating/Frame switch in the toolbar menu.
// Trimming pass: Motion (~21.9 KB gzip) left the mount bundle. Core reaches it through
// src/lazy-motion.ts, which prefetches it on idle and holds an element on its first
// keyframe until it arrives; the toolbar menu shares the chunk. Initial 101,872 -> 80,342.
// All-features 206,935 -> 207,360 (+425 for the extra chunk boundaries and the wrapper).
// Budgets are unchanged so the pending toolbar and layout work has room; import animate
// from ./lazy-motion.js, not "motion", or Motion returns to the mount bundle.
if (report.initial.gzip > 102_500 || report.coreFeatures.gzip > 208_500)
  throw new Error("komo exceeds its core production consumer bundle budget.");
// The inline-text feature adds a small button/state bridge to the optional
// Design mode entry. Its editor remains a separate on-demand chunk below.
// Raised from 7,000 for double-click inline editing (37 bytes); the caret logic stays in the editor chunk.
// 7,250: the footer Before/After switch (styles, text, React props, theme), its keys and morph,
// toolbar-style tooltips and header/footer polish (~870 bytes). The panel chunk has no room either.
// 7,300: the hook that lazy-loads default-off experimental geometry (its own chunk) (~10 bytes).
if (report.optionalDesignMode.gzip > 7_300)
  throw new Error("komo's optional design mode chunk exceeds its gzip budget.");
// Raised from 2,800 so text inside nested markup, links, and buttons can be edited in place.
// 3,100: Before/After swaps edited text back, keeping nested markup (~80 bytes).
if (report.optionalInlineTextEditing.gzip > 3_100)
  throw new Error("komo's on-demand inline text editor chunk exceeds its gzip budget.");
// Design mode's property controls load as their own chunk when Design mode opens,
// so the Figma-style panel does not grow the Design mode entry (7,007 -> 5,677 gzip).
// New budget: 4,262 measured for scrubbing, inline token chips and section rules.
// The select trigger's chevron moved to the select menu chunk below (4,271 -> ~4,140).
if (report.optionalDesignPanel.gzip > 4_300)
  throw new Error("komo's design panel chunk exceeds its gzip budget.");
// The Design panel's styled select popups (listbox, keyboard, flip and check marks)
// load as their own chunk beside the panel, so neither the panel nor the entry grows.
// 3,125: token selects (data-picker) are left to the token picker below (+11 bytes).
if (report.optionalSelectMenu.gzip > 3_125)
  throw new Error("komo's select menu chunk exceeds its gzip budget.");
// The token picker (search, type previews, sticky groups, lazy rows, keyboard) loads the first
// time a token field opens. 4,631 measured, plus ~3%.
if (report.optionalTokenPicker.gzip > 4_775)
  throw new Error("komo's token picker chunk exceeds its gzip budget.");
// Design-system adapters are their own entry points (@hazem3500/komo/adapters/*). Core never
// imports them, so they cost nothing unless an app opts in. Budgets cover the table-driven
// class swapping, spacing helper and theme switching, with a little headroom.
if (report.adapterTailwind.gzip > 2_500)
  throw new Error("komo's Tailwind token adapter exceeds its gzip budget.");
if (report.adapterCssVariables.gzip > 2_000)
  throw new Error("komo's CSS variable token adapter exceeds its gzip budget.");
// The React fiber adapter reads private React fields, serializes props safely and builds the
// read-only panel rows itself, so none of that lives in core.
if (report.adapterReactFiber.gzip > 2_800)
  throw new Error("komo's React fiber component adapter exceeds its gzip budget.");
if (report.adapterReactPreview.gzip > 2_000)
  throw new Error("komo's opt-in React preview bridge exceeds its gzip budget.");
if (report.adapterClassTheme.gzip > 1_000)
  throw new Error("komo's class theme adapter exceeds its gzip budget.");
