// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTokenPicker, tokenLabel, type TokenPickerOptions } from "../src/token-picker.js";
import { createAdapterTokenControl } from "../src/react-props-panel.js";
import { closestToken } from "../src/token-adapter.js";
import type { DesignToken, TokenAdapter } from "../src/design-system.js";

const tokens: DesignToken[] = [
  { path: "color.text.primary", type: "color", value: "#1f1f1f", properties: ["color"], group: "Text", label: "Primary", ref: "text-primary", description: "Body copy" },
  { path: "color.text.secondary", type: "color", value: "#6b6b6b", properties: ["color"], group: "Text", ref: "text-secondary" },
  { path: "color.bg.tint", type: "color", value: "rgba(124, 58, 237, 0.16)", properties: ["background-color"], group: "Background", ref: "bg-tint", states: ["hover", "active", "disabled"] },
  { path: "space.md", type: "dimension", value: "16px", properties: ["padding"], group: "Spacing", ref: "p-md" },
  { path: "radius.lg", type: "dimension", value: "12px", properties: ["border-radius"], group: "Radius", ref: "rounded-lg" },
  { path: "shadow.card", type: "shadow", value: "0 1px 2px #0003", properties: ["box-shadow"], group: "Elevation", ref: "shadow-card" },
  { path: "type.title", type: "typography", value: "600 16px/1.5 Georgia, serif", properties: ["font-size"], group: "Type", label: "Title", ref: "type-title" },
  { path: "font.weight.bold", type: "fontWeight", value: "700", properties: ["font-weight"], group: "Weight", ref: "font-bold" },
  { path: "font.family.serif", type: "fontFamily", value: "Georgia, serif", properties: ["font-family"], group: "Family", ref: "font-serif" },
  { path: "motion.fast", type: "duration", value: "150ms", properties: ["transition-duration"], group: "Motion", ref: "duration-fast" },
];

function mount(options: Partial<TokenPickerOptions> = {}) {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const field = document.createElement("label");
  field.className = "design-field";
  const trigger = document.createElement("select");
  trigger.setAttribute("aria-label", "Style token for color");
  field.append(trigger);
  root.append(field);
  document.body.replaceChildren(host);
  const chosen: string[] = [];
  const close = openTokenPicker({ trigger, tokens, property: "color", onSelect: (token) => chosen.push(token.path), ...options });
  const picker = () => root.querySelector<HTMLElement>(".komo-tokens");
  const search = () => picker()!.querySelector<HTMLInputElement>("input")!;
  const rows = () => [...root.querySelectorAll<HTMLElement>(".komo-tokens [role=option]")];
  const names = () => rows().map((row) => row.querySelector(".komo-tokens__name > span")!.textContent);
  const type = (text: string) => {
    search().value = text;
    search().dispatchEvent(new Event("input"));
  };
  const press = (key: string, target: Element = root.activeElement ?? search()) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { root, trigger, chosen, close, picker, search, rows, names, type, press };
}

const row = (rows: HTMLElement[], text: string) => rows.find((item) => item.textContent!.includes(text))!;

