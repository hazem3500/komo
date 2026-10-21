import { el } from "./dom.js";
import type { DesignToken } from "./design-system.js";
import { tokensFor } from "./token-adapter.js";
import type { TokenPickerOptions } from "./token-picker.js";

// Design mode's Custom color picker: a saturation/brightness area, hue and opacity
// sliders, an eyedropper, one compact value row with a format menu and scrubbable
// channels, and document and recent swatches. Every change previews live; the
// popup commits on pointer-up, Enter, blur or a swatch, and the field turns the
// whole popup visit into one history entry that Escape takes back. Loaded the
// first time a color field's Custom tab opens. Comments stay out of the CSS
// string: they would ship.

/** Red, green and blue 0–255 and alpha 0–1. */
export type Rgba = [number, number, number, number];
export const formats = ["Hex", "RGB", "HSL", "HSB", "CSS"] as const;
export type Format = (typeof formats)[number];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const { round } = Math;
const percent = (value: number) => round(value * 100);
const two = (value: number) => round(value).toString(16).padStart(2, "0");

export function hsvToRgb(h: number, s: number, v: number): number[] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return (v - v * s * clamp(Math.min(k, 4 - k), 0, 1)) * 255; };
  return [f(5), f(3), f(1)];
}

export function hslToRgb(h: number, s: number, l: number): number[] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return (l - a * clamp(Math.min(k - 3, 9 - k), -1, 1)) * 255; };
  return [f(0), f(8), f(4)];
}

const hueOf = (r: number, g: number, b: number, max: number, delta: number) =>
  !delta ? 0 : 60 * (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);

export function rgbToHsv(r: number, g: number, b: number): number[] {
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  return [hueOf(r, g, b, max, delta), max ? delta / max : 0, max / 255];
}

export function rgbToHsl(r: number, g: number, b: number): number[] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 510;
  return [hueOf(r, g, b, max, delta), delta ? delta / 255 / (1 - Math.abs(2 * light - 1)) : 0, light];
}

