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

const css = `.komo-tokens{display:flex;flex-direction:column;overflow:hidden}.komo-tokens__bar{flex:none;display:flex;gap:4px;padding:8px;background:#232323;border-bottom:1px solid #ffffff0d}.komo-tokens__bar input{flex:1;min-width:0;height:28px;box-sizing:border-box;margin:0;padding:0 8px;border:0;border-radius:6px;outline:0;box-shadow:none;background:#ffffff0a;color:#f1efeb;font:inherit}.komo-tokens__bar input:focus{outline:0;box-shadow:inset 0 0 0 1px #bda6ef}.komo-tokens__bar button{flex:none;height:28px;padding:0 8px;border:0;border-radius:6px;background:none;color:#898680;font:inherit;white-space:nowrap;cursor:pointer}.komo-tokens__bar button:hover{background:#ffffff0f;color:#f1efeb}.komo-tokens__bar button:focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}.komo-tokens [role=listbox]{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 4px 4px}.komo-tokens small{position:sticky;top:0;z-index:1;display:block;padding:8px 8px 4px;background:#232323;color:#77736f;font-size:10px;font-weight:500}.komo-tokens [role=option]{display:grid;grid-template-columns:20px minmax(0,1fr) 14px;align-items:center;gap:4px 8px;box-sizing:border-box;min-height:32px;padding:6px 8px;border-radius:7px;cursor:pointer}.komo-tokens [data-active]{background:#ffffff14;color:#f1efeb}.komo-tokens [aria-selected=true] .komo-tokens__name{color:#e6dcfb}.komo-tokens__name{grid-column:2;min-width:0;font-weight:500}.komo-tokens__name>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.komo-tokens__check{grid-column:3;justify-self:center}.komo-tokens [aria-selected=true] .komo-tokens__check{width:7px;height:3.5px;margin-top:-3px;border:solid #bda6ef;border-width:0 0 1.5px 1.5px;rotate:-45deg}.komo-tokens__pv{display:flex;align-items:center;height:16px;overflow:hidden}.komo-tokens__sw{display:flex;width:16px;height:16px;border-radius:4px;overflow:hidden;background:repeating-conic-gradient(#ffffff40 0 25%,#ffffff0d 0 50%) 0 0/8px 8px;outline:1px solid #ffffff1f;outline-offset:-1px}.komo-tokens__sw>span{flex:1}.komo-tokens__sw>[data-unresolved]{display:grid;place-items:center;background:#393939;color:#b6b1aa;font-size:10px}.komo-tokens__dim{height:4px;min-width:2px;border-radius:2px;background:#bda6ef}.komo-tokens__corner{width:12px;height:12px;box-sizing:border-box;border:solid #bda6ef;border-width:1.5px 0 0 1.5px}.komo-tokens__shadow{width:16px;height:12px;margin-left:2px;border-radius:3px;background:#f1efeb}.komo-tokens__ag{color:#f1efeb;font-size:13px;line-height:1;white-space:nowrap}.komo-tokens__empty{padding:12px 8px;color:#77736f}@media (pointer:coarse){.komo-tokens{font-size:13px}.komo-tokens [role=option]{min-height:44px}.komo-tokens__bar input,.komo-tokens__bar button{height:36px}}`;