describe("token picker", () => {
  afterEach(() => document.body.replaceChildren());

  it("previews each type: swatch, bar, corner, shadow card and Ag, and nothing for durations", () => {
    const { rows, picker } = mount({ property: "none" });
    const all = rows();
    expect(all).toHaveLength(tokens.length);
    expect(row(all, "Primary").querySelector<HTMLElement>(".komo-tokens__sw > span")!.style.background).toBe("rgb(31, 31, 31)");
    expect(row(all, "tint").querySelector<HTMLElement>(".komo-tokens__sw > span")!.style.background).toContain("rgba(124, 58, 237, 0.16)");
    expect(row(all, "md").querySelector<HTMLElement>(".komo-tokens__dim")!.style.width).toBe("8px");
    expect(row(all, "lg").querySelector<HTMLElement>(".komo-tokens__corner")!.style.borderTopLeftRadius).toBe("12px");
    expect(row(all, "card").querySelector<HTMLElement>(".komo-tokens__shadow")).not.toBeNull();
    const title = row(all, "Title");
    expect(title.querySelector(".komo-tokens__ag")!.textContent).toBe("Ag");
    expect(title.getAttribute("aria-label")).toContain("type-title");
    // No tooltip covers the rows; the path and value are a muted subline shown on the active row.
    expect(title.title).toBe("");
    expect(title.querySelector(".komo-tokens__sub")!.textContent).toBe("type.title · 600 16px/1.5 Georgia, serif");
    expect(title.querySelector(".komo-tokens__meta")).toBeNull();
    expect(row(all, "bold").querySelector<HTMLElement>(".komo-tokens__ag")!.style.fontWeight).toBe("700");
    expect(row(all, "serif").querySelector<HTMLElement>(".komo-tokens__ag")!.style.fontFamily).toContain("Georgia");
    const fast = row(all, "fast");
    expect(fast.querySelector(".komo-tokens__pv")!.childElementCount).toBe(0);
    expect(fast.getAttribute("aria-label")).toContain("150ms");
    // Secondary details remain accessible without adding extra visible rows.
    expect(row(all, "tint").getAttribute("aria-label")).toContain("hover");
    expect(row(all, "Primary").querySelector(".komo-tokens__desc")).toBeNull();
    expect(row(all, "Primary").getAttribute("aria-label")).toContain("Body copy");
    expect(picker()!.querySelector("[role=listbox]")!.getAttribute("aria-label")).toBe("Tokens for none");
  });

  it("labels rows with label, else the last path segment, under sticky group headings", () => {
    const { names, root } = mount();
    expect(names()).toEqual(["Primary", "secondary"]);
    expect(tokenLabel({ path: "space.md", type: "dimension", value: "16px" })).toBe("md");
    const group = root.querySelector(".komo-tokens [role=group]")!;
    expect(group.querySelector("small")!.textContent).toBe("Text");
    expect(group.getAttribute("aria-labelledby")).toBe(group.querySelector("small")!.id);
  });

  it("shows the field's tokens by default and every token with Show all", () => {
    const { names, picker } = mount();
    // "Show all" sits under the list.
    const widen = picker()!.querySelector<HTMLButtonElement>(".komo-tokens__widen")!;
    expect(widen.previousElementSibling!.getAttribute("role")).toBe("listbox");
    expect(widen.textContent).toBe(`Show all ${tokens.length} tokens`);
    expect(widen.getAttribute("aria-pressed")).toBe("false");
    widen.click();
    expect(widen.getAttribute("aria-pressed")).toBe("true");
    expect(names()).toHaveLength(tokens.length);
    widen.click();
    expect(names()).toEqual(["Primary", "secondary"]);
  });

  it("searches label, path, ref and value, case-insensitively", () => {
    const { names, type, picker } = mount({ property: "none" });
    type("PRIMARY");
    expect(names()).toEqual(["Primary"]);
    type("weight.bold");
    expect(names()).toEqual(["bold"]);
    type("rounded-");
    expect(names()).toEqual(["lg"]);
    type("150MS");
    expect(names()).toEqual(["fast"]);
    type("color text");
    expect(names()).toEqual(["Primary", "secondary"]);
    type("nothing like this");
    expect(names()).toEqual([]);
    expect(picker()!.textContent).toContain("No matching tokens");
  });

  it("marks the current token in its group without a duplicate Current card", () => {
    const { rows, root, search } = mount({ current: "color.text.secondary" });
    const first = rows().find(row => row.getAttribute("aria-selected") === "true")!;
    expect(first.textContent).toContain("secondary");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.parentElement!.querySelector("small")!.textContent).toBe("Text");
    expect(rows().filter((item) => item.textContent!.includes("secondary"))).toHaveLength(1);
    expect(search().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(root.activeElement).toBe(root.querySelector("[role=listbox]"));
    expect(search().getAttribute("role")).toBe("combobox");
  });

  it("moves with the arrow keys, chooses with Enter and gives focus back", () => {
    const { press, search, chosen, picker, trigger, root } = mount();
    press("ArrowDown");
    expect(root.getElementById(search().getAttribute("aria-activedescendant")!)!.textContent).toContain("secondary");
    press("ArrowUp");
    press("ArrowUp");
    expect(root.getElementById(search().getAttribute("aria-activedescendant")!)!.textContent).toContain("Primary");
    press("ArrowDown");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(chosen).toEqual(["color.text.secondary"]);
    expect(picker()).toBeNull();
    expect(root.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape without reaching the page, and chooses on click", () => {
    const { press, picker, trigger, root, chosen } = mount();
    let reached = false;
    const page = () => { reached = true; };
    document.addEventListener("keydown", page, true);
    expect(press("Escape").defaultPrevented).toBe(true);
    document.removeEventListener("keydown", page, true);
    expect(reached).toBe(false);
    expect(picker()).toBeNull();
    expect(root.activeElement).toBe(trigger);
    expect(chosen).toEqual([]);
    const again = mount();
    again.rows()[0].click();
    expect(again.chosen).toEqual(["color.text.primary"]);
  });

  it("shows the current theme swatch while retaining other theme values in details", async () => {
    const { rows } = mount({
      themes: () => [
        { label: "Light", values: new Map([["color.text.primary", "#1f1f1f"], ["color.text.secondary", "#6b6b6b"]]) },
        { label: "Dark", values: new Map([["color.text.primary", "#f1efeb"], ["color.text.secondary", "#6b6b6b"]]) },
      ],
    });
    await vi.waitFor(() => expect(rows()[0].querySelectorAll(".komo-tokens__sw > span")).toHaveLength(1));
    await vi.waitFor(() => expect(rows()[0].getAttribute("aria-label")).toContain("Light"));
    expect(rows()[0].getAttribute("aria-label")).toContain("Light #1f1f1f, Dark #f1efeb");
    expect(rows()[0].querySelector(".komo-tokens__sub")!.textContent).toContain("Light #1f1f1f, Dark #f1efeb");
    expect(rows()[1].querySelectorAll(".komo-tokens__sw > span")).toHaveLength(1);
  });

  it("explains unresolved colors and exposes full long values to the active option", () => {
    const token: DesignToken = { path: "color.text.success-interactive", label: "A very long success interactive text token", type: "color", value: "rgb(var(--missing-channels))", ref: "data-[interactive=true]:hover:text-success-interactive", properties: ["color"], states: ["hover", "active", "disabled"] };
    const { rows } = mount({ tokens: [token] });
    const option = rows()[0];
    expect(option.querySelector("[data-unresolved]")?.textContent).toBe("?");
    expect(option.getAttribute("aria-label")).toContain("Unresolved");
    expect(option.getAttribute("aria-label")).toContain(token.ref);
    expect(option.getAttribute("aria-label")).toContain(token.value);
    expect(option.getAttribute("aria-label")).toContain("no swatch available");
    expect(option.querySelector(".komo-tokens__name i")).toBeNull();
  });

  it("previews hover and keyboard movement, then rolls back before one commit", () => {
    const element = document.createElement("p");
    element.style.setProperty("color", "#123456", "important");
    const committed = vi.fn(() => expect(element.style.getPropertyValue("color")).toBe("rgb(18, 52, 86)"));
    const preview = vi.fn((token: DesignToken) => {
      const value = element.style.color;
      const priority = element.style.getPropertyPriority("color");
      element.style.setProperty("color", token.value, priority);
      return () => element.style.setProperty("color", value, priority);
    });
    const { rows, press, chosen } = mount({ current: "color.text.secondary", onPreview: preview, onSelect: committed });
    document.body.append(element);
    expect(preview).not.toHaveBeenCalled();
    const hover = () => rows()[0].dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    hover();
    expect(element.style.color).toBe("rgb(31, 31, 31)");
    hover();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(press("ArrowLeft").defaultPrevented).toBe(false);
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    press("ArrowDown");
    expect(element.style.color).toBe("rgb(18, 52, 86)");
    press("ArrowUp");
    expect(element.style.color).toBe("rgb(31, 31, 31)");
    expect(chosen).toEqual([]);
    expect(committed).not.toHaveBeenCalled();
    press("Enter");
    expect(committed).toHaveBeenCalledTimes(1);
    expect(element.style.getPropertyPriority("color")).toBe("important");
  });

  it("restores previews on filter changes, cancellation, replacement and detached triggers", async () => {
    const element = document.createElement("p");
    const onPreview = (token: DesignToken) => {
      const value = element.style.color;
      element.style.color = token.value;
      return () => { element.style.color = value; };
    };
    const first = mount({ onPreview });
    document.body.append(element);
    first.press("ArrowDown");
    expect(element.style.color).toBe("rgb(107, 107, 107)");
    first.type("no match");
    expect(element.style.color).toBe("");
    first.type("primary");
    expect(element.style.color).toBe("rgb(31, 31, 31)");
    first.press("Escape");
    expect(element.style.color).toBe("");
    const oldClose = openTokenPicker({ trigger: first.trigger, tokens, property: "color", onPreview, onSelect: vi.fn() });
    const close = openTokenPicker({ trigger: first.trigger, tokens, property: "color", onPreview, onSelect: vi.fn() });
    oldClose();
    expect(first.picker()).not.toBeNull();
    first.press("ArrowDown");
    expect(element.style.color).toBe("rgb(107, 107, 107)");
    first.trigger.remove();
    await vi.waitFor(() => expect(first.picker()).toBeNull());
    expect(element.style.color).toBe("");
    close();
  });

  it("builds rows lazily and filters 700 tokens quickly", () => {
    const many: DesignToken[] = Array.from({ length: 700 }, (_, index) => ({
      path: `color.palette${index % 14}.step${index}`, type: "color", value: `#${(index * 2399).toString(16).padStart(6, "0").slice(-6)}`,
      properties: ["color"], group: `Palette ${index % 14}`, ref: `--palette-${index}`,
    }));
    const start = performance.now();
    const { rows, type, names, press, search, root } = mount({ tokens: many });
    const opened = performance.now() - start;
    expect(rows().length).toBeLessThanOrEqual(60);
    const typed = performance.now();
    for (const text of ["s", "st", "ste", "step6", "step69"]) type(text);
    const filtering = performance.now() - typed;
    expect(names().sort()).toEqual(["step69", "step690", "step691", "step692", "step693", "step694", "step695", "step696", "step697", "step698", "step699"]);
    expect(opened).toBeLessThan(250);
    expect(filtering).toBeLessThan(250);
    type("");
    // The keyboard reaches rows that are not built yet.
    for (let index = 0; index < 80; index++) press("ArrowDown", search());
    expect(rows().length).toBeGreaterThan(80);
    expect(root.getElementById(search().getAttribute("aria-activedescendant")!)).not.toBeNull();
  });
});

describe("token field suggestions", () => {
  afterEach(() => document.body.replaceChildren());
  const adapter: TokenAdapter = { id: "test", list: () => tokens, resolve: () => ({}) };

  function field(property: string, offToken: string) {
    const grid = document.createElement("div");
    const label = document.createElement("label");
    label.className = "design-field";
    label.dataset.fieldProperty = property;
    const input = document.createElement("input");
    input.dataset.property = property;
    label.append(input);
    grid.append(label);
    document.body.replaceChildren(grid);
    const element = document.createElement("p");
    document.body.append(element);
    const swaps: Array<() => void> = [];
    const control = createAdapterTokenControl(adapter, element, property, tokens, { offToken }, (undo) => swaps.push(undo), label, input)!;
    label.append(control);
    return { grid, label, control, swaps, element };
  }

  it("suggests a relevant token with the same value, binding it only on Use token", () => {
    const { grid, label, swaps, element } = field("color", "rgb(31, 31, 31)");
    const line = grid.querySelector<HTMLElement>(".design-token-match")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe("Same color as PrimaryUse token");
    expect(label.dataset.tokenMode).toBe("custom");
    line.querySelector("button")!.click();
    expect(swaps).toHaveLength(1);
    expect(element.style.color).toBe("rgb(31, 31, 31)");
    expect(label.dataset.tokenMode).toBe("token");
    expect(line.hidden).toBe(true);
    swaps[0]();
  });

  it("only suggests tokens relevant to the property and with exactly that value", () => {
    // 16px is space.md's value, but space.md is for padding.
    expect(field("font-size", "16px").grid.querySelector<HTMLElement>(".design-token-match")?.hidden ?? true).toBe(true);
    expect(field("padding", "15px").grid.querySelector<HTMLElement>(".design-token-match")!.hidden).toBe(true);
    expect(field("padding", "16px").grid.querySelector<HTMLElement>(".design-token-match")!.textContent).toContain("space.md");
  });

  it("compares colors across hex, rgb() and rgba() spellings and case", () => {
    expect(closestToken(tokens, "#1F1F1F")?.path).toBe("color.text.primary");
    expect(closestToken(tokens, "rgb(31 31 31)")?.path).toBe("color.text.primary");
    expect(closestToken(tokens, "rgba(31,31,31,1)")?.path).toBe("color.text.primary");
    expect(closestToken(tokens, "#7C3AED29")?.path).toBe("color.bg.tint");
    expect(closestToken(tokens, "rgb(124 58 237 / 16%)")?.path).toBe("color.bg.tint");
    expect(closestToken(tokens, "rgb(32, 31, 31)")).toBeUndefined();
  });

  it("opens the picker from the token select with the keyboard", async () => {
    const { label } = field("color", "rgb(1, 2, 3)");
    const select = label.querySelector<HTMLSelectElement>(".design-token-binding select")!;
    expect(select.dataset.picker).toBe("token");
    select.focus();
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(label.querySelector(".komo-tokens")).not.toBeNull());
    expect(select.getAttribute("aria-expanded")).toBe("true");
    expect([...label.querySelectorAll(".komo-tokens [role=option]")].map((option) => option.querySelector(".komo-tokens__name > span")!.textContent)).toEqual(["Primary", "secondary"]);
  });
});

