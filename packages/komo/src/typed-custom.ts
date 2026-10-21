import { cssParts, primaryFamily } from "./css-value-parts.js";
export { cssParts, primaryFamily } from "./css-value-parts.js";
import { el } from "./dom.js";
import type { Field } from "./design-panel.js";
import type { DesignToken } from "./design-system.js";

// Design mode's typed Custom editors (lengths, spacing, radius, shadows, fonts): compact
// fields like the inspector's, with the unit as a small inline menu, a label that scrubs
// and arrow nudges. `send(value, keep)` previews a change or keeps it when a gesture ends
// (pointer-up, Enter, blur, a menu or a toggle). Comments stay out of the CSS string: they would ship.

const length = /^([+-]?(?:\d*\.)?\d+)([a-z%]*)$/i;
export type ShadowLayer = { lengths: string[]; color: string; inset: boolean; hidden?: boolean };
export function shadowLayers(value: string, property = "box-shadow"): ShadowLayer[] | undefined {
  if (value === "none") return [];
  const layers: ShadowLayer[] = [];
  for (const part of cssParts(value, true)) {
    const words = cssParts(part), lengths: string[] = [];
    let color = "", inset = false, afterLengths = false;
    for (const word of words) {
      if (word === "inset" && property === "box-shadow" && !inset) { inset = true; continue; }
      if (length.test(word)) { if (afterLengths) return; lengths.push(word); }
      else if (!color && !/var\(/i.test(word) && CSS.supports("color", word)) { color = word; afterLengths = lengths.length > 0; }
      else return;
    }
    if (lengths.length < 2 || lengths.length > (property === "box-shadow" ? 4 : 3)) return;
    layers.push({ lengths, color, inset });
  }
  return layers.length ? layers : undefined;
}

/** The shadow value for its layers; `none` once the last layer is removed. */
export function shadowValue(layers: readonly ShadowLayer[]): string {
  return layers.filter(layer => !layer.hidden).map(layer => [...(layer.inset ? ["inset"] : []), ...layer.lengths, layer.color].filter(Boolean).join(" ")).join(", ") || "none";
}

/** A shadow color as people read it: `#000000 · 25%` for rgb() and rgba(), anything else as written. */
export function readableColor(value: string): string {
  const parts = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value.trim());
  if (!parts) return value || "currentColor";
  const hex = `#${parts.slice(1, 4).map(part => Math.round(Number(part)).toString(16).padStart(2, "0")).join("")}`;
  const alpha = parts[4] === undefined ? 1 : Number(parts[4]) / (parts[5] ? 100 : 1);
  return alpha < 1 ? `${hex} · ${Math.round(alpha * 100)}%` : hex;
}

export type FontParts = { style: string; weight: string; size: string; lineHeight: string; family: string };
const fontPattern = /^\s*((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|[1-9]00)\s+)*)([+-]?(?:\d*\.)?\d+[a-z%]*)(?:\s*\/\s*((?:\d*\.)?\d+[a-z%]*|normal))?(?:\s+([\s\S]+?))?\s*$/i;
/** A `font` shorthand as style, weight, size, line height and family; a token may leave the family out. */
export function fontParts(value: string): FontParts | undefined {
  const match = fontPattern.exec(value);
  if (!match) return;
  const words = match[1].trim().split(/\s+/).filter(Boolean);
  return {
    style: words.filter(word => /^(italic|oblique|small-caps)$/i.test(word)).join(" "),
    weight: words.find(word => /^(bold|bolder|lighter|[1-9]00)$/i.test(word)) ?? "",
    size: match[2], lineHeight: match[3] ?? "", family: match[4] ?? "",
  };
}
export function fontValue(font: FontParts): string {
  return [font.style, font.weight, font.size + (font.lineHeight ? `/${font.lineHeight}` : ""), font.family].filter(Boolean).join(" ");
}