const modeStyles = `.komo-tokens__tabs{display:flex;flex:none;gap:2px;margin:8px 8px 0;padding:2px;border-radius:7px;background:#ffffff0a}.komo-tokens__tabs button{flex:1;height:22px;border:0;border-radius:5px;padding:0 8px;font:inherit;color:#898680;background:none;cursor:pointer}.komo-tokens__tabs button:hover{color:#f1efeb}.komo-tokens__tabs button[aria-pressed=true]{background:#ffffff1a;color:#f1efeb}.komo-tokens [hidden]{display:none!important}.komo-tokens button:focus-visible,.komo-tokens [role=listbox]:focus-visible{outline:1px solid #bda6ef;outline-offset:-2px}.komo-tokens[popover]{position:fixed;inset:auto;margin:0;border:0;padding:0}`;
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
  node.append(tokenPreview(token), name, check);
  const perTheme = themes.flatMap((theme) => {
    const value = theme.values.get(token.path);
    return value && token.type === "color" ? [`${theme.label} ${value}`] : [];
  });
  node.title = [token.label, tokenTitle(token, perTheme.length > 1 ? perTheme.join(", ") : token.value, unresolved ? "Unresolved; no swatch available" : "")]
    .filter(Boolean).join(" · ");
  node.setAttribute("aria-label", node.title);
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
  if (toggle && open?.trigger === options.trigger) return open.close(true);
  open?.close();
  const { trigger, property } = options;
  let tokens = options.tokens;
  const root = stylePicker(trigger);
  const id = `komo-tokens-${++count}`;
  const box = el("div", "komo-tokens");
  box.id = `${id}-popup`;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", `Edit ${property}`);
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
  const list = el("div");
  list.id = id;
  list.tabIndex = 0;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", `Tokens for ${property}`);
  let relevant = tokensFor(tokens, property);
  let all = !relevant.length;
  const widen = el("button");
  widen.type = "button";
  widen.textContent = "Show all";
  bar.append(search);
  if (relevant.length && relevant.length < tokens.length) bar.append(widen);
  box.append(bar, list);

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
  const restorePreview = () => {
    const undo = undoPreview;
    undoPreview = undefined;
    previewed = -1;
    undo?.();
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
    restorePreview();
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = all ? tokens : relevant;
    const matches = terms.length ? pool.filter((token) => terms.every((term) => haystack.get(token)!.includes(term))) : pool;

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
    search.hidden = pool.length <= 8 && !search.value;
    bar.hidden = search.hidden && widen.parentElement !== bar;
    widen.setAttribute("aria-pressed", String(all));
    widen.textContent = all ? "Relevant" : "Show all";
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
      if (relevant.length && relevant.length < tokens.length) bar.append(widen);
      else widen.remove();
      render(preview && !customMode, true);
      if (options.current && options.custom) editor?.refresh(options.custom.value);
      if (customMode && customValue !== undefined) customPreview(customValue);
      list.hidden = customMode;
      bar.hidden ||= customMode;
      loadThemes();
    },
  };
  // Color fields get the compact picker: narrower, and tall enough for its area, sliders and swatches.
  const color = /color|^(fill|stroke)$/.test(property), tall = color ? 460 : 320;
  let customMode = !!options.custom && !tokens.some(token => token.path === options.current);
  let customValue: string | undefined;
  let editor: (HTMLElement & { live?: true; refresh(value: string): void; destroy(): void }) | undefined;
  const tabs = el("div", "komo-tokens__tabs");
  const tokenTab = el("button", "", "Tokens"), customTab = el("button", "", "Custom");
  tokenTab.type = customTab.type = "button";
  const customPreview = (value: string) => {
    restorePreview();
    customValue = value;
    undoPreview = options.custom?.onPreview(value);
  };
  async function mode(custom: boolean, focus = true) {
    restorePreview();
    customMode = custom;
    tokenTab.setAttribute("aria-pressed", String(!custom));
    customTab.setAttribute("aria-pressed", String(custom));
    list.hidden = custom;
    bar.hidden = custom || (search.hidden && widen.parentElement !== bar);
    if (editor) editor.hidden = !custom;
    if (custom && options.custom) {
      if (!editor) {
        const module = await (color ? import("./color-editor.js") : import("./token-custom.js"));
        if (open?.close !== close || !customMode || editor) return;
        editor = "parseColor" in module ? module.pickerEditor(options, {
          preview: customPreview,
          // A host without live commits keeps the last value as a preview and takes it on close.
          commit(value) {
            if (!options.custom?.onCommit) return customPreview(value);
            restorePreview();
            customValue = undefined;
            options.custom.onCommit(value);
          },
          token(token) {
            restorePreview();
            customValue = undefined;
            options.custom?.onCancel?.();
            close(true);
            options.onSelect(token);
          },
        }) : module.pickerEditor(options, customPreview, value => {
          close(true);
          options.custom?.onSelect(value);
        });
        box.append(editor);
      } else if (customValue !== undefined) customPreview(customValue);
      if (focus && !coarse) editor.querySelector<HTMLInputElement>("input")?.focus();
    } else if (focus && !coarse) (search.hidden ? list : search).focus();
  }
  if (options.custom && tokens.length) {
    tabs.append(tokenTab, customTab);
    box.prepend(tabs);
    tokenTab.onclick = () => { void mode(false); };
    customTab.onclick = () => { void mode(true); };
  }
  const choose = (index: number) => {
    const token = items[index]?.token;
    if (!token) return;
    close(true);
    if (token.path !== options.current) options.onSelect(token);
  };
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
    else if (key === "Tab") return;
    else if (path[0] !== search && path[0] !== trigger && path[0] !== list) return;
    else if (step) activate(clamp(active + step, 0, items.length - 1));
    else if (key === "Enter") choose(active);
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
  host.addEventListener("komo-field-sync", () => { if (!undoPreview && options.custom) editor?.refresh(options.custom.value); }, { signal });
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", box.id);
  // As wide as the panel allows, up to 340px, anchored to the field in the viewport; flips up when
  // there is more room. It moves with the field when the panel's content shifts.
  let at = "";
  const place = () => {
    const anchor = host.getBoundingClientRect();
    if (at === `${anchor.left} ${anchor.top}`) return;
    at = `${anchor.left} ${anchor.top}`;
    const area = popupBounds(host);
    const width = clamp(area.right - area.left - 8, 120, color ? 240 : 340);
    const below = innerHeight - anchor.bottom - 8;
    const up = below < tall && anchor.top - 8 > below;
    box.style.width = `${width}px`;
    box.style.maxHeight = `${Math.min(tall, Math.max(up ? anchor.top - 8 : below, 120))}px`;
    box.style.left = `${clamp(anchor.left, area.left + 4, area.right - width - 4)}px`;
    box.style.top = up ? "" : `${anchor.bottom + 4}px`;
    box.style.bottom = up ? `${innerHeight - anchor.top + 4}px` : "";
    box.toggleAttribute("data-up", up);
  };
  place();
  const moved = new MutationObserver(place);
  moved.observe(root, { attributes: true, childList: true, subtree: true });
  signal.addEventListener("abort", () => moved.disconnect());
  if (options.current) {
    const index = items.findIndex((item) => item.token.path === options.current);
    if (index >= 0) activate(index, true, false);
  }
  // Touch keeps the keyboard down until the search field is tapped.
  if (!coarse) (search.hidden ? list : search).focus({ preventScroll: true });
  let themeRequest = 0;
  // Values per theme come from the adapter's list(theme), so the page never flips to read them.
  function loadThemes() {
    const request = ++themeRequest;
    void Promise.resolve(options.themes?.()).then((values) => {
      if (!values || values.length < 2 || open?.close !== close || request !== themeRequest) return;
      themes = values;
      if (!customMode) render(previewed >= 0, true);
    }, () => {});
  }
  loadThemes();
  if (options.custom) void mode(customMode);
  return () => close();
}
