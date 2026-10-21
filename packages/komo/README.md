# komo

[![npm version](https://img.shields.io/npm/v/@hazem3500/komo)](https://www.npmjs.com/package/@hazem3500/komo)
[![downloads](https://img.shields.io/npm/dm/@hazem3500/komo)](https://www.npmjs.com/package/@hazem3500/komo)

> This is a maintained fork of [tjcages/komo](https://github.com/tjcages/komo), published as `@hazem3500/komo`. Install it with `npm install @hazem3500/komo`.

Comments for your website. Point at an element, mark an area, and leave feedback your team can reply to, resolve, or copy into a coding agent.

Framework independent. Shared persistence. Google identities and guest reviewers.

[Website](https://komo.offbr.co) · [Documentation](https://komo.offbr.co/install/) · [Playground](https://komo.offbr.co/playground/)

Review actions update immediately while saving in the background. Failed writes roll back with a notice; unsaved comment text is retained.

## Install

```sh
npm install @hazem3500/komo
npx @hazem3500/komo init
```

Requires Node.js 22 or newer. The unscoped `komo` package on npm is unrelated; use `@hazem3500/komo`.

The setup command detects your Git repository and generates `komo.config.js` before sign-in. Mount that helper in your app:

```js
import { initKomo } from './komo.config.js';
initKomo();
```

Keep the setup terminal open and start your app in another terminal. Choose **Connect** in your app’s sidebar. Google sign-in opens in a separate window; komo creates the project and returns you to feedback on your site. The CLI saves the final public settings to `.komo/project.json`, updates the helper, and prints an inline configuration. Use `--origin` for a different dev port or deployed site. If interrupted or expired, run `komo init` again to resume; completed projects are never overwritten.

Hosted onboarding is available through the dedicated komo service. Self-hosting is available through the same CLI.

## Usage

Mount after the page has loaded:

```js
import { initKomo } from '@hazem3500/komo';
initKomo({ project: 'YOUR_PROJECT_KEY' });
```

Optional configuration stays at the call site:

```js
initKomo({
  project: 'YOUR_PROJECT_KEY',
  enabled: import.meta.env.DEV || import.meta.env.PUBLIC_PREVIEW === 'true',
  pageRoot: document.querySelector('#app'),
});
```

### React

With React 18.2 or 19, call the hook once near your app root:

```tsx
'use client'; // Required for Next.js App Router client components.
import { useKomo } from '@hazem3500/komo/react';

export function Komo() {
  useKomo({ project: 'YOUR_PROJECT_KEY' });
  return null;
}
```

Render `<Komo />` in your app or layout. The hook handles mounting, cleanup, and React Strict Mode. Inline configuration objects are supported; unchanged values do not restart komo. Changing configuration remounts it, and `enabled: false` removes it. Memoize callback options with `useCallback` and pass stable DOM elements for `pageRoot` or `drawerContainer`. Mount only one hook per page; do not combine it with a separate `initKomo()` call. Server rendering does not mount the tool.

The **endpoint is the comments API**, not your website or preview URL. Hosted komo defaults to `https://komo.offbr.co`. Google sign-in returns to `https://komo.offbr.co/auth/google/callback`, regardless of the website embedding komo. For self-hosting, pass your Worker or Node API URL as `endpoint`. Your current page comes from the browser. Setup detects repository metadata from Git; include its printed `repo` value to enrich agent prompts.

Comments are shared across deployments by default. Use `pnpm exec komo init --branch-scope` to separate them by branch. For automatic branch detection, import from the optional generated `komo.config.js` helper and run `komo sync` before builds. It detects the current branch from deployment environment variables or Git; set `KOMO_BRANCH` if neither is available. It fails rather than silently grouping unknown branches.

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
- Hosted Cloudflare storage, or your own Worker/D1 or Node/PostgreSQL service.

Comment pins stay anchored during ordinary pointer drags. Authors and verified reviewers can choose **Comment actions → Move pin** to reposition one explicitly: drag it, or use arrow keys (Shift for larger steps), then Enter or **Save position**. Escape or **Cancel move** restores its previous position without saving. Completed moves use the existing thread anchor endpoint and remain attached after reload; the page element itself never moves. Dragging a floating comment card is independent of pin placement.

Design mode edits the rendered page only. Preview styles and inline text edits are temporary and reset when the page refreshes; styles are restored when the Komo widget is destroyed. Use **Copy CSS** to apply a rule in your site stylesheet; Komo does not write source files. Double-click text, or use **Edit text**, to edit it inline. Edits accept plain text only and change text in place: nested markup, links, and buttons keep their structure. Text marked `data-private` or `data-sensitive`, form fields, and text inside graphics, media, or frames stay read-only. An explicitly registered React `textProp` routes edits through the app's state callback. The inspector can select an iframe as one element but cannot edit its isolated contents. Elements inside open or closed shadow roots are not traversed; select the component host instead.

The design inspector loads as a separate optional browser chunk when Design mode is first opened, so the default widget load does not pay its bundle cost. The package size check measures this chunk separately from the core bundle.

The inspector takes direct UX/UI inspiration from [DialKit](https://www.dialkit.dev/): a compact dark floating panel, collapsible Color/Typography/Layout/Border groups, horizontal live sliders with editable numeric values, and color swatches paired with CSS color inputs. Group collapse state survives selection and Undo/Reset. Each slider gesture is one undoable edit; numeric fields remain available for precise keyboard entry. No DialKit runtime dependency is added.

Design mode also takes interaction cues from established design tools: select a visible element, keep its controls contextual, and make each change easy to reverse. Figma places editable layer properties and file-local styles or variables beside the selected layer; its Dev Mode provides inspection and measurements. pen.dev pairs an IDE design-mode toggle with a canvas, layer list, contextual property panel, and undo/redo. OpenPencil synchronizes layer-tree and canvas selection and offers contextual typography/layout controls, variables, and undoable operations.

### Opt-in React prop inspection

React teams can register selected component roots for typed prop previews through the `./react` entry. A build-time TypeScript Compiler API pass generates the prop manifest from an explicitly marked function component and props type; the inspector edits only strings, numbers, booleans, and literal unions. Functions, refs, `ReactNode`, objects, generics and unsupported types are omitted from editable controls. This metadata is a safe allowlist, not runtime discovery of every React component; `defaultProps` and every React component form are not inferred. A literal-union prop previews each option as you hover it or move to it with the arrow keys, through the component's own `onChange`; click or Enter commits one Undo step, and moving off the list, Escape or clicking elsewhere puts the opening value back. While komo drives a preview (an option, a token under the pointer, Before/After), the element's own CSS transitions are held, so each step renders at once and the panel reads final values; the element's attributes and `style` are left exactly as they were.

The app provides an `onChange` callback that updates its own state. Komo previews those values through React's normal render cycle, offers undo/reset, and can prefill an explicit comment with the proposed before/after values and source path. Posting still requires the user to submit the comment. Komo's core never accesses React Fiber internals and never writes source files; the one exception is the separate, opt-in [React fiber adapter](#discovering-react-components), which reads React internals only for apps that install it. Preview prop changes reset on refresh. A component may opt one leaf render into direct text editing by setting `textProp` to the name of an allowed string prop; Komo does not infer which child text belongs to a prop. See [`examples/react-props`](./examples/react-props/README.md) for the generated fixture and limitations.

### Opt-in design tokens

`useKomoDesignTokens` can register a bounded list of named CSS custom properties from a host-owned source. Each entry supplies its token path, DTCG scalar type, CSS variable, eligible element properties, and an explicit selector for the estimated theme-preview scope. Komo does not scan arbitrary computed styles or infer a complete semantic system. The first adapter uses the Design Tokens Format Module 2025.10 naming/type vocabulary; it is not a general DTCG file importer, and composite typography tokens are not editable.

Compatible registered tokens appear inside each existing style control, next to the color, spacing, typography, or radius value they affect. The chooser filters by that control's CSS property; it never guesses a token by name, matches computed values, or snaps arbitrary values to a scale. A control reads **Connected** only when the element's winning declaration (inline, or a same-origin stylesheet rule ranked by `!important`, specificity, and order) references the registered `var(--token)`. Typing a value, or choosing **Custom value**, records a custom override that keeps the original token as provenance; choosing another token rebinds the preview, and choosing the original token again removes the override. The comment proposal lists each change once, with its token before and after. Undo and Reset restore the original declaration and token provenance. Cross-origin stylesheets are skipped (their properties read as not connected), and cascade layers are ranked as if unlayered. For registered React components, a build-generated string prop can opt into one allowlisted `styleProperty` mapping (for example `brandColor` → `color`); the token reference then goes through the component's supplied React state callback and stays in the proposed prop diff. Unsupported prop types remain read-only.

Shared theme edits remain secondary under **Edit shared theme values**. Their explicit Preview action changes the registered variable temporarily and reports the author-declared impact selector/count. This is not a persisted design-system edit; it resets on refresh, widget destruction, or Reset. Selectors are estimates, not proof that every matching element consumes the variable. Both element and shared changes remain previews until the user explicitly submits a comment; Komo does not write CSS or React source. Enable registration only in a trusted development/demo environment, and exclude confidential values from the token list.

This approach uses React Developer Tools as a reference for component props but avoids depending on its browser DevTools UI. TypeScript's compiler can generate type metadata before type erasure, while a host callback keeps live previews within the app's public state model. React 18 and 19 are both exercised (see the fixture); the registration hook uses public hooks and DOM refs and does not inspect version-specific React internals. Only the opt-in React fiber adapter does.

Puck is a useful reference for the **explicit component contract**: its config registers renderable components and declares typed editor fields, defaults, nested object/array fields, and global/component/per-instance edit permissions. Komo borrows the opt-in registration, typed allowlist, contextual controls, and fail-closed edit permissions. It does not reuse Puck's editor/runtime: Puck owns a structured page document and supports component insertion, nesting, drag-and-drop, and publishing, while Komo edits a temporary preview of the host app's existing React state and turns proposed values into a comment. A Puck dependency would add a full page-builder interaction/data model and runtime cost where Komo needs a small optional inspector; Puck's MIT license permits reuse, but licensing is not the deciding constraint. For the first version, nested object/array, slot, custom, and dynamic fields remain read-only until the adapter can represent and validate them safely without implying broader source persistence.

Komo adapts those patterns to an embedded live page: direct hover/select, a compact inspector, immediate CSS preview, grouped undo/reset, and CSS export. It does not add a persistent design document, a shared theme editor, or a source-code writer. Named tokens can be previewed only when the host explicitly registers their CSS-variable source; this does not imply that browser preview edits changed application source.

Sources: [Figma layer properties and styles](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar), [Figma Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode), [pen.dev installation and IDE design mode](https://docs.pen.dev/getting-started/installation), [pen.dev interface and undo/redo](https://docs.pen.dev/core-concepts/pencil-interface), [OpenPencil features and properties panel](https://openpencil.dev/overview/features), [OpenPencil layers and selection sync](https://openpencil.dev/user-guide/layers-and-pages), [Puck component configuration](https://puckeditor.com/docs/integrating-puck/component-configuration), [Puck nested object and array fields](https://puckeditor.com/docs/api-reference/fields/object), [Puck permissions](https://puckeditor.com/docs/api-reference/permissions), [Puck source and MIT license](https://github.com/puckeditor/puck), and the [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/).

### Design-system adapters

`design: { tokens, themes, components }` tells Design mode about your design system. These are types in `DesignSystem`, and all three are optional. komo never guesses tokens from computed styles, and its core never reads framework internals; your adapters answer. The single exception is the opt-in [React fiber adapter](#discovering-react-components): it is off unless you install it, and it is the only komo code that touches React's private fields.

- `tokens: TokenAdapter` lists tokens (aliases resolved, per theme). For a picked element, it says which token each CSS property uses, or that the value is off-token. It can also preview a token, for example by swapping a utility class, and describe how to apply the change in source.
- `themes: ThemeAxis[]` are independent axes reviewers can flip from the Design panel, such as light/dark or a product palette. Proposals record the theme state they were made in.
- `components: ComponentAdapter` identifies the component behind an element (name, props, source). Proposals name it with its props. A component registered with `useKomoInspectable` always takes precedence and keeps its editable props. An adapter may also supply `panel(identity)` to show read-only details in the Design panel.

Each Design mode comment starts with its context, for example `Theme: mode=dark`, `Component: Button (src/ui/Button.tsx:12)` and `Props: variant="secondary"`. Its changes follow: token swaps, shared token values, prop changes, text, and raw CSS as a fallback. The CLI reads the comment back as a versioned `DesignEdit` record (`theme`, `target.component`, `changes`) that agents can apply; comments without context lines still parse. Token values edited from the [Tokens view](#editing-tokens-without-picking-an-element) become `{ kind: "token-value", path, theme?, from, to }` changes on target `:root`; `theme` is optional, so earlier version 1 records stay valid. See [Agent CLI](#agent-cli).

#### Themes

The Design panel and Tokens view headers show one theme control. A single axis with exactly two options is a one-click switch: a sun or moon when the options are light and dark (by id or label), otherwise both labels as two segments; its tooltip names the next state. More options or more axes open a compact menu with a row per axis: a segmented control for two or three options, a select for more. With no axis to choose from, there is no control; komo never adds a System option. Switching calls `apply(id)`, then the panel re-reads `current()`, lists tokens for the new theme state, and refreshes the picked element's values, chips and outline. Closing Design mode restores each axis's original option.

```ts
import { classTheme } from "@hazem3500/komo/adapters/class-theme";

const mode = classTheme({ id: "mode", options: [{ id: "light" }, { id: "dark", class: "dark" }], colorScheme: true });
initKomo({ project: "your-project", design: { themes: [mode] } });
```

Theme is context, not an edit. Switching isn't counted as a change, and Undo, Reset and Before/After leave it alone. When Design mode closes, or the widget is destroyed, komo applies each axis's original option again. An axis whose `current()` throws is left out; an `apply()` that throws doesn't break the panel. Any object with `id`, `options`, `current()` and `apply()` works, so a theme kept in React state or a cookie fits too.

#### Token adapters

Without `design.tokens`, Design mode uses the built-in `cssVariableTokens()` adapter (id `"css-variables"`, from `@hazem3500/komo/react`) over the CSS custom properties registered with `useKomoDesignTokens`. Passing `design.tokens` replaces it on every style field: the chips, the suggestions and the off-token markers all come from your adapter, so an element never shows two answers. The **Shared theme** section for registered CSS variables stays available, since it edits variable values rather than an element. To keep CSS-variable chips too, fall back to `cssVariableTokens()` inside your own `resolve()`.

In Design mode, each style field of the picked element:

- shows the token `resolve(element)` reports for that property as a chip;
- opens a token picker listing the `list()` tokens whose `properties` include it, with **Show all** for every token. Rows sit under sticky `group` headings and show a preview for the token's `type` (a color swatch, a bar or corner for dimensions, a shadow card, "Ag" in the font), its `label` (or the last path segment), `ref` and value, `states` as chips and `description` as a second line. The current token is pinned first. Search matches label, path, ref and value; arrow keys and Enter choose, Escape closes. With a theme axis of two or three options, color swatches split by option, using `list(theme)` for each, so the page never switches to read them;
- marks an `{ offToken }` value with a small dot, "Not from a token · 13px", naming a token with exactly that value. Colors compare across hex, `rgb()` and `rgba()` spellings. When a token suggested for the property matches, a "Matches Primary · Use token" line offers it; the field stays unbound until you choose it;
- previews a chosen token with `preview()`, or by setting its value inline when there is no `preview()`. Undo, Reset and Before/After use the undo it returns. States such as hover are listed, not previewed.

`list()` and `resolve()` may return promises; the panel renders first and the token controls join when they resolve. `list()` is called once per theme state. If your token set can change at runtime, add `subscribe(onChange): () => void`: komo subscribes once Design mode shows your tokens (the panel and an unsaved proposal may each hold a subscription), unsubscribes when the widget is destroyed, and on each `onChange()` drops its cached lists, calls `list()` again and refreshes chips, proposals and any open picker, keeping its search, scroll, active row and preview. A comment on a token swap records `Element color: #6b6b6b [color.text.secondary] → #1f1f1f [color.text.primary]`, followed by your `describe()` text on an `Apply:` line.

Returning `{ path: "tone.base" }` declares a semantic binding, including when the host renders that token as a concrete inline value. Its Before/Undo baseline follows the current theme's resolved token value; existing classes, CSS-variable references, declaration priorities and unrelated styles are preserved. Return `{ offToken: value }` for a genuine custom literal, even if it happens to equal a token. Supply current resolved values through `list(theme)` and notify subscribers after applying a theme change.

Writing an adapter for utility classes:

```ts
import type { DesignToken, TokenAdapter, TokenUsage } from "@hazem3500/komo";

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

initKomo({ project: "your-project", design: { tokens: classTokens } });
```

Keep `resolve()` cheap and honest: report only properties you can vouch for. Define the adapter once, outside render, so `useKomo` sees the same object. The React props demo shows this adapter with `?tokens=classes`.

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

The comment's **Token changes** card has the same Before/After switch as an element's card when the adapter implements `previewValues`: Before runs the preview's cleanup, and After previews the edits again. Rows name each token by its label, or else the last part of its path. komo's tooltip shows the full path and theme.

The theme in parentheses is the theme key: the current option of each switchable axis, joined with `+` (`docs+dark`). A repointed alias records token references in braces. Live preview is opt-in:

- `previewValues(changes, theme, target)` receives every current edit, `{ path, value, theme?, alias? }`, on each edit and theme switch, after komo runs the previous cleanup. Return a cleanup that restores the page exactly; komo also runs it for Before, cancel, Reset, closing Design mode and destroy. `theme` is the current key, so an adapter that cannot scope a value to its theme can preview only the edits for it. `target` is `{ document, root }` for the reviewed page; in Frame's Viewport mode it is the frame's document, so write injected styles there.
- Without `previewValues`, edits are still recorded and commented, and the view says "No live preview".
- A token may name its `cssVariable` and a `toCss(value)` transform. A variable holding raw channels such as `19 18 19`, used as `rgb(var(--color-surface))`, shows and edits as `#131213` while the variable receives `19 18 19`.

`discoverCssTokens({ scopes: { dark: ".dark" } })` and `tailwindTokens(table, { scopes })` implement `previewValues` with one injected stylesheet: an edit without a theme sets the variable on `:root`, an option's edit uses its scope selector, and an option without one uses `:root` outside the other scopes. Removing the stylesheet restores the page. `discoverCssTokens` reports `alias` for a variable declared as exactly `var(--other)` (in `:root`, or in the current option's scope), and lists `--color-*` channel triplets as hex with `toCss`. Tailwind tables preview only tokens that set `cssVariable` (and `toCss` when needed). `cssVariableTokens()` previews registered tokens on their root's inline style, for the current theme only.

#### Discovering CSS variables

`discoverCssTokens()` from `@hazem3500/komo/adapters/css-variables` is the no-table option for sites whose tokens are CSS custom properties, including the variables Tailwind v4 emits for `@theme`. It is opt-in, reads `--*` declarations on `:root`/`html` from same-origin stylesheets (cross-origin sheets are skipped), and is meant for development builds.

```ts
import { discoverCssTokens } from "@hazem3500/komo/adapters/css-variables";

initKomo({ project, design: { tokens: discoverCssTokens() } });
```

- Tailwind namespaces set the type and the properties a token may style: `--color-*`, `--spacing`/`--spacing-*`, `--radius-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`. Other variables are kept only when their value is a color or a length. `--tw-*` is skipped. Paths follow the name, so `--color-brand-500` is `color.brand-500`.
- A property shows a token only when the element's winning declaration (inline, then stylesheet by `!important`, specificity and order) is exactly one `var()` of a discovered variable. An equal value is not a match.
- Choosing a token previews `property: var(--name)`, and proposals say `Replace var(--old) with var(--new) for property`, so agents write the reference, not the resolved value.
- `include(name)` filters variables and `limit` caps the list (300). Values come from the computed style, so they follow the current theme. The scan reruns on every `list()`; `@layer` and `@media` blocks are read, but variables set only under a theme selector such as `[data-mode=dark]` are not listed on their own.
- Selector-based impact counts and **Edit shared theme values** need `useKomoDesignTokens` and are not part of this adapter.

#### Discovering React components

`discoverReactComponents()` from `@hazem3500/komo/adapters/react-fiber` finds the React component behind a picked element, so Design mode can show its name, props and where it was rendered without registering each component by hand. It is **opt-in and off by default**, and it is the one place komo reads React's private fields. Use it in development builds.

```ts
import { discoverReactComponents } from "@hazem3500/komo/adapters/react-fiber";

initKomo({ project, design: { components: discoverReactComponents() } });
// Keep your own adapter first: discoverReactComponents({ adapter: myAdapter })
```

- **What it reads.** The `__reactFiber$*` key React puts on DOM nodes (or, when present, the renderers of `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`), then `return`/`child` links, `memoizedProps`, `_debugSource` (React 18) and `_debugStack` (React 19 dev). It climbs from the picked element, through shadow hosts, to the nearest function, class, `forwardRef` or `memo` component, and picks that fiber's current copy so props are not stale after updates. Several React roots and renderers on a page are fine.
- **Useful props first.** Strings, finite numbers and booleans appear under the component's name, marked **Read-only**. Callbacks, refs, undefined values, React children, opaque objects and framework internals are omitted without invoking getters. Technical primitive attributes are in collapsed **Advanced attributes**; `aria-label` stays with useful props. Secret-looking names and `redact(name)` matches are excluded from both the panel and proposals. `maxProps` (24) and `maxString` (80) bound the display.
- **Location and precedence.** The ⓘ beside the component name holds the JSX call site (`file:line`) with Copy, and Open when `sourceUrl` can link a repository-relative path. Use `resolveSource(file, line, column)` to map bundled locations. Explicit `useKomoInspectable` registrations and your own `adapter` win. A descendant points to its component root; props edit that instance only.
- **Runtime editing is optional.** Import `@hazem3500/komo/adapters/react-preview` before the first `react-dom/client` import, then use `discoverReactComponents({ edit: true })`. The separate bootstrap captures React 18/19 development renderer capabilities, preserves an existing DevTools hook, and calls the renderer's own prop override method. It never assigns Fiber fields. Production and unsupported renderers, or renderers whose capabilities were not captured, stay read-only. Discovered class components need an explicit editor/registration. Import order matters: calling the installer after React has loaded cannot recover missing renderer capabilities.

```ts
// First import in the app's development entry, before its React/router graph.
import "@hazem3500/komo/adapters/react-preview";
// In the lazily enabled feedback configuration:
const components = discoverReactComponents({ edit: true });
```

Primitive controls use current prop types. Declare optional or enum controls through `schema(identity)` when you have component metadata; runtime discovery cannot infer a union from one string. Edits stay applied through parent re-renders, suspend outside Design, and support Before/After, Undo, per-field Reset and Reset all. Reset restores the pre-edit value and releases the override; unmounting never transfers it to another instance. These are runtime previews, with proposed changes available for comments, not source edits.

For a framework-independent integration, a `ComponentAdapter` may supply `editor(identity)` returning a stable `ComponentEditor` with `schema`, `read()` and `apply(next)`. Apply through the app's state or supported renderer API, preserve other props, and keep the preview stable through re-renders. Optional `available()` rejects detached instances; `release(properties)` stops retaining overrides after baseline restoration, and `subscribe(listener)` refreshes computed controls after a render commits. Existing `useKomoInspectable` registrations remain supported and take precedence.

- **Graceful no-op.** Every access is guarded. Non-React pages, unknown React versions or fiber shapes, production builds and hostile props yield nothing rather than an error. Production React keeps no debug fields, so there is no location; names that look minified (one or two characters) or are missing are not shown. `include(name)` hides components you don't want listed.
- **Fragile by design.** These fields are private React implementation details, and React can rename or remove them in any release. React 18.3 and 19.2 are tested here (unit tests and a Chrome run of the demo for each); another version may quietly show nothing until the adapter is updated. If that matters more than convenience, register the components you care about with `useKomoInspectable` instead.

#### Tailwind and class themes

Two optional adapters ship as their own entry points, outside the core bundle. For utility-class design systems, a token is a class: komo previews by swapping classes, not by setting CSS variables.

```ts
import { tailwindTokens, tailwindSpacing, type TailwindToken } from "@hazem3500/komo/adapters/tailwind";
import { classTheme } from "@hazem3500/komo/adapters/class-theme";

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

initKomo({ project, design: { tokens: tailwindTokens({ tokens }, { themes: [mode, product] }), themes: [mode, product] } });
```

- `class` is the utility class; an array lists aliases, and the first is the one previews add. `properties` are the CSS properties the class sets, as the Design panel names them. A shorthand such as `padding` or `border-radius` also covers its longhands.
- `values` keys are option ids (`dark`), `axis=option` pairs (`mode=dark`), or combinations joined with `+` (`track+dark`). The most specific match wins, then `value`.
- `resolve()` reads base-state classes only; variants such as `hover:` or `md:` are ignored. When classes overlap, the narrower class wins, as in Tailwind (`p-4 px-2` reads `padding-left` from `px-2`). Properties with no table class are reported off-token with their computed value; pass `offToken: [...]` to narrow the list or `false` to turn it off.
- Previews replace table classes the new class fully covers, keep everything else in place, and stack; undoing restores the original `class` exactly. Classes outside the table, such as `text-[14px]`, are left alone.
- `tailwindSpacing({ prefix, scale, steps })` narrows the families (`p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`, `m`, `mx`, …, `gap`, `gap-x`, `gap-y`), the pixels per step (default 4), and the steps (default Tailwind's 0 to 96). Paths are `spacing.<class>`, for example `spacing.p-4`.
- Tailwind's JIT only emits CSS for classes it finds in source, so a full table can list classes such as `p-9` or `mt-96` that have no rule and preview nothing. `tailwindTokens(table, { onlyGenerated: true })` lists only tokens whose first class has a rule in the page's stylesheets, including rules inside `@media`, `@supports`, `@layer`, `@container`, nested rules and same-origin `@import`. Names are matched exactly as escaped CSS, so `p-1.5`, `w-1/2`, `-mt-4`, `p-[13px]`, `md:p-4` and `!p-4` each need their own rule. The scan runs on the first `list()` and again only when a stylesheet is added, removed, replaced, loads or gains rules, including `adoptedStyleSheets`. With `onlyGenerated`, the adapter also has `subscribe()`: adding, removing, editing or loading a `<style>` or `<link>` refreshes the list in Design mode, including an open picker. Rules added only through `insertRule()` or `adoptedStyleSheets` show with the next such change.
- Cross-origin sheets: komo cannot read a cross-origin stylesheet served without CORS, such as a font stylesheet pulled in with `@import url(https://fonts…)`. By default it skips each unreadable sheet or `@import`, assumes it holds no utility CSS, and filters with the rest. It hides nothing while a `<link>` stylesheet is still loading or failed, or when no readable sheet has a style rule. If your utilities themselves come from another origin, pass `onlyGenerated: { strict: true }`, which hides nothing while any sheet is unreadable, or serve that CSS with `crossorigin` on the `<link>` and `Access-Control-Allow-Origin`. `onlyGenerated: true` is the default object.
- `filter(token)` returning `false` leaves a token out of `list()`, alone or with `onlyGenerated`. Hidden tokens still resolve on elements that already use their class.
- `classTheme` options take `class`, `attribute`, or both, on `target(page)` (default the reviewed page's `<html>`, which is the frame's in Viewport mode). An option with neither is the default. With `colorScheme`, applying an option sets `color-scheme` to its `colorScheme` or id, and returning to the starting option restores the page's own value.
- Theme changes refresh semantic previews, field values, open token pickers and unsaved proposals without adding an edit. `classTheme` observes its target. Custom axes may provide `subscribe(listener): () => void` for host state changes; axes without it detect changes carried on `<html>` or `<body>` attributes. Custom literals and saved comment bodies keep their recorded values.

## Agent CLI

`komo init` adds the default comment workflow to `AGENTS.md`, preserving existing instructions. For an existing project, run `komo agents setup` from its root. Commit the instructions so every agent uses them.

Before editing, agents read open comments, export the relevant prompt, and read replies. After verifying a simple fix, an agent can reply with evidence and resolve it at **90%+ confidence**. Complex or uncertain work stays open with a question or progress reply. This is guidance for your coding agent; the CLI does not run an agent or measure its confidence.

Requires komo 0.2.0 or later. Connect your coding agent to the same comments your team sees in the browser:

```sh
npm install @hazem3500/komo@latest
npx @hazem3500/komo login
npx @hazem3500/komo comments list
npx @hazem3500/komo comments get THREAD_ID
npx @hazem3500/komo comments reply THREAD_ID --body "Fixed and verified on mobile."
npx @hazem3500/komo comments resolve THREAD_ID
```

Run these from a project configured with `komo init`. The CLI searches parent directories for `.komo/project.json`. Google sign-in opens a local browser handoff; `--no-open` prints the local sign-in link instead. Credentials are stored outside your repository in `~/.config/komo`, with a private file per API/project. Sessions stay valid until you sign out. `komo logout` revokes the session and removes its file.

For an existing inline installation, pass `--project YOUR_PROJECT_KEY --origin https://your-site.example`. `--origin` is an approved website address; `--endpoint` is the comments API. New setups remember the website address. Older setups default to `http://localhost:3000`; override it if that site is not approved. `--repo` and `--branch` override detected scope; project scope defaults to `shared`.

### Commands

| Command | Purpose |
| --- | --- |
| `komo schema` | JSON command reference for agents; no sign-in needed. |
| `komo whoami` | Show the current reviewer and project scope. |
| `komo comments list` | Open threads as JSON; `--status open\|resolved\|all`, `--page`, `--tag`, `--limit 1–250`, `--offset`. Default page size: 50. |
| `komo comments tag THREAD_ID TAG` | Add a normalized group tag to a thread. |
| `komo comments untag THREAD_ID TAG` | Remove a group tag from a thread. |
| `komo comments get THREAD_ID` | Full thread, replies, selector, source reference, and anchor. |
| `komo comments prompt` | The UI’s open-feedback prompt as Markdown; optional `--page` and `--json`. |
| `komo comments reply THREAD_ID --body TEXT` | Add a reply as the signed-in reviewer. |
| `komo comments resolve THREAD_ID` | Mark verified work resolved. |
| `komo comments reopen THREAD_ID` | Reopen a thread. |
| `komo comments create --page /path --anchor-file FILE --body TEXT` | Create a thread from captured anchor JSON. |
| `komo comments edit THREAD_ID COMMENT_ID --body TEXT` | Edit your own message. |
| `komo comments delete THREAD_ID COMMENT_ID` | Delete your own message. |
| `komo comments react THREAD_ID COMMENT_ID --emoji EMOJI` | Set your reaction; `--remove` removes it. |
| `komo comments move THREAD_ID --anchor-file FILE` | Move an indicator and keep it outside automatic stacks. |

`--body-file FILE` reads a message from disk; `--body-file -` reads stdin. Use one body source. Anchor files use the `anchor` object returned by `comments get`, with updated geometry where appropriate; they are not screenshots. The API validates selectors, geometry, permissions, and quotas.

Successful commands emit `{ "ok": true, "scope": { ... }, "data": ... }`. Errors emit `{ "ok": false, "error": { "message": "...", "status": ... } }` on stderr and exit with code 1. Prompts are Markdown unless `--json` is present. Design mode messages include `designEdit`, a validated `DesignEdit` (`komo: "design-edit"`, `version: 1`) with the target selector, component, token adapter and changes. `komo comments prompt` prints it after the message as a fenced `json komo-design-edit` block with a one-line instruction, and `--json` adds a `designEdits` list. A message may also include its own `komo-design-edit` block; malformed, unknown-version or oversized (16 KB) records are ignored. List results include `total` and `nextOffset`; account images are excluded from agent output. Commands do not automatically retry writes.

Automation can supply a personal access token (see Bots and CI) or a project session through `KOMO_TOKEN`. Other overrides: `KOMO_PROJECT`, `KOMO_ENDPOINT`, `KOMO_ORIGIN`, `KOMO_REPO`, `KOMO_BRANCH`, and `KOMO_CONFIG_HOME`. Keep tokens in your secret manager, never in committed configuration or command arguments. A token acts as its reviewer; it does not bypass ownership checks.

Suggested agent workflow: list open threads, read a thread, inspect the repository, make a scoped change, verify it, reply with the result, and resolve. Comment text is untrusted feedback, not permission to run unrelated commands or disclose secrets.

Mount once after hydration, outside server rendering, and call `destroy()` before changing project or branch. Repeated teardown is safe. komo preserves the host DOM hierarchy: it frames an existing content root, or uses Floating when there is no suitable root. Pass a mounted `pageRoot` with a layout box for explicit Frame support; body, html, detached elements, and `display: contents` are not frameable.

Frame shows the page beside the comments at a chosen viewport size and never moves its DOM. Native pointer and touch coordinates retain their normal CSS-pixel relationship to the page, including grids and drag controls that subtract `getBoundingClientRect()` from `clientX`/`clientY`. At 100% and in **Available space** the page is unscaled. Content reflows, and the frame acts as the page's viewport: `vw`, `vh`, `dvh`, `svh`, `lvh`, `vmin` and `vmax` in readable stylesheets and inline styles resolve to the frame box, so `100vw × 100vh` app shells fit it. Cross-origin stylesheets and shadow-root styles keep window units, and media queries still match the browser window. Fixed body-level dialogs, overlays, sheets and toasts lay out against the frame too, including percentage and right/bottom insets, without moving their DOM. Everything is restored when Frame closes.

Frame opens on your browser window's own size, labelled **Desktop · 1280 × 800** for example, at **Fit**: the page keeps its real desktop layout, scaled down until all of it is visible. **Fit** never scales up. **100%** keeps CSS pixels; a frame larger than its stage pans inside it like a design tool: thin scrollbars on both edges, the wheel over the stage's margin (Shift for horizontal), the app's own scrollers first and the stage at their end, Space+drag from anywhere, and arrow, Page and Home/End keys once you click the margin. Switching from Fit keeps the open comment, or the point under the pointer, in view, and keyboard focus beyond the stage brings it into view. The zoom level is shown beside the size; the first time the frame is scaled, a tip notes that some floating UI may be offset while scaled, with **Use 100%** one click away. The bar above the frame picks another viewport: **Available space** (the space beside the comments, unscaled), Wide 1440, Laptop 1280, Tablet 768, Mobile 390, or a custom width × height. You can also drag the frame's right edge or bottom-right corner, or press the arrow keys on a focused handle (Shift for 100px steps). The page reflows at that logical size, and viewport units follow it. komo remembers the size and zoom for each project. A fitted scale changes visual rectangles but not layout. komo's pins, picking, outlines and portals follow the scale, its own cards stay unscaled beside their pins, and host code that combines client coordinates with element rectangles stays correct. Handlers that mix client coordinates with unscaled lengths, such as a fixed row height, need 100% or Available space. Media queries, `matchMedia`, `window.innerWidth` and resize events still match the browser window, because in-place reflow cannot give the page a separate viewport. When the chosen width differs from the window, the bar says **Layout follows your browser window**; resize the browser window to see another breakpoint.

#### Viewport mode

`frame: { mode: "iframe" }` adds **Viewport** to the bar, like a browser's device mode. The current URL renders in a same-origin `<iframe>` sized to the chosen width × height, at Fit or 100%, so media queries, `vw`/`vh`, `matchMedia`, resize events and `window.innerWidth` are real. komo keeps running on your page and reaches into the frame: picking, hover outlines, pins, threads, Design mode (inspector, previews, Undo, Before/After), Tokens previews and keyboard shortcuts all work there, including with focus inside the frame. The page's own komo, booted inside the frame, sees that komo framed it and stays inert, so there is only ever one instance. Reviewers switch between **Viewport** ("Loads the page in a frame at this size. Breakpoints, popovers and menus behave like a real screen. Runs a second copy of the app.") and **In place** ("Shows the page itself resized. No extra copy, but breakpoints follow your browser window."); komo remembers the choice per project.

- **Opt-in.** The frame runs a second live copy of your app, with its own requests, sockets, analytics and auth refreshes, so the default stays `"transform"` (in place). Turn it on once your app is safe to run twice. With `defaultMode: "transform"`, Frame still opens In place and offers Viewport, and a reviewer's own choice is remembered over the default.
- **`iframeUrl(location)`** picks the URL to frame, e.g. a preview route for an app that needs its own bootstrap. It must be same-origin. If it changes the path, pass `page(location)` too, so comments keep the page they belong to: in Viewport mode komo passes the frame's location to `page`.
- **Fallback.** When the frame can't show a same-origin page, Frame falls back to In place and the bar says why: X-Frame-Options `DENY`, a CSP `frame-ancestors` that excludes the page, a redirect to another origin, or no load within 15 seconds. Choosing Viewport again retries.
- **Navigation.** Client-side routes inside the frame (`pushState`, back and forward, hash changes) are komo's page; your page's URL stays where it was. Opening a comment on another page navigates the frame.
- **Anchors.** Comments are anchored by page and selector, so a comment made in either mode resolves the same in the other. A draft, an open thread and the Design selection carry over when you switch.
- **Exit.** Closing Frame removes the iframe. Your page underneath was never moved, so its layout and scroll are exactly as you left them; the frame opens at the same scroll position.
- **Adapters** receive the reviewed page: `previewValues(changes, theme, target)` and theme axes' `current(target)` and `apply(id, target)` get `{ document, root }`, which is the frame's document in Viewport mode. Write page-wide previews there. The built-in adapters already do. Element-level `preview(element, …)` needs nothing new: the element is in the frame.
- **React registrations.** `useKomoInspectable` and `useKomoDesignTokens` registrations made by the framed copy of the app are read through a small bridge that komo, inert inside the frame, publishes; prop edits go through the framed app's own state, and token previews apply to its roots. The React fiber adapter works too.
- **Limits.** `pickRoots` names your page's elements, so in Viewport mode all of the frame's body is pickable. Experimental move/resize geometry works in both modes: handles, snapping and structural moves map through the frame's scale.

`frame: { scale: true }` explicitly opts into shrinking the original viewport instead. A CSS transform changes visual rectangles without changing local layout dimensions, so arbitrary coordinate-sensitive host handlers may select the wrong value under scaling. This option requires host controls that already account for transforms; komo does not rewrite native events or browser prototypes. Use the default unscaled Frame or Floating for interactive pages that do not support scaling.

## Bots and CI

Give a bot its own revocable credential instead of sharing your login.

1. **Create a token.** Signed in with Google, open **Account → API tokens** in the komo toolbar, or `/account` on your komo server (`https://komo.offbr.co/account` when hosted). Name the token, pick an expiry, choose scopes, and optionally limit it to projects you own or have joined. The token is shown once; copy it into your secret manager. Guest sessions cannot create tokens.
2. **Set `KOMO_TOKEN`.** Export it in the bot's environment, or save it once with `printf %s "$KOMO_TOKEN" | komo login --token` (stdin only; a token passed as an argument is refused). Check it with `komo whoami`. `komo logout` removes saved credentials.
3. **Use the CLI as usual.** The project, endpoint, and origin come from `.komo/project.json` or the `KOMO_*` overrides.

Tokens start with `komo_pat_`, so secret scanners can find them. komo stores only a salted hash, and records create, revoke, and use events (use is logged at most once a minute per token).

| Scope | Allows |
| --- | --- |
| `comments:read` | List and read threads, `komo whoami`. |
| `comments:write` | Create threads, reply, edit, react, resolve, tag, move. |

A token acts as its owner, narrowed by its scopes and project list: it never passes an ownership check or private-project invitation its owner would fail, and it cannot manage tokens, projects, members, or webhooks. Credentials resolve in this order: `KOMO_TOKEN`, a token saved by `komo login --token`, then a browser login session.

**Rotate** by creating a replacement, updating the secret, confirming `komo whoami`, then revoking the old token. Prefer an expiry of 90 days or less. **Revoke** from **Account → API tokens** or `/account`; the token stops working on its next request (HTTP 401), and so does an expired one.

GitHub Actions:

```yaml
- name: Export open feedback
  env:
    KOMO_TOKEN: ${{ secrets.KOMO_TOKEN }} # a comments:read token, limited to this project
  run: npx --no-install komo comments prompt
```

Add the token under **Settings → Secrets and variables → Actions**. Self-hosted servers can set `KOMO_TOKEN_PEPPER` (a long random secret) to mix into stored hashes; changing it revokes every token.

## How it works

The package adds an isolated ShadowRoot to your site. Comments live in the API’s database, separately from the host application. Reviewers using the same project and scope see the same feedback. Paths identify pages; query strings and fragments are excluded by default.

Every new hosted workspace has a Google-authenticated owner. Guests can review but cannot create or own a workspace. Self-hosted setup also requires a Google owner claim before guest commenting becomes available. Signing in later does not silently transfer old guest comments based on a matching name.

Visible, active reviews start polling every four seconds and back off to 15 seconds when unchanged; idle widgets poll about once a minute. Hidden/offline tabs pause. Successful writes refresh immediately. Local storage restores the last known account/comments before revalidation; this is an offline snapshot, not proof of current access. Server authorization still checks every request. Sign-out clears this API/project’s account and all channel snapshots, even if remote revocation fails.

Sessions are isolated by API endpoint and project. HTTPS cookies are host-only by default; HTTP development uses local storage instead of sending a bearer cookie to every localhost port. `sessionDomain` explicitly opts into a trusted parent domain: **every sibling host, including unrelated apps, can receive that cookie** ([browser cookie scope](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)). Do not enable it for untrusted previews. Unrelated origins cannot share browser storage. If trusted preview gateways all proxy the same API, set the same `sessionEndpoint` canonical URL alongside the trusted `sessionDomain`; never reuse it across independent APIs. The komo website opts in for its own controlled previews.

Legacy project-only cookies are retired rather than trusted across API installations. Existing endpoint-scoped local sessions can migrate after server validation; cookie-only users may need to sign in once. Browser storage can be disabled independently; sessions remain usable in memory when neither cookie nor local storage is available. Client credentials and cached feedback are accessible to scripts on the embedding site—install only on sites you trust.

On localhost, the widget defaults to a separate `local` channel in the **configured API’s database**. It is not a browser-only database or a private workspace per developer. Project permissions still apply; use a separate project/API for isolated development data. Switching to Shared selects the configured shared branch. `pnpm dev:api` is different: it starts a local API with its own local database.

Projects default to link access. Owners can restrict feedback to invited Google accounts in Account → Project settings. The public project key identifies a workspace; it is not a credential. Approved origins control embedding, and private-project membership controls feedback access. Your website and repository permissions remain separate.

## Hosted setup

```sh
pnpm exec komo init
```

Mount the generated `komo.config.js` helper and open your app. Select **Connect** in the sidebar and sign in with Google. Review the detected production and preview addresses in the sidebar and add any others, one per line. Connecting approves the current site and those listed addresses, including production sites that have not launched. Remove a suggested address to leave it unapproved. Google credentials and account-wide management stay on the komo service; your site receives a session for its new project.

The CLI waits up to ten minutes and replaces the temporary setup configuration after connection. Keep the terminal open. Run `komo init` again after an interruption or expiry. The temporary polling secret stays in ignored `.komo/setup.json` and is never bundled into your site. A reload can resume commenting while the CLI finishes. Run `komo sync` before builds that use the generated helper.

If the app cannot run, use the hosted recovery link printed in the terminal, sign in, and select **Create project**. The CLI still writes the final configuration.

Approve your deployed website in **Approved sites**. komo detects deployment URLs when available; `--origin` can supply one. You can paste a full preview link—the modal extracts its site address. No DNS changes are required, including for `pages.dev` previews.

The setup page manages your account and approved sites. Leave comments on the website where you installed komo.

Return to `/setup?workspace=<project key>` to approve additional sites (up to ten). Only the Google owner can approve sites. The site address controls where that owner’s project can be embedded; it does not grant ownership of a domain or access to other projects. The API endpoint is the komo service, not your website URL.

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

Install komo in your project, then run:

```sh
pnpm exec komo init --self-host --origin https://preview.example.com
```

The CLI signs into Cloudflare, creates a dedicated D1 database, applies migrations, deploys a Worker, and prompts for the Google client secret through Wrangler. It writes the deployment configuration into `.komo/` so you own and can change it.

Create a Google OAuth **Web application** client with `openid profile email` access. Pass its public client ID with `--google-client-id`, or enter it when prompted. Add the callback printed after deployment:

```text
https://YOUR-WORKER.workers.dev/auth/google/callback
```

Open the owner-claim link printed by setup and sign in with Google. The one-time claim key is saved in `.komo/owner-key`, excluded from Git, and only its hash is deployed. Ownership cannot be claimed again. Keep the Google secret out of browser code and configuration files.

If setup is interrupted, run `pnpm exec komo deploy` to resume the existing deployment. Do not rerun initialization to create another database. The generated `.komo/wrangler.json` supports explicit allowed preview domains and single-label wildcard origins. Only allow domains whose scripts you trust.

Self-hosted storage belongs to your Cloudflare account; its service limits and charges apply. Use `komo deploy` for package migrations and `komo project export` for feedback backups. The hosted service and self-hosted installations use separate databases.

For a Node container with PostgreSQL (including Cloud Run), use the [Node self-hosting guide](./NODE.md). It uses the same `endpoint`, project configuration, and CLI commands without Wrangler. Existing Worker installations do not change.

## Configuration

### Client options

Pass these to `initKomo(config)` from `@hazem3500/komo` or `useKomo(config)` from `@hazem3500/komo/react`.

`YOUR_PROJECT_KEY` is a placeholder for a string. Hosted komo generates the key during `komo init`; copy that value. For self-hosting, use the project identifier configured on your server. Reuse the same key across sites that should share feedback.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `endpoint` | `string` | Hosted komo API | Comments API root; HTTPS outside localhost. |
| `project` | `string` | Required | Public project identifier returned by setup. |
| `repo` | `string` | Project key | Repository identifier, usually `owner/repo`. |
| `scope` | `"project" \| "branch"` | `"project"` | `"project"` shares comments; `"branch"` separates branches. |
| `branch` | `string` | Inferred by `komo sync` | Required only for branch scope. |
| `enabled` | `boolean` | `true` | Set from your build environment to restrict review UI. |
| `pageRoot` | `HTMLElement` | Sole existing content root, when present | Mounted element inside body to frame. Body and html are not supported. |
| `pickRoots()` | `() => Element[]` | All of body except komo | Extra roots, besides `pageRoot`, that can be picked for comments and Design mode. By default body-level portals such as dialogs and popovers are pickable; return `[]` to limit picking to `pageRoot`, or return your portal container to allow only it. |
| `frame.scale` | `boolean` | `false` | Reflow at the available width without scaling. Set `true` only for hosts whose interactive controls account for transformed coordinates; keeps the original viewport layout and scales its contents. |
| `frame.mode` | `"iframe" \| "transform"` | `"transform"` | `"iframe"` offers Viewport mode: the page in a same-origin iframe sized to the chosen viewport, with real media queries. Falls back in place with the reason when the page can't be framed. |
| `frame.defaultMode` | `"iframe" \| "transform"` | `"iframe"` | With `mode: "iframe"`, where Frame starts until the reviewer picks Viewport or In place. `"transform"` opens In place, so the second copy of the app loads only when asked for. A remembered choice wins. |
| `frame.iframeUrl(location)` | `(location: Location) => string` | The current URL | Same-origin URL to load in Viewport mode, e.g. a preview route. Pair it with `page(location)`. Pass a stable function. |
| `frame.include(element)` | `(element: HTMLElement) => boolean` | Fixed portals, including fixed descendants of static wrappers | Keep body-level dialogs, overlays and toasts inside Frame. Host transforms, animations and focus are preserved without moving portal DOM. Return `true` to map a whole body child through Frame or `false` to exclude its subtree; komo's own host is never framed. |
| `isolateEvents` | `boolean` | `true` | Keep komo's events out of the host page. See [Host events](#host-events). |
| `source(element)` | `(element: Element) => string \| undefined` | Anchor metadata | Return a repository-relative source path. |
| `anchorTarget(element)` | `(element: Element) => Element \| undefined` | Declared owners and stable semantic cards | Optional persistent ancestor for comment capture. Offsets stay relative to this owner when hover-only children disappear. Owners cannot cross a dialog/popover boundary. Design inspection continues to target the exact element. |
| `sourceUrl(source, branch)` | `(source: string, branch: string) => string` | GitHub viewer | Custom source or editor link. |
| `page()` | `() => string` | `location.pathname` | Canonical page identifier. |
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

The returned controller has `open()`, `close()`, `comment(element)`, `refresh()`, and `destroy()`. Repeated initialization returns the current controller; destroy it before switching projects. SSR returns a no-op controller. In React, use the `useKomo` hook. With Astro view transitions, destroy before swapping the document and initialize after navigation.

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

Shortcuts never fire while focus is in a field or editable region, on the page or in komo. Bare letters follow the keyboard layout; with a modifier, komo also matches the physical key, so Caps Lock, other layouts, and macOS Alt characters still work. Bare letters keep working while focus is on komo's own buttons, sidebar, and panels.

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

komo renders in a shadow root, so page listeners see its events as coming from komo's host `<div>`. By default komo stops them at that element:

- **Typing.** `keydown`, `keyup` and `keypress` from komo's inputs don't reach `document` or `window`, so app shortcuts (such as `react-hotkeys-hook` or a custom `keydown` listener) don't fire while someone writes a comment. Keys pressed on komo's buttons still reach the page.
- **Modals.** `pointerdown`, `mousedown`, `touchstart`, `touchmove`, `touchend`, `click`, `wheel`, `focusin` and `focusout` from komo's UI don't reach page listeners. An open Radix or similar dialog doesn't treat komo as an outside interaction, so it doesn't close, take focus back from the composer, or block the sidebar's scroll.
- **Focus traps.** When focus moves from the page into komo, komo stops that `focusout` for `document` listeners added after komo mounted, such as Radix's FocusScope.
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

When a signed-in reviewer starts a comment, komo captures the commented element in the page, in Frame's viewport iframe when it shows the page. Capture needs a server that supports [element snapshots](#element-snapshots); guests capture only when the project allows guest snapshots. The capture code loads on demand. Each kind uploads as its own file once the thread is saved and never holds up the comment: if an upload fails, the comment still posts and komo logs a note to the console.

- **`image`** is a WebP image of the element with 16px of padding, at most 1200px wide and `maxBytes` in size (250,000 by default). Quality steps down from 0.8, then the size. komo draws the element itself, with no extension or third-party library: it copies the element with its computed styles into an SVG `foreignObject` and draws that to a canvas, after `document.fonts.ready`. An image from another origin without CORS would taint the canvas, so komo saves the HTML instead, starting with a comment that says why.
- **`html`** is the element's `outerHTML`, trimmed to about 20 KB. Scripts, styles and inline event handlers are removed, and long attribute values and text are cut short.
- **Redaction.** Input, textarea and password values never appear in either snapshot. `redact(element)` returning true replaces that element's text with `[redacted]`.
- **Privacy.** komo's own UI is never captured. Add `data-komo-no-snapshot` to any element to keep it out: a comment inside it captures nothing, and inside a captured element it shows as an empty box.

Limits: the image shows the element at the top of its scroll position and up to 2,000px tall. It leaves out iframes, shadow DOM contents, `<use>` references to sprites outside the element, and web fonts served from another origin without CORS, which fall back to a local font. A target with more than 3,000 elements gets no image.

### CLI

| Command / flag | Purpose |
| --- | --- |
| `komo init` | Create a Google-owned hosted workspace. |
| `komo init --self-host` | Create your Worker and D1 database. |
| `komo sync` | Regenerate the public client helper. Run before dev/build. |
| `komo deploy` | Resume or redeploy generated self-host infrastructure. |
| `--origin URL` | Optional website address. Otherwise detected from Cloudflare Pages, Vercel, or Netlify; defaults to localhost. |
| `--endpoint URL` | Override hosted API or self-host deployment URL. |
| `--repo OWNER/REPO` | Override Git detection. |
| `--branch-scope` | Opt into separate comments per branch. |
| `--google-client-id ID` | Self-hosted Google OAuth client ID. |
| `KOMO_BRANCH` | Explicit build-time branch override. |

Branch detection also supports `CF_PAGES_BRANCH`, `WORKERS_CI_BRANCH`, `VERCEL_GIT_COMMIT_REF`, `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, and `BRANCH`, followed by the Git checkout.

### Backend

`PROJECTS` is a JSON object keyed by public project ID. Each entry supports:

| Option | Default | Purpose |
| --- | --- | --- |
| `repo` | Required | Repository allowed for the project. |
| `origins` | Required | Exact allowed origins; self-host supports single-label wildcards. |
| `allowGuests` | `true` | Enable named guest sessions. |
| `allowGuestResolve` | `true` | Allow guests to resolve threads. |
| `requireOwner` | `true` in generated setups | Block reviewing until Google ownership is claimed. Legacy static projects remain compatible. |
| `bootstrapHash` | Generated | SHA-256 owner-claim key hash. |
| `suspended` | `false` | Disable a project. |
| `writesPerDay` | `10000` self-hosted | Daily write-request allowance; hosted uses 500. |
| `allowGuestSnapshots` | `false` | Let guest sessions attach element snapshots to their own threads. |
| `maxSnapshotBytes` | `52428800` (50 MiB) | Total snapshot bytes stored per project; hosted uses 5 MiB. |

Worker bindings: `DB` (D1), optional `EDGE_LIMIT` (rate limiter). Variables: `PROJECTS`, `GOOGLE_CLIENT_ID`, optional `GITHUB_CLIENT_ID`, `KOMO_HOSTED="true"` to enable hosted provisioning, and `KOMO_PAUSED="true"` to pause service requests. Store `GOOGLE_CLIENT_SECRET` and optional `GITHUB_CLIENT_SECRET` as Worker secrets. Hosted configuration uses an hourly cleanup trigger. `/health` remains available while paused.

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

If an element disappears, the original page position remains available. komo cannot inspect closed shadow roots, canvas internals, or cross-origin iframe content. It does not invent source line numbers.

Choose **Copy all comments for agent** to copy open feedback across the configured scope; the sidebar copy button includes open comments on its current page. Resolved threads and deleted messages are excluded. Copying does not send anything to an agent.

## Development

Requires Node.js 22+, a modern browser, and Cloudflare access for deployment.

```sh
pnpm --filter @hazem3500/komo typecheck
pnpm --filter @hazem3500/komo test
pnpm --filter @hazem3500/komo build
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

Extracted from the komo product at source commit `f57f3521` in the Cloudflare marketing workspace. Product development now lives in [tjcages/komo](https://github.com/tjcages/komo). Third-party credits are preserved in each package’s NOTICE.md.


## Project management

Sign in as the Google owner with `npx @hazem3500/komo login`. In the widget, open **Account → Project settings** to manage access, download feedback, clear resolved threads, or delete a hosted project.

Self-hosted Node deployments can also send signed webhooks for new comments, replies, and resolved threads. In **Project settings → Comment webhooks**, enter an HTTPS endpoint and a signing secret of at least 32 characters. Komo encrypts the secret at rest using the `KOMO_WEBHOOK_KEYS` environment variable; generate a 32-byte key with `openssl rand -base64 32` and configure a JSON keyring such as `{"current":"2026-10","keys":{"2026-10":"BASE64_KEY"}}`. Keep the keyring in your secret manager. Cloudflare Worker deployments currently disable webhook delivery because they do not yet have the DNS-pinning egress transport used by the Node adapter.

Each request includes `X-Komo-Event`, `X-Komo-Delivery`, and `X-Komo-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`. Verify the HMAC over `<timestamp>.<raw-request-body>` and reject timestamps outside your replay window. Treat `X-Komo-Delivery` as the idempotency key. Komo sends once without retries, does not follow redirects, and never logs secrets or response bodies. Master-key rotation requires replacing each project's signing secret and updating its receiver before removing the old key from the keyring.

```sh
npx @hazem3500/komo project info
npx @hazem3500/komo project access --access private
npx @hazem3500/komo project invite --email teammate@example.com
npx @hazem3500/komo project export --out comments.json
```

On localhost, the widget defaults to a separate `local` channel in the **configured API’s database**. It is not a browser-only database or a private workspace per developer. Project permissions still apply; use a separate project/API for isolated development data. Switching to Shared selects the configured shared branch. `pnpm dev:api` is different: it starts a local API with its own local database.

Projects default to link access. Private projects require Google sign-in and owner-approved membership for reads and writes, including the CLI. Invitations match a verified email address, expire after seven days, and are single-use. Members can review; only owners manage access, export, import, or delete. Google accounts used before this release should sign out and back in to verify their email. Repository access is separate.

### Quota recovery and migration

Export first, then permanently clear resolved threads with `npx @hazem3500/komo project clear-resolved --confirm PROJECT_KEY`. This reclaims stored-comment quota. In the sidebar’s Resolved view, owners can also use the trash button to permanently delete only the currently filtered threads and their replies after confirmation. `project delete --confirm PROJECT_KEY` permanently deletes a hosted project and frees its project slot. Both are owner-only. The account panel also offers these actions with typed confirmation.

To migrate, export from your source, set up a destination using `npx @hazem3500/komo init --self-host` in another directory, then sign in there and run:

```sh
npx @hazem3500/komo project import --file /path/to/comments.json
```

Exports include threads, replies, reactions, element snapshots, anchors, and historical profiles across all pages and branches, including resolved feedback. They exclude sessions, credentials, verified emails, and membership. Imports use the destination repository and keep imported authors unverified. Retrying the same export is safe; existing imported records are not overwritten. Destination quotas still apply. Export retries are required if feedback changes while downloading. Keep export files private.

Upgrade self-hosted deployments with `npm install @hazem3500/komo@latest` then `npx @hazem3500/komo deploy`; the CLI applies bundled database migrations before redeploying. Self-hosted project removal is controlled by your Worker configuration. Account-wide data requests remain available at ty@offbr.co.

Without `pageRoot`, a sole existing content element with a layout box enables Frame. Script and style elements do not count as content roots. Multiple roots or `display: contents` use Floating; pass a suitable existing app container for Frame.

The `@hazem3500/komo/server` export loads built ESM in Node and includes Worker handler types. Wrangler selects the original TypeScript through the `workerd` condition; keep `nodejs_compat` enabled. Package metadata is available at `@hazem3500/komo/package.json`.

### Experimental page-element resize and move

Both are **off by default**. Opt in explicitly in the public configuration:

```ts
initKomo({
  // ...your existing endpoint/project/repo/branch options
  design: { experimentalGeometry: true },
});
```

This loads geometry tools lazily in Design mode. A supported selection gets a crisp 1px outline on its border box and design-tool handles: four corners and four edge midpoints, 7px white squares with a 1px border in the selection color, centred on the outline and aligned to device pixels. Each sits in a 12px hit area that reaches outward, so the body stays draggable and double-click still edits text. Hovering a handle fills it, and each handle has its resize cursor. Only applicable handles appear: aspect-locked boxes get corners only, and an axis pinned by equal `min-`/`max-` sizes has no handles. Sides under 40px drop their midpoint squares, and boxes under 24px draw no squares at all; their edges and corners still drag from just outside. Handles, outline and the size chip keep their on-screen size at any Frame zoom.

Handles show only when the pointer is on or near the selection, while resizing or moving, or when the selection has keyboard focus; otherwise only the outline shows. They fade out (120ms, none with reduced motion) and leave a faint outline while the pointer is over the Design panel, while a field is focused or scrubbed, and while a select or color picker is open. During a select's hover preview the outline goes too. Before (B) hides the selection.

**Hide the overlays.** In Design mode the comments visibility shortcut (**H** by default, `shortcuts.visibility`) hides every Design overlay: the selection, handles, hover outline, pins and move feedback. A tap toggles them and holding the key peeks until it's released; letting go of any key in the combo, or the window losing focus, ends the peek. The eye button in the inspector header (**Hide selection** / **Show selection**) does the same. Shortcut help lists the key.

**Selection color.** Outlines, handles, the size chip, the hover outline and move feedback use a canvas selection color, separate from komo's panel accent. It defaults to `#0c93f5`, a design-tool blue with 3:1 contrast on white and near-black. On a background close to it, the selection turns magenta. Set it with `design: { selectionColor: "#7c3aed" }` (with experimental geometry), or in any case from CSS with the `--komo-selection` custom property on komo's host element (`[data-branch-comments]`).

- **Drag** any handle. A W × H chip shows below the selection. The moving edge snaps to the parent's content edges and centre and to siblings' edges across the flow within 4px, with a thin guide; hold **Alt/Option** to resize freely. **Shift** on a corner keeps the box's proportions. Escape cancels.
- **Keyboard:** press **M** on the canvas (or Tab) to focus the selection, then **Ctrl+arrows** (or **⌘+arrows** on macOS, where Ctrl+arrows switch spaces) to resize from the bottom-right by one local CSS pixel, Shift for ten; snapped grid items step one track. Escape returns to the canvas, where plain arrows and **Alt+arrows** keep their Design meaning (sibling and parent/child selection). Each step is announced politely, for example "Resized: width 241px".
- Minimum dimensions are 16 CSS pixels, or the border and padding footprint when larger. Each completed gesture is one chronological Undo. The panel's Layout fields (Width, Height and the rest) show the new values as soon as a gesture commits, and again after Undo, Reset and Before/After. A field edit after a resize joins the same history; the proposal then reports the field's net value instead of the superseded resize.

**Move** changes an element's place among other elements; it is never free-form:

- **Drag** the selection itself (the cursor shows `move` over it). A press only becomes a drag after 4px, so a click still selects and a double-click still edits text. While dragging, an insertion line sits between siblings along the parent's flow (stacked or side by side, including flex rows, columns and grid order), a dashed outline marks a container you would drop *into*, and a chip names the spot, for example "After Button “Month”" or "Into div#panel · position 2". The nearest valid target wins: never into text runs, `display: contents` wrappers, form or replaced elements, komo's own UI, or the element itself. Escape cancels.
- Until the first move, the Layout section shows a short hint: "Drag to reorder · M, then ⌥↑/⌥↓".
- **Keyboard**, on the focused selection: **Alt/⌥+↑** moves before the previous sibling and **Alt/⌥+↓** after the next one (← and → work too); **Alt/⌥+Shift+↑** moves out, after its parent; **Alt/⌥+Shift+↓** moves into the previous sibling as its last child. Each move is announced, for example "Moved before List item “One”". **⌘Z / Ctrl+Z** (or the panel's Undo) undoes moves one at a time, from the focused selection or the canvas; Design mode has no redo.
- **Preview without moving nodes:** the page's renderer keeps owning its DOM. komo hides the original in place (`display: none`) so the layout reflows, and inserts an inert, `aria-hidden` stand-in with the original's computed styles inlined at the destination. The stand-in follows renderer commits (text, style and sibling changes) and is removed on Before, Undo, Reset, leaving Design mode and destroy, which restore the original exactly.
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

Supported targets are HTML boxes and SVG roots in normal flow, flex or grid, or relatively, absolutely, fixed or sticky positioned, through positive axis-aligned 2D scale chains and normal, reflow or explicitly scaled Frames. Pointer deltas are converted to local CSS pixels, and scroll during pointer capture is accounted for. Only boxes that can't be previewed are excluded, each with its own reason in the panel and a **Select parent** action that picks the nearest resizable ancestor: inline text boxes, SVG shapes inside an SVG, `display: contents` or unrendered elements, table cells and rows, boxes split across lines or columns, rotated/skewed/3D/mirrored chains, and geometry animations in progress. A running animation only counts when it moves or sizes the box and komo did not start it; it is named after 400ms, as a dot by the Layout title, so brief host transitions never show and the panel never reflows. This is deliberately not a universal layout editor.