/** One step of a nudge: tenths for unitless numbers and font-relative units, else whole units. */
export function nudged(value: string, steps: number): string {
  const match = length.exec(value.trim());
  if (!match) return value;
  const fine = !match[2] || /^r?em$/i.test(match[2]);
  const next = Math.round((parseFloat(match[1]) + steps * (fine ? 0.1 : 1)) * 1000) / 1000;
  return `${next}${match[2]}`;
}

export const css = `.komo-custom{display:flex;flex:1;flex-direction:column;min-height:0}.komo-custom__body{display:grid;gap:8px;padding:8px;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.komo-typed{display:grid;gap:6px;min-width:0}.komo-typed__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.komo-typed__field,.komo-typed__color,.komo-typed__menu{display:flex;align-items:center;box-sizing:border-box;width:100%;min-width:0;height:28px;border-radius:6px;background:#ffffff0a;box-shadow:none;color:#f1efeb;font:inherit;font-size:11px}.komo-typed__field:hover,.komo-typed__color:hover,.komo-typed__menu:hover{box-shadow:inset 0 0 0 1px #ffffff1c}.komo-typed__field:focus-within,.komo-typed__color:focus-visible,.komo-typed__menu:focus-visible{outline:0;box-shadow:inset 0 0 0 1px #bda6ef}.komo-typed__field>span{flex:none;display:grid;place-items:center;min-width:24px;height:100%;padding:0 2px 0 6px;color:#77736f;font-size:10px;font-weight:500;cursor:ew-resize;user-select:none;touch-action:none}.komo-typed__field>span:hover{color:#e9e6e1}.komo-typed__field>span svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.1}.komo-typed__field input{flex:1;width:100%;min-width:0;height:100%;margin:0;padding:0 2px;border:0;border-radius:0;outline:0;box-shadow:none;background:none;color:inherit;font:inherit;font-variant-numeric:tabular-nums}.komo-typed__field input:focus,.komo-typed__field input:focus-visible,.komo-typed__field select:focus,.komo-typed__field select:focus-visible{outline:0;box-shadow:none}.komo-typed__field select{flex:none;width:auto;max-width:44px;height:100%;margin:0;padding:0 8px 0 2px;border:0;border-radius:0 6px 6px 0;box-shadow:none;appearance:none;background:none;color:#77736f;font:inherit;font-size:10px;text-align:right;cursor:pointer}.komo-typed__field select:hover{color:#f1efeb}.komo-typed__menu{padding:0 20px 0 8px;border:0;appearance:none;background:#ffffff0a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1.5 3 4 5.5 6.5 3' fill='none' stroke='%23898680' stroke-width='1.2'/%3E%3C/svg%3E") right 7px center/8px no-repeat;cursor:pointer}.komo-typed [aria-invalid=true]{color:#f8a898}.komo-typed__layer{display:grid;gap:6px}.komo-typed__layer[data-hidden] .komo-typed__grid{opacity:.45}.komo-typed__row{display:flex;align-items:center;gap:4px;min-width:0}.komo-typed__row>.komo-typed__menu{flex:none;width:64px}.komo-typed__row>.komo-typed__color{flex:1;gap:6px;padding:0 6px}.komo-typed__color .komo-typed__alpha{flex:none;margin-left:auto;color:#898680;font-size:10px}.komo-typed button.komo-typed__icon{display:grid;place-items:center;flex:none;width:24px;padding:0}.komo-typed__icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}.komo-typed__tile{display:grid;place-items:center;height:56px;border-radius:6px;background:repeating-conic-gradient(#ffffff0a 0 25%,#ffffff04 0 50%) 0 0/12px 12px}.komo-typed__tile i{display:grid;place-items:center;width:32px;height:32px;border-radius:6px;background:#f1efeb;color:#f1efeb;font-style:normal;font-size:20px;font-weight:600}.komo-typed__tile i:not(:empty){width:auto;height:auto;background:none}.komo-typed__layer+.komo-typed__layer{padding-top:8px;border-top:1px solid #ffffff0d}.komo-typed__head{display:flex;align-items:center;gap:2px;min-height:24px}.komo-typed__head b{flex:1;color:#b5b1ab;font-size:10px;font-weight:500}.komo-typed button:not(.komo-typed__color){height:24px;padding:0 8px;border:0;border-radius:5px;background:none;color:#898680;font:inherit;font-size:10px;cursor:pointer}.komo-typed button:not(.komo-typed__color):hover{background:#ffffff14;color:#f1efeb}.komo-typed button[aria-pressed=true]{background:#bda6ef24;color:#e6dcfb}.komo-typed button:focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}.komo-typed__color{gap:8px;padding:0 8px;border:0;justify-content:flex-start;text-align:left;font-variant-numeric:tabular-nums;cursor:pointer}.komo-typed__color i{flex:none;width:14px;height:14px;border-radius:3px;box-shadow:inset 0 0 0 1px #ffffff26;background:linear-gradient(var(--c),var(--c)),repeating-conic-gradient(#ffffff40 0 25%,#ffffff12 0 50%) 0 0/8px 8px}.komo-typed__color span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.komo-typed .komo-color{padding:0}.komo-typed__sample{display:flex;align-items:center;gap:8px;min-width:0;height:36px;padding:0 8px;border-radius:6px;background:#ffffff08}.komo-typed__sample b{flex:none;font-size:20px;font-weight:400}.komo-typed__sample span{overflow:hidden;color:#b5b1ab;text-overflow:ellipsis;white-space:nowrap}.komo-typed__hint{color:#898680;font-size:10px;line-height:1.5}.komo-custom .komo-typed__advanced>summary{display:flex;align-items:center;height:auto;min-height:24px;color:#77736f;font-size:10px;font-weight:500;list-style:none;cursor:pointer}.komo-typed__advanced>summary::-webkit-details-marker{display:none}.komo-custom .komo-typed__advanced>summary:hover{color:#e9e6e1}.komo-typed__advanced>summary:focus-visible{outline:1px solid #bda6ef;outline-offset:-1px;border-radius:4px}@media (max-width:520px){.komo-typed__font{grid-template-columns:minmax(0,1fr)}}@media (pointer:coarse){.komo-typed__field,.komo-typed__color,.komo-typed__menu{height:36px}.komo-typed button:not(.komo-typed__color){height:32px}}`;

