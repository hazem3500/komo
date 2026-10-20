import { cssParts, primaryFamily } from "./css-value-parts.js";
export { cssParts, primaryFamily } from "./css-value-parts.js";
import { el } from "./dom.js";
import type { Field } from "./design-panel.js";
import type { DesignToken } from "./design-system.js";

let inputId = 0;
const length = /^([+-]?(?:\d*\.)?\d+)([a-z%]*)$/i;
export type ShadowLayer = { lengths: string[]; color: string; inset: boolean };
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

export function typedCustom(body: HTMLElement, property: string, initial: string, exact: HTMLInputElement,
  accept: (value: string) => boolean, field?: Field, tokens: readonly DesignToken[] = []) {
  const style = el("style");
  style.textContent = `.komo-typed{display:grid;gap:8px;min-width:0}.komo-typed__row{display:grid;grid-template-columns:minmax(66px,1fr) minmax(0,1fr) 66px;gap:6px;align-items:center}.komo-typed__row label{display:block;grid-column:auto}.komo-typed__row input,.komo-typed__row select{width:100%}.komo-typed__advanced{min-width:0}.komo-typed__advanced summary{min-height:28px;display:flex;align-items:center;cursor:pointer}.komo-typed__advanced label{display:block}.komo-typed__advanced input{width:100%;margin-top:4px}.komo-typed__sample{display:flex;align-items:center;gap:10px;min-width:0;padding:8px;background:#ffffff08;border-radius:6px}.komo-typed__sample b{font-size:24px}.komo-typed__sample span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.komo-typed__layer{display:grid;gap:6px;padding:8px;border:1px solid #ffffff14;border-radius:6px}.komo-typed__layer input[type=checkbox]{width:24px;height:24px}.komo-typed__hint{color:#aaa;line-height:1.5}.komo-typed>select{width:100%}`;
  const heading = el("strong", "", field?.label || property);
  const controls = el("div", "komo-typed");
  const advanced = el("details", "komo-typed__advanced");
  const summary = el("summary", "", "Advanced · exact CSS");
  summary.onclick = event => { event.preventDefault(); event.stopPropagation(); advanced.open = !advanced.open; };
  exact.title = property;
  const label = el("label", "", `Exact ${property}`);
  label.append(exact);
  advanced.append(summary, label);
  body.append(style, heading, controls, advanced);
  let current = initial;
  const incomplete = new Set<HTMLInputElement>();
  function send(next: string) { exact.value = next; current = next; return accept(incomplete.size ? "" : next); }
  function row(name: string, value: string, change: (next: string) => void, parent = controls) {
    const line = el("div", "komo-typed__row");
    const label = el("label", "", name), input = el("input"), unit = el("select");
    input.type = "number"; input.step = "any";
    input.setAttribute("aria-label", `${name} value`);
    const match = length.exec(value)!;
    input.value = match[1];
    const units = [...new Set([match[2], "px", "%", "rem", "em", "vw", "vh", "ch", "", "vmin", "vmax", "dvh"])];
    for (const name of units) { const option = el("option", "", name || "unitless"); option.value = name; unit.append(option); }
    unit.value = match[2]; unit.setAttribute("aria-label", `${name} unit`);
    const update = () => {
      if (!input.value) { incomplete.add(input); accept(""); input.setAttribute("aria-invalid", "true"); return; }
      incomplete.delete(input); input.removeAttribute("aria-invalid"); change(input.value + unit.value);
    };
    input.oninput = update; unit.onchange = update;
    input.id = `komo-custom-length-${++inputId}`; label.htmlFor = input.id;
    line.append(label, input, unit);
    parent.append(line);
  }
  function draw(next: string) {
    current = next;
    incomplete.clear();
    controls.replaceChildren();
    if (property === "font-family") {
      const sample = el("div", "komo-typed__sample"), aa = el("b", "", "Aa"), name = el("span", "", primaryFamily(next));
      sample.title = next; aa.style.fontFamily = next; sample.append(aa, name); controls.append(sample);
      const choices = tokens.filter(token => token.type === "fontFamily" && token.value && CSS.supports(property, token.value));
      if (choices.length) {
        const select = el("select"); select.setAttribute("aria-label", "Font family choices");
        const current = el("option", "", `Custom · ${primaryFamily(next)}`); current.value = next; select.append(current);
        for (const token of choices) { const option = el("option", "", token.label || primaryFamily(token.value)); option.value = token.value; option.title = token.value; select.append(option); }
        select.onchange = () => { if (send(select.value)) { aa.style.fontFamily = select.value; name.textContent = primaryFamily(select.value); sample.title = select.value; } };
        controls.append(select);
      }
      if (!choices.length) advanced.open = true;
    } else if (/^(box|text)-shadow$/.test(property)) {
      const layers = shadowLayers(next, property);
      if (!layers) { controls.append(el("span", "komo-typed__hint", "Complex shadow · edit the exact CSS below.")); advanced.open = true; return; }
      const update = () => send(layers.map(layer => [...(layer.inset ? ["inset"] : []), ...layer.lengths, layer.color].filter(Boolean).join(" ")).join(", ") || "none");
      layers.forEach((layer, index) => {
        const group = el("div", "komo-typed__layer"); group.setAttribute("role", "group"); group.setAttribute("aria-label", `Shadow layer ${index + 1}`); group.append(el("strong", "", `Layer ${index + 1}`));
        const names = ["X offset", "Y offset", "Blur", "Spread"].slice(0, property === "box-shadow" ? 4 : 3);
        names.forEach((name, i) => row(name, layer.lengths[i] || "0px", value => {
          while (layer.lengths.length <= i) layer.lengths.push("0px");
          layer.lengths[i] = value; update();
        }, group));
        const color = el("input"); color.value = layer.color; color.placeholder = "currentColor"; color.setAttribute("aria-label", `Layer ${index + 1} color`);
        color.oninput = () => { layer.color = color.value; update(); };
        const colorLabel = el("label", "", "Color"); colorLabel.append(color); group.append(colorLabel);
        if (property === "box-shadow") {
          const inset = el("input"); inset.type = "checkbox"; inset.checked = layer.inset;
          const label = el("label", "", "Inset"); label.append(inset); group.append(label);
          inset.onchange = () => { layer.inset = inset.checked; update(); };
        }
        const remove = el("button", "", "Remove layer"); remove.type = "button";
        remove.onclick = () => { layers.splice(index, 1); if (update()) draw(current); };
        group.append(remove); controls.append(group);
      });
      const add = el("button", "", "Add layer"); add.type = "button";
      add.onclick = () => { layers.push({ lengths: ["0px", "2px", "4px"], color: "#00000040", inset: false }); if (update()) draw(current); };
      controls.append(add);
    } else if (field?.values?.length) {
      const select = el("select"); select.setAttribute("aria-label", field.label);
      for (const name of new Set([next, ...field.values])) { const option = el("option", "", name); option.value = name; select.append(option); }
      select.value = next; select.onchange = () => send(select.value); controls.append(select);
    } else {
      const parts = cssParts(next);
      const shorthand = /^(padding|margin|border-(width|radius)|gap)$/.test(property);
      if (parts.length && parts.every(part => length.test(part)) && (parts.length === 1 || shorthand && parts.length <= 4)) {
        const names = parts.length === 1 ? [field?.label || property] : property === "gap" ? ["Row", "Column"] : property === "border-radius" ? ["Top left", "Top right", "Bottom right", "Bottom left"] : ["Top", "Right", "Bottom", "Left"];
        if (parts.length > 1 && property !== "gap") {
          const [a, b = a, c = a, d = b] = parts; parts.splice(0, parts.length, a, b, c, d);
        }
        parts.forEach((part, i) => row(names[i], part, value => { parts[i] = value; send(parts.join(" ")); }));
      } else {
        controls.append(el("span", "komo-typed__hint", "Custom expression · preserved exactly below.")); advanced.open = true;
      }
    }
  }
  exact.oninput = () => { current = exact.value; if (accept(current)) draw(current); };
  draw(initial);
  return draw;
}
