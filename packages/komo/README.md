# Palette

[![npm version](https://img.shields.io/npm/v/@hazem3500/palette)](https://www.npmjs.com/package/@hazem3500/palette)
[![downloads](https://img.shields.io/npm/dm/@hazem3500/palette)](https://www.npmjs.com/package/@hazem3500/palette)

> Palette is a maintained fork of [tjcages/komo](https://github.com/tjcages/komo). It is published as `@hazem3500/palette`. Install it with `npm install @hazem3500/palette`.

Comments for your website. Point at an element, mark an area, and leave feedback your team can reply to, resolve, or copy into a coding agent.

Framework independent. Shared persistence. Google identities and guest reviewers.

[Documentation](https://github.com/hazem3500/palette#readme)

Review actions update immediately while saving in the background. Failed writes roll back with a notice; unsaved comment text is retained.

## Install

```sh
npm install @hazem3500/palette
```

Requires Node.js 22 or newer. The unscoped `komo` package on npm is unrelated; use `@hazem3500/palette`.

Palette has no hosted default. Comments go to a Palette server that you run, and every install sets `endpoint` to it. Start a server first:

- **Node and PostgreSQL**, including Cloud Run: run `npx @hazem3500/palette init --node` and follow the [Node self-hosting guide](./NODE.md).
- **Cloudflare Worker and D1**: run `npx @hazem3500/palette init --self-host`; see [Self-host](#self-host).

Both print the `endpoint` and project key for your site. If your team already runs a Palette server with hosted setup turned on (`PALETTE_HOSTED=true`), connect to it with `npx @hazem3500/palette init --endpoint https://palette.example.com`; see [Hosted setup](#hosted-setup).

## Usage

Mount after the page has loaded:

```js
import { initPalette } from '@hazem3500/palette';
initPalette({
  endpoint: 'https://palette.example.com',
  project: 'YOUR_PROJECT_KEY',
});
```

Optional configuration stays at the call site:

```js
initPalette({
  endpoint: 'https://palette.example.com',
  project: 'YOUR_PROJECT_KEY',
  enabled: import.meta.env.DEV || import.meta.env.PUBLIC_PREVIEW === 'true',
  pageRoot: document.querySelector('#app'),
});
```

### React

With React 18.2 or 19, call the hook once near your app root:

```tsx
'use client'; // Required for Next.js App Router client components.
import { usePalette } from '@hazem3500/palette/react';

export function Palette() {
  usePalette({
    endpoint: 'https://palette.example.com',
    project: 'YOUR_PROJECT_KEY',
  });
  return null;
}
```

Render `<Palette />` in your app or layout. The hook handles mounting, cleanup, and React Strict Mode. Inline configuration objects are supported; unchanged values do not restart Palette. Changing configuration remounts it, and `enabled: false` removes it. Memoize callback options with `useCallback` and pass stable DOM elements for `pageRoot` or `drawerContainer`. Mount only one hook per page; do not combine it with a separate `initPalette()` call. Server rendering does not mount the tool.

The **endpoint is the comments API**, your Palette server, not your website or preview URL. It is required: without it, Palette logs an error and does not mount. Google sign-in returns to `ENDPOINT/auth/google/callback`, regardless of the website embedding Palette. Your current page comes from the browser. Setup detects repository metadata from Git; include its printed `repo` value to enrich agent prompts.

Comments are shared across deployments by default. Use `pnpm exec palette init --branch-scope` to separate them by branch. For automatic branch detection, import from the optional generated `palette.config.js` helper and run `palette sync` before builds. It detects the current branch from deployment environment variables or Git; set `PALETTE_BRANCH` if neither is available. It fails rather than silently grouping unknown branches.

## Migrating from komo

Palette was called komo. Existing installs keep working without changes.

- **API names.** `initPalette`, `definePalette`, `usePalette`, `usePaletteInspectable`, `usePaletteDesignTokens` and the `Palette*` types are the main names. `initKomo`, `defineKomo`, `useKomo`, `useKomoInspectable`, `useKomoDesignTokens` and the `Komo*` types still work and are marked deprecated.
- **CLI.** The command is `palette`. `komo` still works as an alias.
- **Package.** The package is now `@hazem3500/palette`. Replace `@hazem3500/komo` in your dependencies and imports (including subpaths such as `/react` and `/vite`); `@hazem3500/komo` is deprecated and gets no new releases.
- **Stored and wire names.** The Palette names are the main ones, and the komo names are still read, so sessions, settings, tokens, deployments, comments and host integrations keep working:
  - **Browser storage.** Keys start with `palette:`. When Palette mounts, each of its keys from before the rename (`branch-comments:*`, `komo:*`) is copied to its `palette:` name if that is unset, and the old key stays, so an older copy of the app on the same origin keeps working. The new key wins when both exist. Clearing a value (signing out, closing the sidebar) clears both. Other keys on the origin are left alone.
  - **Environment variables.** Set `PALETTE_*` (`PALETTE_TOKEN`, `PALETTE_ALLOW_GUESTS`, `PALETTE_TRUSTED_PROXY_HOPS` and the rest). Each `KOMO_*` name still works when its `PALETTE_*` name is unset or empty, on the server, the Node image and the CLI.
  - **Access tokens.** New tokens start with `palette_pat_`. Tokens starting with `komo_pat_` keep authenticating everywhere until they expire or are revoked. The token list shows each one as `…_pat_<id>…<last4>`.
  - **Project files.** New projects use `.palette/` and `palette.config.js`. A project set up before the rename keeps `.komo/` and `komo.config.js`, so its imports and ignored files stay valid. The CLI also reads credentials saved under `~/.config/komo`; new ones go to `~/.config/palette`, and `palette logout` revokes and removes the sessions saved in both. `palette init` rewrites the AGENTS.md workflow block's `komo:workflow` markers to `palette:workflow`.
  - **Page attributes and CSS.** Use `data-palette-no-snapshot`, `data-palette-inspectable`, `data-palette-design-tokens` and `--palette-selection`. Their `data-komo-*` and `--komo-selection` forms are still read. `usePaletteInspectable` returns both `data-palette-inspectable` and `data-komo-inspectable`. Frame's viewport link uses `?palette-shell=`; `?komo-shell=` still opens it. The viewport iframe keeps the name `komo-viewport` and carries both `data-palette-viewport` and `data-komo-viewport`, so an older framed copy still knows it is framed.
  - **Webhooks.** Each request carries `X-Palette-Event`, `X-Palette-Delivery` and `X-Palette-Signature`, and the same values as `X-Komo-*`.
  - **Comments.** Design edits are marked `palette: "design-edit"` (fence `palette-design-edit`), and snapshot notes say `palette:`. Comments written before the rename, with `komo` markers, still parse.
  - **Unchanged.** Database tables, project keys (`komo_…`), the reserved `_komo` management project and exported feedback (`komo-export`) keep their names.

## Features

- Point and area comments anchored to page elements.
- On-demand design mode for temporary typography, color, spacing, border, and layout previews; copy the resulting CSS or attach a comment to the selected element.
- Replies, reactions, author-only editing, resolution, and undo.
- Group tags: add them while writing a comment or on an open thread, with suggestions from tags already in the project.
- Safe HTTP(S) links and simple Markdown links in comment messages.
- Searchable sidebar, draggable dock, and Google or guest profiles.

- Dismiss the toolbar for the current tab with ×; restore it with Shift+K or `controller.open()`. Set `showToolbar: false` to start hidden.
- **More → Hide comments** (H) clears pins, comment cards and the open sidebar or Frame from the page while review stays on. Unsent comments and replies, the open thread and the list's filters and scroll come back with **Show comments**. Comments return only when the reviewer asks: Show comments, or starting a comment, opening the list or a thread. The choice lasts for the current tab (session storage).
- **More → Pin size** switches pins between Full, Compact (a small initial), Dot (the author's accent at full strength, with a brief breathing halo, until you open its latest comment in this browser; quieter after that) and Auto (dots while browsing, full while commenting or with the sidebar open). Small pins keep a 24px target and expand in place on hover, focus, a nearby pointer or selection. The choice is remembered per project and wins over `pins.size`.
- **Crowded pins** consolidate. Comments on the same target (its persistent owner, including a custom `anchorTarget`) draw as one tight avatar stack at the oldest comment's anchor; more than three collapse to the first author and a count. Hover, keyboard focus or a tap fans the stack out in creation order, and each pin opens its own thread. Pins on different targets whose 24px targets overlap at the current zoom or Frame scale merge into a count bubble; it opens a keyboard-navigable list of those comments. Grouping never changes anchors or saves anything, the open comment's pin is always drawn at its own anchor, and a pin moved with **Move pin** stays out of stacks and bubbles. Set `pins.cluster: false` to draw every pin on its own.
- Keyboard shortcuts: C to comment, V to browse, D to toggle Design mode, L to view all comments, H to hide or show comments, Shift+K to restore. Remap or disable them with `shortcuts`; see [Choosing shortcuts](#choosing-shortcuts). In Design mode, ? or **Keyboard shortcuts** in the empty inspector lists every canvas key and gesture.
- Copy open feedback with selectors, source paths, page URLs, replies, and geometry into an agent.
- Your own Worker/D1 or Node/PostgreSQL service.

Comment pins stay anchored during ordinary pointer drags. Authors and verified reviewers can choose **Comment actions → Move pin** to reposition one explicitly: drag it, or use arrow keys (Shift for larger steps), then Enter or **Save position**. Escape or **Cancel move** restores its previous position without saving. Completed moves use the existing thread anchor endpoint and remain attached after reload; the page element itself never moves. Dragging a floating comment card is independent of pin placement.

Design mode edits the rendered page only. Preview styles and inline text edits are temporary and reset when the page refreshes; styles are restored when the Palette widget is destroyed. Use **Copy CSS** to apply a rule in your site stylesheet; Palette does not write source files. Double-click text, or use **Edit text**, to edit it inline. Edits accept plain text only and change text in place: nested markup, links, and buttons keep their structure. Text marked `data-private` or `data-sensitive`, form fields, and text inside graphics, media, or frames stay read-only. An explicitly registered React `textProp` routes edits through the app's state callback. The inspector can select an iframe as one element but cannot edit its isolated contents. Elements inside open or closed shadow roots are not traversed; select the component host instead.

The design inspector loads as a separate optional browser chunk when Design mode is first opened, so the default widget load does not pay its bundle cost. The package size check measures this chunk separately from the core bundle.

The inspector takes direct UX/UI inspiration from [DialKit](https://www.dialkit.dev/): a compact dark floating panel, collapsible Color/Typography/Layout/Border groups, horizontal live sliders with editable numeric values, and color swatches paired with CSS color inputs. Group collapse state survives selection and Undo/Reset. Each slider gesture is one undoable edit; numeric fields remain available for precise keyboard entry. No DialKit runtime dependency is added.

Design mode also takes interaction cues from established design tools: select a visible element, keep its controls contextual, and make each change easy to reverse. Figma places editable layer properties and file-local styles or variables beside the selected layer; its Dev Mode provides inspection and measurements. pen.dev pairs an IDE design-mode toggle with a canvas, layer list, contextual property panel, and undo/redo. OpenPencil synchronizes layer-tree and canvas selection and offers contextual typography/layout controls, variables, and undoable operations.

### Opt-in React prop inspection

React teams can register selected component roots for typed prop previews through the `./react` entry. A build-time TypeScript Compiler API pass generates the prop manifest from an explicitly marked function component and props type; the inspector edits only strings, numbers, booleans, and literal unions. Functions, refs, `ReactNode`, objects, generics and unsupported types are omitted from editable controls. This metadata is a safe allowlist, not runtime discovery of every React component; `defaultProps` and every React component form are not inferred. A literal-union prop previews each option as you hover it or move to it with the arrow keys, through the component's own `onChange`; click or Enter commits one Undo step, and moving off the list, Escape or clicking elsewhere puts the opening value back. While Palette drives a preview (an option, a token under the pointer, Before/After), the element's own CSS transitions are held, so each step renders at once and the panel reads final values; the element's attributes and `style` are left exactly as they were.

The app provides an `onChange` callback that updates its own state. Palette previews those values through React's normal render cycle, offers undo/reset, and can prefill an explicit comment with the proposed before/after values and source path. Posting still requires the user to submit the comment. Palette's core never accesses React Fiber internals and never writes source files; the one exception is the separate, opt-in [React fiber adapter](#discovering-react-components), which reads React internals only for apps that install it. Preview prop changes reset on refresh. A component may opt one leaf render into direct text editing by setting `textProp` to the name of an allowed string prop; Palette does not infer which child text belongs to a prop. See [`examples/react-props`](./examples/react-props/README.md) for the generated fixture and limitations.

### Opt-in design tokens

`usePaletteDesignTokens` can register a bounded list of named CSS custom properties from a host-owned source. Each entry supplies its token path, DTCG scalar type, CSS variable, eligible element properties, and an explicit selector for the estimated theme-preview scope. Palette does not scan arbitrary computed styles or infer a complete semantic system. The first adapter uses the Design Tokens Format Module 2025.10 naming/type vocabulary; it is not a general DTCG file importer, and composite typography tokens are not editable.

Compatible registered tokens appear inside each existing style control, next to the color, spacing, typography, or radius value they affect. The chooser filters by that control's CSS property; it never guesses a token by name, matches computed values, or snaps arbitrary values to a scale. A control reads **Connected** only when the element's winning declaration (inline, or a same-origin stylesheet rule ranked by `!important`, specificity, and order) references the registered `var(--token)`. Typing a value, or choosing **Custom value**, records a custom override that keeps the original token as provenance; choosing another token rebinds the preview, and choosing the original token again removes the override. The comment proposal lists each change once, with its token before and after. Undo and Reset restore the original declaration and token provenance. Cross-origin stylesheets are skipped (their properties read as not connected), and cascade layers are ranked as if unlayered. For registered React components, a build-generated string prop can opt into one allowlisted `styleProperty` mapping (for example `brandColor` → `color`); the token reference then goes through the component's supplied React state callback and stays in the proposed prop diff. Unsupported prop types remain read-only.

Shared theme edits remain secondary under **Edit shared theme values**. Their explicit Preview action changes the registered variable temporarily and reports the author-declared impact selector/count. This is not a persisted design-system edit; it resets on refresh, widget destruction, or Reset. Selectors are estimates, not proof that every matching element consumes the variable. Both element and shared changes remain previews until the user explicitly submits a comment; Palette does not write CSS or React source. Enable registration only in a trusted development/demo environment, and exclude confidential values from the token list.

This approach uses React Developer Tools as a reference for component props but avoids depending on its browser DevTools UI. TypeScript's compiler can generate type metadata before type erasure, while a host callback keeps live previews within the app's public state model. React 18 and 19 are both exercised (see the fixture); the registration hook uses public hooks and DOM refs and does not inspect version-specific React internals. Only the opt-in React fiber adapter does.

Puck is a useful reference for the **explicit component contract**: its config registers renderable components and declares typed editor fields, defaults, nested object/array fields, and global/component/per-instance edit permissions. Palette borrows the opt-in registration, typed allowlist, contextual controls, and fail-closed edit permissions. It does not reuse Puck's editor/runtime: Puck owns a structured page document and supports component insertion, nesting, drag-and-drop, and publishing, while Palette edits a temporary preview of the host app's existing React state and turns proposed values into a comment. A Puck dependency would add a full page-builder interaction/data model and runtime cost where Palette needs a small optional inspector; Puck's MIT license permits reuse, but licensing is not the deciding constraint. For the first version, nested object/array, slot, custom, and dynamic fields remain read-only until the adapter can represent and validate them safely without implying broader source persistence.

Palette adapts those patterns to an embedded live page: direct hover/select, a compact inspector, immediate CSS preview, grouped undo/reset, and CSS export. It does not add a persistent design document, a shared theme editor, or a source-code writer. Named tokens can be previewed only when the host explicitly registers their CSS-variable source; this does not imply that browser preview edits changed application source.

Sources: [Figma layer properties and styles](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar), [Figma Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode), [pen.dev installation and IDE design mode](https://docs.pen.dev/getting-started/installation), [pen.dev interface and undo/redo](https://docs.pen.dev/core-concepts/pencil-interface), [OpenPencil features and properties panel](https://openpencil.dev/overview/features), [OpenPencil layers and selection sync](https://openpencil.dev/user-guide/layers-and-pages), [Puck component configuration](https://puckeditor.com/docs/integrating-puck/component-configuration), [Puck nested object and array fields](https://puckeditor.com/docs/api-reference/fields/object), [Puck permissions](https://puckeditor.com/docs/api-reference/permissions), [Puck source and MIT license](https://github.com/puckeditor/puck), and the [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/).

### Design-system adapters

`design: { tokens, themes, components }` tells Design mode about your design system. These are types in `DesignSystem`, and all three are optional. Palette never guesses tokens from computed styles, and its core never reads framework internals; your adapters answer. The single exception is the opt-in [React fiber adapter](#discovering-react-components): it is off unless you install it, and it is the only Palette code that touches React's private fields.

- `tokens: TokenAdapter` lists tokens (aliases resolved, per theme). For a picked element, it says which token each CSS property uses, or that the value is off-token. It can also preview a token, for example by swapping a utility class, and describe how to apply the change in source.
- `themes: ThemeAxis[]` are independent axes reviewers can flip from the Design panel, such as light/dark or a product palette. Proposals record the theme state they were made in.
- `components: ComponentAdapter` identifies the component behind an element (name, props, source). Proposals name it with its props. A component registered with `usePaletteInspectable` always takes precedence and keeps its editable props. An adapter may also supply `panel(identity)` to show read-only details in the Design panel.

Each Design mode comment starts with its context, for example `Theme: mode=dark`, `Component: Button (src/ui/Button.tsx:12)` and `Props: variant="secondary"`. Its changes follow: token swaps, shared token values, prop changes, text, and raw CSS as a fallback. The CLI reads the comment back as a versioned `DesignEdit` record (`theme`, `target.component`, `changes`) that agents can apply; comments without context lines still parse. Token values edited from the [Tokens view](#editing-tokens-without-picking-an-element) become `{ kind: "token-value", path, theme?, from, to }` changes on target `:root`; `theme` is optional, so earlier version 1 records stay valid. See [Agent CLI](#agent-cli).

#### Themes

The Design panel and Tokens view headers show one theme control. A single axis with exactly two options is a one-click switch: a sun or moon when the options are light and dark (by id or label), otherwise both labels as two segments; its tooltip names the next state. More options or more axes open a compact menu with a row per axis: a segmented control for two or three options, a select for more. With no axis to choose from, there is no control; Palette never adds a System option. Switching calls `apply(id)`, then the panel re-reads `current()`, lists tokens for the new theme state, and refreshes the picked element's values, chips and outline. Closing Design mode restores each axis's original option.

```ts
import { classTheme } from "@hazem3500/palette/adapters/class-theme";

const mode = classTheme({ id: "mode", options: [{ id: "light" }, { id: "dark", class: "dark" }], colorScheme: true });
initPalette({ project: "your-project", design: { themes: [mode] } });
```

Theme is context, not an edit. Switching isn't counted as a change, and Undo, Reset and Before/After leave it alone. When Design mode closes, or the widget is destroyed, Palette applies each axis's original option again. An axis whose `current()` throws is left out; an `apply()` that throws doesn't break the panel. Any object with `id`, `options`, `current()` and `apply()` works, so a theme kept in React state or a cookie fits too.

#### Token adapters

Without `design.tokens`, Design mode uses the built-in `cssVariableTokens()` adapter (id `"css-variables"`, from `@hazem3500/palette/react`) over the CSS custom properties registered with `usePaletteDesignTokens`. Passing `design.tokens` replaces it on every style field: the chips, the suggestions and the off-token markers all come from your adapter, so an element never shows two answers. The **Shared theme** section for registered CSS variables stays available, since it edits variable values rather than an element. To keep CSS-variable chips too, fall back to `cssVariableTokens()` inside your own `resolve()`.

In Design mode, each style field of the picked element:

- shows the token `resolve(element)` reports for that property as a chip;
- opens a token picker listing the `list()` tokens whose `properties` include it, with **Show all** for every token. Rows sit under sticky `group` headings and show a preview for the token's `type` (a color swatch, a bar or corner for dimensions, a shadow card, "Ag" in the font), its `label` (or the last path segment), `ref` and value, `states` as chips and `description` as a second line. The current token is pinned first. Search matches label, path, ref and value; arrow keys and Enter choose, Escape closes. With a theme axis of two or three options, color swatches split by option, using `list(theme)` for each, so the page never switches to read them;
- marks an `{ offToken }` value with a small dot, "Not from a token · 13px", naming a token with exactly that value. Colors compare across hex, `rgb()` and `rgba()` spellings. When a token suggested for the property matches, a "Matches Primary · Use token" line offers it; the field stays unbound until you choose it;
- previews a chosen token with `preview()`, or by setting its value inline when there is no `preview()`. Undo, Reset and Before/After use the undo it returns. States such as hover are listed, not previewed.

`list()` and `resolve()` may return promises; the panel renders first and the token controls join when they resolve. `list()` is called once per theme state. If your token set can change at runtime, add `subscribe(onChange): () => void`: Palette subscribes once Design mode shows your tokens (the panel and an unsaved proposal may each hold a subscription), unsubscribes when the widget is destroyed, and on each `onChange()` drops its cached lists, calls `list()` again and refreshes chips, proposals and any open picker, keeping its search, scroll, active row and preview. A comment on a token swap records `Element color: #6b6b6b [color.text.secondary] → #1f1f1f [color.text.primary]`, followed by your `describe()` text on an `Apply:` line.

Returning `{ path: "tone.base" }` declares a semantic binding, including when the host renders that token as a concrete inline value. Its Before/Undo baseline follows the current theme's resolved token value; existing classes, CSS-variable references, declaration priorities and unrelated styles are preserved. Return `{ offToken: value }` for a genuine custom literal, even if it happens to equal a token. Supply current resolved values through `list(theme)` and notify subscribers after applying a theme change.

Writing an adapter for utility classes:

```ts
import type { DesignToken, TokenAdapter, TokenUsage } from "@hazem3500/palette";

const tokens: DesignToken[] = [
  { path: "color.text.primary", type: "color", value: "#1f1f1f", properties: ["color"], group: "Text", ref: "text-primary" },
  { path: "color.text.secondary", type: "color", value: "#6b6b6b", properties: ["color"], group: "Text", ref: "text-secondary" },
];
const textClass = (element: Element) => tokens.find((token) => element.classList.contains(token.ref!));

const classTokens: TokenAdapter = {
  id: "classes",
  list: () => tokens,
  resolve(element): Record<string, TokenUsage> {
    const token = textClass(element);
    return { color: token ? { path: token.path } : { offToken: getComputedStyle(element).color } };
  },
  preview(element, _property, token) {
    const previous = textClass(element)?.ref;
    if (previous) element.classList.remove(previous);
    element.classList.add(token.ref!);
    return () => {
      element.classList.remove(token.ref!);
      if (previous) element.classList.add(previous);
    };
  },
  describe: (element, _property, _from, to) => `Replace class "${textClass(element)?.ref}" with "${to.ref}"`,
};

initPalette({ project: "your-project", design: { tokens: classTokens } });
```

Keep `resolve()` cheap and honest: report only properties you can vouch for. Define the adapter once, outside render, so `usePalette` sees the same object. The React props demo shows this adapter with `?tokens=classes`.

#### Editing tokens without picking an element

With nothing selected, the Design panel offers **Edit tokens**. The Tokens view lists every `list()` token in the same rows, sticky groups and search as the picker. A row opens the field popup in **Custom** for the token's raw value; a token with `alias` (the path it references) can instead be repointed from **Tokens**. With theme axes, an edit belongs to the current option, so the switcher at the top chooses which option you edit and the preview follows it. Edited tokens show a dot and a reset. The footer has the change count, Before/After (← → or B, flipping the whole preview), chronological Undo, Reset all and **Comment**, which posts one comment on the page:

```text
Proposed token changes (preview only)
Token: color.text.primary (dark) #e6e6e6 → #f5f5f5
Token: color.accent {color.blue.500} → {color.violet.500}
Token adapter: css-variables
```

Token edits stay pending exactly like element previews. Escape or closing Design mode shows Before while it is closed, and reopening previews the edits again, never silently: with an element selected, the footer count includes them and a **Token changes · N** chip opens the Tokens view. Undo steps through token and element edits in the order they were made, Before/After flips both, the element's **Comment** adds the token section to its comment and then clears both.

With nothing selected, a card lists what is pending: "N unsaved changes", then one row per changed element and one for token changes, each with its kind and count. Hovering a row outlines its element; clicking it selects the element. **Comment with changes** opens the composer with every change, the copy button copies them, and **Discard all** clears them without a confirm: ⌘Z (Ctrl+Z) brings them back and ⌘⇧Z discards them again, until something else is selected.

The comment's **Token changes** card has the same Before/After switch as an element's card when the adapter implements `previewValues`: Before runs the preview's cleanup, and After previews the edits again. Rows name each token by its label, or else the last part of its path. Palette's tooltip shows the full path and theme.

The theme in parentheses is the theme key: the current option of each switchable axis, joined with `+` (`docs+dark`). A repointed alias records token references in braces. Live preview is opt-in:

- `previewValues(changes, theme, target)` receives every current edit, `{ path, value, theme?, alias? }`, on each edit and theme switch, after Palette runs the previous cleanup. Return a cleanup that restores the page exactly; Palette also runs it for Before, cancel, Reset, closing Design mode and destroy. `theme` is the current key, so an adapter that cannot scope a value to its theme can preview only the edits for it. `target` is `{ document, root }` for the reviewed page; in Frame's simulated viewport it is the frame's document, so write injected styles there.
- Without `previewValues`, edits are still recorded and commented, and the view says "No live preview".
- A token may name its `cssVariable` and a `toCss(value)` transform. A variable holding raw channels such as `19 18 19`, used as `rgb(var(--color-surface))`, shows and edits as `#131213` while the variable receives `19 18 19`.

`discoverCssTokens({ scopes: { dark: ".dark" } })` and `tailwindTokens(table, { scopes })` implement `previewValues` with one injected stylesheet: an edit without a theme sets the variable on `:root`, an option's edit uses its scope selector, and an option without one uses `:root` outside the other scopes. Removing the stylesheet restores the page. `discoverCssTokens` reports `alias` for a variable declared as exactly `var(--other)` (in `:root`, or in the current option's scope), and lists `--color-*` channel triplets as hex with `toCss`. Tailwind tables preview only tokens that set `cssVariable` (and `toCss` when needed). `cssVariableTokens()` previews registered tokens on their root's inline style, for the current theme only.

#### Discovering CSS variables

`discoverCssTokens()` from `@hazem3500/palette/adapters/css-variables` is the no-table option for sites whose tokens are CSS custom properties, including the variables Tailwind v4 emits for `@theme`. It is opt-in, reads `--*` declarations on `:root`/`html` from same-origin stylesheets (cross-origin sheets are skipped), and is meant for development builds.

```ts
import { discoverCssTokens } from "@hazem3500/palette/adapters/css-variables";

initPalette({ project, design: { tokens: discoverCssTokens() } });
```

- Tailwind namespaces set the type and the properties a token may style: `--color-*`, `--spacing`/`--spacing-*`, `--radius-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`. Other variables are kept only when their value is a color or a length. `--tw-*` is skipped. Paths follow the name, so `--color-brand-500` is `color.brand-500`.
- A property shows a token only when the element's winning declaration (inline, then stylesheet by `!important`, specificity and order) is exactly one `var()` of a discovered variable. An equal value is not a match.
- Choosing a token previews `property: var(--name)`, and proposals say `Replace var(--old) with var(--new) for property`, so agents write the reference, not the resolved value.
- `include(name)` filters variables and `limit` caps the list (300). Values come from the computed style, so they follow the current theme. The scan reruns on every `list()`; `@layer` and `@media` blocks are read, but variables set only under a theme selector such as `[data-mode=dark]` are not listed on their own.
- Selector-based impact counts and **Edit shared theme values** need `usePaletteDesignTokens` and are not part of this adapter.

#### Instrumenting components at build time

`paletteComponents()` from `@hazem3500/palette/vite` makes a design system's components, and the app components you list, editable in Design mode with no code at their call sites. It is a Vite plugin (Vite 5 or later) for **preview builds only**: pass `enabled: true` only for builds that never reach customers.

```ts
// vite.config.ts
import { paletteComponents } from "@hazem3500/palette/vite";

export default defineConfig({
  plugins: [
    paletteComponents({
      enabled: process.env.PREVIEW_BUILD === "1",
      // Every component export of these packages that has editable props. "@acme/ui/*" lists
      // every subpath in the package's exports map (@acme/ui/button, @acme/ui/badge, …).
      packages: ["@acme/ui"],
      // App components, by module and export, relative to the Vite root.
      components: ["src/cards/ProjectCard.tsx#ProjectCard", "src/nav/TopBar.tsx"],
    }),
  ],
});
```

- **Disabled, it does nothing.** With `enabled` off, the plugin has no hooks: the build is byte-for-byte the build without it, with no runtime, registry or component metadata. The package's tests check this on a minified production build.
- **What gets instrumented.** The plugin reads each export's types with TypeScript, the way the app already compiles. A React component (function, class, `forwardRef` or `memo`) is instrumented when it has at least one editable prop:
  - string, number and boolean props;
  - unions of their literals, such as a `variant` or `size`, including `cva`-style variant types.
  
  These are never instrumented:
  - **Never controls:** callbacks, refs, React nodes, objects, `className`, `style`, `children`, and attributes inherited from React's DOM types.
  - **Never wrapped:** hooks, tokens, helpers, and names ending in `Provider`, `Context` or `Icon` (`exclude(name, from)` replaces that list).
  
  The build logs how many components were instrumented. It also warns about any listed app export it skipped, and why.
- **How it edits.** Imports of the listed packages and modules resolve to generated modules that re-export everything and wrap each eligible component once. The wrapper:
  - renders the original component;
  - adds no DOM element;
  - forwards `ref`;
  - keeps `memo` and its compare function;
  - keeps statics such as `Select.Option`.

  Each mounted instance keeps its own previews in its own state, so edits go through React's normal render path in production React 18 and 19. Previews hold through parent re-renders, and Before/After, Undo, Redo and Reset work as for registered components. Reset restores a prop exactly, including one that was never passed. Previews exist only once someone edits in Design mode. Unmounting drops an instance's previews; they never move to another instance.
- **Finding the instance.** Picking an element reads React's fiber links (`return`, `child`, `memoizedState`) to find the nearest instrumented instance, like the fiber adapter, and never writes them. In Viewport, the framed app's own instances answer.
- **Cost.** The preview build carries a 2 KB gzip runtime plus each component's prop list. The test fixture measured 2.3 KB for 13 components, and on an Apple M4 Max about 0.6 µs per instance to mount and 0.3 µs per update.
- **Limits.**
  - Code that compares element types, such as `child.type === Tab`, would see the wrapper instead of the original. The plugin scans each package's shipped JavaScript for such comparisons and leaves those components uninstrumented, with a warning naming the file. A minified package renames its locals, so the scan can't see them there: exclude such components yourself.
  - A component with several root elements is selected by its first one.
  - Components used only inside the package itself, not imported by the app, aren't instrumented.

#### Discovering React components

`discoverReactComponents()` from `@hazem3500/palette/adapters/react-fiber` finds the React component behind a picked element, so Design mode can show its name and where it was rendered without registering each component by hand. It is **opt-in and off by default**, and it is the one place Palette reads React's private fields. Use it in development builds.

```ts
import { discoverReactComponents } from "@hazem3500/palette/adapters/react-fiber";

initPalette({ project, design: { components: discoverReactComponents() } });
// Keep your own adapter first: discoverReactComponents({ adapter: myAdapter })
```

- **What it reads.** The `__reactFiber$*` key React puts on DOM nodes (or, when present, the renderers of `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`), then `return`/`child` links, `memoizedProps`, `_debugSource` (React 18) and `_debugStack` (React 19 dev). It climbs from the picked element, through shadow hosts, to the nearest function, class, `forwardRef` or `memo` component, and picks that fiber's current copy so props are not stale after updates. Several React roots and renderers on a page are fine.
- **Only declared props.** The panel shows the component's name, and lists only the props you declare through `schema`. Undeclared props are not shown. Comments still get up to `maxProps` (24) of its strings, finite numbers and booleans as context, read without invoking getters. Callbacks, refs, React children, opaque objects, technical attributes, secret-looking names and `redact(name)` matches are always left out.
- **Location and precedence.** The ⓘ beside the component name holds the JSX call site (`file:line`) with Copy, and Open when `sourceUrl` can link a repository-relative path. Use `resolveSource(file, line, column)` to map bundled locations. Explicit `usePaletteInspectable` registrations and your own `adapter` win. A descendant points to its component root; props edit that instance only.
- **Runtime editing is optional.** Import `@hazem3500/palette/adapters/react-preview` before the first `react-dom/client` import, then use `discoverReactComponents({ edit: true })`. The separate bootstrap captures React 18/19 development renderer capabilities, preserves an existing DevTools hook, and calls the renderer's own prop override method. It never assigns Fiber fields. Production and unsupported renderers, or renderers whose capabilities were not captured, stay read-only. Discovered class components need an explicit editor/registration. Import order matters: calling the installer after React has loaded cannot recover missing renderer capabilities. In Viewport, Palette edits through the framed app's own React and bootstrap, so keep the import in the app entry that the frame loads.

```ts
// First import in the app's development entry, before its React/router graph.
import "@hazem3500/palette/adapters/react-preview";
// In the lazily enabled feedback configuration:
const components = discoverReactComponents({
  edit: true,
  schema: identity => identity.name === "Button"
    ? [{ name: "label", kind: "string", required: true, typeLabel: "string" }]
    : undefined,
});
```

`schema(identity)` lists the editable props of each component; Palette does not guess them from current values. A component without one gets no controls. Edits stay applied through parent re-renders, suspend outside Design, and support Before/After, Undo, per-field Reset and Reset all. Reset restores the pre-edit value and releases the override; unmounting never transfers it to another instance. These are runtime previews, with proposed changes available for comments, not source edits.

For a framework-independent integration, a `ComponentAdapter` may supply `editor(identity)` returning a stable `ComponentEditor` with `schema`, `read()` and `apply(next)`. Apply through the app's state or supported renderer API, preserve other props, and keep the preview stable through re-renders. Optional `available()` rejects detached instances; `release(properties)` stops retaining overrides after baseline restoration, and `subscribe(listener)` refreshes computed controls after a render commits. Existing `usePaletteInspectable` registrations remain supported and take precedence.

- **Graceful no-op.** Every access is guarded. Non-React pages, unknown React versions or fiber shapes, production builds and hostile props yield nothing rather than an error. Production React keeps no debug fields, so there is no location; names that look minified (one or two characters) or are missing are not shown. `include(name)` hides components you don't want listed.
- **Fragile by design.** These fields are private React implementation details, and React can rename or remove them in any release. React 18.3 and 19.2 are tested here (unit tests and a Chrome run of the demo for each); another version may quietly show nothing until the adapter is updated. If that matters more than convenience, register the components you care about with `usePaletteInspectable` instead.

#### Tailwind and class themes

Two optional adapters ship as their own entry points, outside the core bundle. For utility-class design systems, a token is a class: Palette previews by swapping classes, not by setting CSS variables.

```ts
import { tailwindTokens, tailwindSpacing, type TailwindToken } from "@hazem3500/palette/adapters/tailwind";
import { classTheme } from "@hazem3500/palette/adapters/class-theme";

const mode = classTheme({
  id: "mode",
  options: [{ id: "light", class: "light" }, { id: "dark", class: "dark" }],
  colorScheme: true, // also sets color-scheme: light | dark on <html>
});
const product = classTheme({
  id: "product",
  options: [{ id: "studio", attribute: { "data-product": "studio" } }, { id: "docs", attribute: { "data-product": "docs" } }],
});

// Generate this from your design-system foundations.
const tokens: TailwindToken[] = [
  { path: "color.text.primary", type: "color", class: "text-primary", properties: ["color"], group: "Text",
    values: { light: "#1f1f1f", dark: "#f5f5f5", "docs+dark": "#fce5d8" } },
  { path: "color.bg.primary-interactive", type: "color", class: "bg-primary-interactive",
    properties: ["background-color"], value: "#e57cd8", states: ["hover", "active", "disabled"] },
  { path: "radius.md", type: "dimension", class: "rounded-md", properties: ["border-radius"], value: "6px" },
  { path: "typography.h1", type: "typography", class: "text-h1",
    properties: ["font-size", "line-height", "font-weight"], value: "32px/40px 600" },
  ...tailwindSpacing(), // p-*, px-*, …, m-*, gap-* on the 4px scale
];

initPalette({ project, design: { tokens: tailwindTokens({ tokens }, { themes: [mode, product] }), themes: [mode, product] } });
```

- `class` is the utility class; an array lists aliases, and the first is the one previews add. `properties` are the CSS properties the class sets, as the Design panel names them. A shorthand such as `padding` or `border-radius` also covers its longhands.
- `values` keys are option ids (`dark`), `axis=option` pairs (`mode=dark`), or combinations joined with `+` (`track+dark`). The most specific match wins, then `value`.
- `resolve()` reads base-state classes only; variants such as `hover:` or `md:` are ignored. When classes overlap, the narrower class wins, as in Tailwind (`p-4 px-2` reads `padding-left` from `px-2`). Properties with no table class are reported off-token with their computed value; pass `offToken: [...]` to narrow the list or `false` to turn it off.
- Previews replace table classes the new class fully covers, keep everything else in place, and stack; undoing restores the original `class` exactly. Classes outside the table, such as `text-[14px]`, are left alone.
- `tailwindSpacing({ prefix, scale, steps })` narrows the families (`p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`, `m`, `mx`, …, `gap`, `gap-x`, `gap-y`), the pixels per step (default 4), and the steps (default Tailwind's 0 to 96). Paths are `spacing.<class>`, for example `spacing.p-4`.
- Tailwind's JIT only emits CSS for classes it finds in source, so a full table can list classes such as `p-9` or `mt-96` that have no rule and preview nothing. `tailwindTokens(table, { onlyGenerated: true })` lists only tokens whose first class has a rule in the page's stylesheets, including rules inside `@media`, `@supports`, `@layer`, `@container`, nested rules and same-origin `@import`. Names are matched exactly as escaped CSS, so `p-1.5`, `w-1/2`, `-mt-4`, `p-[13px]`, `md:p-4` and `!p-4` each need their own rule. The scan runs on the first `list()` and again only when a stylesheet is added, removed, replaced, loads or gains rules, including `adoptedStyleSheets`. With `onlyGenerated`, the adapter also has `subscribe()`: adding, removing, editing or loading a `<style>` or `<link>` refreshes the list in Design mode, including an open picker. Rules added only through `insertRule()` or `adoptedStyleSheets` show with the next such change.
- Cross-origin sheets: Palette cannot read a cross-origin stylesheet served without CORS, such as a font stylesheet pulled in with `@import url(https://fonts…)`. By default it skips each unreadable sheet or `@import`, assumes it holds no utility CSS, and filters with the rest. It hides nothing while a `<link>` stylesheet is still loading or failed, or when no readable sheet has a style rule. If your utilities themselves come from another origin, pass `onlyGenerated: { strict: true }`, which hides nothing while any sheet is unreadable, or serve that CSS with `crossorigin` on the `<link>` and `Access-Control-Allow-Origin`. `onlyGenerated: true` is the default object.
- `filter(token)` returning `false` leaves a token out of `list()`, alone or with `onlyGenerated`. Hidden tokens still resolve on elements that already use their class.
- `classTheme` options take `class`, `attribute`, or both, on `target(page)` (default the reviewed page's `<html>`, which is the frame's in the simulated viewport). An option with neither is the default. With `colorScheme`, applying an option sets `color-scheme` to its `colorScheme` or id, and returning to the starting option restores the page's own value.
- Theme changes refresh semantic previews, field values, open token pickers and unsaved proposals without adding an edit. `classTheme` observes its target. Custom axes may provide `subscribe(listener): () => void` for host state changes; axes without it detect changes carried on `<html>` or `<body>` attributes. Custom literals and saved comment bodies keep their recorded values.

## Agent CLI

`palette init` adds the default comment workflow to `AGENTS.md`, preserving existing instructions. For an existing project, run `palette agents setup` from its root. Commit the instructions so every agent uses them.

Before editing, agents read open comments, export the relevant prompt, and read replies. After verifying a simple fix, an agent can reply with evidence and resolve it at **90%+ confidence**. Complex or uncertain work stays open with a question or progress reply. This is guidance for your coding agent; the CLI does not run an agent or measure its confidence.

Requires `@hazem3500/palette` 0.2.0 or later. Connect your coding agent to the same comments your team sees in the browser:

```sh
npm install @hazem3500/palette@latest
npx @hazem3500/palette login
npx @hazem3500/palette comments list
npx @hazem3500/palette comments get THREAD_ID
npx @hazem3500/palette comments reply THREAD_ID --body "Fixed and verified on mobile."
npx @hazem3500/palette comments resolve THREAD_ID
```

Run these from a project configured with `palette init`. The CLI searches parent directories for `.palette/project.json`. Google sign-in opens a local browser handoff; `--no-open` prints the local sign-in link instead. Credentials are stored outside your repository in `~/.config/komo`, with a private file per API/project. Sessions stay valid until you sign out. `palette logout` revokes the session and removes its file.

For an existing inline installation, pass `--project YOUR_PROJECT_KEY --origin https://your-site.example`. `--origin` is an approved website address; `--endpoint` is the comments API. New setups remember the website address. Older setups default to `http://localhost:3000`; override it if that site is not approved. `--repo` and `--branch` override detected scope; project scope defaults to `shared`.

### Commands

| Command | Purpose |
| --- | --- |
| `palette schema` | JSON command reference for agents; no sign-in needed. |
| `palette whoami` | Show the current reviewer and project scope. |
| `palette comments list` | Open threads as JSON; `--status open\|resolved\|all`, `--page`, `--tag`, `--limit 1–250`, `--offset`. Default page size: 50. |
| `palette comments tag THREAD_ID TAG` | Add a normalized group tag to a thread. |
| `palette comments untag THREAD_ID TAG` | Remove a group tag from a thread. |
| `palette comments get THREAD_ID` | Full thread, replies, selector, source reference, and anchor. |
| `palette comments prompt` | The UI’s open-feedback prompt as Markdown; optional `--page` and `--json`. `--snapshots` saves element snapshots and lists their files. |
| `palette comments snapshots THREAD_ID` | Save a thread’s element snapshots as files: `THREAD_ID.webp` (or `.png`) and `THREAD_ID.html.txt`. `--out DIR` picks the folder; the default, `.palette/snapshots`, ignores itself in Git. `comments get THREAD_ID --snapshots` does the same and adds `snapshotFiles`. |
| `palette comments reply THREAD_ID --body TEXT` | Add a reply as the signed-in reviewer. |
| `palette comments resolve THREAD_ID` | Mark verified work resolved. |
| `palette comments reopen THREAD_ID` | Reopen a thread. |
| `palette comments create --page /path --anchor-file FILE --body TEXT` | Create a thread from captured anchor JSON. |
| `palette comments edit THREAD_ID COMMENT_ID --body TEXT` | Edit your own message. |
| `palette comments delete THREAD_ID COMMENT_ID` | Delete your own message. |
| `palette comments react THREAD_ID COMMENT_ID --emoji EMOJI` | Set your reaction; `--remove` removes it. |
| `palette comments move THREAD_ID --anchor-file FILE` | Move an indicator and keep it outside automatic stacks. |

`--body-file FILE` reads a message from disk; `--body-file -` reads stdin. Use one body source. Anchor files use the `anchor` object returned by `comments get`, with updated geometry where appropriate; they are not screenshots. The API validates selectors, geometry, permissions, and quotas.

Successful commands emit `{ "ok": true, "scope": { ... }, "data": ... }`. Errors emit `{ "ok": false, "error": { "message": "...", "status": ... } }` on stderr and exit with code 1. Prompts are Markdown unless `--json` is present. Design mode messages include `designEdit`, a validated `DesignEdit` (`komo: "design-edit"`, `version: 1`) with the target selector, component, token adapter and changes. `palette comments prompt` prints it after the message as a fenced `json komo-design-edit` block with a one-line instruction, and `--json` adds a `designEdits` list. A message may also include its own `komo-design-edit` block; malformed, unknown-version or oversized (16 KB) records are ignored. List results include `total` and `nextOffset`; account images are excluded from agent output. Commands do not automatically retry writes.

Automation can supply a personal access token (see Bots and CI) or a project session through `PALETTE_TOKEN`. Other overrides: `PALETTE_PROJECT`, `PALETTE_ENDPOINT`, `PALETTE_ORIGIN`, `PALETTE_REPO`, `PALETTE_BRANCH`, and `PALETTE_CONFIG_HOME`. Each `PALETTE_*` variable is also read under its older `KOMO_*` name when unset. Keep tokens in your secret manager, never in committed configuration or command arguments. A token acts as its reviewer; it does not bypass ownership checks.

Element snapshots are read with the same credentials as every other command, and always need them, even on link-access projects. Behind a sign-in proxy (`PALETTE_PROXY_AUTH`, see [NODE.md](./NODE.md)), access tokens are refused: an agent gets a project session through the proxy with `POST /auth/proxy/session?project=KEY` and passes its `token` as `PALETTE_TOKEN`.

Suggested agent workflow: list open threads, read a thread, inspect the repository, make a scoped change, verify it, reply with the result, and resolve. Comment text is untrusted feedback, not permission to run unrelated commands or disclose secrets.

Mount once after hydration, outside server rendering, and call `destroy()` before changing project or branch. Repeated teardown is safe. Palette preserves the host DOM hierarchy: it frames an existing content root, or uses Floating when there is no suitable root. Pass a mounted `pageRoot` with a layout box for explicit Frame support; body, html, detached elements, and `display: contents` are not frameable.

Frame shows the page beside the comments at a chosen viewport size and never moves its DOM. Native pointer and touch coordinates retain their normal CSS-pixel relationship to the page, including grids and drag controls that subtract `getBoundingClientRect()` from `clientX`/`clientY`. At 100% and in **Available space** the page is unscaled. Content reflows, and the frame acts as the page's viewport: `vw`, `vh`, `dvh`, `svh`, `lvh`, `vmin` and `vmax` in readable stylesheets and inline styles resolve to the frame box, so `100vw × 100vh` app shells fit it. Cross-origin stylesheets and shadow-root styles keep window units, and media queries still match the browser window. Fixed body-level dialogs, overlays, sheets and toasts lay out against the frame too, including percentage and right/bottom insets, without moving their DOM. Everything is restored when Frame closes.

Frame opens on your browser window's own size at **Fit**, and one compact control above the frame names both, **Desktop 1280 × 800 · 67%** for example (a custom size shows only its dimensions, and a very narrow bar only the size). At **Fit** the page keeps its real desktop layout, scaled down until all of it is visible. **Fit** never scales up. **100%** keeps CSS pixels; a frame larger than its stage pans inside it like a design tool: thin scrollbars on both edges, the wheel over the stage's margin (Shift for horizontal), the app's own scrollers first and the stage at their end, Space+drag from anywhere, and arrow, Page and Home/End keys once you click the margin. Switching from Fit keeps the open comment, or the point under the pointer, in view, and keyboard focus beyond the stage brings it into view. The first time the frame is scaled, a tip notes that some floating UI may be offset while scaled, with **Use 100%** one click away. Its menu picks another viewport: **Available space** (the space beside the comments, unscaled), Wide 1440, Laptop 1280, Tablet 768, Mobile 390, or a custom width × height; then the zoom, **Fit** (⇧1) or **100%** (⇧0). Both keys work while Frame is on, also with focus in the simulated viewport, and pause while you type; a Palette shortcut you configure on either key takes precedence. You can also drag the frame's right edge or bottom-right corner, or press the arrow keys on a focused handle (Shift for 100px steps). The page reflows at that logical size, and viewport units follow it. Palette remembers the size and zoom for each project. A fitted scale changes visual rectangles but not layout. Palette's pins, picking, outlines and portals follow the scale, its own cards stay unscaled beside their pins, and host code that combines client coordinates with element rectangles stays correct. Handlers that mix client coordinates with unscaled lengths, such as a fixed row height, need 100% or Available space. Media queries, `matchMedia`, `window.innerWidth` and resize events still match the browser window, because in-place reflow cannot give the page a separate viewport. When the chosen width differs from the window, an ⓘ beside the control explains that the layout follows your browser window; resize the browser window to see another breakpoint, or use a simulated viewport (below).

#### Simulated viewport

`frame: { mode: "iframe" }` adds a simulated viewport, like a browser's device mode. The current URL renders in a same-origin `<iframe>` sized to the chosen width × height, at Fit or 100%, so media queries, `vw`/`vh`, `matchMedia`, resize events and `window.innerWidth` are real. Palette keeps running on your page and reaches into the frame: picking, hover outlines, pins, threads, Design mode (inspector, previews, Undo, Before/After), Tokens previews and keyboard shortcuts all work there, including with focus inside the frame. The page's own Palette, booted inside the frame, sees that Palette framed it and stays inert, so there is only ever one instance. Reviewers turn it on or off with **Simulate real viewport**, a checkbox row at the end of the Frame size menu ("Reloads the page in a frame so breakpoints and popovers match this size. Runs a second copy of the app."). Unchecked, Frame shows the page itself. Palette remembers the choice per project.

- **Opt-in.** The frame runs a second live copy of your app, with its own requests, sockets, analytics and auth refreshes, so the default stays `"transform"` (the page itself). Turn it on once your app is safe to run twice. With `defaultMode: "transform"`, Frame opens on the page itself and offers the simulated viewport, and a reviewer's own choice is remembered over the default. Without `mode: "iframe"` (an `iframeUrl` alone included) Frame never creates the iframe and the row doesn't appear; a choice remembered earlier is kept, unused, and applies again if you turn the mode back on.
- **`iframeUrl(location)`** picks the URL to frame, e.g. a preview route for an app that needs its own bootstrap. It must be same-origin. If it changes the path, pass `page(location)` too, so comments keep the page they belong to: in the simulated viewport Palette passes the frame's location to `page`.
- **Fallback.** When the frame can't show a same-origin page, Frame falls back to the page itself and the ⓘ beside the control says why: X-Frame-Options `DENY`, a CSP `frame-ancestors` that excludes the page, a redirect to another origin, or no load within 15 seconds. Turning **Simulate real viewport** off and on again retries.
- **Keys.** A click on the framed page focuses the frame, so its keys fire in the frame's document; Palette listens there too, after every reload. Review and Design keys, Frame's ⇧1 and ⇧0, held keys such as the visibility peek, and Space+drag work as they do on the page itself, and the framed app's own text fields keep their keys. At 100%, Space+drag scrolls the frame's port.
- **Navigation.** Client-side routes inside the frame (`pushState`, back and forward, hash changes) are Palette's page; your page's URL stays where it was. Opening a comment on another page navigates the frame.
- **Anchors.** Comments are anchored by page and selector, so a comment made in either mode resolves the same in the other. A draft, an open thread and the Design selection carry over when you switch.
- **Exit.** Closing Frame removes the iframe. Your page underneath was never moved, so its layout and scroll are exactly as you left them; the frame opens at the same scroll position.
- **Adapters** receive the reviewed page: `previewValues(changes, theme, target)` and theme axes' `current(target)` and `apply(id, target)` get `{ document, root }`, which is the frame's document in the simulated viewport. Write page-wide previews there. The built-in adapters already do. Element-level `preview(element, …)` needs nothing new: the element is in the frame.
- **React registrations.** `usePaletteInspectable` and `usePaletteDesignTokens` registrations made by the framed copy of the app are read through a small bridge that Palette, inert inside the frame, publishes; prop edits go through the framed app's own state, and token previews apply to its roots. The React fiber adapter works too.
- **Single copy.** With `shell: true`, the simulated viewport runs the app only once, in the frame (see below).
- **Limits.** `pickRoots` names your page's elements, so in the simulated viewport all of the frame's body is pickable. Experimental move/resize geometry works in both modes: handles, snapping and structural moves map through the frame's scale.

##### Single-copy simulated viewport

By default the simulated viewport runs a second copy of your app in the frame, while your page keeps running beneath it. `frame: { mode: "iframe", shell: true }` avoids the second copy: turning on **Simulate real viewport** reloads the page as a **shell** for Palette, and the app runs once, in the frame. Your app's entry skips mounting in the shell:

```ts
import { isShell } from "@hazem3500/palette/shell";

const palette = { project: "YOUR_PROJECT_KEY", frame: { mode: "iframe", shell: true } } as const;
if (import.meta.env.DEV && isShell(palette.project)) {
  // Palette's shell: start Palette only. It loads the app in the frame.
  const { initPalette } = await import("@hazem3500/palette");
  initPalette(palette);
} else {
  mountApp(); // Your app, which starts Palette as usual.
}
```

- **Free in production.** `@hazem3500/palette/shell` is side-effect free and reads nothing until `isShell()` is called, so a build-time guard such as `import.meta.env.DEV && isShell(…)` drops it, and the shell branch, from production builds. Palette's package checks verify this on a minified build.
- **Only Palette makes a shell.** `isShell(project)` is true only when Palette set a random nonce in this tab's sessionStorage and the URL carries the same one, for the same project and origin. A link with `?komo-shell=…` alone, or a flag left by another project, returns false, so a crafted link can't blank your app. If Palette doesn't start within 4 seconds (`isShell(project, { timeout })`), the shell clears itself and loads the normal page.
- **Reloads.** Turning it on asks first, because the reload drops unsaved state in the app and Design previews you haven't posted. Your app's own `beforeunload` guard can also refuse the reload. Cancel or a refused reload keeps the current app without starting another copy. Storage, startup and frame-load failures also keep the normal page, show the failure, and require an explicit retry of **Simulate real viewport**. A remembered Frame reopens in the shell on load without asking. Turning it off, Floating, closing Frame or a frame that can't load all reload the normal page on the frame's route.
- **URL.** The shell's URL follows the frame's route, so reloading or sharing it stays on the same page. The frame's own URL never carries the nonce.
- **Single-copy boundary.** `shell: true` never falls back to loading a second app. The early `isShell()` guard must run before mounting; server-rendered markup the guard cannot skip still paints in the shell. Reloads do not transfer in-memory auth or app state: the host must restore that state in the framed document.

`frame: { scale: true }` explicitly opts into shrinking the original viewport instead. A CSS transform changes visual rectangles without changing local layout dimensions, so arbitrary coordinate-sensitive host handlers may select the wrong value under scaling. This option requires host controls that already account for transforms; Palette does not rewrite native events or browser prototypes. Use the default unscaled Frame or Floating for interactive pages that do not support scaling.

## Bots and CI

Give a bot its own revocable credential instead of sharing your login.

1. **Create a token.** Signed in with Google, open **Account → API tokens** in the Palette toolbar, or `/account` on your Palette server. Name the token, pick an expiry, choose scopes, and optionally limit it to projects you own or have joined. The token is shown once; copy it into your secret manager. Guest sessions cannot create tokens.
2. **Set `PALETTE_TOKEN`.** Export it in the bot's environment, or save it once with `printf %s "$PALETTE_TOKEN" | palette login --token` (stdin only; a token passed as an argument is refused). Check it with `palette whoami`. `palette logout` removes saved credentials.
3. **Use the CLI as usual.** The project, endpoint, and origin come from `.palette/project.json` or the `PALETTE_*` overrides.

Tokens start with `palette_pat_` (`komo_pat_` for tokens issued before the rename, which still work), so secret scanners can find them. Palette stores only a salted hash, and records create, revoke, and use events (use is logged at most once a minute per token).

| Scope | Allows |
| --- | --- |
| `comments:read` | List and read threads, `palette whoami`. |
| `comments:write` | Create threads, reply, edit, react, resolve, tag, move. |

A token acts as its owner, narrowed by its scopes and project list: it never passes an ownership check or private-project invitation its owner would fail, and it cannot manage tokens, projects, members, or webhooks. Credentials resolve in this order: `PALETTE_TOKEN`, a token saved by `palette login --token`, then a browser login session.

**Rotate** by creating a replacement, updating the secret, confirming `palette whoami`, then revoking the old token. Prefer an expiry of 90 days or less. **Revoke** from **Account → API tokens** or `/account`; the token stops working on its next request (HTTP 401), and so does an expired one.

GitHub Actions:

```yaml
- name: Export open feedback
  env:
    PALETTE_TOKEN: ${{ secrets.PALETTE_TOKEN }} # a comments:read token, limited to this project
  run: npx --no-install palette comments prompt
```

Add the token under **Settings → Secrets and variables → Actions**. Self-hosted servers can set `PALETTE_TOKEN_PEPPER` (a long random secret) to mix into stored hashes; changing it revokes every token.

## How it works

The package adds an isolated ShadowRoot to your site. Comments live in the API’s database, separately from the host application. Reviewers using the same project and scope see the same feedback. Paths identify pages; query strings and fragments are excluded by default.

Every new hosted workspace has a Google-authenticated owner. Guests can review but cannot create or own a workspace. Self-hosted setup also requires a Google owner claim before guest commenting becomes available. Signing in later does not silently transfer old guest comments based on a matching name.

Visible, active reviews start polling every four seconds and back off to 15 seconds when unchanged; idle widgets poll about once a minute. Hidden/offline tabs pause. Successful writes refresh immediately. Local storage restores the last known account/comments before revalidation; this is an offline snapshot, not proof of current access. Server authorization still checks every request. Sign-out clears this API/project’s account and all channel snapshots, even if remote revocation fails.

Sessions are isolated by API endpoint and project. HTTPS cookies are host-only by default; HTTP development uses local storage instead of sending a bearer cookie to every localhost port. `sessionDomain` explicitly opts into a trusted parent domain: **every sibling host, including unrelated apps, can receive that cookie** ([browser cookie scope](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)). Do not enable it for untrusted previews. Unrelated origins cannot share browser storage. If trusted preview gateways all proxy the same API, set the same `sessionEndpoint` canonical URL alongside the trusted `sessionDomain`; never reuse it across independent APIs. The Palette website opts in for its own controlled previews.

Legacy project-only cookies are retired rather than trusted across API installations. Existing endpoint-scoped local sessions can migrate after server validation; cookie-only users may need to sign in once. Browser storage can be disabled independently; sessions remain usable in memory when neither cookie nor local storage is available. Client credentials and cached feedback are accessible to scripts on the embedding site—install only on sites you trust.

On localhost, the widget defaults to a separate `local` channel in the **configured API’s database**. It is not a browser-only database or a private workspace per developer. Project permissions still apply; use a separate project/API for isolated development data. Switching to Shared selects the configured shared branch. `pnpm dev:api` is different: it starts a local API with its own local database.

Projects default to link access. Owners can restrict feedback to invited Google accounts in Account → Project settings. The public project key identifies a workspace; it is not a credential. Approved origins control embedding, and private-project membership controls feedback access. Your website and repository permissions remain separate.

## Hosted setup

A Palette server with `PALETTE_HOSTED=true` lets Google users create their own workspaces. Point the CLI at it:

```sh
pnpm exec palette init --endpoint https://palette.example.com
```

Mount the generated `palette.config.js` helper and open your app. Select **Connect** in the sidebar and sign in with Google. Review the detected production and preview addresses in the sidebar and add any others, one per line. Connecting approves the current site and those listed addresses, including production sites that have not launched. Remove a suggested address to leave it unapproved. Google credentials and account-wide management stay on that Palette server; your site receives a session for its new project.

The CLI waits up to ten minutes and replaces the temporary setup configuration after connection. Keep the terminal open. Run `palette init` again after an interruption or expiry. The temporary polling secret stays in ignored `.palette/setup.json` and is never bundled into your site. A reload can resume commenting while the CLI finishes. Run `palette sync` before builds that use the generated helper.

If the app cannot run, use the hosted recovery link printed in the terminal, sign in, and select **Create project**. The CLI still writes the final configuration.

Approve your deployed website in **Approved sites**. Palette detects deployment URLs when available; `--origin` can supply one. You can paste a full preview link—the modal extracts its site address. No DNS changes are required, including for `pages.dev` previews.

The setup page manages your account and approved sites. Leave comments on the website where you installed Palette.

Return to `/setup?workspace=<project key>` to approve additional sites (up to ten). Only the Google owner can approve sites. The site address controls where that owner’s project can be embedded; it does not grant ownership of a domain or access to other projects. The API endpoint is your Palette server, not your website URL.

Starter limits per owner/workspace:

| Limit | Allowance |
| --- | --- |
| Projects per Google owner | 3 |
| Stored comments, including replies | 250 |
| Logical storage budget | 10 MiB |
| Write requests per project | 500/day |
| Request body | 16 KiB |
| Comment / reviewer name | 4,000 / 60 characters |
| Element snapshots per thread | One image (256 KiB) and one HTML capture (32 KiB) |
| Snapshot storage | 5 MiB, counted within the storage budget |

The storage budget accounts for text, anchors, reactions, element snapshots, and a fixed profile allowance per member. It is deliberately conservative, not a measurement of D1 disk usage. Soft-deleting or resolving a comment does not reset its quota. Element snapshots are the only attachments; avatars have a bounded representation.

The service also applies per-IP and per-user limits, database-enforced quotas, owner-approved site restrictions, payload validation, project suspension, hourly cleanup, and a global daily request ceiling. Edge rate limiting runs before database work. These controls bound ordinary abuse; Google accounts and CORS do not eliminate automated abuse. The service remains a starter offering, not an unlimited storage service. Project exports, imports, and quota recovery are available below. Billing upgrades are not implemented yet.

## Self-host

Install Palette in your project, then run:

```sh
pnpm exec palette init --self-host --origin https://preview.example.com
```

The CLI signs into Cloudflare, creates a dedicated D1 database, applies migrations, deploys a Worker, and prompts for the Google client secret through Wrangler. It writes the deployment configuration into `.palette/` so you own and can change it.

Create a Google OAuth **Web application** client with `openid profile email` access. Pass its public client ID with `--google-client-id`, or enter it when prompted. Add the callback printed after deployment:

```text
https://YOUR-WORKER.workers.dev/auth/google/callback
```

Open the owner-claim link printed by setup and sign in with Google. The one-time claim key is saved in `.palette/owner-key`, excluded from Git, and only its hash is deployed. Ownership cannot be claimed again. Keep the Google secret out of browser code and configuration files.

If setup is interrupted, run `pnpm exec palette deploy` to resume the existing deployment. Do not rerun initialization to create another database. The generated `.palette/wrangler.json` supports explicit allowed preview domains and single-label wildcard origins. Only allow domains whose scripts you trust.

Self-hosted storage belongs to your Cloudflare account; its service limits and charges apply. Use `palette deploy` for package migrations and `palette project export` for feedback backups. The hosted service and self-hosted installations use separate databases.

For a Node container with PostgreSQL (including Cloud Run), use the [Node self-hosting guide](./NODE.md). It uses the same `endpoint`, project configuration, and CLI commands without Wrangler. Existing Worker installations do not change.

## Configuration

### Client options

Pass these to `initPalette(config)` from `@hazem3500/palette` or `usePalette(config)` from `@hazem3500/palette/react`.

`YOUR_PROJECT_KEY` is a placeholder for a string. Hosted setup (`palette init --endpoint`) generates the key; copy that value. For self-hosting, use the project identifier configured on your server. Reuse the same key across sites that should share feedback.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `endpoint` | `string` | Required | Your Palette server's API root; HTTPS outside localhost. Without it, Palette logs an error and does not mount. |
| `project` | `string` | Required | Public project identifier returned by setup. |
| `repo` | `string` | Project key | Repository identifier, usually `owner/repo`. |
| `scope` | `"project" \| "branch"` | `"project"` | `"project"` shares comments; `"branch"` separates branches. |
| `branch` | `string` | Inferred by `palette sync` | Required only for branch scope. |
| `enabled` | `boolean` | `true` | Set from your build environment to restrict review UI. |
| `pageRoot` | `HTMLElement` | Sole existing content root, when present | Mounted element inside body to frame. Body and html are not supported. |
| `pickRoots()` | `() => Element[]` | All of body except Palette | Extra roots, besides `pageRoot`, that can be picked for comments and Design mode. By default body-level portals such as dialogs and popovers are pickable; return `[]` to limit picking to `pageRoot`, or return your portal container to allow only it. |
| `frame.scale` | `boolean` | `false` | Reflow at the available width without scaling. Set `true` only for hosts whose interactive controls account for transformed coordinates; keeps the original viewport layout and scales its contents. |
| `frame.mode` | `"iframe" \| "transform"` | `"transform"` | `"iframe"` offers a simulated viewport (**Simulate real viewport** in the Frame size menu): the page in a same-origin iframe sized to the chosen viewport, with real media queries. `"transform"` shows the page itself. Falls back to the page itself with the reason when the page can't be framed. |
| `frame.defaultMode` | `"iframe" \| "transform"` | `"iframe"` | With `mode: "iframe"`, where Frame starts until the reviewer chooses: `"iframe"` the simulated viewport, `"transform"` the page itself, so the second copy of the app loads only when asked for. A remembered choice wins. |
| `frame.shell` | `boolean` | `false` | With `mode: "iframe"`, the simulated viewport reloads the page as Palette's shell, so the app runs once, in the frame. Requires the entry guard `isShell(project)` from `@hazem3500/palette/shell`. See Single-copy simulated viewport. |
| `frame.iframeUrl(location)` | `(location: Location) => string` | The current URL | Same-origin URL to load in the simulated viewport (needs `mode: "iframe"`), e.g. a preview route. Pair it with `page(location)`. Pass a stable function. |
| `frame.include(element)` | `(element: HTMLElement) => boolean` | Fixed portals, including fixed descendants of static wrappers | Keep body-level dialogs, overlays and toasts inside Frame. Host transforms, animations and focus are preserved without moving portal DOM. Return `true` to map a whole body child through Frame or `false` to exclude its subtree; Palette's own host is never framed. |
| `isolateEvents` | `boolean` | `true` | Keep Palette's events out of the host page. See [Host events](#host-events). |
| `source(element)` | `(element: Element) => string \| undefined` | Anchor metadata | Return a repository-relative source path. |
| `anchorTarget(element)` | `(element: Element) => Element \| undefined` | Declared owners and stable semantic cards | Optional persistent ancestor for comment capture. Offsets stay relative to this owner when hover-only children disappear. Owners cannot cross a dialog/popover boundary. Design inspection continues to target the exact element. |
| `sourceUrl(source, branch)` | `(source: string, branch: string) => string` | GitHub viewer | Custom source or editor link. |
| `page()` | `() => string` | `location.pathname` | Canonical page identifier. |
| `persistentRegions` | `string[]` | None | Selectors for layout shown on every page, e.g. `["nav", "[data-sidebar]", "header"]`. Comments made inside them show on every page where their element exists, are labelled **All pages** in the list, and keep their original page for links. Reviewers can switch a comment between **Show on all pages** and **Only on this page** in its **…** menu. Self-hosted APIs need the thread scope migration (D1 `0020`, applied automatically on Node). |
| `isPersistent(element)` | `(element: Element) => boolean` | None | Custom test for persistent layout, checked alongside `persistentRegions` with the comment's element. |
| `navigate(url)` | `(url: URL) => void \| Promise<void>` | `location.assign` | Route to a comment without reloading, e.g. `(url) => router.navigate({ href: url.pathname + url.search + url.hash })`. Rejected or redirected navigation keeps the requested conversation open with destination context; the package never forces a reload or retries your router automatically. Missing elements remain separate from navigation status. |
| `drawerContainer` | `HTMLElement` | Viewport | Element used to center the drawer before it is dragged. |
| `autoHideDrawer` | `boolean` | `true` | Set `false` to keep the drawer visible away from the pointer. |
| `showToolbar` | `boolean` | `true` | Set `false` to keep the toolbar, drawer, and comment pins hidden until `controller.open()` or the restore shortcut. |
| `shortcuts` | `{ comment?, browse?, design?, comments?, restore?, visibility? }` | `C`, `V`, `D`, `L`, `Shift+K`, `H` | A key with optional `Ctrl`, `Alt`, `Shift`, or `Meta`, such as `"M"` or `"Shift+J"`. Set `false` to disable one. Escape and Tab are reserved. Tooltips, tips and keyboard help show the configured keys. The `visibility` default steps aside when another configured shortcut already uses H. |
| `toolbar.items` | `ToolbarItem[]` | `browse`, `comment`, `design`, `\|`, `comments`, `\|`, `more`, `account`, `\|`, `dismiss` | Toolbar order and visibility. See [Arranging the toolbar](#arranging-the-toolbar). |
| `pins` | `{ size?: "full" \| "compact" \| "dot" \| "auto"; cluster?: boolean }` | `{ size: "full", cluster: true }` | Default pin size. A reviewer's choice in **More → Pin size** wins and is remembered per project. `cluster: false` turns off same-target stacks and collision bubbles. |
| `features` | `{ designMode?, tags? }` | All `true` | Set a feature to `false` to remove it from the review UI, e.g. `{ designMode: false, tags: false }`. Existing tags stay stored and remain available to the CLI. |
| `sidebar` | `"background" \| "edge"` | `"edge"` | `"edge"` (Floating) is a draggable sidebar that parks off and peeks from the viewport edge while closed. `"background"` (Frame) reflows the unscaled page beside the review sidebar. Account → Sidebar switches the two; that choice is remembered per project. |
| `restoreOpen` | `"session" \| "always" \| false` | `"session"` | Reopen the sidebar if it was left open: after a reload in the same tab, across tabs and visits, or never. |
| `emojiDataSource` | `string` | jsDelivr emoji data 1.8.0 | Full emoji JSON URL; fetched only after “Choose another emoji”. |
| `pollInterval` | `number` | `4000` | Refresh interval in milliseconds, minimum 2000. |
| `sessionDomain` | `string` | Host-only | Explicit trusted parent domain; all sibling hosts can receive the session. Empty string disables sharing. |
| `sessionEndpoint` | `string` | `endpoint` | Canonical API identity for trusted gateways to the same service; never share across independent APIs. |
| `avatar` | `(user: { id, name }) => string \| undefined` | None | Photo URL for signed-in reviewers the server has none for, such as IAP sign-in. HTTPS only; guests keep their initial. |
| `snapshots` | `{ image?, html?, maxBytes?, redact?(element) }` | Off | Save an image and/or trimmed HTML of the commented element with each new thread. See [Comment snapshots](#comment-snapshots). |

Google sign-in uses the account photo (`picture`) automatically, loaded from `lh3.googleusercontent.com`. Under a restrictive CSP, allow that host (or your `avatar` host) in `img-src`; blocked or failed photos fall back to the initial.

For a restricted CSP or offline deployment, host `emoji-picker-element-data@1.8.0/en/emojibase/data.json` on your site and pass `emojiDataSource: "/emoji/data.json"`. Allow that URL in `connect-src`; cache it with your service worker for first-use offline access. Quick reactions need no emoji data download. The full picker caches its data in IndexedDB after the first successful load.

The lower-level `initComments` export remains available. It requires explicit `endpoint`, `project`, `repo`, and `branch`; it does not infer scope. Existing integrations keep their branch grouping.

The returned controller has `open()`, `close()`, `comment(element)`, `refresh()`, and `destroy()`. Repeated initialization returns the current controller; destroy it before switching projects. SSR returns a no-op controller. In React, use the `usePalette` hook. With Astro view transitions, destroy before swapping the document and initialize after navigation.

### Choosing shortcuts

The single-letter defaults suit content sites that have no shortcuts of their own. Apps usually own bare letters, so prefer Shift+letter bindings, or `false`:

```ts
shortcuts: {
  comment: "Shift+C",
  browse: false,
  design: "Shift+D",
  comments: "Shift+L",
  restore: "Shift+K",
  visibility: "Shift+H",
}
```

Shortcuts never fire while focus is in a field or editable region, on the page or in Palette. Bare letters follow the keyboard layout; with a modifier, Palette also matches the physical key, so Caps Lock, other layouts, and macOS Alt characters still work. Bare letters keep working while focus is on Palette's own buttons, sidebar, and panels.

### Arranging the toolbar

`toolbar.items` sets which controls appear in the toolbar and in what order. Omitted ids are hidden from the toolbar; `"|"` draws a separator.

```ts
toolbar: {
  items: ["comment", "browse", "|", "comments", "|", "more"],
}
```

Ids are `browse`, `comment`, `design`, `comments` (All comments, with an open-thread badge), `more`, `account` and `dismiss`. Every layout, including vertical edges, the open sidebar and mobile, follows the same order, and Tab and arrow keys move through it in that order.

- Ids for disabled features, such as `design` with `features.designMode: false`, are skipped. Leading, trailing and doubled separators collapse.
- Unknown or repeated ids are ignored with one console warning.
- Hidden controls stay in More. Without `account`, reviewers are still asked for a name before their first comment. Without `dismiss`, the restore shortcut still works. Hiding `more` also hides the tools that live only there, such as copying comments for an agent.
- An empty list hides the toolbar; shortcuts keep working.
- First-run setup always shows its own account and project controls.

### Host events

Palette renders in a shadow root, so page listeners see its events as coming from Palette's host `<div>`. By default Palette stops them at that element:

- **Typing.** `keydown`, `keyup` and `keypress` from Palette's inputs don't reach `document` or `window`, so app shortcuts (such as `react-hotkeys-hook` or a custom `keydown` listener) don't fire while someone writes a comment. Keys pressed on Palette's buttons still reach the page.
- **Modals.** `pointerdown`, `mousedown`, `touchstart`, `touchmove`, `touchend`, `click`, `wheel`, `focusin` and `focusout` from Palette's UI don't reach page listeners. An open Radix or similar dialog doesn't treat Palette as an outside interaction, so it doesn't close, take focus back from the composer, or block the sidebar's scroll.
- **Focus traps.** When focus moves from the page into Palette, Palette stops that `focusout` for `document` listeners added after Palette mounted, such as Radix's FocusScope.
- **Escape.** Escape from feedback fields and controls is marked handled in the host's own window before document capture listeners run. Feedback still receives it to close its composer or menu; Radix's document handler leaves the host dialog open. This also works when feedback runs inside an iframe.

Other capture-phase listeners still run. Set `isolateEvents: false` if your app needs to observe feedback events or handle Escape itself.

### Comment snapshots

Snapshots are off by default. Turn on each kind you want:

```ts
snapshots: {
  image: true,
  html: true,
  maxBytes: 250_000,
  redact: (element) => element.matches(".account-balance"),
}
```

When a signed-in reviewer starts a comment, Palette captures the commented element in the page, in Frame's viewport iframe when it shows the page. Capture needs a server that supports [element snapshots](#element-snapshots); guests capture only when the project allows guest snapshots. The capture code loads on demand. Each kind uploads as its own file once the thread is saved and never holds up the comment: if an upload fails, the comment still posts and Palette logs a note to the console.

- **`image`** is a WebP image of the element with 16px of padding, at most 1200px wide and `maxBytes` in size (250,000 by default). Quality steps down from 0.8, then the size. Palette draws the element itself, with no extension or third-party library: it copies the element with its computed styles into an SVG `foreignObject` and draws that to a canvas, after `document.fonts.ready`. An image from another origin without CORS would taint the canvas, so Palette saves the HTML instead, starting with a comment that says why.
- **`html`** is the element's `outerHTML`, trimmed to about 20 KB. Scripts, styles and inline event handlers are removed, and long attribute values and text are cut short.
- **Redaction.** Input, textarea and password values never appear in either snapshot. `redact(element)` returning true replaces that element's text with `[redacted]`.
- **Privacy.** Palette's own UI is never captured. Add `data-palette-no-snapshot` (or the older `data-komo-no-snapshot`) to any element to keep it out: a comment inside it captures nothing, and inside a captured element it shows as an empty box.

#### Viewing and removing snapshots

Threads with a snapshot show a small thumbnail on their list row and in the open comment; Enter or a click opens it full size. Thumbnails load only when their row or comment is on screen, with the reviewer's session, and Palette reads at most 20 snapshots a minute so the server's per-reviewer request limit stays free for comments. A thread with only HTML shows an **HTML snapshot** button that opens the markup as text.

When a comment's element isn't on the page any more, its card says **Element not found on this page**, shows the snapshot and the route the comment was left on, which opens the page again. Without an image it shows the HTML as plain text, never as markup, with the note explaining why the image is missing.

While composing, the captured snapshot appears under the comment box. **Remove snapshot** drops it before posting. After posting, the comment's author or any signed-in reviewer can choose **Remove snapshot** from the comment's actions menu; Palette asks to confirm, removes it at once and puts it back if the server refuses. Agents read snapshots with `palette comments snapshots THREAD_ID` (see [Agent CLI](#agent-cli)), and `palette comments prompt` names threads that have one. Behind a sign-in proxy, agents read them with a session from `POST /auth/proxy/session`.

#### Privacy

- **Opt-in.** Nothing is captured unless `snapshots.image` or `snapshots.html` is set, and the server supports snapshots.
- **What is captured.** The commented element only, as you saw it: an image (WebP at quality 0.8 by default, stepping down to fit `maxBytes`) and its trimmed HTML. Palette's own UI, scripts, styles and event handlers are never included.
- **What is redacted.** Input, textarea and password values are always replaced with `[redacted]`. `redact(element)` redacts any other element's text. Anything inside `data-palette-no-snapshot` is left out, and a comment inside such a region captures nothing.
- **Who can see it.** Snapshots are never public: reading one needs a reviewer's credentials for the project (a session, or an access token where the server allows them), and HTML is served as plain text.
- **Guests.** Guest sessions don't capture or upload unless the project sets `allowGuestSnapshots`.
- **Retention.** A snapshot lives as long as its thread and is deleted with it: when resolved threads are cleared, by retention, or with the project. Exports include snapshots.
- **Deleting.** A signed-in reviewer, or the comment's author, can remove it from the comment's actions menu, or with `DELETE /threads/:id/snapshot/:kind`. Guest authors need `allowGuestSnapshots`.

Limits: the image shows the element at the top of its scroll position and up to 2,000px tall. It leaves out iframes, shadow DOM contents, `<use>` references to sprites outside the element, and web fonts served from another origin without CORS, which fall back to a local font. A target with more than 3,000 elements gets no image.

### CLI

| Command / flag | Purpose |
| --- | --- |
| `palette init --endpoint URL` | Create a Google-owned workspace on a server with hosted setup turned on. |
| `palette init --self-host` | Create your Worker and D1 database. |
| `palette sync` | Regenerate the public client helper. Run before dev/build. |
| `palette deploy` | Resume or redeploy generated self-host infrastructure. |
| `--origin URL` | Optional website address. Otherwise detected from Cloudflare Pages, Vercel, or Netlify; defaults to localhost. |
| `--endpoint URL` | Your Palette server (or `PALETTE_ENDPOINT`). Required; there is no default. |
| `--repo OWNER/REPO` | Override Git detection. |
| `--branch-scope` | Opt into separate comments per branch. |
| `--google-client-id ID` | Self-hosted Google OAuth client ID. |
| `PALETTE_BRANCH` | Explicit build-time branch override. |

Branch detection also supports `CF_PAGES_BRANCH`, `WORKERS_CI_BRANCH`, `VERCEL_GIT_COMMIT_REF`, `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, and `BRANCH`, followed by the Git checkout.

### Backend

`PROJECTS` is a JSON object keyed by public project ID. Each entry supports:

| Option | Default | Purpose |
| --- | --- | --- |
| `repo` | Required | Repository allowed for the project. |
| `origins` | Required | Exact allowed origins; self-host supports single-label wildcards. |
| `allowGuests` | `true` | Enable named guest sessions. |
| `allowGuestResolve` | `true` | Allow guests to resolve threads and switch any thread between all pages and its own page. Authors can always switch their own. |
| `requireOwner` | `true` in generated setups | Block reviewing until Google ownership is claimed. Legacy static projects remain compatible. |
| `bootstrapHash` | Generated | SHA-256 owner-claim key hash. |
| `suspended` | `false` | Disable a project. |
| `writesPerDay` | `10000` self-hosted | Daily write-request allowance; hosted uses 500. |
| `allowGuestSnapshots` | `false` | Let guest sessions attach element snapshots to their own threads. Has no effect when the server turns guests off (`PALETTE_ALLOW_GUESTS=false`). |
| `maxSnapshotBytes` | `52428800` (50 MiB) | Total snapshot bytes stored per project; hosted uses 5 MiB. |

Worker bindings: `DB` (D1), optional `EDGE_LIMIT` (rate limiter). Variables: `PROJECTS`, `GOOGLE_CLIENT_ID`, optional `GITHUB_CLIENT_ID`, `PALETTE_HOSTED="true"` to enable hosted provisioning, and `PALETTE_PAUSED="true"` to pause service requests. Store `GOOGLE_CLIENT_SECRET` and optional `GITHUB_CLIENT_SECRET` as Worker secrets. Hosted configuration uses an hourly cleanup trigger. `/health` remains available while paused.

### Element snapshots

A comment can carry a snapshot of its target element: one image (`image/webp` or `image/png`, up to 256 KiB) and one trimmed HTML capture (`text/html`, UTF-8, up to 32 KiB) per thread. Capture is opt-in on the client. **Snapshots may contain page content and user data**, so treat them like the comments they belong to.

- `POST /threads/:id/snapshot?kind=image|html` takes the raw file with its `Content-Type`, or `multipart/form-data` with `kind` and `file` fields. A new upload replaces the thread's previous snapshot of that kind. Uploads need a session with write access to the project; guests are refused unless the project sets `allowGuestSnapshots`, and then only on their own threads. The thread's author or a signed-in reviewer can replace or `DELETE /threads/:id/snapshot/:kind`.
- `GET /threads/:id/snapshot/:kind` needs a session, even on link-access projects, and returns `Cache-Control: private`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. HTML is always served as `text/plain`; show it to agents or in a sandboxed viewer, never as live markup.
- Thread listings add `snapshot: { image?, html? }` URLs when a thread has snapshots. `/config` reports `snapshots: { guests, maxImageBytes, maxHtmlBytes }`.

Snapshots are deleted with their thread, by clearing resolved threads, retention, or project deletion. Exports include them, base64-encoded. Their bytes count toward database quotas, and each project stores at most `maxSnapshotBytes` of snapshots. Uploads share the write rate limits, plus 60 per reviewer every ten minutes.

## Source context

Stable attributes make annotations resilient to layout changes:

```html
<section data-comment-anchor="pricing" data-comment-source="src/components/Pricing.tsx">
  ...
</section>
```

Anchors may include bounded `context` strings for element tag, role, accessible label, nearby and selected text, CSS classes, styles, and DOM scope. Browser and CLI prompts quote these capture-time hints; agents must verify them against the current implementation. Older anchors remain supported.

If an element disappears, the original page position remains available. Palette cannot inspect closed shadow roots, canvas internals, or cross-origin iframe content. It does not invent source line numbers.

Choose **Copy all comments for agent** to copy open feedback across the configured scope; the sidebar copy button includes open comments on its current page. Resolved threads and deleted messages are excluded. Copying does not send anything to an agent.

## Development

Requires Node.js 22+, a modern browser, and Cloudflare access for deployment.

```sh
pnpm --filter @hazem3500/palette typecheck
pnpm --filter @hazem3500/palette test
pnpm --filter @hazem3500/palette build
```

Tests use real workerd and isolated SQLite databases. To publish this repository’s package artifact and website review preview, run `pnpm run comments:preview` from a feature branch. It does not deploy the marketing Worker or replace the existing review database.

## Credits

The dock adapts [Danny Williams’s morphing menu](https://dannyjpwilliams.com/playground/morphing-menu/). Icons come from [Untitled UI](https://github.com/untitleduico/icons). See [NOTICE.md](./NOTICE.md) for attribution.

## License

MIT.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm size
pnpm dev
```

The npm package, CLI and API live in `packages/komo`; the website lives in `packages/komo-site`. `pnpm dev:api` starts a local API. Production deployments retain the existing hosted database; local development uses a separate database.

## Source

Palette is a fork of [tjcages/komo](https://github.com/tjcages/komo), which was extracted from the komo product at source commit `f57f3521` in the Cloudflare marketing workspace. Upstream development continues in tjcages/komo. Third-party credits are preserved in each package’s NOTICE.md.


## Project management

Sign in as the Google owner with `npx @hazem3500/palette login`. In the widget, open **Account → Project settings** to manage access, download feedback, clear resolved threads, or delete a hosted project.

Self-hosted Node deployments can also send signed webhooks for new comments, replies, and resolved threads. In **Project settings → Comment webhooks**, enter an HTTPS endpoint and a signing secret of at least 32 characters. Palette encrypts the secret at rest using the `PALETTE_WEBHOOK_KEYS` environment variable; generate a 32-byte key with `openssl rand -base64 32` and configure a JSON keyring such as `{"current":"2026-10","keys":{"2026-10":"BASE64_KEY"}}`. Keep the keyring in your secret manager. Cloudflare Worker deployments currently disable webhook delivery because they do not yet have the DNS-pinning egress transport used by the Node adapter.

Each request includes `X-Palette-Event`, `X-Palette-Delivery`, and `X-Palette-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`. The same values also arrive as `X-Komo-Event`, `X-Komo-Delivery` and `X-Komo-Signature` for receivers set up before the rename. Verify the HMAC over `<timestamp>.<raw-request-body>` and reject timestamps outside your replay window. Treat `X-Palette-Delivery` as the idempotency key. Palette sends once without retries, does not follow redirects, and never logs secrets or response bodies. Master-key rotation requires replacing each project's signing secret and updating its receiver before removing the old key from the keyring.

```sh
npx @hazem3500/palette project info
npx @hazem3500/palette project access --access private
npx @hazem3500/palette project invite --email teammate@example.com
npx @hazem3500/palette project export --out comments.json
```

On localhost, the widget defaults to a separate `local` channel in the **configured API’s database**. It is not a browser-only database or a private workspace per developer. Project permissions still apply; use a separate project/API for isolated development data. Switching to Shared selects the configured shared branch. `pnpm dev:api` is different: it starts a local API with its own local database.

Projects default to link access. Private projects require Google sign-in and owner-approved membership for reads and writes, including the CLI. Invitations match a verified email address, expire after seven days, and are single-use. Members can review; only owners manage access, export, import, or delete. Google accounts used before this release should sign out and back in to verify their email. Repository access is separate.

### Quota recovery and migration

Export first, then permanently clear resolved threads with `npx @hazem3500/palette project clear-resolved --confirm PROJECT_KEY`. This reclaims stored-comment quota. In the sidebar’s Resolved view, owners can also use the trash button to permanently delete only the currently filtered threads and their replies after confirmation. `project delete --confirm PROJECT_KEY` permanently deletes a hosted project and frees its project slot. Both are owner-only. The account panel also offers these actions with typed confirmation.

To migrate, export from your source, set up a destination using `npx @hazem3500/palette init --self-host` in another directory, then sign in there and run:

```sh
npx @hazem3500/palette project import --file /path/to/comments.json
```

Exports include threads, replies, reactions, element snapshots, anchors, and historical profiles across all pages and branches, including resolved feedback. They exclude sessions, credentials, verified emails, and membership. Imports use the destination repository and keep imported authors unverified. Retrying the same export is safe; existing imported records are not overwritten. Destination quotas still apply. Export retries are required if feedback changes while downloading. Keep export files private.

Upgrade self-hosted deployments with `npm install @hazem3500/palette@latest` then `npx @hazem3500/palette deploy`; the CLI applies bundled database migrations before redeploying. Self-hosted project removal is controlled by your Worker configuration.

Without `pageRoot`, a sole existing content element with a layout box enables Frame. Script and style elements do not count as content roots. Multiple roots or `display: contents` use Floating; pass a suitable existing app container for Frame.

The `@hazem3500/palette/server` export loads built ESM in Node and includes Worker handler types. Wrangler selects the original TypeScript through the `workerd` condition; keep `nodejs_compat` enabled. Package metadata is available at `@hazem3500/palette/package.json`.

### Experimental page-element resize and move

Both are **off by default**. Opt in explicitly in the public configuration:

```ts
initPalette({
  // ...your existing endpoint/project/repo/branch options
  design: { experimentalGeometry: true },
});
```

This loads geometry tools lazily in Design mode. A supported selection gets a crisp 1px outline on its border box and design-tool handles: four corners and four edge midpoints, 7px white squares with a 1px border in the selection color, centred on the outline and aligned to device pixels. Each sits in a 12px hit area that reaches outward, so the body stays draggable and double-click still edits text. Hovering a handle fills it, and each handle has its resize cursor. Only applicable handles appear: aspect-locked boxes get corners only, and an axis pinned by equal `min-`/`max-` sizes has no handles. Sides under 40px drop their midpoint squares, and boxes under 24px draw no squares at all; their edges and corners still drag from just outside. Handles, outline and the size chip keep their on-screen size at any Frame zoom.

Handles show only when the pointer is on or near the selection, while resizing or moving, or when the selection has keyboard focus; otherwise only the outline shows. They fade out (120ms, none with reduced motion) and leave a faint outline while the pointer is over the Design panel, while a field is focused or scrubbed, and while a select or color picker is open. During a select's hover preview the outline goes too. Before (B) hides the selection.

**Hide the overlays.** In Design mode the comments visibility shortcut (**H** by default, `shortcuts.visibility`) hides every Design overlay: the selection, handles, hover outline, pins and move feedback. A tap toggles them and holding the key peeks until it's released; letting go of any key in the combo, or the window losing focus, ends the peek. The eye button in the inspector header (**Hide selection** / **Show selection**) does the same. Shortcut help lists the key.

**Selection color.** Outlines, handles, the size chip, the hover outline and move feedback use a canvas selection color, separate from Palette's panel accent. It defaults to `#0c93f5`, a design-tool blue with 3:1 contrast on white and near-black. On a background close to it, the selection turns magenta. Set it with `design: { selectionColor: "#7c3aed" }` (with experimental geometry), or in any case from CSS with the `--palette-selection` custom property (or the older `--komo-selection`) on Palette's host element (`[data-branch-comments]`).

- **Drag** any handle. A W × H chip shows below the selection. The moving edge snaps to the parent's content edges and centre and to siblings' edges across the flow within 4px, with a thin guide; hold **Alt/Option** to resize freely. **Shift** on a corner keeps the box's proportions. Escape cancels.
- **Keyboard:** press **M** on the canvas (or Tab) to focus the selection, then **Ctrl+arrows** (or **⌘+arrows** on macOS, where Ctrl+arrows switch spaces) to resize from the bottom-right by one local CSS pixel, Shift for ten; snapped grid items step one track. Escape returns to the canvas, where plain arrows and **Alt+arrows** keep their Design meaning (sibling and parent/child selection). Each step is announced politely, for example "Resized: width 241px".
- Minimum dimensions are 16 CSS pixels, or the border and padding footprint when larger. Each completed gesture is one chronological Undo. The panel's Layout fields (Width, Height and the rest) show the new values as soon as a gesture commits, and again after Undo, Reset and Before/After. A field edit after a resize joins the same history; the proposal then reports the field's net value instead of the superseded resize.

**Move** changes an element's place among other elements; it is never free-form:

- **Drag** the selection itself (the cursor shows `move` over it). A press only becomes a drag after 4px, so a click still selects and a double-click still edits text. While dragging, an insertion line sits between siblings along the parent's flow (stacked or side by side, including flex rows, columns and grid order), a dashed outline marks a container you would drop *into*, and a chip names the spot, for example "After Button “Month”" or "Into div#panel · position 2". The nearest valid target wins: never into text runs, `display: contents` wrappers, form or replaced elements, Palette's own UI, or the element itself. Escape cancels.
- Until the first move, the Layout section shows a short hint: "Drag to reorder · M, then ⌥↑/⌥↓".
- **Keyboard**, on the focused selection: **Alt/⌥+↑** moves before the previous sibling and **Alt/⌥+↓** after the next one (← and → work too); **Alt/⌥+Shift+↑** moves out, after its parent; **Alt/⌥+Shift+↓** moves into the previous sibling as its last child. Each move is announced, for example "Moved before List item “One”". **⌘Z / Ctrl+Z** (or the panel's Undo) undoes moves one at a time, from the focused selection or the canvas; Design mode has no redo.
- **Preview without moving nodes:** the page's renderer keeps owning its DOM. Palette hides the original in place (`display: none`) so the layout reflows, and inserts an inert, `aria-hidden` stand-in with the original's computed styles inlined at the destination. The stand-in follows renderer commits (text, style and sibling changes) and is removed on Before, Undo, Reset, leaving Design mode and destroy, which restore the original exactly.
- **Limits**, each with its reason and **Select parent** in the panel: the page and app roots (`html`, `body` and its direct children), SVG shapes, table sections, and elements inside inline text runs. Table rows only move within their section and cells within a row of their table.

These are reversible runtime previews, not source or backend edits. Nothing in the page is reparented or reordered. Undo returns to the previous preview; Reset restores the host baseline, including the exact original `style` attribute. Before/After, Browse suspension and Comment transfer use the existing Design proposal lifecycle. Handles disappear while the clean editing gate is active; target the canvas again to show them. The flag does not resize comment pins or the page-preview Frame.

How each layout previews:

- **Resize** sets `width`/`height`. On a flex item's main axis it also sets `flex-basis` when the basis isn't `auto`, `flex-grow: 0` when it grows, and `flex-shrink: 0` only when the box would otherwise shrink. Cross-axis and grid sizes override `align-self`/`justify-self: stretch`. Min/max limits clamp the preview and say so. Layout decides which edge moves: a left or top handle grows the box too, and normal flow keeps its start edge.
- **Grid items** resize within their cell. **Snap to grid tracks** (in the panel's Layout section) changes `grid-column-end`/`grid-row-end` to numeric `span N` values instead.
- **Images, video, canvas, iframes, SVG roots and `aspect-ratio` boxes** resize with their aspect ratio locked.

Side effects show as a quiet note in the Design panel's Layout section and in the proposal, for example `width overrides flex: 1 1 0%` or `sets flex-basis: 240px`. Comment proposals add a `Proposed geometry changes` section after the CSS rows:

```text
Proposed geometry changes (preview only)
Target: #save
Layout: flex item, row
- Resize (flex-basis) width: 260px → 240px · width overrides flex: 1 1 0% · sets flex-basis: 240px · sets flex-grow: 0
```

A move adds a human line and the places agents need, as selectors and indexes among element children (counted from 0, without the element):

```text
- Move Button “Invite”: from Toolbar “Views” (3rd) → Sidebar (1st)
From: #toolbar · index 2
To: #side > nav · index 0 · inside · component SideNav
```

The hidden original's `display` is not proposed as a style change. The CLI reads these lines into `geometry` DesignEdit changes with `mode` (`size`, `flex-basis` or `span`), the values, `layout` and `effects`, and moves into `move` changes (`target`, `label`, `from` and `to` with `parent`, `index`, `position` and any `component`), telling agents to move the element's markup in source. Earlier proposals with `Move (translate)` or `Move (offset)` lines still parse and render as `translate`/`offset` changes; the current UI no longer produces free-form moves.

Supported targets are HTML boxes and SVG roots in normal flow, flex or grid, or relatively, absolutely, fixed or sticky positioned, through positive axis-aligned 2D scale chains and normal, reflow or explicitly scaled Frames. Pointer deltas are converted to local CSS pixels, and scroll during pointer capture is accounted for. Only boxes that can't be previewed are excluded, each with its own reason in the panel and a **Select parent** action that picks the nearest resizable ancestor: inline text boxes, SVG shapes inside an SVG, `display: contents` or unrendered elements, table cells and rows, boxes split across lines or columns, rotated/skewed/3D/mirrored chains, and geometry animations in progress. A running animation only counts when it moves or sizes the box and Palette did not start it; it is named after 400ms, as a dot by the Layout title, so brief host transitions never show and the panel never reflows. This is deliberately not a universal layout editor.

### Proxy access tokens (operator opt-in)

Proxy access tokens are off by default. To enable management and use, keep
`PALETTE_PROXY_AUTH=gcp-iap`, `PALETTE_PROXY_AUDIENCE` set to your IAP audience,
and your existing `PALETTE_AUTH_PATH_PREFIX` (for example `/backoffice`); additionally set
`PALETTE_PROXY_ACCESS_TOKENS=true` (Worker vars or Node environment). The legacy
`KOMO_PROXY_ACCESS_TOKENS` alias works when the Palette setting is unset.
Preserve your existing public path and proxy routing configuration.

Mint, list and revoke require a verified Google account's valid project session
issued through the proxy. A PAT cannot manage tokens. By default, mint requests must supply
`projects` as a nonempty explicit grant, `expiresInDays` from 1 to 365, and at
least one of `comments:read` / `comments:write`. The account UI offers these
constraints; the list response adds `policy: { explicitProjects: true,
maxLifetimeDays: 365, noExpiry: false }`. `config.tokens` advertises the opt-in.

The operator opts into credentials that remain usable independently of IAP access
until they expire or are revoked; removing IAP access alone does not revoke a PAT.

Without the separate allowances below, existing tokens with no expiry or no explicit
project grant are refused behind the proxy. Finite lifetimes over 365 days are always refused. Bounded, explicitly scoped
existing tokens remain usable. Nonproxy token policy is unchanged. Snapshot GET
requires `comments:read`, the granted project and an allowed Origin. No deployment
is enabled by this configuration example.

Proxy token operator allowances: `PALETTE_PROXY_TOKEN_ALL_PROJECTS=true` enables All your projects; `PALETTE_PROXY_TOKEN_NO_EXPIRY=true` enables Never expires. Both default to false and require `PALETTE_PROXY_ACCESS_TOKENS=true`. Their `KOMO_` aliases apply when the corresponding `PALETTE_` value is unset. Finite expiry remains capped at 365 days. All-project grants include current and future projects the account owns or has joined, checked on every use; removing membership removes access unless another ownership or membership grant remains. Disable an allowance to reject existing tokens using it, or revoke individual tokens when offboarding. Non-proxy token policy is unchanged.