const units = ["px", "%", "rem", "em", "vw", "vh", "ch", "vmin", "vmax", "dvh"];
const EYE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
const MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
/** A quiet icon button; `pressed` makes it a toggle. */
function iconButton(label: string, icon: string, onclick: () => void, pressed?: boolean): HTMLButtonElement {
  const button = el("button", "komo-typed__icon");
  button.type = "button";
  button.innerHTML = icon;
  button.title = label;
  button.setAttribute("aria-label", label);
  if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
  button.onclick = onclick;
  return button;
}
const SCRUB = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10M3 4 1 6l2 2M9 4l2 2-2 2"/></svg>';

/**
 * A value and its unit in one inspector-style field: typing previews, Enter or blur keeps,
 * ArrowUp/Down nudge (Shift ten times), dragging the label scrubs and keeps on release,
 * and the unit menu keeps at once.
 */
function lengthField(name: string, short: string, value: string, change: (next: string, keep: boolean) => boolean, incomplete: Set<HTMLElement>, { unitless = false, optional = false } = {}): HTMLElement {
  const box = el("div", "komo-typed__field");
  const handle = el("span");
  if (short) handle.textContent = short;
  else handle.innerHTML = SCRUB;
  handle.title = `${name} · drag to adjust`;
  const input = el("input");
  input.setAttribute("aria-label", name);
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  const unit = el("select");
  unit.setAttribute("aria-label", `${name} unit`);
  const match = length.exec(value) ?? ["", "", ""];
  input.value = match[1];
  const current = match[2] || (unitless || !match[1] && optional ? "" : "px");
  for (const name of new Set([current, ...units, ...(unitless ? [""] : [])])) {
    const option = el("option", "", name || "—");
    option.value = name;
    if (!name) option.title = "No unit";
    unit.append(option);
  }
  unit.value = current;
  let typed = false;
  // A field left empty or invalid holds back every other field of the editor until it is fixed.
  const send = (keep: boolean) => {
    const empty = optional && !input.value.trim();
    const valid = empty || length.test(input.value.trim() + unit.value);
    if (valid) incomplete.delete(input);
    else incomplete.add(input);
    const ok = valid && change(empty ? "" : input.value.trim() + unit.value, keep);
    input.setAttribute("aria-invalid", String(!valid));
    if (keep) typed = false;
    return ok;
  };
  const nudge = (steps: number, keep: boolean) => {
    const next = length.exec(nudged(input.value.trim() + unit.value, steps));
    if (!next) return;
    input.value = next[1];
    send(keep);
  };
  input.oninput = () => { typed = true; send(false); };
  input.onkeydown = event => {
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); send(true); }
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1), true);
    }
  };
  input.onblur = () => { if (typed) send(true); };
  unit.onchange = () => send(true);
  handle.onpointerdown = event => {
    if (event.button) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    let x = event.clientX, moved = false;
    handle.onpointermove = move => {
      const steps = Math.trunc((move.clientX - x) / 2);
      if (!steps) return;
      x += steps * 2;
      moved = true;
      nudge(steps * (move.shiftKey ? 10 : 1), false);
    };
    handle.onpointerup = handle.onpointercancel = () => {
      handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
      if (moved) send(true);
      else input.focus();
    };
  };
  box.append(handle, input, unit);
  return box;
}

