import { popupBounds, popupStyles, watchPopup } from "./design-popup.js";
import { el } from "./dom.js";
import { tokensFor, tokenTitle } from "./token-adapter.js";
// Design mode's token picker: a searchable listbox of `DesignToken`s with a
// preview per type, sticky group headings, a single current-token indicator and
// the field's relevant tokens by default. It is driven only by token data, so
// any adapter gets the same picker. Loaded on demand, the first time a token
// field opens. Comments stay out of the CSS string: they would ship.
import type { DesignToken } from "./design-system.js";

/** One theme option's resolved values, path → value, for optional details. */
export interface ThemeValues {
  label: string;
  values: ReadonlyMap<string, string>;
}

export interface TokenPickerOptions {
  /** The control that opened the picker; focus returns to it. */
  trigger: HTMLElement;
  /** Every token the picker may offer. */
  tokens: readonly DesignToken[];
  /** The field's CSS property: tokens whose `properties` include it are shown by default. */
  property: string;
  /** The popup's header; the field's label or the property by default. */
  title?: string;
  /** Path of the token the field uses now; equal literals leave this unset. */
  current?: string;
  /** Values per theme option for full details; swatches show the current theme. */
  themes?: () => Promise<ThemeValues[]> | ThemeValues[] | undefined;
  /** Transient preview; its undo runs before another preview, cancellation or a commit. */
  onPreview?(token: DesignToken): () => void;
  onSelect(token: DesignToken): void;
  custom?: {
    value: string;
    field?: import("./design-panel.js").Field;
    onPreview(value: string): () => void;
    onSelect(value: string): void;
    /** Live editors keep values while the popup stays open; the field holds them as one pending edit. */
    onCommit?(value: string): void;
    /** The popup closed: the pending edit becomes one history entry. */
    onDone?(): void;
    /** Escape: the pending edit is undone and leaves no history. */
    onCancel?(): void;
  };
}

const css = `.komo-tokens{display:flex;flex-direction:column;overflow:hidden}.komo-tokens__head{flex:none;display:flex;align-items:center;gap:4px;min-height:36px;padding:0 12px;color:#f1efeb;font-weight:500}.komo-tokens__back{display:grid;place-items:center;width:20px;height:20px;margin-left:-6px;padding:0;border:0;border-radius:5px;background:none;color:#898680;cursor:pointer}.komo-tokens__back:hover{background:#ffffff14;color:#f1efeb}.komo-tokens__back svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.komo-tokens__bar{flex:none;display:flex;gap:4px;padding:0 8px 8px;background:#232323;border-bottom:1px solid #ffffff0d}.komo-tokens__bar input{flex:1;min-width:0;height:28px;box-sizing:border-box;margin:0;padding:0 8px;border:0;border-radius:6px;outline:0;box-shadow:none;background:#ffffff0a;color:#f1efeb;font:inherit}.komo-tokens__bar input:focus{outline:0;box-shadow:inset 0 0 0 1px #bda6ef}.komo-tokens__widen{flex:none;height:28px;margin:0 4px 4px;padding:0 8px;border:0;border-radius:6px;background:none;color:#898680;font:inherit;text-align:left;cursor:pointer}.komo-tokens__widen:hover,.komo-tokens__more:hover{background:#ffffff0f;color:#f1efeb}.komo-tokens__more{flex:none;display:flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border:0;border-top:1px solid #ffffff0d;background:none;color:#d9d6d1;font:inherit;text-align:left;cursor:pointer}.komo-tokens__more b{margin-right:auto;font-weight:500}.komo-tokens__more i{flex:none;width:14px;height:14px;border-radius:3px;box-shadow:inset 0 0 0 1px #ffffff26;background:linear-gradient(var(--c),var(--c)),repeating-conic-gradient(#ffffff40 0 25%,#ffffff12 0 50%) 0 0/8px 8px}.komo-tokens__more span{max-width:50%;overflow:hidden;color:#898680;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}.komo-tokens [role=listbox]{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 4px 4px}.komo-tokens small:not(.komo-select *){position:sticky;top:0;z-index:1;display:block;padding:8px 8px 4px;background:#232323;color:#77736f;font-size:10px;font-weight:500}.komo-tokens [role=option]:not(.komo-select *){display:grid;grid-template-columns:20px minmax(0,1fr) 14px;align-items:center;gap:4px 8px;box-sizing:border-box;min-height:32px;padding:6px 8px;border-radius:7px;cursor:pointer}.komo-tokens [data-active]{background:#ffffff14;color:#f1efeb}.komo-tokens [aria-selected=true] .komo-tokens__name{color:#e6dcfb}.komo-tokens__name{grid-column:2;min-width:0;font-weight:500}.komo-tokens__name>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.komo-tokens__sub{grid-column:2/4;display:none;min-width:0;overflow:hidden;color:#77736f;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.komo-tokens [data-active] .komo-tokens__sub{display:block}.komo-tokens__check{grid-column:3;justify-self:center}.komo-tokens [aria-selected=true] .komo-tokens__check{width:7px;height:3.5px;margin-top:-3px;border:solid #bda6ef;border-width:0 0 1.5px 1.5px;rotate:-45deg}.komo-tokens__pv{display:flex;align-items:center;height:16px;overflow:hidden}.komo-tokens__sw{display:flex;width:16px;height:16px;border-radius:4px;overflow:hidden;background:repeating-conic-gradient(#ffffff40 0 25%,#ffffff0d 0 50%) 0 0/8px 8px;outline:1px solid #ffffff1f;outline-offset:-1px}.komo-tokens__sw>span{flex:1}.komo-tokens__sw>[data-unresolved]{display:grid;place-items:center;background:#393939;color:#b6b1aa;font-size:10px}.komo-tokens__dim{height:4px;min-width:2px;border-radius:2px;background:#bda6ef}.komo-tokens__corner{width:12px;height:12px;box-sizing:border-box;border:solid #bda6ef;border-width:1.5px 0 0 1.5px}.komo-tokens__shadow{width:16px;height:12px;margin-left:2px;border-radius:3px;background:#f1efeb}.komo-tokens__ag{color:#f1efeb;font-size:13px;line-height:1;white-space:nowrap}.komo-tokens__empty{padding:12px 8px;color:#77736f}@media (pointer:coarse){.komo-tokens{font-size:13px}.komo-tokens [role=option]:not(.komo-select *){min-height:44px}.komo-tokens__bar input,.komo-tokens__bar button{height:36px}}`;

