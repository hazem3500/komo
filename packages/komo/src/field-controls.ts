import { previewStyle } from "./design-preview.js";
// In-row controls for the Design panel's fields, fetched with the panel like the select menu:
// keyword fields whose every option has a natural icon (text alignment, border style) become a
// segmented control, weight options show in their own weight, numeric fields carry their
// unit inside the field, and a single-value numeric field keeps its value beside a bound
// token's chip. The native control stays the value store, so the field's focus,
// input and change listeners, Escape, syncFields and token chips keep working unchanged.
// Comments stay out of the CSS string: they would ship.

const css = `.design-segments{display:flex;flex:1;gap:2px;min-width:0;height:100%;box-sizing:border-box;padding:2px}.design-field:has(>.design-segments)>select{display:none}.design-field:has(>.design-token-binding)>.design-segments{margin-right:24px}.design-segments button{flex:1;display:grid;place-items:center;min-width:0;padding:0;border:0;border-radius:4px;background:none;color:#898680;font:inherit;font-size:10px;cursor:pointer}.design-segments button:hover{color:#f1efeb}.design-segments button[aria-checked=true]{background:#ffffff1a;color:#f1efeb}.design-segments button:focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}.design-segments svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round}.design-field__unit{flex:none;padding-right:8px;color:#77736f;font-size:10px;pointer-events:none}.design-field__unit:empty{display:none}.design-field.design-field:has(>.design-field__unit:not(:empty))>input[data-property]{padding-right:2px}.design-field:has(>.design-token-binding)>.design-field__unit{margin-right:20px}.design-field:is([data-token-mode=token],[data-token-mode=connected])>.design-field__unit{visibility:hidden}.design-field:has(>.design-token-binding>.design-token-off:not([hidden]))>.design-field__unit{margin-right:30px}.design-field.design-field[data-inline-token]:is([data-token-mode=token],[data-token-mode=connected])>:is([data-property],.design-field__unit){visibility:visible}.design-field.design-field[data-inline-token]:is([data-token-mode=token],[data-token-mode=connected])>.design-field__unit{display:block;margin-right:calc(var(--chip,50%) + 30px)}.design-field.design-field[data-inline-token]:is([data-token-mode=token],[data-token-mode=connected]) .design-token-chip{left:auto;width:max-content;max-width:50%;box-sizing:border-box;overflow:clip;overflow-clip-margin:content-box}.design-field.design-field[data-inline-token]:is([data-token-mode=token],[data-token-mode=connected]) .design-token-binding select{left:auto;width:var(--chip,50%)}.design-token-chip__verb{display:contents}.design-field[data-inline-token] .design-token-chip__verb{display:none}.design-field.design-field[data-inline-token]:is([data-token-mode=token],[data-token-mode=connected])>input[data-property]{padding-right:2px}.design-field[data-inline-token]>.komo-tokens:not([data-custom])>.komo-tokens__head,.design-field[data-inline-token] .komo-custom__body>.komo-typed:not(.komo-typed__advanced){display:none}`;

/** Every option of these fields has a natural icon; other keyword fields keep the listbox. */
const icons: Record<string, Record<string, string>> = {
  "text-align": {
    left: "M1.5 2.5h9M1.5 5h6M1.5 7.5h9M1.5 10h6",
    center: "M1.5 2.5h9M3 5h6M1.5 7.5h9M3 10h6",
    right: "M1.5 2.5h9M4.5 5h6M1.5 7.5h9M4.5 10h6",
    justify: "M1.5 2.5h9M1.5 5h9M1.5 7.5h9M1.5 10h9",
  },
  "border-style": {
    none: "M3 3l6 6M9 3 3 9",
    solid: "M1.5 6h9",
    dashed: "M1.5 6h2M5 6h2M8.5 6h2",
    dotted: "M2 6h.01M4.67 6h.01M7.33 6h.01M10 6h.01",
  },
};
/** Numeric fields edited in the row while they hold one value (a computed shorthand without spaces). */
const single = new Set(["font-size", "line-height", "letter-spacing", "gap", "border-width", "padding", "margin", "border-radius"]);
const styled = new WeakSet<Node>();
/** A bound chip is as wide as its token's name; the value and the chip's hit area make room for it. */
const chips = globalThis.ResizeObserver && new ResizeObserver((entries) => {
  for (const { target } of entries) target.closest<HTMLElement>(".design-field")?.style.setProperty("--chip", `${(target as HTMLElement).offsetWidth}px`);
});