/** Hex with or without `#`, rgb(), hsl() and hsb() in either syntax; any other CSS color the browser resolves. */
export function parseColor(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = /^#?([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length < 5 ? [...hex].map(char => char + char).join("") : hex;
    const channel = (at: number) => parseInt(full.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4), full.length > 6 ? channel(6) / 255 : 1];
  }
  const call = /^(rgb|hsl|hs[bv])a?\(([^)]*)\)$/.exec(value);
  if (call) {
    const parts = call[2].split(/[\s,/]+/).filter(Boolean);
    const number = (part = "1", scale = 1) => /^-?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(part) ? parseFloat(part) / (part.endsWith("%") ? 100 : 1) * (part.endsWith("%") ? scale : 1) : NaN;
    if (parts.length < 3 || parts.length > 4) return;
    const [x, y, z] = call[1] === "rgb"
      ? parts.slice(0, 3).map(part => number(part, 255))
      : [number(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100];
    const rgb = call[1] === "rgb" ? [x, y, z] : (call[1] === "hsl" ? hslToRgb : hsvToRgb)(((x % 360) + 360) % 360, clamp(y, 0, 1), clamp(z, 0, 1));
    const alpha = number(parts[3]);
    if ([...rgb, alpha].some(Number.isNaN)) return;
    return [...rgb.map(channel => clamp(channel, 0, 255)), clamp(alpha, 0, 1)] as Rgba;
  }
  if (/var\(|currentcolor|^$/.test(value) || !globalThis.CSS?.supports?.("color", value)) return;
  const context = el("canvas").getContext?.("2d", { willReadFrequently: true });
  if (!context) return;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

const alphaPart = (a: number, comma = false) => a < 1 ? `${comma ? "," : " /"} ${percent(a)}%` : "";

/** The CSS a format writes: HSB has no CSS form and writes hex; CSS writes rgb(). */
export function formatColor([r, g, b, a]: Rgba, format: Format, hue?: number): string {
  if (format === "RGB" || format === "CSS") return `rgb(${round(r)} ${round(g)} ${round(b)}${alphaPart(a)})`;
  if (format === "HSL") {
    const [h, s, l] = rgbToHsl(r, g, b);
    return `hsl(${round(s ? h : hue ?? h)} ${percent(s)}% ${percent(l)}%${alphaPart(a)})`;
  }
  return `#${two(r)}${two(g)}${two(b)}${a < 1 ? two(a * 255) : ""}`;
}

/** The value row's channels for a format, as shown: hex digits upper case, alpha in percent. */
export function colorChannels(rgba: Rgba, format: Format, hsv: number[]): string[] {
  const [r, g, b, a] = rgba;
  if (format === "CSS") return [formatColor(rgba, "CSS")];
  if (format === "Hex") return [formatColor([r, g, b, 1], "Hex").slice(1).toUpperCase(), String(percent(a))];
  const [h, s, third] = format === "HSL" ? rgbToHsl(r, g, b) : hsv;
  const parts = format === "RGB" ? [r, g, b] : [format === "HSB" || s ? h : hsv[0], s * 100, third * 100];
  return [...parts.map(part => String(round(part))), String(percent(a))];
}

const channelNames: Record<Format, string[]> = {
  Hex: ["Hex", "Opacity"], RGB: ["Red", "Green", "Blue", "Opacity"], HSL: ["Hue", "Saturation", "Lightness", "Opacity"],
  HSB: ["Hue", "Saturation", "Brightness", "Opacity"], CSS: ["CSS color"],
};
const channelMax: Record<string, number> = { Red: 255, Green: 255, Blue: 255, Hue: 360 };

/** Colors the page itself paints: its most used text, fill, border and SVG colors, sampled cheaply. */
export function documentColors(root: ParentNode = document.body, limit = 12, sample = 600): string[] {
  const counts = new Map<string, number>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode() as Element | null, seen = 0; node && seen < sample; node = walker.nextNode() as Element | null, seen++) {
    if (node.hasAttribute("data-branch-comments")) continue;
    const style = getComputedStyle(node);
    for (const property of ["color", "background-color", "border-top-color", "fill", "stroke"]) {
      if (property === "border-top-color" && !parseFloat(style.borderTopWidth)) continue;
      const rgba = parseColor(style.getPropertyValue(property));
      if (!rgba?.[3]) continue;
      const key = formatColor(rgba, "Hex");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].sort((x, y) => y[1] - x[1]).slice(0, limit).map(([color]) => color);
}

const recentKey = () => `branch-comments:colors:${document.querySelector("[data-branch-comments]")?.getAttribute("data-branch-comments") || location.host}`;

/** Colors committed here before, newest first, per project. */
export function recentColors(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(recentKey()) ?? "[]");
    return Array.isArray(saved) ? saved.filter(item => typeof item === "string" && parseColor(item)).slice(0, 8) : [];
  } catch { return []; }
}

export function rememberColor(color: string): void {
  try { localStorage.setItem(recentKey(), JSON.stringify([color, ...recentColors().filter(item => item !== color)].slice(0, 8))); } catch { /* Private mode keeps no recents. */ }
}