const modeStyles = `.komo-tokens__custom{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.komo-tokens__custom>.komo-custom{flex:none}.komo-tokens__custom .komo-custom__body{overflow:visible}.komo-tokens [hidden]{display:none!important}.komo-tokens button:focus-visible,.komo-tokens [role=listbox]:focus-visible{outline:1px solid #bda6ef;outline-offset:-2px}.komo-tokens[popover]{position:fixed;inset:auto;margin:0;border:0;padding:0}`;
/** Headers for properties without a field label. */
const titles: Record<string, string> = { font: "Typography", "box-shadow": "Shadow", "text-shadow": "Text shadow" };
const styled = new WeakSet<Node>();
/** Rows built per batch; the rest are built as the list scrolls or the keyboard reaches them. */
const BATCH = 60;
let count = 0;
let open: { trigger: HTMLElement; close(focus?: boolean): void; refresh(options?: TokenPickerOptions): void } | undefined;

/** The row's name: `label`, else the last path segment, since the group heading names the rest. */
export function tokenLabel(token: DesignToken): string {
  return token.label || token.path.slice(token.path.lastIndexOf(".") + 1) || token.path;
}

/** Pixels for a length, for preview sizes only; rem and em count 16px. */
function pixels(value: string): number | undefined {
  const match = /^(-?[\d.]+)(px|r?em)?$/.exec(value.trim());
  return match ? parseFloat(match[1]) * (match[2] ? (match[2] === "px" ? 1 : 16) : 1) : undefined;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A small visual for the token's type: swatch, bar, corner, shadow card or "Ag". */
export function tokenPreview(token: DesignToken): HTMLElement {
  const box = el("span", "komo-tokens__pv");
  box.setAttribute("aria-hidden", "true");
  const part = (name: string) => {
    const node = el("span", `komo-tokens__${name}`);
    box.append(node);
    return node;
  };
  const value = token.value ?? "";
  const { type } = token;
  if (type === "color") {
    const swatch = part("sw");
    const color = el("span");
    if (resolvedColor(value)) color.style.background = value;
    else { color.dataset.unresolved = ""; color.textContent = "?"; }
    swatch.append(color);
  } else if (type === "dimension" || type === "letterSpacing") {
    const size = pixels(value);
    if (size === undefined) return box;
    const radius = /radius/.test(`${token.path} ${token.properties?.join(" ")}`);
    const node = part(radius ? "corner" : "dim");
    if (radius) node.style.borderTopLeftRadius = `${clamp(size, 0, 12)}px`;
    else node.style.width = `${clamp(size / 2, 2, 24)}px`;
  } else if (type === "shadow") part("shadow").style.boxShadow = value;
  else if (type === "typography" || type === "fontWeight" || type === "fontFamily") {
    const sample = part("ag");
    sample.textContent = "Ag";
    if (type === "typography") {
      sample.style.font = value;
      sample.style.fontSize = "13px";
      sample.style.lineHeight = "1";
    } else if (type === "fontWeight") sample.style.fontWeight = value;
    else sample.style.fontFamily = value;
  }
  return box;
}

function resolvedColor(value: string): boolean {
  if (!value || /var\(/i.test(value)) return false;
  const style = el("span").style;
  style.color = value;
  return !!style.color;
}

function row(token: DesignToken, id: string, selected: boolean, themes: readonly ThemeValues[]): HTMLElement {
  const node = el("div");
  node.id = id;
  node.setAttribute("role", "option");
  node.setAttribute("aria-selected", String(selected));
  const name = el("span", "komo-tokens__name");
  const label = el("span", "", tokenLabel(token));
  name.append(label);
  const check = el("span", "komo-tokens__check");
  check.setAttribute("aria-hidden", "true");
  const unresolved = token.type === "color" && !resolvedColor(token.value);
  const perTheme = themes.flatMap((theme) => {
    const value = theme.values.get(token.path);
    return value && token.type === "color" ? [`${theme.label} ${value}`] : [];
  });
  const shown = perTheme.length > 1 ? perTheme.join(", ") : token.value ?? "";
  // No tooltip: it would cover the rows around it. The hovered or active row shows its path and
  // value on a muted second line; the full details stay in the accessible name.
  const sub = el("span", "komo-tokens__sub", [token.path, shown].filter(Boolean).join(" · "));
  sub.setAttribute("aria-hidden", "true");
  node.append(tokenPreview(token), name, check, sub);
  node.setAttribute("aria-label", [token.label, tokenTitle(token, shown, unresolved ? "Unresolved; no swatch available" : "")].filter(Boolean).join(" · "));
  return node;
}


/** Add the picker's styles once to the root holding `node`; returns that root. */
export function stylePicker(node: Node): Node {
  const root = node.getRootNode();
  if ((root instanceof ShadowRoot || root === document) && !styled.has(root)) {
    styled.add(root);
    const style = el("style");
    style.textContent = popupStyles + css + modeStyles;
    (root instanceof ShadowRoot ? root : document.head).append(style);
  }
  return root;
}

export function refreshTokenPicker(trigger: HTMLElement, options?: TokenPickerOptions): void {
  if (open?.trigger === trigger) open.refresh(options);
}

export function openTokenPicker(options: TokenPickerOptions): () => void;
export function openTokenPicker(options: TokenPickerOptions, toggle: boolean): (() => void) | void;
export function openTokenPicker(options: TokenPickerOptions, toggle = false) {
  // A field's swatch asks for Custom straight away (data-start), for this opening only.
  const start = options.trigger.dataset.start;
  delete options.trigger.dataset.start;
  if (toggle && open?.trigger === options.trigger) return open.close(true);
  open?.close();
  const { trigger, property } = options;
  let tokens = options.tokens;
  const root = stylePicker(trigger);
  const id = `komo-tokens-${++count}`;
  const color = /color|^(fill|stroke)$/.test(property);
  const box = el("div", "komo-tokens");
  box.id = `${id}-popup`;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", `Edit ${property}`);
  // One shell for every popup: a pinned header, then either the matching tokens with a
  // "Custom…" row at the bottom, or, on demand, the Custom editor alone with a way back.
  const head = el("div", "komo-tokens__head");
  const back = el("button", "komo-tokens__back");
  back.type = "button";
  back.setAttribute("aria-label", "Back to tokens");
  back.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>';
  const title = el("span", "", options.title || options.custom?.field?.label || titles[property] || property);
  head.append(back, title);
  const bar = el("div", "komo-tokens__bar");
  const search = el("input");
  search.type = "text";
  search.placeholder = "Search tokens";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  search.setAttribute("aria-controls", id);
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-label", `Search tokens for ${property}`);
  const list = el("div", "komo-tokens__list");
  list.id = id;
  list.tabIndex = 0;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", `Tokens for ${property}`);
  let relevant = tokensFor(tokens, property);
  let all = !relevant.length;
  // "Show all" sits under the list; a search looks through every token anyway.
  const widen = el("button", "komo-tokens__widen");
  widen.type = "button";
  bar.append(search);
  // The way into Custom: the current value's swatch or text, then the editor in place of the list.
  const more = el("button", "komo-tokens__more");
  more.type = "button";
  const moreSwatch = el("i"), moreValue = el("span");
  more.append(el("b", "", "Custom…"), moreSwatch, moreValue);
  const section = el("div", "komo-tokens__custom");
  box.append(head, bar, list, widen, more);
  if (options.custom) box.append(section);

  // Lowercase haystacks are built once, so each keystroke is a plain scan.
  const haystacks = () => new Map(tokens.map((token) => [token, `${tokenLabel(token)} ${token.path} ${token.ref ?? ""} ${token.value ?? ""}`.toLowerCase()]));
  let haystack = haystacks();
  let themes: readonly ThemeValues[] = [];
  let items: Array<{ token: DesignToken; group: string }> = [];
  let built = 0;
  let active = -1;
  let groupNode: HTMLElement = list;
  let groupName: string | undefined;
  let undoPreview: (() => void) | undefined;
  let previewed = -1;
  let resuming = false;
  /** Typing on the list opened the search; it stays so focus never lands on a hidden field. */
  let revealed = false;
  let customValue: string | undefined;
  let editor: (HTMLElement & { live?: true; refresh(value: string): void; destroy(): void }) | undefined;
  /** The token list, or the Custom editor alone. */
  let custom = false;
  const restorePreview = () => {
    const undo = undoPreview;
    undoPreview = undefined;
    previewed = -1;
    undo?.();
  };
  const customPreview = (value: string) => {
    restorePreview();
    customValue = value;
    undoPreview = options.custom?.onPreview(value);
  };
  /** The pointer or focus left the tokens: their preview goes, and a Custom preview comes back. */
  const leave = () => {
    if (previewed < 0) return;
    restorePreview();
    if (customValue !== undefined) customPreview(customValue);
  };
  /** A popup with a Custom value and no relevant tokens is the Custom editor alone. */
  const listed = () => !options.custom || !!relevant.length;
  const sections = () => {
    const tokenView = listed() && !custom;
    const pool = all || search.value ? tokens : relevant;
    list.hidden = bar.hidden = !tokenView;
    search.hidden = !tokenView || !revealed && pool.length <= 8 && !search.value;
    bar.hidden ||= search.hidden;
    widen.hidden = !tokenView || !!search.value || !relevant.length || relevant.length === tokens.length;
    widen.textContent = all ? "Show relevant tokens" : `Show all ${tokens.length} tokens`;
    widen.setAttribute("aria-pressed", String(all));
    more.hidden = !tokenView || !options.custom;
    section.hidden = tokenView;
    back.hidden = !custom || !listed();
    title.textContent = custom && listed() ? (color ? "Custom colour" : "Custom value") : options.title || options.custom?.field?.label || titles[property] || property;
    box.toggleAttribute("data-custom", !tokenView);
    // The Custom row names the value the field has now.
    const now = options.custom?.value ?? "";
    // A color reads as its hex, with its opacity when it has one.
    const rgb = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(now);
    moreValue.textContent = !color ? now : rgb
      ? rgb.slice(1, 4).map(part => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase() + (rgb[4] && +rgb[4] < 1 ? ` ${Math.round(+rgb[4] * 100)}%` : "")
      : now.replace(/^#/, "").toUpperCase();
    moreSwatch.hidden = !color || !now;
    moreSwatch.style.setProperty("--c", now);
    more.title = now;
  };

  const build = (upTo: number) => {
    for (; built < Math.min(upTo, items.length); built++) {
      const { token, group } = items[built];
      if (group !== groupName) {
        groupName = group;
        groupNode = list;
        if (group) {
          groupNode = el("div");
          groupNode.setAttribute("role", "group");
          const heading = el("small");
          heading.id = `${id}-g${built}`;
          heading.textContent = group;
          groupNode.setAttribute("aria-labelledby", heading.id);
          groupNode.append(heading);
          list.append(groupNode);
        }
      }
      groupNode.append(row(token, `${id}-${built}`, token.path === options.current, themes));
    }
  };
  const node = (index: number) => list.querySelector<HTMLElement>(`#${id}-${index}`);
  const activate = (index: number, scroll = true, preview = true) => {
    if (index < 0 || index >= items.length) return;
    if (index !== previewed && preview) {
      restorePreview();
      previewed = index;
      const token = items[index].token;
      if (token.path !== options.current) undoPreview = options.onPreview?.(token);
    }
    build(index + BATCH);
    node(active)?.removeAttribute("data-active");
    active = index;
    const target = node(index)!;
    target.toggleAttribute("data-active", true);
    search.setAttribute("aria-activedescendant", target.id);
    list.setAttribute("aria-activedescendant", target.id);
    if (!scroll) return;
    const top = target.offsetTop - (target.parentElement === list ? 0 : (target.parentElement!.firstElementChild as HTMLElement).offsetHeight);
    const bottom = target.offsetTop + target.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  };
  const render = (preview = false, keep = false) => {
    const path = keep ? items[active]?.token.path : undefined;
    const scroll = list.scrollTop, upTo = keep ? built : BATCH;
    // A token preview goes with its row; a Custom preview stays.
    if (previewed >= 0) restorePreview();
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = all || terms.length ? tokens : relevant;
    const found = terms.length ? pool.filter((token) => terms.every((term) => haystack.get(token)!.includes(term))) : pool;
    // A search looks through every token, the field's own first.
    const matches = all ? found : [...found.filter(token => relevant.includes(token)), ...found.filter(token => !relevant.includes(token))];

    // Groups keep their first appearance order; ungrouped tokens come first.
    const groups = new Map<string, DesignToken[]>([["", []]]);
    for (const token of matches) {
      const key = token.group ?? "";
      groups.set(key, [...groups.get(key) ?? [], token]);
    }
    items = [
      ...[...groups].flatMap(([group, members]) => members.map((token) => ({ token, group }))),
    ];
    list.replaceChildren();
    list.scrollTop = 0;
    built = 0;
    active = -1;
    groupName = undefined;
    search.removeAttribute("aria-activedescendant");
    list.removeAttribute("aria-activedescendant");
    sections();
    if (!items.length) {
      const empty = el("div", "komo-tokens__empty", terms.length ? "No matching tokens" : "No tokens");
      list.append(empty);
      return;
    }
    build(upTo);
    activate(Math.max(0, items.findIndex(item => item.token.path === path)), false, preview);
    if (keep) list.scrollTop = scroll;
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  const coarse = !!globalThis.matchMedia?.("(pointer:coarse)")?.matches;
  function close(focus = false, cancel = false) {
    if (open?.close !== close) return;
    open = undefined;
    // A live editor keeps the value it was previewing; Escape drops it with everything kept.
    const pending = editor?.live && customValue;
    restorePreview();
    if (pending && !cancel) (options.custom?.onCommit ?? options.custom?.onSelect)?.(pending);
    options.custom?.[cancel ? "onCancel" : "onDone"]?.();
    listeners.abort();
    editor?.destroy();
    box.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-controls");
    if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  open = { trigger, close,
    refresh(next) {
      if (!next) {
        resuming ||= previewed >= 0;
        return restorePreview();
      }
      const preview = resuming || previewed >= 0;
      resuming = false;
      options = next;
      tokens = next.tokens;
      relevant = tokensFor(tokens, property);
      haystack = haystacks();
      themes = [];
      render(preview && !custom, true);
      if (options.current && options.custom) editor?.refresh(options.custom.value);
      if (previewed < 0 && !undoPreview && customValue !== undefined) customPreview(customValue);
      loadThemes();
    },
  };
  // Every popup shares one compact width, sized to its content up to 460px and to the viewport.
  const tall = 460;
  /** A token from the list or the editor's "Use it": a pending Custom edit is undone first. */
  const pick = (token: DesignToken) => {
    restorePreview();
    customValue = undefined;
    options.custom?.onCancel?.();
    close(true);
    if (token.path !== options.current) options.onSelect(token);
  };
  // Fetched as the popup opens, so Custom swaps in without a wait.
  const chunk = options.custom ? (color ? import("./color-editor.js") : import("./token-custom.js")) : undefined;
  async function loadEditor(focus: boolean) {
    const module = await chunk!;
    if (open?.close !== close) return;
    if (!editor) {
      // Both editors apply live and keep values through the same host.
      editor = module.pickerEditor(options, {
        preview: customPreview,
        // A host without live commits keeps the last value as a preview and takes it on close.
        commit(value) {
          if (!options.custom?.onCommit) return customPreview(value);
          restorePreview();
          customValue = undefined;
          options.custom.onCommit(value);
        },
        token: pick,
        // A hovered menu option previews over the kept value; leaving it brings that value back.
        hover(value) {
          restorePreview();
          if (value !== undefined) undoPreview = options.custom?.onPreview(value);
          else if (customValue !== undefined) customPreview(customValue);
        },
      });
      section.append(editor);
    }
    // Placed again for the editor's own height.
    at = "";
    place();
    // The first field that shows ("Edit as CSS" starts closed), else the first control at all, so
    // focus never stays on the Custom row this view just hid.
    const laid = !!box.getClientRects().length;
    const shown = [...box.querySelectorAll<HTMLElement>("input,select,summary,button")].filter(node => (!laid || node.getClientRects().length) && !node.closest("[hidden]") && !node.matches("details:not([open]) :not(summary)"));
    if (focus) (shown.find(node => node instanceof HTMLInputElement && section.contains(node)) ?? shown[0])?.focus({ preventScroll: true });
  }
  /** Swaps between the token list and the Custom editor; focus follows to the new view. */
  function view(next: boolean, focus = !coarse) {
    leave();
    custom = next;
    sections();
    at = "";
    place();
    if (custom) return void loadEditor(focus);
    if (focus) (search.hidden ? more : search).focus({ preventScroll: true });
  }
  const choose = (index: number) => {
    const token = items[index]?.token;
    if (token) pick(token);
  };
  more.addEventListener("click", () => view(true), { signal });
  back.addEventListener("click", () => view(false), { signal });
  search.addEventListener("input", () => render(true), { signal });
  widen.addEventListener("click", () => {
    all = !all;
    render(true);
    if (!coarse) (search.hidden ? list : search).focus({ preventScroll: true });
  }, { signal });
  addEventListener("keydown", (event) => {
    if (!trigger.isConnected) return close();
    const path = event.composedPath();
    if (!path.includes(box) && !path.includes(trigger)) return;
    const { key } = event;
    const step = ({ ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 } as Record<string, number>)[key];
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // A select open inside the popup closes its own list first.
    if (key === "Escape" && path[0] instanceof HTMLSelectElement && path[0] !== trigger && path[0].getAttribute("aria-expanded") === "true") return;
    if (key === "Escape") close(true, true);
    else if (key === "Tab") {
      // Tab stays inside the popup, from its last control back to its first and the other way.
      const focusable = [...box.querySelectorAll<HTMLElement>("button,input,select,summary,[tabindex='0']")].filter(node => !node.closest("[hidden]") && !node.matches("details:not([open]) :not(summary)") && node.getClientRects().length);
      if (path[0] !== focusable[event.shiftKey ? 0 : focusable.length - 1]) return;
      focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
    }
    // From the Custom row, ArrowUp returns to the last token.
    else if (path[0] === more && key === "ArrowUp" && items.length) {
      list.focus({ preventScroll: true });
      activate(items.length - 1);
    }
    else if (list.hidden || path[0] !== search && path[0] !== trigger && path[0] !== list) return;
    // Past the last token, ArrowDown on the list reaches the Custom row; the search keeps its place.
    else if (step > 0 && path[0] === list && active === items.length - 1 && !more.hidden) {
      leave();
      more.focus({ preventScroll: true });
    }
    else if (step) activate(clamp(active + step, 0, items.length - 1));
    else if ((key === "Home" || key === "End") && path[0] !== search) activate(key === "Home" ? 0 : items.length - 1);
    else if (key === "Enter") choose(active);
    // Typing on the list filters it: the search opens with the letter.
    else if (path[0] === list && key.length === 1 && key !== " ") {
      revealed = true;
      search.value += key;
      render(true);
      search.focus({ preventScroll: true });
    }
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
  addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    if (!path.includes(box) && !path.includes(trigger)) close();
  }, { capture: true, signal });
  addEventListener("focusin", event => {
    const path = event.composedPath();
    if (!path.includes(box) && !path.includes(trigger)) close();
  }, { capture: true, signal });
  const scrolled = (event: Event) => {
    if (event.target === list) {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - 200) build(built + BATCH);
    } else if (!(event.target instanceof Node && box.contains(event.target))) close();
  };
  addEventListener("scroll", scrolled, { capture: true, signal });
  root.addEventListener("scroll", scrolled, { capture: true, signal });
  addEventListener("resize", () => close(), { signal });
  watchPopup(trigger, () => close(), signal);
  list.addEventListener("mousedown", (event) => event.preventDefault(), { signal });
  const indexOf = (event: Event) => {
    const option = (event.target as Element).closest?.("[role=option]");
    return option && list.contains(option) ? Number(option.id.slice(id.length + 1)) : -1;
  };
  list.addEventListener("pointermove", (event) => {
    const index = indexOf(event);
    if (index >= 0) activate(index, false);
  }, { signal });
  list.addEventListener("pointerleave", leave, { signal });
  more.addEventListener("focusin", leave, { signal });
  section.addEventListener("focusin", leave, { signal });
  // The picker sits inside the field's <label>; a click there would refocus the field's input.
  box.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement)) event.preventDefault();
    const index = indexOf(event);
    if (index >= 0) choose(index);
  }, { signal });

  render();
  const host = trigger.closest<HTMLElement>(".design-field") ?? trigger.parentElement!;
  // In the top layer, later fields never paint over the popup and the panel's scroll never clips it.
  box.popover = "manual";
  host.append(box);
  box.showPopover?.();
  // The field read a settled value; Custom follows unless a preview or an edit is in progress.
  host.addEventListener("komo-field-sync", () => {
    if (undoPreview || !options.custom) return;
    editor?.refresh(options.custom.value);
    sections();
  }, { signal });
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", box.id);
  // As wide as the panel allows, up to 256px, anchored to the field in the viewport; flips up when
  // there is more room, and never taller than the viewport. It moves with the field.
  let at = "";
  const place = () => {
    const anchor = host.getBoundingClientRect();
    if (at === `${anchor.left} ${anchor.top}`) return;
    at = `${anchor.left} ${anchor.top}`;
    const area = popupBounds(host);
    const width = clamp(area.right - area.left - 8, 120, 256);
    const below = innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    // Measured at its natural height: the scroll area shrinks to fit a cap set before.
    box.style.maxHeight = "";
    const need = Math.min(tall, Math.max(box.scrollHeight, 200));
    const up = below < need && above > below;
    // Too little room on either side: the popup keeps 200px and covers the field instead.
    const height = Math.min(tall, innerHeight - 16, Math.max(up ? above : below, 200));
    box.style.width = `${width}px`;
    box.style.maxHeight = `${height}px`;
    box.style.left = `${clamp(anchor.left, area.left + 4, area.right - width - 4)}px`;
    box.style.top = up ? "" : `${Math.min(anchor.bottom + 4, innerHeight - 8 - height)}px`;
    box.style.bottom = up ? `${Math.min(innerHeight - anchor.top + 4, innerHeight - 8 - height)}px` : "";
    box.toggleAttribute("data-up", up);
  };
  place();
  const moved = new MutationObserver(place);
  moved.observe(root, { attributes: true, childList: true, subtree: true });
  signal.addEventListener("abort", () => moved.disconnect());
  const chosen = items.findIndex((item) => item.token.path === options.current);
  if (chosen >= 0) activate(chosen, true, false);
  // Tokens come first: a long list focuses its search, a short one its list. A field with no
  // relevant tokens opens straight in Custom. Touch keeps the keyboard down until a field is tapped.
  if (!listed() || start === "custom" && options.custom) view(true);
  // The active row marks where the keyboard is; the list itself gets no ring on opening.
  else if (!coarse) (search.hidden ? list : search).focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  let themeRequest = 0;
  // Values per theme come from the adapter's list(theme), so the page never flips to read them.
  function loadThemes() {
    const request = ++themeRequest;
    void Promise.resolve(options.themes?.()).then((values) => {
      if (!values || values.length < 2 || open?.close !== close || request !== themeRequest) return;
      themes = values;
      if (!list.hidden) render(previewed >= 0, true);
    }, () => {});
  }
  loadThemes();
  return () => close();
}
