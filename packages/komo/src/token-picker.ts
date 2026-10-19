// Design mode's token picker: a searchable listbox of `DesignToken`s with a
// preview per type, sticky group headings, the current token pinned first and
// the field's relevant tokens by default. It is driven only by token data, so
// any adapter gets the same picker. Loaded on demand, the first time a token
// field opens. Comments stay out of the CSS string: they would ship.
import type { DesignToken } from "./design-system.js";

/** One theme option's resolved values, path → value, for split color swatches. */
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
  /** Path of the token the field uses now, pinned at the top. */
  current?: string;
  /** Values per theme option, for split swatches; resolved lazily. */
  themes?: () => Promise<ThemeValues[]> | ThemeValues[] | undefined;
  onSelect(token: DesignToken): void;
}

const css = `.komo-tokens{position:absolute;z-index:20;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border-radius:10px;background:#232323;box-shadow:0 0 0 1px #ffffff14,0 12px 32px #0008;color:#d9d6d1;font-size:11px;font-weight:400;line-height:1.25;text-align:left;cursor:default;transform-origin:top;animation:komo-tokens-in var(--duration-fast,250ms) var(--ease-smooth-out,cubic-bezier(.22,1,.36,1)) backwards}.komo-tokens[data-up]{transform-origin:bottom}@keyframes komo-tokens-in{from{opacity:0;transform:scale(.97)}}@media (prefers-reduced-motion:reduce){.komo-tokens{animation:none}}.komo-tokens__bar{display:flex;gap:4px;padding:6px 6px 2px}.komo-tokens__bar input{flex:1;min-width:0;height:28px;box-sizing:border-box;margin:0;padding:0 8px;border:0;border-radius:6px;outline:0;box-shadow:none;background:#ffffff0a;color:#f1efeb;font:inherit}.komo-tokens__bar input::placeholder{color:#77736f}.komo-tokens__bar input:focus{outline:0;box-shadow:inset 0 0 0 1px #bda6ef}.komo-tokens__bar button{flex:none;height:28px;padding:0 8px;border:0;border-radius:6px;background:none;color:#898680;font:inherit;white-space:nowrap;cursor:pointer}.komo-tokens__bar button:hover{background:#ffffff0f;color:#f1efeb}.komo-tokens__bar button[aria-pressed=true]{background:#bda6ef24;color:#e6dcfb}.komo-tokens__bar button:focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}.komo-tokens [role=listbox]{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 4px 4px}.komo-tokens small{position:sticky;top:0;z-index:1;display:block;padding:8px 8px 4px;background:#232323;color:#77736f;font-size:10px;font-weight:500}.komo-tokens [role=option]{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:1px 8px;box-sizing:border-box;min-height:28px;padding:4px 8px;border-radius:6px;cursor:pointer}.komo-tokens [data-active]{background:#ffffff14;color:#f1efeb}.komo-tokens__name{display:flex;align-items:center;gap:4px;min-width:0}.komo-tokens__name>*{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.komo-tokens__name>span{flex:none;max-width:100%}.komo-tokens__name>i{min-width:0;padding:1px 4px;border-radius:4px;background:#ffffff0d;color:#898680;font-size:9px;font-style:normal}.komo-tokens__desc{grid-column:2/-1;overflow:hidden;color:#77736f;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.komo-tokens__meta{display:flex;align-items:center;gap:6px;max-width:160px;min-width:0;color:#77736f;font-size:10px;font-variant-numeric:tabular-nums;white-space:nowrap}.komo-tokens__meta span{overflow:hidden;text-overflow:ellipsis}.komo-tokens__meta span+span{flex:none;max-width:90px;color:#898680}.komo-tokens [aria-selected=true] .komo-tokens__meta::after{content:'';flex:none;width:7px;height:3.5px;margin:-3px 1px 0 0;border:solid #bda6ef;border-width:0 0 1.5px 1.5px;rotate:-45deg}.komo-tokens__pv{display:flex;align-items:center;height:16px;overflow:hidden}.komo-tokens__sw{display:flex;width:16px;height:16px;border-radius:4px;overflow:hidden;background:repeating-conic-gradient(#ffffff40 0 25%,#ffffff0d 0 50%) 0 0/8px 8px;outline:1px solid #ffffff1f;outline-offset:-1px}.komo-tokens__sw>span{flex:1}.komo-tokens__dim{height:4px;min-width:2px;border-radius:2px;background:#bda6ef}.komo-tokens__corner{width:12px;height:12px;box-sizing:border-box;border:solid #bda6ef;border-width:1.5px 0 0 1.5px}.komo-tokens__shadow{width:16px;height:12px;margin-left:2px;border-radius:3px;background:#f1efeb}.komo-tokens__ag{color:#f1efeb;font-size:13px;line-height:1;white-space:nowrap}.komo-tokens__empty{padding:12px 8px;color:#77736f}@media (pointer:coarse){.komo-tokens{font-size:13px}.komo-tokens [role=option]{min-height:40px}.komo-tokens__bar input,.komo-tokens__bar button{height:36px}}`;

