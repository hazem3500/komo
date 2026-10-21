// Design-system adapters: how a site tells Design mode about its tokens,
// themes, and components. komo never guesses from computed styles or reads
// framework internals; the app answers through these adapters. The one
// exception is opt-in: `@hazem3500/komo/adapters/react-fiber` is an adapter an app
// can install to read React's private fields.
//
//   initKomo({ design: { tokens, themes, components } })
//
// Every adapter is optional. Without `tokens`, Design mode keeps using the
// CSS custom properties registered with `useKomoDesignTokens`.

/** DTCG-style token types. Composite types are listed but previewed only as a whole. */
export type DesignTokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "shadow"
  | "typography"
  | "duration"
  | "number"
  | "other";

/** One token, with aliases already resolved by the adapter. */
export interface DesignToken {
  /** Stable dot path, e.g. "color.text.primary". This is what proposals record. */
  path: string;
  type: DesignTokenType;
  /** Resolved value for the theme passed to `list()`, e.g. "#1f1f1f" or "8px". */
  value: string;
  /** CSS properties this token may set on an element, e.g. ["color"]. Used to suggest tokens. */
  properties?: string[];
  /** Display name in the picker, e.g. "Primary"; defaults to the last path segment there and to the path elsewhere. */
  label?: string;
  /** Group heading in the picker, e.g. "Text", "Background", "Spacing". */
  group?: string;
  /** One line shown under the token in the picker, e.g. "Body copy and headings". */
  description?: string;
  /**
   * The adapter's own handle for the token: a CSS variable ("--color-brand"), a
   * utility class ("text-primary"), etc. Shown to reviewers and agents.
   */
  ref?: string;
  /** Interaction states the token carries itself, e.g. ["hover", "active", "disabled"]. */
  states?: string[];
  /**
   * Path of the token this one references, e.g. "color.gray.900" for a
   * `color.text.primary` declared as `var(--color-gray-900)`. The Tokens view
   * offers to repoint an alias to another token.
   */
  alias?: string;
  /** The CSS custom property that carries the token, e.g. "--color-surface". */
  cssVariable?: string;
  /**
   * Convert an edited value into what `cssVariable` holds, e.g. "#131213" to
   * "19 18 19" for a variable used as `rgb(var(--color-surface))`. `value` and
   * the editor keep the readable form; previews write the converted one.
   */
  toCss?(value: string): string;
}

/**
 * One token value previewed from the Tokens view. `theme` is the theme key the
 * edit applies to: the current option ids of every switchable axis, joined with
 * "+" ("dark", "docs+dark"); absent without theme axes. With `alias`, the token
 * is repointed to that token path, and `value` is the target's current value.
 */
export interface TokenValueChange {
  path: string;
  value: string;
  theme?: string;
  alias?: string;
}

/** A property that uses a token. */
export interface TokenRef {
  path: string;
}

/** A property whose value doesn't come from a token; `value` is what the page uses. */
export interface OffToken {
  offToken: string;
}

export type TokenUsage = TokenRef | OffToken;

