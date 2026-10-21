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
const geometry = (await readdir("dist"))
  .filter((file) => /^design-geometry.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const liveColors = (await readdir("dist"))
  .filter((file) => /^live-colors.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const fieldControls = (await readdir("dist"))
  .filter((file) => /^field-controls.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const typedEditor = (await readdir("dist"))
  .filter((file) => /^token-custom.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const colorEditor = (await readdir("dist"))
  .filter((file) => /^color-editor.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const tokenPicker = (await readdir("dist"))
  .filter((file) => /^token-picker.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const tokenPage = (await readdir("dist"))
  .filter((file) => /^token-page.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const frameIframe = (await readdir("dist"))
  .filter((file) => /^frame-iframe.*\.js$/.test(file))
  .map((file) => `dist/${file}`);
const accountTokens = (await readdir("dist"))
  .filter((file) => /^account-tokens.*\.js$/.test(file))
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
  optionalTokenPage: await sizes(new Set(tokenPage)),
  optionalGeometry: await sizes(new Set(geometry)),
  optionalAccountTokens: await sizes(new Set(accountTokens)),
  optionalFrameViewport: await sizes(new Set(frameIframe)),
  optionalLiveColors: await sizes(new Set(liveColors)),
  optionalFieldControls: await sizes(new Set(fieldControls)),
  optionalColorEditor: await sizes(new Set(colorEditor)),
  optionalTypedEditor: await sizes(new Set(typedEditor)),
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
// All-features 209,300: design change cards name targets for reviewers, keep long paths, URLs
// and diffs inside the card, and share the source ⓘ popover with Properties (207,582 -> 209,140,
// all in the on-demand design comment chunk; initial +35).
// All-features 213,250: Frame size controls (presets, custom size, handles, Fit / 100%, the
// fitted view and pan clipping) load as their own ~3,100-byte chunk when Frame first opens or a
// size is remembered; Frame's sizing hooks add ~600 to initial. Main was at ~209,140.
// All-features 213,250 -> 219,500: the Account panel's API tokens view (list, create with a
// one-time reveal, inline revoke, its own styles) is a new on-demand chunk (~5,670 measured).
// Initial grows ~530 bytes for the entry row, the view switch and the chunk boundary.
// 219,500 -> 220,150: ringed, breathing dot pins at mount and the Design shortcuts link and help gestures on demand (+612 measured: 219,146 -> 219,758; initial +467).
// 220,150 -> 221,000: Frame opens on the window's own size at Fit and cards are placed beside their
// pin's on-screen box. Initial +382 (the fitted default view and card placement run before any chunk
// loads); the frame-size chunk +630 (Available space, the zoom readout, the "Layout follows your
// browser window" note and its tooltip). Measured locally: main 219,704 -> 220,715.
// 221,100: the pending-token chip and Layout field sync (#139) landed alongside (+~300).
// 221,250: a subscribed adapter refreshes only when its list changed, so the color popup stays open (+~125).
// 221,250 -> 223,200: the redesigned shortcut help (pinned header with a tooltip close button,
// filter, two-column groups, mode-first order, focus trap and its own styles) is all in its
// on-demand chunk (+1,746 measured on 0.9.59: 219,703 -> 221,449; 222,942 on 0.9.65). Its
// styles left the mount bundle, so initial shrinks 85 bytes. Leaves room for geometry keys (#146).
// 223,200 -> 223,500: remembered Frame sizes are versioned and clamped, and only explicit choices
// are stored (+157 in the frame-size chunk).
// 223,500 -> 225,810: pin stacks and collision bubbles (pins.cluster). Grouping, the 24px collision pass
// and the stack/bubble styles run at mount (initial +1,218: 82,457 -> 83,675); drawing stacks and bubbles
// is a ~1,100-byte chunk loaded the first time a page has a group, and the bubble's list reuses the
// comment action menu. Styles stay in the shared sheet: in the chunk they cost ~1,000 more in total.
// Measured locally: main 223,370 -> 225,680 (+2,310); main's 130 bytes of headroom are kept.
// 223,500 -> 227,900: Frame's Viewport mode (frame.mode "iframe"). The iframe, its load checks, fallback
// reasons and the frame geometry are their own chunk (below). Initial grows ~1,650: komo's page reads
// reach the frame through frame-target.ts (cross-realm checks, a listener registry, identity geometry the
// chunk replaces; ~620 in the shared core chunk) and Frame's layout keeps the viewport hooks (~1,000). The
// size bar's Viewport / In place switch and reason note add ~420 to the frame-size chunk (227,768 measured on main with #156 and #158).
// 225,810 -> 230,200: both of the above together (230,073 measured with pin stacks and Viewport mode).
// 230,200 -> 233,000: a 100% Frame pans inside its stage (scrollbars, wheel chaining from the app's
// scrollers, Space+drag, stage keys, focus reveal, Fit-to-100% anchoring) and a one-time tip about scaled
// floating UI, all in the frame-size chunk (~+2,400); initial ~+190 moves the frame and its overlays per
// pan frame. Measured locally on main 53dedcc: 232,848.
// 233,150: Viewport mode at 100% keeps the stage pan out of its port, resets the port on leaving 100% and
// restores the in-place state when switching back (~+40; 233,027 measured on main 418bc33 with the fix).
// 233,150 -> 233,800: Design mode keys. Redo for every edit kind (props, styles, tokens, text,
// resize, move), Before/After on ← → anywhere, Tab/Enter selection and configurable compare/select
// keys, one-press Escape (+599 measured on main 418bc33: 232,968 -> 233,567). Initial +472 for the key resolver and named keycaps;
// resolving the keys on demand instead cost ~500 more in total for the extra chunk boundary.
// 233,150 -> 235,450: posted design proposals and the composer's card preview every kind on the page
// (resizes with what they also set, structural moves through a stand-in, React props through the
// component editor), say why After is off, preview what they can and name the rest, and outline the
// change and a move's origin in the selection colour (+2,194 measured on main 9652312: 232,968 -> 235,162). All in the
// on-demand design comment chunk; initial +94 for the host's blocked reasons and the scrolling card.
// 233,800 -> 236,050: both of the above together (235,806 measured).
if (report.initial.gzip > 102_500 || report.coreFeatures.gzip > 236_050)
  throw new Error("komo exceeds its core production consumer bundle budget.");
// The inline-text feature adds a small button/state bridge to the optional
// Design mode entry. Its editor remains a separate on-demand chunk below.
// Raised from 7,000 for double-click inline editing (37 bytes); the caret logic stays in the editor chunk.
// 7,250: the footer Before/After switch (styles, text, React props, theme), its keys and morph,
// toolbar-style tooltips and header/footer polish (~870 bytes). The panel chunk has no room either.
// 7,300: the hook that lazy-loads default-off experimental geometry (its own chunk) (~10 bytes).
// Passing select and the geometry proposal section to that chunk adds ~10 bytes (7,093 measured).
// 7,350: geometry's structural move needs Design mode's click selection and Before state, and the
// hidden original's display stays out of proposals and Copy CSS (7,234 -> 7,320 measured).
// 7,475: Design mode also listens inside Frame's viewport iframe (pointer, click, keys, scroll) and
// maps its outlines and picks through it (+~124: 7,320 -> 7,445). The entry imports chunks by hashed
// name, so a lazy chunk's new content can also move it a byte.
// 7,700: redraws of the same selection keep focus on the same control (or the selection, never
// Exit), and moves, Undo and applied tokens reach komo's one live region from here, not core
// (+~228: 7,445 -> 7,673). The re-resolving itself lives in the keyboard chunk.
// 7,700 -> 8,150: the Redo button and its stack (each undone entry with how to put it back, cleared by any
// new edit), keyed tooltips, empty-canvas deselect (also on Frame's viewport backdrop) and the selection
// restored on re-entry (7,677 -> 8,109 on main 418bc33).
// 8,150 -> 8,215: the pending changes card's hooks (row hover outline, Discard all held in Before for Undo and Redo); the card itself is in the export chunk (8,103 -> 8,166 on main bc089fe).
if (report.optionalDesignMode.gzip > 8_215)
  throw new Error("komo's optional design mode chunk exceeds its gzip budget.");
// Raised from 2,800 so text inside nested markup, links, and buttons can be edited in place.
// 3,100: Before/After swaps edited text back, keeping nested markup (~80 bytes).
if (report.optionalInlineTextEditing.gzip > 3_100)
  throw new Error("komo's on-demand inline text editor chunk exceeds its gzip budget.");
// Design mode's property controls load as their own chunk when Design mode opens,
// so the Figma-style panel does not grow the Design mode entry (7,007 -> 5,677 gzip).
// New budget: 4,262 measured for scrubbing, inline token chips and section rules.
// The select trigger's chevron moved to the select menu chunk below (4,271 -> ~4,140).
// 4,375: color fields fetch their settled-value sync (live-colors, below) and read a bound token's value (4,246 -> 4,321).
// 4,625: field-label.ts moved into this chunk with the picker (it left a shared chunk the panel already loaded, because the typed Custom editor stopped importing it with the old color form).
// 4,800: letter spacing and opacity fields, per-field scrub steps, no Custom popup for keyword
// fields and the fetch of the field controls chunk below (4,591 -> 4,677), plus ~3%.
// The field Escape that cancels and lets go of focus fits in the 4,800 above.
if (report.optionalDesignPanel.gzip > 4_800)
  throw new Error("komo's design panel chunk exceeds its gzip budget.");
// The Design panel's styled select popups (listbox, keyboard, flip and check marks)
// load as their own chunk beside the panel, so neither the panel nor the entry grows.
// 3,125: token selects (data-picker) are left to the token picker below (+11 bytes).
// 3,250: a letter on a closed select opens the list on its first match (3,085 -> 3,154), plus ~3%.
// 3,300: with the shared host-motion hold for previews (#151) alongside (3,260 measured).
if (report.optionalSelectMenu.gzip > 3_300)
  throw new Error("komo's select menu chunk exceeds its gzip budget.");
// The token picker (search, type previews, sticky groups, lazy rows, keyboard) loads the first
// time a token field opens. 4,631 measured, plus ~3%. It now also hands its rows' previews and
// styles to the Tokens view (4,770 measured).
// 4,975: the popup opens in the top layer, follows its field, refreshes Custom when the field settles and leaves a select open inside it to its own list.
// 5,275: color fields open a 240px popup with live commits, finish or cancel the edit on close,
// and keep a value for hosts without live commits (4,932 -> 5,123), plus ~3%.
// 5,600: one popup replaces the Tokens and Custom tabs: a header, token values in each row, an
// inline Custom value section, a restore when the pointer leaves the list, Home/End and
// type-to-filter (5,222 -> 5,440), plus ~3%.
// 6,375: popups open on their tokens and swap to Custom on demand: a back header, a Custom… row with
// the current value, Show all under the list, an active row's path and value instead of a tooltip,
// and a viewport-capped height with one scroll area (5,458 -> 6,183 measured), plus ~3%.
if (report.optionalTokenPicker.gzip > 6_375)
  throw new Error("komo's token picker chunk exceeds its gzip budget.");
// The Tokens view (every token with nothing selected, per-theme edits, its footer and page
// comment) loads only when "Edit tokens" is chosen. It reuses the picker, theme switcher and
// footer chunks, so its own chunk is small. 4,730 measured, plus ~3%.
// 4,950: rows update in place when the listed tokens keep their order, so an open popup stays open (4,814 -> 4,895).
// 5,150: row details use the footer tooltip, placed beside the panel or above a narrow sheet (+~150).
// It also covers previews and theme reads that go to the reviewed page (Frame's viewport iframe when it shows one)
// and Before/After keys with focus inside it (+~60; 5,085 measured with both).
if (report.optionalTokenPage.gzip > 5_150)
  throw new Error("komo's Tokens view chunk exceeds its gzip budget.");
// Experimental move/resize is default off and loads only with design.experimentalGeometry, after
// Design mode opens; nothing else imports it. It was 3,375 gzip for normal-flow blocks only. Flex and
// grid items (flex-basis/grow/shrink, stretch detection, numeric track spans), positioned and
// aspect-locked boxes, per-element reasons with Select parent, and side-effect proposals measure 6,725.
// 8,400: Figma-style selection (1px outline, eight handles with hit areas and cursors, outward offsets
// for thin padding and tiny boxes), a W × H readout, resize snapping to parent and sibling edges with
// guides, Ctrl/⌘+arrow resize with a live region, and notes moved into the panel. Free-form Move and
// its translate/offset fallback left the chunk (6,725 -> 8,141 measured), plus ~3%.
// 12,500: structural move between elements (src/design-move.ts, bundled into this chunk): body drag
// with a click threshold, nearest-valid drop targets per flow with an insertion line, container
// outline and label chip, inert computed-style stand-ins that follow renderer commits, Alt+arrow
// moves on the focused selection, limits, and the move proposal lines (8,141 -> 12,137), plus ~3%.
// 13,900: design-tool handle polish (7px pixel-snapped squares, outward hit areas, none under 24px),
// a configurable canvas selection color with a magenta fallback on matching backgrounds, handles shown
// only near the pointer or with focus and stepping back for the panel, fields and previews, overlay
// peek/toggle with the visibility key and an eye button, and the first-use move hint (12,191 -> 13,483), plus ~3%.
// 14,200: komo previews hold host motion and a lasting animation shows as a dot by the Layout title (+302: 13,736 -> 14,038 measured).
if (report.optionalGeometry.gzip > 14_200)
  throw new Error("komo's experimental geometry chunk exceeds its gzip budget.");
// API tokens load only when "API tokens" is opened in the Account panel; nothing else imports
// the chunk. 5,671 measured, plus ~3%.
if (report.optionalAccountTokens.gzip > 5_850)
  throw new Error("komo's API tokens chunk exceeds its gzip budget.");
// Viewport mode loads only when Frame opens with frame.mode "iframe": the iframe, its stage, the
// same-origin and fallback checks (X-Frame-Options, frame-ancestors, cross-origin redirects, timeout) and
// the frame geometry komo's page reads switch to. 2,216 measured, plus ~3%.
if (report.optionalFrameViewport.gzip > 2_300)
  throw new Error("komo's Viewport mode chunk exceeds its gzip budget.");
// Color fields re-read the element once hover, focus, theme and transitions settle; fetched with the
// panel as its own chunk. 704 measured, plus ~3%.
// In-row field controls (icon segments for text alignment and border style, weight samples,
// unit suffixes) are fetched with the panel, like the select menu. 1,834 measured, plus ~3%.
// 2,100: the font size row keeps its value beside a bound token's chip and trims its popup to the token list (1,834 -> 2,024), plus ~3%.
// 2,400: every single-value numeric field (line height, letter spacing, gap, border width, and padding, margin and radius with one value) gets that row, with a chip sized to its token's name (2,024 -> 2,351), plus ~2%.
if (report.optionalFieldControls.gzip > 2_400)
  throw new Error("komo's field controls chunk exceeds its gzip budget.");
if (report.optionalLiveColors.gzip > 725)
  throw new Error("komo's live color field chunk exceeds its gzip budget.");
// The Custom color picker (area, sliders, eyedropper, value row with five formats, document and
// recent swatches, token match) loads the first time a color field's Custom tab opens, instead of
// the React color picker it replaces. 6,307 measured, plus ~3%.
if (report.optionalColorEditor.gzip > 6_500)
  throw new Error("komo's color editor chunk exceeds its gzip budget.");
// The typed Custom editors (lengths, spacing, radius, shadows, fonts: compact fields with inline
// units, scrubbing, nudges and live apply) load the first time a non-color Custom tab opens.
// 3,009 with the Apply form. The compact live fields, Figma-style shadow layer rows (Drop/Inner, swatch,
// visibility, remove, a sample tile) and the structured typography editor measure 5,698, plus ~3%.
if (report.optionalTypedEditor.gzip > 5_875)
  throw new Error("komo's typed Custom editor chunk exceeds its gzip budget.");
// Design-system adapters are their own entry points (@hazem3500/komo/adapters/*). Core never
// imports them, so they cost nothing unless an app opts in. Budgets cover the table-driven
// class swapping, spacing helper and theme switching, with a little headroom.
// 2,600: opt-in onlyGenerated (stylesheet scan, escaped class matching, re-scan on sheet
// changes) and the filter hook measure 2,551 (+342 bytes over 2,209); nothing loads it but the adapter.
// 3,075 / 2,650: Tokens view previews (one injected stylesheet scoped per theme option, aliases
// and raw-channel colors) add ~430 and ~750 bytes; measured 2,981 and 2,559, plus ~3%.
// 3,450: onlyGenerated reports stylesheet changes through subscribe() (a MutationObserver
// and <link> load/error listeners, only while komo is subscribed) and skips unreadable
// sheets one by one, with a strict mode (+372 bytes); measured 3,353, plus ~3%.
if (report.adapterTailwind.gzip > 3_450)
  throw new Error("komo's Tailwind token adapter exceeds its gzip budget.");
if (report.adapterCssVariables.gzip > 2_650)
  throw new Error("komo's CSS variable token adapter exceeds its gzip budget.");
// The React fiber adapter reads private React fields, serializes props safely and builds the
// read-only panel rows itself, so none of that lives in core.
if (report.adapterReactFiber.gzip > 2_800)
  throw new Error("komo's React fiber component adapter exceeds its gzip budget.");
if (report.adapterReactPreview.gzip > 2_000)
  throw new Error("komo's opt-in React preview bridge exceeds its gzip budget.");
if (report.adapterClassTheme.gzip > 1_000)
  throw new Error("komo's class theme adapter exceeds its gzip budget.");