const styled = new WeakSet<Node>();
/** Rows built per batch; the rest are built as the list scrolls or the keyboard reaches them. */
const BATCH = 60;
let count = 0;
let open: { trigger: HTMLElement; close(focus?: boolean): void } | undefined;

/** The row's name: `label`, else the last path segment, since the group heading names the rest. */
export function tokenLabel(token: DesignToken): string {
  return token.label || token.path.slice(token.path.lastIndexOf(".") + 1) || token.path;
}

/** Pixels for a length, for preview sizes only; rem and em count 16px. */
function pixels(value: string): number | undefined {
  const match = /^(-?[\d.]+)(px|r?em)?$/.exec(value.trim());
  return match ? parseFloat(match[1]) * (match[2] ? (match[2] === "px" ? 1 : 16) : 1) : undefined;
}

/** "600 · 16px/1.5" from a font shorthand, else the value as given. */
function fontSummary(value: string): string {
  const parts = value.trim().split(/\s+/);
  const weight = parts.find((part) => /^(\d{3}|bold|bolder|lighter)$/.test(part));
  const size = parts.find((part) => /^[\d.]+(px|r?em|pt|%)(\/\S+)?$/.test(part));
  return [weight, size].filter(Boolean).join(" · ") || value;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A small visual for the token's type: swatch, bar, corner, shadow card or "Ag". */
function preview(token: DesignToken, themes: readonly ThemeValues[]): HTMLElement {
  const box = document.createElement("span");
  box.className = "komo-tokens__pv";
  box.setAttribute("aria-hidden", "true");
  const part = (name: string) => {
    const node = document.createElement("span");
    node.className = `komo-tokens__${name}`;
    box.append(node);
    return node;
  };
  const value = token.value ?? "";
  const { type } = token;
  if (type === "color") {
    const swatch = part("sw");
    const values = themes.map((theme) => theme.values.get(token.path)).filter((item): item is string => !!item);
    for (const color of new Set(values).size > 1 ? values : [value]) {
      const half = document.createElement("span");
      half.style.background = color;
      swatch.append(half);
    }
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
      const size = pixels(value.split(/\s+/).find((item) => /^[\d.]+(px|r?em)(\/|$)/.test(item))?.split("/")[0] ?? "");
      sample.style.fontSize = `${clamp(size ?? 13, 10, 16)}px`;
      sample.style.lineHeight = "1";
    } else if (type === "fontWeight") sample.style.fontWeight = value;
    else sample.style.fontFamily = value;
  }
  return box;
}

function row(token: DesignToken, id: string, selected: boolean, themes: readonly ThemeValues[]): HTMLElement {
  const node = document.createElement("div");
  node.id = id;
  node.setAttribute("role", "option");
  node.setAttribute("aria-selected", String(selected));
  const name = document.createElement("span");
  name.className = "komo-tokens__name";
  const label = document.createElement("span");
  label.textContent = tokenLabel(token);
  name.append(label);
  for (const state of token.states ?? []) {
    const chip = document.createElement("i");
    chip.textContent = state;
    name.append(chip);
  }
  const meta = document.createElement("span");
  meta.className = "komo-tokens__meta";
  const shown = token.type === "typography" ? fontSummary(token.value ?? "") : token.value ?? "";
  for (const text of [token.ref, shown]) {
    if (!text) continue;
    const item = document.createElement("span");
    item.textContent = text;
    meta.append(item);
  }
  node.append(preview(token, themes), name, meta);
  if (token.description) {
    const description = document.createElement("span");
    description.className = "komo-tokens__desc";
    description.textContent = token.description;
    node.append(description);
  }
  const perTheme = themes.flatMap((theme) => {
    const value = theme.values.get(token.path);
    return value && token.type === "color" ? [`${theme.label} ${value}`] : [];
  });
  node.title = [token.path, token.ref, perTheme.length > 1 ? perTheme.join(", ") : token.value, token.states?.length ? `States: ${token.states.join(", ")}` : "", token.description]
    .filter(Boolean).join(" · ");
  return node;
}