export function typedCustom(body: HTMLElement, property: string, initial: string, exact: HTMLInputElement,
  send: (value: string, keep: boolean) => boolean, field?: Field, tokens: readonly DesignToken[] = []) {
  const controls = el("div", "komo-typed");
  const advanced = el("details", "komo-typed komo-typed__advanced");
  const summary = el("summary", "", "Edit as CSS");
  // The popup cancels default clicks inside it (it sits in the field's <label>), so the summary toggles itself.
  summary.onclick = event => { event.preventDefault(); event.stopPropagation(); advanced.open = !advanced.open; };
  const exactField = el("div", "komo-typed__field");
  exact.title = property;
  exact.autocomplete = "off";
  exact.spellcheck = false;
  exactField.append(el("span", "", "CSS"), exact);
  advanced.append(summary, exactField);
  body.append(controls, advanced);
  let typedExact = false;
  const incomplete = new Set<HTMLElement>();
  exact.oninput = () => { typedExact = true; if (send(exact.value, false)) draw(exact.value, true); };
  exact.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); typedExact = false; send(exact.value, true); } };
  exact.onblur = () => { if (typedExact) { typedExact = false; send(exact.value, true); } };

  const menu = (label: string, values: Array<[string, string]>, current: string, pick: (value: string) => void) => {
    const select = el("select", "komo-typed__menu");
    select.setAttribute("aria-label", label);
    for (const [value, text] of values) { const option = el("option", "", text); option.value = value; option.title = value; select.append(option); }
    select.value = current;
    select.onchange = () => pick(select.value);
    return select;
  };

  /** Draws the controls for a value; `quiet` keeps the exact field as typed. */
  function draw(next: string, quiet = false) {
    if (!quiet) exact.value = next;
    incomplete.clear();
    controls.replaceChildren();
    if (property === "font-family") {
      const sample = el("div", "komo-typed__sample"), aa = el("b", "", "Aa"), name = el("span", "", primaryFamily(next));
      sample.title = next;
      aa.style.fontFamily = next;
      sample.append(aa, name);
      controls.append(sample);
      const choices = tokens.filter(token => token.type === "fontFamily" && token.value && CSS.supports(property, token.value));
      if (choices.length) controls.append(menu("Font family choices", [[next, `Custom · ${primaryFamily(next)}`], ...choices.map(token => [token.value, token.label || primaryFamily(token.value)] as [string, string])], next, value => {
        if (send(value, true)) draw(value);
      }));
      else advanced.open = true;
    } else if (/^(box|text)-shadow$/.test(property)) {
      const layers = shadowLayers(next, property);
      if (!layers) { controls.append(el("span", "komo-typed__hint", "Complex shadow · edit it as CSS below.")); advanced.open = true; return; }
      const boxShadow = property === "box-shadow";
      // A small tile shows the shadow as it is now.
      const tile = el("div", "komo-typed__tile"), sample = el("i", "", boxShadow ? "" : "Ag");
      tile.setAttribute("aria-hidden", "true");
      tile.append(sample);
      const update = (keep: boolean) => {
        sample.style.setProperty(property, shadowValue(layers));
        return send(shadowValue(layers), keep);
      };
      sample.style.setProperty(property, shadowValue(layers));
      const top = el("div", "komo-typed__head");
      top.append(el("b", "", "Layers"), iconButton("Add shadow layer", PLUS, () => {
        layers.push({ lengths: ["0px", "2px", "4px", "0px"].slice(0, boxShadow ? 4 : 3), color: "#00000040", inset: false });
        if (update(true)) draw(shadowValue(layers));
      }));
      controls.append(tile, top);
      layers.forEach((layer, index) => {
        const name = `Layer ${index + 1}`;
        const group = el("div", "komo-typed__layer");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", `Shadow layer ${index + 1}`);
        group.toggleAttribute("data-hidden", !!layer.hidden);
        const row = el("div", "komo-typed__row");
        if (boxShadow) row.append(menu(`${name} type`, [["drop", "Drop"], ["inner", "Inner"]], layer.inset ? "inner" : "drop", value => { layer.inset = value === "inner"; update(true); }));
        // The color shows as a swatch, its hex and its opacity; it opens the color picker in place.
        const color = el("button", "komo-typed__color");
        color.type = "button";
        color.setAttribute("aria-label", `${name} color`);
        color.setAttribute("aria-expanded", "false");
        const chip = el("i"), text = el("span"), alpha = el("span", "komo-typed__alpha");
        color.append(chip, text, alpha);
        const paint = () => {
          const [hex, opacity = "100%"] = readableColor(layer.color).split(" · ");
          chip.style.setProperty("--c", layer.color || "currentColor");
          text.textContent = hex.replace(/^#/, "").toUpperCase();
          alpha.textContent = layer.color ? opacity : "";
          color.title = layer.color || "currentColor";
        };
        paint();
        let picker: HTMLElement | undefined;
        color.onclick = async () => {
          if (picker) { picker.remove(); picker = undefined; color.setAttribute("aria-expanded", "false"); return; }
          color.setAttribute("aria-expanded", "true");
          const { pickerEditor } = await import("./color-editor.js");
          if (!color.isConnected || picker) return;
          picker = pickerEditor({ trigger: color, tokens, property: "color", onSelect() {}, custom: { value: layer.color || "#000000", onPreview: () => () => {}, onSelect() {} } }, {
            preview(value) { layer.color = value; paint(); update(false); },
            commit(value) { layer.color = value; paint(); update(true); },
            token(token) { layer.color = token.value; paint(); update(true); },
          });
          group.append(picker);
        };
        const eye = iconButton(`${name} visible`, EYE, () => {
          layer.hidden = !layer.hidden;
          eye.setAttribute("aria-pressed", String(!layer.hidden));
          group.toggleAttribute("data-hidden", !!layer.hidden);
          update(true);
        }, !layer.hidden);
        row.append(color, eye, iconButton(`Remove layer ${index + 1}`, MINUS, () => { layers.splice(index, 1); if (update(true)) draw(shadowValue(layers)); }));
        const grid = el("div", "komo-typed__grid");
        const names = [["X offset", "X"], ["Y offset", "Y"], ["Blur", "Blur"], ["Spread", "Spread"]].slice(0, boxShadow ? 4 : 3);
        names.forEach(([field, short], i) => grid.append(lengthField(`${name} ${field.toLowerCase()}`, short, layer.lengths[i] || "0px", (value, keep) => {
          while (layer.lengths.length <= i) layer.lengths.push("0px");
          layer.lengths[i] = value;
          return !incomplete.size && update(keep);
        }, incomplete)));
        group.append(row, grid);
        controls.append(group);
      });
    } else if (property === "font") {
      // A typography token: family, weight, size and line height, with the CSS below.
      const font = fontParts(next);
      if (!font) { controls.append(el("span", "komo-typed__hint", "Custom expression · edit it as CSS below.")); advanced.open = true; return; }
      const sample = el("div", "komo-typed__sample"), aa = el("b", "", "Aa"), label = el("span");
      sample.setAttribute("aria-hidden", "true");
      sample.append(aa, label);
      const paint = () => {
        Object.assign(aa.style, { fontStyle: font.style, fontWeight: font.weight, fontFamily: font.family });
        label.textContent = [font.family ? primaryFamily(font.family) : "Inherited family", font.weight, font.size + (font.lineHeight ? `/${font.lineHeight}` : "")].filter(Boolean).join(" · ");
      };
      const keep = (live: boolean) => { paint(); return send(fontValue(font), live); };
      paint();
      const families = tokens.filter(token => token.type === "fontFamily" && token.value && CSS.supports("font-family", token.value) && token.value !== font.family);
      // Font sizes carry longer values ("0.875rem"), so on a narrow sheet these fields stack.
      const grid = el("div", "komo-typed__grid komo-typed__font");
      grid.append(
        menu("Font weight", [...new Set([font.weight || "400", "100", "200", "300", "400", "500", "600", "700", "800", "900"])].map(value => [value, value]), font.weight || "400", value => { font.weight = value; keep(true); }),
        lengthField("Font size", "Size", font.size, (value, live) => { font.size = value; return !incomplete.size && keep(live); }, incomplete),
        lengthField("Line height", "LH", font.lineHeight, (value, live) => { font.lineHeight = value; return !incomplete.size && keep(live); }, incomplete, { unitless: true, optional: true }),
      );
      controls.append(sample, menu("Font family", [[font.family, font.family ? primaryFamily(font.family) : "Inherited family"], ...families.map(token => [token.value, token.label || primaryFamily(token.value)] as [string, string])], font.family, value => { font.family = value; keep(true); }), grid);
    } else if (field?.values?.length) {
      controls.append(menu(field.label, [...new Set([next, ...field.values])].map(value => [value, value]), next, value => send(value, true)));
    } else {
      const parts = cssParts(next);
      const shorthand = /^(padding|margin|border-(width|radius)|gap)$/.test(property);
      if (parts.length && parts.every(part => length.test(part)) && (parts.length === 1 || shorthand && parts.length <= 4)) {
        const label = field?.label || property;
        const names = parts.length === 1 ? [[label, ""]]
          : property === "gap" ? [["Row gap", "Row"], ["Column gap", "Col"]]
          : property === "border-radius" ? [["Top left", "TL"], ["Top right", "TR"], ["Bottom right", "BR"], ["Bottom left", "BL"]]
          : [["Top", "T"], ["Right", "R"], ["Bottom", "B"], ["Left", "L"]];
        if (parts.length > 1 && property !== "gap") {
          const [a, b = a, c = a, d = b] = parts;
          parts.splice(0, parts.length, a, b, c, d);
        }
        const fields = parts.map((part, i) => lengthField(names[i][0], names[i][1], part, (value, keep) => { parts[i] = value; return !incomplete.size && send(parts.join(" "), keep); }, incomplete));
        if (fields.length > 1) { const grid = el("div", "komo-typed__grid"); grid.append(...fields); controls.append(grid); }
        else controls.append(...fields);
      } else {
        controls.append(el("span", "komo-typed__hint", "Custom expression · preserved exactly below."));
        advanced.open = true;
      }
    }
  }
  draw(initial);
  return draw;
}