/** Runs `paint` whenever the control's value is set from code, as show() and syncFields do. */
function follow(control: HTMLInputElement | HTMLSelectElement, paint: () => void) {
  const own = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!;
  Object.defineProperty(control, "value", { configurable: true, get: () => own.get!.call(control), set: (value: string) => { own.set!.call(control, value); paint(); } });
  control.addEventListener("input", paint);
  paint();
}

export function enhance(container: HTMLElement, element: Element): void {
  const root = container.getRootNode();
  if ((root instanceof ShadowRoot || root === document) && !styled.has(root)) {
    styled.add(root);
    const style = document.createElement("style");
    style.textContent = css;
    (root instanceof ShadowRoot ? root : document.head).append(style);
  }
  for (const box of container.querySelectorAll<HTMLElement>(".design-field[data-field-property]")) {
    if (box.dataset.enhanced) continue;
    box.dataset.enhanced = "";
    const property = box.dataset.fieldProperty!;
    const control = box.querySelector<HTMLInputElement | HTMLSelectElement>(":scope > [data-property]");
    if (!control) continue;
    if (control instanceof HTMLSelectElement && property === "font-weight")
      for (const option of control.options) option.style.fontWeight = option.value;
    if (control instanceof HTMLSelectElement && icons[property]) segments(box, control, element, icons[property]);
    const inline = single.has(property);
    if (!(control instanceof HTMLInputElement) || !(inline || /design-field--(length|size)/.test(box.className))) continue;
    const unit = document.createElement("span");
    unit.className = "design-field__unit";
    unit.setAttribute("aria-hidden", "true");
    control.after(unit);
    // One value sits beside a bound token's chip, and its popup is the token list alone: the row
    // already names the field and holds the value; Edit as CSS stays. Several values keep Custom.
    // An open popup keeps its layout while its rows preview other values; it settles on close.
    const settle = () => {
      if (inline && !box.querySelector(":scope > .komo-tokens"))
        box.toggleAttribute("data-inline-token", !/\s/.test(getComputedStyle(element).getPropertyValue(property).trim()));
    };
    // The token chip joins the row when the design system's controls load, before or after this.
    const chip = () => { const node = box.querySelector(".design-token-chip"); if (node) chips?.observe(node); };
    if (inline) new MutationObserver(() => { chip(); settle(); }).observe(box, { childList: true });
    chip();
    follow(control, () => {
      // Plain numbers are pixels, except a unitless line height; a value with its own unit or a keyword shows none.
      unit.textContent = property !== "line-height" && /^-?\d*\.?\d+$/.test(control.value.trim()) ? "px" : "";
      settle();
    });
  }
}

/** A radio group of icons: hover previews, a click or an arrow key keeps one change, Escape drops a preview. */
function segments(box: HTMLElement, select: HTMLSelectElement, element: Element, paths: Record<string, string>) {
  const group = document.createElement("div");
  group.className = "design-segments";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", select.getAttribute("aria-label") ?? "");
  let undo: (() => void) | undefined;
  const drop = () => { const back = undo; undo = undefined; back?.(); };
  const buttons = [...select.options].filter(option => paths[option.value]).map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.value = option.value;
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    button.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${paths[option.value]}"/></svg>`;
    button.addEventListener("pointerenter", () => {
      drop();
      if (select.value !== option.value) undo = previewStyle(element, select.dataset.property!, option.value);
    });
    button.addEventListener("pointerleave", drop);
    button.addEventListener("click", () => pick(option.value));
    return button;
  });
  const pick = (value: string) => {
    drop();
    if (select.value === value) return;
    // The field's own listeners: focus begins the edit, input applies it, change keeps it.
    select.dispatchEvent(new Event("focus"));
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  group.addEventListener("keydown", event => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
    if (event.key === "Escape" && undo) { drop(); event.stopPropagation(); return; }
    if (!step) return;
    event.preventDefault();
    const at = Math.max(0, buttons.findIndex(button => button.getAttribute("aria-checked") === "true"));
    const next = (at + step + buttons.length) % buttons.length;
    pick(buttons[next].value);
    buttons[next].focus();
  });
  group.append(...buttons);
  select.after(group);
  // Start and end read as left and right; another value outside the icons checks none.
  follow(select, () => {
    const value = ({ start: "left", end: "right" } as Record<string, string>)[select.value] ?? select.value;
    const at = buttons.findIndex(button => button.value === value);
    buttons.forEach((button, index) => {
      button.setAttribute("aria-checked", String(index === at));
      button.tabIndex = index === Math.max(at, 0) ? 0 : -1;
    });
  });
}