/** The first relevant token whose value for the current theme is this color. */
export function matchingToken(rgba: Rgba, tokens: readonly DesignToken[], property: string): DesignToken | undefined {
  const hex = formatColor(rgba, "Hex");
  return tokensFor(tokens, property).find(token => token.type === "color" && token.value && !/var\(/i.test(token.value) && (() => {
    const value = parseColor(token.value);
    return value && formatColor(value, "Hex") === hex;
  })());
}

const css = `.komo-color{display:grid;gap:8px;padding:8px}.komo-color__area{position:relative;aspect-ratio:4/3;border-radius:6px;background:linear-gradient(to top,#000,#0000),linear-gradient(to right,#fff,#0000),var(--hue);cursor:crosshair;touch-action:none}.komo-color__area>i,.komo-color__track>i{position:absolute;width:12px;height:12px;box-sizing:border-box;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #0006,inset 0 0 0 1px #0004;translate:-50% -50%;pointer-events:none}.komo-color__row{display:flex;align-items:center;gap:8px}.komo-color__tools{display:flex;align-items:center;gap:4px}.komo-color__sliders{display:grid;flex:1;gap:8px;min-width:0}.komo-color__track{position:relative;height:10px;border-radius:5px;cursor:pointer;touch-action:none}.komo-color__track>i{top:50%;width:14px;height:14px}.komo-color__hue{background:linear-gradient(to right,red,#ff0,lime,cyan,blue,#f0f,red)}.komo-color__alpha,.komo-color__chip,.komo-color__swatches button{background:linear-gradient(var(--color),var(--color)),repeating-conic-gradient(#ffffff40 0 25%,#ffffff12 0 50%) 0 0/8px 8px}.komo-color__alpha{background:linear-gradient(to right,#0000,var(--solid)),repeating-conic-gradient(#ffffff40 0 25%,#ffffff12 0 50%) 0 0/8px 8px}.komo-color__chip{width:20px;height:20px;border-radius:5px;box-shadow:inset 0 0 0 1px #ffffff26}.komo-color__drop{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:none;color:#b5b1ab;cursor:pointer}.komo-color__drop:hover{background:#ffffff14;color:#f1efeb}.komo-color__drop svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}.komo-color__value{display:flex;gap:4px;min-width:0}.komo-color__value select{flex:none;width:64px;height:24px;padding:0 16px 0 6px;border:0;border-radius:5px;box-shadow:none;appearance:none;background:#ffffff0a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1.5 3 4 5.5 6.5 3' fill='none' stroke='%23898680' stroke-width='1.2'/%3E%3C/svg%3E") right 5px center/8px no-repeat;color:#f1efeb;font:inherit;cursor:pointer}.komo-color__channels{display:flex;flex:1;min-width:0;border-radius:5px;background:#ffffff0a}.komo-color__channels label{display:flex;flex:1;align-items:center;min-width:0}.komo-color__channels label:first-child{flex:2.2}.komo-color__channels[data-format=RGB] label:first-child,.komo-color__channels[data-format=HSL] label:first-child,.komo-color__channels[data-format=HSB] label:first-child{flex:1}.komo-color__channels span{flex:none;width:12px;color:#77736f;font-size:9px;text-align:center;cursor:ew-resize;user-select:none;touch-action:none}.komo-color__channels span:hover{color:#e9e6e1}.komo-color__channels input{width:100%;min-width:0;height:24px;box-sizing:border-box;padding:0 2px;border:0;border-radius:0;outline:0;box-shadow:none;background:none;color:#f1efeb;font:inherit;font-variant-numeric:tabular-nums}.komo-color__channels input:focus,.komo-color__channels input:focus-visible{outline:0;box-shadow:none}.komo-color__channels:hover{box-shadow:inset 0 0 0 1px #ffffff1c}.komo-color__channels:focus-within{box-shadow:inset 0 0 0 1px #bda6ef}.komo-color__channels [aria-invalid=true]{color:#f8a898}.komo-tokens .komo-color small{position:static;display:block;margin:2px 0 4px;padding:0;background:none;color:#77736f;font-size:10px}.komo-color__swatches>div{display:flex;flex-wrap:wrap;gap:4px}.komo-color__swatches button{width:16px;height:16px;padding:0;border:0;border-radius:4px;box-shadow:inset 0 0 0 1px #ffffff26;cursor:pointer}.komo-color__match{display:flex;align-items:center;gap:6px;color:#b5b1ab;font-size:10px}.komo-color__match span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.komo-color__match button{padding:0;border:0;background:none;color:#bda6ef;font:inherit;cursor:pointer}.komo-color [role=slider]:focus-visible,.komo-color button:focus-visible{outline:1px solid #bda6ef;outline-offset:2px}.komo-color select:focus-visible{outline:0;box-shadow:inset 0 0 0 1px #bda6ef}@media (pointer:coarse){.komo-color__track{height:16px}.komo-color__value select,.komo-color__channels input{height:32px}.komo-color__swatches button{width:24px;height:24px}}`;

const DROPPER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 3.5 3 3M11 2a1.4 1.4 0 0 1 2 2l-1.5 1.5-2-2zM10 5 4 11l-1 3 3-1 6-6"/></svg>';

export interface ColorEditorHost {
  /** Transient preview; the next preview, a commit or Escape replaces it. */
  preview(value: string): void;
  /** Keeps the value: pointer-up, Enter, blur or a swatch. */
  commit(value: string): void;
  /** Use the token instead of a raw value. */
  token(token: DesignToken): void;
}

/** The Custom tab for color properties. */
export function pickerEditor(options: TokenPickerOptions, host: ColorEditorHost): HTMLElement & { live: true; refresh(value: string): void; destroy(): void } {
  const { property } = options;
  const box = el("div", "komo-color");
  const style = el("style", "", css);
  let [h, s, v, a] = [0, 0, 0, 1];
  let format: Format = "Hex";
  try { format = formats.find(name => name === localStorage.getItem("branch-comments:color-format")) ?? format; } catch { /* Defaults to Hex. */ }
  let dirty = false, gone = false;
  let raw: string | undefined;
  const rgba = (): Rgba => [...hsvToRgb(h, s, v), a] as Rgba;
  const value = () => raw ?? formatColor(rgba(), format, h);
  /** What a commit compares, so a format switch or an unchanged gesture keeps nothing new. */
  const key = () => raw ?? formatColor(rgba(), "Hex");
  const take = (next: Rgba) => {
    const [nh, ns, nv] = rgbToHsv(next[0], next[1], next[2]);
    if (nv && ns) h = nh;
    if (nv) s = ns;
    v = nv;
    a = next[3];
  };
  const read = (text: string) => { const next = parseColor(text); if (next) take(next); return !!next; };
  read(options.custom!.value);
  let last = key();

  const slider = (className: string, label: string) => {
    const node = el("div", className);
    node.tabIndex = 0;
    node.setAttribute("role", "slider");
    node.setAttribute("aria-label", label);
    node.append(el("i"));
    return node;
  };
  const area = slider("komo-color__area", "Saturation and brightness");
  const hue = slider("komo-color__track komo-color__hue", "Hue");
  const alpha = slider("komo-color__track komo-color__alpha", "Opacity");
  hue.setAttribute("aria-valuemax", "360");
  for (const node of [area, hue, alpha]) node.setAttribute("aria-valuemin", "0");
  area.setAttribute("aria-valuemax", "100");
  alpha.setAttribute("aria-valuemax", "100");
  const chip = el("span", "komo-color__chip");
  chip.setAttribute("aria-hidden", "true");
  const tools = el("div", "komo-color__tools");
  const EyeDropper = (globalThis as typeof globalThis & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
  if (EyeDropper && isSecureContext) {
    const drop = el("button", "komo-color__drop");
    drop.type = "button";
    drop.title = "Pick from screen";
    drop.setAttribute("aria-label", "Pick color from screen");
    drop.innerHTML = DROPPER;
    drop.onclick = async () => {
      try {
        const { sRGBHex } = await new EyeDropper().open();
        if (box.isConnected && read(sRGBHex)) change(true);
      } catch { /* Cancelled. */ }
    };
    tools.append(drop);
  }
  tools.append(chip);
  const sliders = el("div", "komo-color__sliders");
  sliders.append(hue, alpha);
  const row = el("div", "komo-color__row");
  row.append(tools, sliders);

  const select = el("select");
  select.setAttribute("aria-label", "Color format");
  for (const name of formats) select.append(new Option(name, name));
  const channels = el("div", "komo-color__channels");
  const valueRow = el("div", "komo-color__value");
  valueRow.append(select, channels);
  const swatches = el("div", "komo-color__swatches");
  const match = el("div", "komo-color__match");
  match.hidden = true;
  box.append(style, area, row, valueRow, swatches, match);

  let matched: DesignToken | undefined;
  /** Paints everything from the state; `keep` is the channel being typed in, left as typed. */
  function paint(keep?: HTMLInputElement) {
    const color = rgba(), [r, g, b] = color;
    const solid = `rgb(${round(r)} ${round(g)} ${round(b)})`;
    box.style.setProperty("--hue", `hsl(${round(h)} 100% 50%)`);
    box.style.setProperty("--solid", solid);
    box.style.setProperty("--color", formatColor(color, "RGB"));
    const place = (node: HTMLElement, x: number, y = 50) => { const thumb = node.firstElementChild as HTMLElement; thumb.style.left = `${x}%`; thumb.style.top = `${y}%`; };
    place(area, s * 100, 100 - v * 100);
    place(hue, h / 3.6);
    place(alpha, a * 100);
    area.setAttribute("aria-valuenow", String(percent(s)));
    area.setAttribute("aria-valuetext", `Saturation ${percent(s)}%, brightness ${percent(v)}%`);
    hue.setAttribute("aria-valuenow", String(round(h)));
    hue.setAttribute("aria-valuetext", `Hue ${round(h)}°`);
    alpha.setAttribute("aria-valuenow", String(percent(a)));
    alpha.setAttribute("aria-valuetext", `Opacity ${percent(a)}%`);
    select.value = format;
    const shown = colorChannels(color, format, [h, s, v]);
    if (channels.dataset.format !== format) build();
    channels.querySelectorAll("input").forEach((input, index) => {
      const next = format === "CSS" ? value() : shown[index];
      if (input === keep || input.value === next) return;
      // A theme refresh under a focused channel keeps its caret.
      const { selectionStart: start, selectionEnd: end } = input;
      input.value = next;
      input.removeAttribute("aria-invalid");
      if (start !== null && input === (input.getRootNode() as Document).activeElement) input.setSelectionRange(start, end);
    });
    const token = matchingToken(color, options.tokens, property);
    match.hidden = !token;
    if (token && token !== matched) {
      matched = token;
      const label = token.label || token.path;
      match.replaceChildren(el("span", "", `Matches ${label}`), Object.assign(el("button", "", "Use it"), { type: "button", onclick: () => host.token(token) }));
      match.lastElementChild!.setAttribute("aria-label", `Use token ${label}`);
    }
  }

  /** A change from a control: preview it, and keep it when the gesture ends. */
  function change(keep: boolean, typing?: HTMLInputElement | true) {
    // Chrome blurs a focused channel as the closed popup is removed; that blur keeps nothing.
    if (gone) return;
    dirty = true;
    if (!typing) raw = undefined;
    paint(typing === true ? undefined : typing);
    if (!keep) return host.preview(value());
    if (key() !== last) { host.commit(value()); rememberColor(formatColor(rgba(), "Hex")); }
    last = key();
  }

  /** The channel inputs for the current format. */
  function build() {
    channels.dataset.format = format;
    channels.replaceChildren(...channelNames[format].map((name, index) => {
      const label = el("label");
      const handle = el("span", "", format === "Hex" ? (index ? "%" : "#") : format === "CSS" ? "" : name[0]);
      const input = el("input");
      input.setAttribute("aria-label", format === "Hex" && index ? "Opacity" : name);
      input.spellcheck = false;
      input.autocomplete = "off";
      const numeric = format !== "CSS" && !(format === "Hex" && !index);
      if (numeric) input.inputMode = "decimal";
      const typed = (text: string): boolean => {
        if (format === "CSS") { const ok = !!text.trim() && !!globalThis.CSS?.supports?.(property, text) && !/[{};]/.test(text); if (ok) { raw = text.trim(); read(text); } return ok; }
        // Hex digits set the color; the opacity channel keeps its own value.
        if (!numeric) { const opacity = a; const ok = /^[\da-f]{3}([\da-f]{3})?$/i.test(text.trim()) && read(text); a = opacity; return ok; }
        const number = Number(text);
        if (text.trim() === "" || !Number.isFinite(number)) return false;
        const values = [...channels.querySelectorAll("input")].map(item => Number(item === input ? number : item.value));
        const [x, y, z] = values, opacity = clamp(values[values.length - 1], 0, 100) / 100;
        if (format === "Hex") { a = opacity; return true; }
        const ranged = [clamp(x, 0, channelMax[channelNames[format][0]]), clamp(y, 0, format === "RGB" ? 255 : 100), clamp(z, 0, format === "RGB" ? 255 : 100)];
        if (format === "HSB") [h, s, v] = [ranged[0] % 360, ranged[1] / 100, ranged[2] / 100];
        else {
          take([...(format === "RGB" ? ranged : hslToRgb(ranged[0] % 360, ranged[1] / 100, ranged[2] / 100)), 1] as Rgba);
          if (format === "HSL") h = ranged[0] % 360;
        }
        a = opacity;
        return true;
      };
      input.oninput = () => {
        dirty = true;
        const ok = typed(input.value);
        input.setAttribute("aria-invalid", String(!ok));
        if (ok) change(false, input);
      };
      input.onkeydown = event => {
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (input.getAttribute("aria-invalid") !== "true") change(true, true); }
        else if (numeric && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          nudge((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1), true);
        }
      };
      input.onblur = () => { if (input.getAttribute("aria-invalid") !== "true" && key() !== last) change(true, true); };
      input.onpaste = event => {
        const text = event.clipboardData?.getData("text") ?? "";
        const pasted = parseColor(text);
        if (!pasted || (!numeric && /^#?[\da-f]{6}$/i.test(text.trim()))) return;
        event.preventDefault();
        if (format === "CSS") raw = text.trim();
        else take(pasted);
        change(true, format === "CSS" || undefined);
      };
      const nudge = (steps: number, keep: boolean) => {
        const current = Number(input.value) || 0;
        const max = format === "Hex" || index === channelNames[format].length - 1 ? 100 : channelMax[name] ?? (format === "RGB" ? 255 : 100);
        input.value = String(clamp(round(current + steps), 0, max));
        if (typed(input.value)) change(keep);
      };
      if (numeric) {
        handle.title = `${name} · drag to adjust`;
        handle.onpointerdown = event => {
          event.preventDefault();
          handle.setPointerCapture?.(event.pointerId);
          let x = event.clientX;
          handle.onpointermove = move => {
            const steps = Math.trunc((move.clientX - x) / 2);
            if (!steps) return;
            x += steps * 2;
            nudge(steps * (move.shiftKey ? 10 : 1), false);
          };
          handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; change(true); };
        };
      }
      label.append(handle, input);
      return label;
    }));
  }

  select.onchange = () => {
    format = select.value as Format;
    raw = undefined;
    try { localStorage.setItem("branch-comments:color-format", format); } catch { /* Not remembered. */ }
    paint();
  };

  /** Pointer and keyboard for the area and the two tracks. */
  const drive = (node: HTMLElement, set: (x: number, y: number) => void, keys: (key: string, step: number) => boolean) => {
    const at = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      set(clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1));
      change(false);
    };
    node.onpointerdown = event => {
      if (event.button) return;
      event.preventDefault();
      node.focus({ preventScroll: true });
      node.setPointerCapture?.(event.pointerId);
      at(event);
      node.onpointermove = at;
      node.onpointerup = node.onpointercancel = () => { node.onpointermove = null; change(true); };
    };
    node.onkeydown = event => {
      if (!keys(event.key, event.shiftKey ? 10 : 1)) return;
      event.preventDefault();
      event.stopPropagation();
      change(true);
    };
  };
  drive(area, (x, y) => { s = x; v = 1 - y; }, (key, step) => {
    const d = step / 100;
    if (key === "ArrowLeft" || key === "ArrowRight") s = clamp(s + (key === "ArrowRight" ? d : -d), 0, 1);
    else if (key === "ArrowUp" || key === "ArrowDown") v = clamp(v + (key === "ArrowUp" ? d : -d), 0, 1);
    else if (key === "Home" || key === "End") s = key === "End" ? 1 : 0;
    else if (key === "PageUp" || key === "PageDown") v = clamp(v + (key === "PageUp" ? .1 : -.1), 0, 1);
    else return false;
    return true;
  });
  const linear = (set: (x: number) => void, get: () => number, max: number) => (key: string, step: number) => {
    const next = key === "Home" ? 0 : key === "End" ? max : get() + ({ ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 10, PageDown: -10 } as Record<string, number>)[key];
    if (Number.isNaN(next)) return false;
    set(clamp(next, 0, max));
    return true;
  };
  drive(hue, x => { h = x * 360; }, linear(x => { h = x; }, () => h, 360));
  drive(alpha, x => { a = x; }, linear(x => { a = x / 100; }, () => a * 100, 100));

  /** Swatches load after the popup has painted, so sampling the page never delays it. */
  const fill = () => {
    const groups = [["Document colors", documentColors()], ["Recent", recentColors()]] as const;
    swatches.replaceChildren(...groups.filter(([, colors]) => colors.length).flatMap(([title, colors]) => {
      const list = el("div");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", title);
      list.append(...colors.map(color => {
        const button = el("button");
        button.type = "button";
        button.title = color;
        button.setAttribute("aria-label", `${title === "Recent" ? "Recent" : "Document"} color ${color}`);
        button.style.setProperty("--color", color);
        button.onclick = () => { if (read(color)) change(true); };
        return button;
      }));
      return [el("small", "", title), list];
    }));
  };
  setTimeout(() => { if (box.isConnected) fill(); }, 16);


  paint();
  return Object.assign(box, {
    live: true as const,
    destroy() { gone = true; },
    refresh(next: string) {
      if (dirty || !read(next)) return;
      last = key();
      paint();
    },
  });
}