describe("one popup for tokens and Custom value", () => {
  afterEach(() => document.body.replaceChildren());
  const custom = (extra: Partial<NonNullable<TokenPickerOptions["custom"]>> = {}): NonNullable<TokenPickerOptions["custom"]> =>
    ({ value: "16px", onPreview: vi.fn(() => () => {}), onSelect: vi.fn(), ...extra });

  it("opens on the tokens with a Custom row, and swaps to the editor and back", async () => {
    const { picker, rows, root, press } = mount({ property: "padding", custom: custom() });
    const box = picker()!;
    expect(box.querySelector(".komo-tokens__tabs")).toBeNull();
    expect(box.querySelector(".komo-tokens__head")!.textContent).toBe("padding");
    expect(rows().map(row => [row.querySelector(".komo-tokens__pv .komo-tokens__dim") !== null, row.querySelector(".komo-tokens__name")!.textContent])).toEqual([[true, "md"]]);
    const more = box.querySelector<HTMLButtonElement>(".komo-tokens__more")!;
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe("Custom…16px");
    expect(box.querySelector<HTMLElement>(".komo-tokens__custom")!.hidden).toBe(true);
    // Keyboard: past the last token, ArrowDown reaches Custom…; Enter opens it; Back returns.
    const list = box.querySelector<HTMLElement>(".komo-tokens__list")!;
    press("ArrowDown", list);
    expect(root.activeElement).toBe(more);
    more.click();
    expect(box.querySelector<HTMLElement>(".komo-tokens__list")!.hidden).toBe(true);
    expect(box.querySelector<HTMLElement>(".komo-tokens__custom")!.hidden).toBe(false);
    expect(box.querySelector(".komo-tokens__head")!.textContent).toBe("Custom value");
    await vi.waitFor(() => expect(box.querySelector(".komo-tokens__custom .komo-custom")).not.toBeNull());
    expect(box.querySelector("details:not([open]) > summary")!.textContent).toBe("Edit as CSS");
    await vi.waitFor(() => expect(root.activeElement?.closest(".komo-tokens__custom")).toBeTruthy());
    const back = box.querySelector<HTMLButtonElement>(".komo-tokens__back")!;
    expect(back.hidden).toBe(false);
    back.click();
    expect(list.hidden).toBe(false);
    expect(box.querySelector<HTMLElement>(".komo-tokens__custom")!.hidden).toBe(true);
    expect(back.hidden).toBe(true);
    expect(root.activeElement).toBe(more);
    press("ArrowUp", more);
    expect(root.activeElement).toBe(list);
  });

  it("opens straight in Custom for a property without tokens, with no way back", async () => {
    const { picker, root } = mount({ property: "letter-spacing", custom: custom({ value: "0px" }) });
    const box = picker()!;
    expect(box.querySelector<HTMLElement>(".komo-tokens__list")!.hidden).toBe(true);
    expect(box.querySelector<HTMLElement>(".komo-tokens__bar")!.hidden).toBe(true);
    expect(box.querySelector<HTMLElement>(".komo-tokens__more")!.hidden).toBe(true);
    expect(box.querySelector<HTMLElement>(".komo-tokens__back")!.hidden).toBe(true);
    expect(box.querySelector(".komo-tokens__head")!.textContent).toBe("letter-spacing");
    await vi.waitFor(() => expect(root.activeElement?.closest(".komo-tokens__custom")).toBeTruthy());
    expect(root.activeElement!.closest("details")).toBeNull();
  });

  it("names a color's Custom view and shows its swatch and hex on the Custom row", () => {
    const { picker } = mount({ custom: custom({ value: "#1a2b3c" }) });
    const more = picker()!.querySelector<HTMLElement>(".komo-tokens__more")!;
    expect(more.querySelector("i")!.style.getPropertyValue("--c")).toBe("#1a2b3c");
    expect(more.querySelector("span")!.textContent).toBe("1A2B3C");
    more.click();
    expect(picker()!.querySelector(".komo-tokens__head")!.textContent).toBe("Custom colour");
  });

  it("previews a hovered token and restores the page exactly on leaving the list", () => {
    const element = document.createElement("p");
    element.style.setProperty("color", "#123456", "important");
    const onPreview = vi.fn((token: DesignToken) => {
      const value = element.style.color, priority = element.style.getPropertyPriority("color");
      element.style.setProperty("color", token.value, priority);
      return () => element.style.setProperty("color", value, priority);
    });
    const { rows, picker, chosen } = mount({ onPreview });
    document.body.append(element);
    rows()[1].dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(element.style.color).toBe("rgb(107, 107, 107)");
    picker()!.querySelector(".komo-tokens__list")!.dispatchEvent(new PointerEvent("pointerleave"));
    expect(element.style.color).toBe("rgb(18, 52, 86)");
    expect(element.style.getPropertyPriority("color")).toBe("important");
    rows()[1].dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(chosen).toEqual([]);
  });

  it("moves with Home and End, and typing on the list filters it", () => {
    const { press, root, search, names } = mount();
    const list = root.querySelector<HTMLElement>(".komo-tokens__list")!;
    expect(root.activeElement).toBe(list);
    expect(search().hidden).toBe(true);
    press("End", list);
    // A search looks through every token, not just the relevant ones.
    expect(root.getElementById(list.getAttribute("aria-activedescendant")!)!.textContent).toContain("secondary");
    press("Home", list);
    expect(root.getElementById(list.getAttribute("aria-activedescendant")!)!.textContent).toContain("Primary");
    expect(press("s", list).defaultPrevented).toBe(true);
    expect(search().hidden).toBe(false);
    expect(search().value).toBe("s");
    expect(root.activeElement).toBe(search());
    expect(names()).toContain("secondary");
    expect(names()).toContain("md");
    search().value = "";
    search().dispatchEvent(new Event("input"));
    expect(search().hidden).toBe(false);
  });

  it("focuses the search of a long list", () => {
    const { root, search } = mount({ property: "none" });
    expect(search().hidden).toBe(false);
    expect(root.activeElement).toBe(search());
  });

  it("previews a hovered menu option over a kept Custom value and brings that value back", async () => {
    vi.stubGlobal("CSS", { supports: () => true });
    const applied: string[] = [];
    const onPreview = vi.fn((value: string) => { applied.push(value); return () => { applied.pop(); }; });
    const { picker } = mount({ property: "font", tokens: [], custom: custom({ value: "500 14px serif", onPreview }) });
    const weight = await vi.waitFor(() => {
      const select = picker()!.querySelector<HTMLSelectElement>('select[aria-label="Font weight"]');
      expect(select).not.toBeNull();
      return select!;
    });
    weight.value = "600";
    weight.dispatchEvent(new Event("change"));
    expect(applied).toEqual(["600 14px serif"]);
    weight.dispatchEvent(new CustomEvent("komo-preview", { detail: "800" }));
    expect(applied).toEqual(["800 14px serif"]);
    weight.dispatchEvent(new CustomEvent("komo-preview", { detail: null }));
    expect(applied).toEqual(["600 14px serif"]);
    vi.unstubAllGlobals();
  });

  it("undoes a pending Custom edit before choosing a token, as one change", async () => {
    const calls: string[] = [];
    const { rows, picker, chosen } = mount({
      property: "padding",
      onSelect: token => calls.push(`select ${token.path}`),
      custom: custom({ onCommit: value => calls.push(`commit ${value}`), onCancel: () => calls.push("cancel"), onDone: () => calls.push("done") }),
    });
    picker()!.querySelector<HTMLElement>(".komo-tokens__more")!.click();
    await vi.waitFor(() => expect(picker()!.querySelector(".komo-custom")).not.toBeNull());
    picker()!.querySelector<HTMLElement>(".komo-tokens__back")!.click();
    rows()[0].click();
    expect(picker()).toBeNull();
    expect(calls).toEqual(["cancel", "done", "select space.md"]);
    expect(chosen).toEqual([]);
  });
});