export interface TokenAdapter {
  /** Stable id recorded on proposals, e.g. "css-variables" or "tailwind". */
  id: string;
  /** Every token, with values for `theme` (the current theme state when omitted). */
  list(theme?: ThemeState): DesignToken[] | Promise<DesignToken[]>;
  /**
   * Which token each CSS property of `element` uses, or its off-token value.
   * Return only properties the app can vouch for; komo shows nothing for the rest.
   * A path declares a semantic binding, including a token rendered as a concrete
   * inline value. Report custom literals as offToken, even when they match a token.
   */
  resolve(element: Element): Record<string, TokenUsage> | Promise<Record<string, TokenUsage>>;
  /**
   * Preview `token` for `property` on `element` until the returned undo runs,
   * e.g. by swapping a utility class or setting a CSS variable. Without it,
   * komo previews by setting the token's resolved value inline.
   */
  preview?(element: Element, property: string, token: DesignToken): () => void;
  /**
   * How a developer or agent should apply the change in source, e.g.
   * 'Replace class "text-secondary" with "text-primary"'. Recorded on proposals.
   */
  describe?(element: Element, property: string, from: TokenUsage, to: DesignToken): string;
  /**
   * Preview token values page-wide until the returned cleanup runs; the cleanup
   * restores the page exactly. komo runs the previous cleanup, then passes the
   * full current change set, on every edit and theme switch. It also cleans up
   * for Before, cancel, reset, closing Design mode and destroy. `theme` is the
   * current theme key: an adapter that cannot scope a value to its theme applies
   * only the changes for it. Without this method, the Tokens view records edits
   * as proposals, labelled "No live preview".
   */
  previewValues?(changes: TokenValueChange[], theme?: string): () => void;
  /**
   * For token sets that change at runtime: call `onChange` when `list()` would
   * return something different, and stop when the returned function runs. komo
   * subscribes once Design mode shows tokens; on each call it lists again and
   * refreshes chips, proposals and open pickers. Without it, `list()` runs once
   * per theme state.
   */
  subscribe?(onChange: () => void): () => void;
}

/** Theme state: axis id → option id, e.g. { mode: "dark", product: "docs" }. */
export type ThemeState = Record<string, string>;

export interface ThemeOption {
  id: string;
  label?: string;
}

/**
 * One independent theme dimension reviewers can flip, such as light/dark. The
 * Design panel shows a one-click switch for a single two-option axis, and a compact
 * menu for more options or axes; axes with fewer than two options are left out.
 */
export interface ThemeAxis {
  id: string;
  label?: string;
  options: ThemeOption[];
  /** The option currently applied to the page. */
  current(): string;
  /** Switch the page to `optionId`. komo restores the original option when Design mode closes. */
  apply(optionId: string): void;
  /** Notify when the host changes this axis outside the inspector, including state held outside the DOM. */
  subscribe?(listener: () => void): () => void;
}

export type ComponentPropValue = string | number | boolean | null;

/** The declared, safe subset of a component's runtime props. */
export interface ComponentProperty {
  name: string;
  kind: "string" | "number" | "boolean" | "enum" | "unsupported";
  required: boolean;
  values?: Array<string | number | boolean>;
  typeLabel: string;
}

export interface ComponentEditor {
  schema: ComponentProperty[];
  read(): Record<string, string | number | boolean | undefined>;
  /** Apply through the host renderer/state callback, preserving other props. */
  apply(next: Record<string, string | number | boolean | undefined>): void;
  /** Stop retaining these overrides after the inspector restores their baseline values. */
  release?(properties: string[]): void;
  /** Notify after the renderer commits, so computed controls follow the rendered preview. */
  subscribe?(listener: () => void): () => void;
  /** False when the original component unmounts; never retarget another instance. */
  available?(): boolean;
  /** Current root of this same mounted instance, proven by its renderer; never a selector lookup. */
  currentElement?(): Element | null;
}

/** What the app knows about the component that renders an element. */
export interface ComponentIdentity {
  /** Display name, e.g. "Button". Prefer the design-system or Figma Code Connect name. */
  name: string;
  /** Props worth showing, e.g. { variant: "secondary", size: "md" }. */
  props?: Record<string, ComponentPropValue>;
  /** Source location, e.g. "src/components/Button.tsx:12". */
  source?: string;
  /** The component's root element; may be an ancestor of the picked element. */
  element: Element;
}

export interface ComponentAdapter {
  /**
   * The nearest component for `element`, or null. Apps may use any strategy,
   * including reading their framework's internals; komo's core never does.
   * Works alongside `useKomoInspectable`, which still provides editable props
   * and always takes precedence over what an adapter identifies.
   */
  identify(element: Element): ComponentIdentity | null;
  /**
   * Read-only panel content for an identity this adapter returned, or null.
   * The Design panel shows it under the picked element's other controls.
   */
  panel?(identity: ComponentIdentity): HTMLElement | null;
  /** Optional runtime preview editor. Source files are never changed. */
  editor?(identity: ComponentIdentity): ComponentEditor | null;
}