/** The nearest box that clips the popup: a scrolling ancestor, else the viewport. */
function bounds(from: Element) {
  const view = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  for (let node = from.parentElement; node; node = node.parentElement)
    if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) {
      const rect = node.getBoundingClientRect();
      return {
        top: Math.max(rect.top, 0), left: Math.max(rect.left, 0),
        bottom: Math.min(rect.bottom, view.bottom), right: Math.min(rect.right, view.right),
      };
    }
  return view;
}

export function isTokenPickerOpen(trigger: HTMLElement): boolean {
  return open?.trigger === trigger;
}

/** Open the picker for `trigger`, or close it when it is already open there. */
export function toggleTokenPicker(options: TokenPickerOptions): void {
  if (isTokenPickerOpen(options.trigger)) open!.close(true);
  else openTokenPicker(options);
}

export function openTokenPicker(options: TokenPickerOptions): () => void {
  open?.close();
  const { trigger, tokens, property } = options;
  const root = trigger.getRootNode();
  if ((root instanceof ShadowRoot || root === document) && !styled.has(root)) {
    styled.add(root);
    const style = document.createElement("style");
    style.textContent = css;
    (root instanceof ShadowRoot ? root : document.head).append(style);
  }
  const id = `komo-tokens-${++count}`;
  const box = document.createElement("div");
  box.className = "komo-tokens";
  const bar = document.createElement("div");
  bar.className = "komo-tokens__bar";
  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search tokens";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  search.setAttribute("aria-controls", id);
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-label", `Search tokens for ${property}`);
  const list = document.createElement("div");
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", `Tokens for ${property}`);
  const relevant = tokens.filter((token) => token.properties?.includes(property));
  let all = !relevant.length;
  const widen = document.createElement("button");
  widen.type = "button";
  widen.textContent = "Show all";
  widen.title = `Show all ${tokens.length} tokens, not only ${property} tokens`;
  bar.append(search);
  if (relevant.length && relevant.length < tokens.length) bar.append(widen);
  box.append(bar, list);
  // Lowercase haystacks are built once, so each keystroke is a plain scan.
  const haystack = new Map(tokens.map((token) => [token, `${tokenLabel(token)} ${token.label ?? ""} ${token.path} ${token.ref ?? ""} ${token.value ?? ""}`.toLowerCase()]));
  let themes: readonly ThemeValues[] = [];
  let items: Array<{ token: DesignToken; group: string }> = [];
  let built = 0;
  let active = -1;
  let groupNode: HTMLElement = list;
  let groupName: string | undefined;

  const build = (upTo: number) => {
    for (; built < Math.min(upTo, items.length); built++) {
      const { token, group } = items[built];
      if (group !== groupName) {
        groupName = group;
        groupNode = list;
        if (group) {
          groupNode = document.createElement("div");
          groupNode.setAttribute("role", "group");
          const heading = document.createElement("small");
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
  const activate = (index: number, scroll = true) => {
    if (index < 0 || index >= items.length) return;
    build(index + BATCH);
    node(active)?.removeAttribute("data-active");
    active = index;
    const target = node(index)!;
    target.toggleAttribute("data-active", true);
    search.setAttribute("aria-activedescendant", target.id);
    if (!scroll) return;
    const top = target.offsetTop - (target.parentElement === list ? 0 : (target.parentElement!.firstElementChild as HTMLElement).offsetHeight);
    const bottom = target.offsetTop + target.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  };
  const render = () => {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = all ? tokens : relevant;
    const matches = terms.length ? pool.filter((token) => terms.every((term) => haystack.get(token)!.includes(term))) : pool;
    const pinned = !terms.length && options.current ? matches.find((token) => token.path === options.current) : undefined;
    // Groups keep their first appearance order; ungrouped tokens come first.
    const groups = new Map<string, DesignToken[]>([["", []]]);
    for (const token of matches) {
      if (token === pinned) continue;
      const key = token.group ?? "";
      groups.set(key, [...groups.get(key) ?? [], token]);
    }
    items = [
      ...pinned ? [{ token: pinned, group: "Current" }] : [],
      ...[...groups].flatMap(([group, members]) => members.map((token) => ({ token, group }))),
    ];
    list.replaceChildren();
    list.scrollTop = 0;
    built = 0;
    active = -1;
    groupName = undefined;
    search.removeAttribute("aria-activedescendant");
    widen.setAttribute("aria-pressed", String(all));
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "komo-tokens__empty";
      empty.textContent = terms.length ? "No matching tokens" : "No tokens";
      list.append(empty);
      return;
    }
    build(BATCH);
    activate(0, false);
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  const coarse = !!globalThis.matchMedia?.("(pointer:coarse)")?.matches;
  function close(focus = false) {
    if (open?.trigger !== trigger) return;
    open = undefined;
    listeners.abort();
    box.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-controls");
    if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  open = { trigger, close };
  const choose = (index: number) => {
    const token = items[index]?.token;
    if (!token) return;
    close(true);
    options.onSelect(token);
  };
  search.addEventListener("input", render, { signal });
  widen.addEventListener("click", () => {
    all = !all;
    render();
    if (!coarse) search.focus({ preventScroll: true });
  }, { signal });
  addEventListener("keydown", (event) => {
    if (!trigger.isConnected) return close();
    const path = event.composedPath();
    if (!path.includes(box) && !path.includes(trigger)) return;
    const { key } = event;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === "Escape") close(true);
    else if (key === "Tab") return close();
    else if (path[0] !== search) return;
    else if (key === "ArrowDown" || key === "ArrowUp") activate(clamp(active + (key === "ArrowDown" ? 1 : -1), 0, items.length - 1));
    else if (key === "PageDown" || key === "PageUp") activate(clamp(active + (key === "PageDown" ? 8 : -8), 0, items.length - 1));
    else if (key === "Enter") choose(active);
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
  addEventListener("pointerdown", (event) => {
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
  list.addEventListener("mousedown", (event) => event.preventDefault(), { signal });
  const indexOf = (event: Event) => {
    const option = (event.target as Element).closest?.("[role=option]");
    return option ? Number(option.id.slice(id.length + 1)) : -1;
  };
  list.addEventListener("pointermove", (event) => {
    const index = indexOf(event);
    if (index >= 0 && index !== active) activate(index, false);
  }, { signal });
  // The picker sits inside the field's <label>; a click there would refocus the field's input.
  box.addEventListener("click", (event) => {
    if (event.target !== search) event.preventDefault();
    const index = indexOf(event);
    if (index >= 0) choose(index);
  }, { signal });

  render();
  const host = trigger.closest<HTMLElement>(".design-field") ?? trigger.parentElement!;
  host.append(box);
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", id);
  // As wide as the panel allows, up to 340px, anchored to the field; flips up when there is more room.
  const anchor = host.getBoundingClientRect();
  const area = bounds(host);
  const origin = (box.offsetParent ?? host).getBoundingClientRect();
  const width = clamp(area.right - area.left - 8, 120, 340);
  const below = area.bottom - anchor.bottom - 8;
  const above = anchor.top - area.top - 8;
  const up = below < 240 && above > below;
  const height = Math.min(320, Math.max(up ? above : below, 120));
  box.style.width = `${width}px`;
  box.style.maxHeight = `${height}px`;
  box.style.left = `${clamp(anchor.left, area.left + 4, area.right - width - 4) - origin.left}px`;
  box.style.top = up ? "" : `${anchor.bottom + 4 - origin.top}px`;
  box.style.bottom = up ? `${origin.bottom - anchor.top + 4}px` : "";
  box.toggleAttribute("data-up", up);
  if (options.current) {
    const index = items.findIndex((item) => item.token.path === options.current);
    if (index >= 0) activate(index);
  }
  // Touch keeps the keyboard down until the search field is tapped.
  if (!coarse) search.focus({ preventScroll: true });
  // Values per theme come from the adapter's list(theme), so the page never flips to read them.
  void Promise.resolve(options.themes?.()).then((values) => {
    if (!values || values.length < 2 || open?.trigger !== trigger) return;
    themes = values;
    const at = active;
    const scroll = list.scrollTop;
    const upTo = built;
    list.replaceChildren();
    built = 0;
    groupName = undefined;
    build(upTo);
    list.scrollTop = scroll;
    activate(at, false);
  }, () => {});
  return () => close();
}