export interface DesignSystem {
  /** Opt in to experimental, reversible page-element previews: Figma-style resize handles and moves between elements. Default false. */
  experimentalGeometry?: boolean;
  /**
   * Canvas selection color for Design mode's hover and selection outlines, resize handles and move
   * feedback, e.g. "#0c93f5" (the default) or "rebeccapurple". The panel keeps komo's accent. It
   * applies with `experimentalGeometry`; the `--komo-selection` custom property on komo's host
   * element sets it from CSS either way.
   */
  selectionColor?: string;
  tokens?: TokenAdapter;
  themes?: ThemeAxis[];
  components?: ComponentAdapter;
}

/**
 * Machine-readable record of a Design mode proposal, versioned so the CLI and
 * agents can apply it. Comments carry it as human-readable text: besides the
 * changes, the first proposal section names its context in lines such as
 * "Theme: mode=dark, density=compact", "Component: PromoCard (src/card.tsx:19)"
 * and 'Props: tone="calm", compact=false', which fill `theme` and
 * `target.component`. Comments without those lines still parse.
 */
export interface DesignEdit {
  komo: "design-edit";
  version: 1;
  target: {
    /**
     * Selector that matched exactly the edited element at proposal time: a
     * :nth-of-type path from body or a unique id. The comment's anchor
     * (scoped path, text and context) re-finds the element if the page changes.
     */
    selector: string;
    component?: Omit<ComponentIdentity, "element">;
  };
  /** Theme state the proposal was made in. */
  theme?: ThemeState;
  /** Token adapter id, when token changes are present. */
  tokens?: string;
  changes: DesignEditChange[];
}

export type DesignEditChange =
  /** Use a different token for a property. `apply` is the adapter's `describe()` text. */
  | { kind: "token"; property: string; from: TokenUsage; to: TokenRef; apply?: string }
  /**
   * Change a shared token's value for everyone using it. `theme` is the theme
   * key it applies to ("dark", "docs+dark"); absent means every theme. A
   * repointed alias records token references, e.g. "{color.gray.700}".
   */
  | { kind: "token-value"; path: string; theme?: string; from: string; to: string }
  /**
   * Change a component prop (from `useKomoInspectable` or the component adapter).
   * `token` is the style token path the new value binds, e.g. "color.brand"
   * for var(--color-brand); absent for custom values. Optional, so v1 edits
   * without it stay valid.
   */
  | { kind: "prop"; name: string; from: ComponentPropValue | undefined; to: ComponentPropValue | undefined; token?: string }
  /** Change text content. */
  | { kind: "text"; from: string; to: string }
  /** Raw CSS fallback when no token or prop applies. */
  | { kind: "css"; property: string; from: string; to: string }
  /**
   * How an experimental move or resize was previewed. Moves record the delta in
   * CSS px (`translate`, or `offset` when host styles override translate);
   * resizes record the property and its values (`size`, `flex-basis` when the
   * flex basis carries the size, `span` for grid track spans). `effects` lists
   * side effects such as "sets flex-basis: 240px". The matching `css` changes
   * carry the exact declarations.
   */
  | {
      kind: "geometry";
      mode: "translate" | "offset" | "size" | "flex-basis" | "span";
      layout?: string;
      dx?: number;
      dy?: number;
      property?: string;
      from?: string;
      to?: string;
      effects?: string[];
    }
  /**
   * A structural move previewed with experimental geometry: put the element
   * (`target`, a selector) at `to.index` among `to.parent`'s element children,
   * counted from 0 without the element itself. `position` says whether it landed
   * before or after a sibling, or inside a container. Apply it in source by
   * moving the element's markup; nothing moved in the page.
   */
  | {
      kind: "move";
      target?: string;
      label?: string;
      from: DesignMovePlace;
      to: DesignMovePlace & { position: "before" | "after" | "inside" };
    };
/** A parent (selector, reviewer label, component name) and an index among its element children. */
export interface DesignMovePlace {
  parent: string;
  index: number;
  label?: string;
  component?: string;
}
