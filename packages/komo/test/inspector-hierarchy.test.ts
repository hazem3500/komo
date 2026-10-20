// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fontView, primaryFamily } from "../src/css-value-parts.js";
import { parseDesignComment, renderDesignComment, resetDesignPreviews, targetLabel } from "../src/design-comment.js";
import { registerInspectableRoot, type InspectableComponent } from "../src/react-inspector.js";
import { createReactPropsPanel, resetPreviews } from "../src/react-props-panel.js";
import { sourceInfo } from "../src/source-info.js";

afterEach(() => {
  resetPreviews();
  resetDesignPreviews();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("font family display", () => {
  it.each([
    ['"Acme, Display", "Fallback Sans", serif', "Acme, Display"],
    ["'Acme, Display', serif", "Acme, Display"],
    ['"Say \\"Hi\\", Display", serif', 'Say "Hi", Display'],
    ["Inter, ui-sans-serif, system-ui, sans-serif, \"Apple Color Emoji\"", "Inter"],
    ["Fallback   Sans, serif", "Fallback Sans"],
    ["system-ui", "system-ui"],
  ])("reads the primary family of %s", (stack, primary) => {
    expect(primaryFamily(stack)).toBe(primary);
  });

  it("labels generic families, resolved variables and unresolved variables honestly", () => {
    const none = () => "";
    expect(fontView("", "system-ui, sans-serif", none)).toEqual({ label: "system-ui", note: "generic", title: "system-ui, sans-serif" });
    expect(fontView("", '"serif", Georgia', none).note).toBe("");
    expect(fontView("var(--font-sans)", '"Acme, Display", Georgia, serif', name => name === "--font-sans" ? '"Acme, Display", Georgia, serif' : ""))
      .toEqual({ label: "Acme, Display", note: "", title: 'var(--font-sans) → "Acme, Display", Georgia, serif' });
    const missing = fontView("var(--font-missing)", "Georgia, serif", none);
    expect(missing.label).toBe("--font-missing unresolved");
    expect(missing.title).toContain("renders with Georgia, serif");
    expect(fontView("var(--font-missing, serif)", "serif", none).label).toBe("serif");
  });

  it("shows the primary family while the field keeps the exact stack through edits", async () => {
    const { fieldControl, fields } = await import("../src/design-panel.js");
    const element = document.body.appendChild(document.createElement("p"));
    const stack = '"Acme, Display", "Fallback Sans", serif';
    element.style.fontFamily = stack;
    const values: Array<string | null> = [];
    const box = document.body.appendChild(fieldControl(fields.find(field => field.property === "font-family")!, {
      element, begin() {}, commit() {},
      apply(_control, property, value) { values.push(value); if (value) element.style.setProperty(property, value); },
    }));
    const input = box.querySelector<HTMLInputElement>("input[data-property]")!;
    expect(box.querySelector(".komo-font-name span")?.textContent).toBe("Acme, Display");
    expect(input.value).toBe(getComputedStyle(element).fontFamily);
    input.value = "'Other, Face', monospace";
    input.dispatchEvent(new Event("input"));
    expect(element.style.fontFamily).toBe('"Other, Face", monospace');
    expect(box.querySelector(".komo-font-name span")?.textContent).toBe("Other, Face");
    expect(input.title).toContain("Other, Face");
  });
});

const definition: InspectableComponent = {
  id: "button", name: "Button", source: "src/components/button.tsx", line: 12,
  props: [
    { name: "label", kind: "string", required: true, typeLabel: "string" },
    { name: "variant", kind: "enum", required: true, values: ["primary", "secondary"], typeLabel: '"primary" | "secondary"' },
    { name: "disabled", kind: "boolean", required: true, typeLabel: "boolean" },
    { name: "loading", kind: "boolean", required: false, typeLabel: "boolean" },
    { name: "accessibleDescriptionOverride", kind: "string", required: false, typeLabel: "string" },
    { name: "count", kind: "number", required: false, typeLabel: "number" },
  ],
};

function mount(props: Record<string, string | number | boolean | undefined>, component = definition, href?: (path: string, line?: number) => string | undefined) {
  const element = document.body.appendChild(document.createElement("button"));
  const changes: Array<Record<string, unknown>> = [];
  registerInspectableRoot(element, component, props, next => changes.push(next));
  const panel = document.body.appendChild(createReactPropsPanel(element, () => {}, undefined, undefined, undefined, undefined, href)!);
  return { element, panel, changes };
}

describe("Properties hierarchy", () => {
  it("heads the section with the component name and keeps the source behind an info popover", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const href = vi.fn((path: string, line?: number) => `vscode://file/${path}:${line}`);
    const { panel } = mount({ label: "Save", variant: "primary", disabled: false, accessibleDescriptionOverride: "" }, definition, href);
    expect(panel.querySelector("summary")?.textContent).toBe("Button");
    expect(panel.textContent).not.toContain("Runtime preview");
    expect(panel.querySelector(".design-react-source")).toBeNull();
    expect(panel.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(true);
    const info = panel.querySelector<HTMLButtonElement>('[aria-label="Button source"]')!;
    const popup = panel.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(popup.hidden).toBe(true);
    info.click();
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(popup.hidden).toBe(false);
    expect(popup.firstChild?.textContent).toBe("src/components/button.tsx:12");
    popup.querySelector<HTMLButtonElement>('[aria-label="Copy source path"]')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("src/components/button.tsx:12"));
    await vi.waitFor(() => expect(popup.querySelector('[aria-label="Copy source path"]')?.textContent).toBe("Copied"));
    expect(href).toHaveBeenCalledWith("src/components/button.tsx", 12);
    popup.querySelector<HTMLButtonElement>('[aria-label="Open source"]')!.click();
    expect(open).toHaveBeenCalledWith("vscode://file/src/components/button.tsx:12", "_blank", "noopener,noreferrer");
    expect(popup.hidden).toBe(true);
    info.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(popup.hidden).toBe(false);
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    expect(popup.hidden).toBe(true);
  });

  it("offers Copy without Open for bundle locations", () => {
    const tray = sourceInfo("Card", "/chunk-AB12CD34.js:793", () => "https://example.com/source");
    expect(tray.querySelector('[aria-label="Copy source path"]')).not.toBeNull();
    expect(tray.querySelector('[aria-label="Open source"]')).toBeNull();
    expect(sourceInfo("Card", "src/card.tsx:4", () => "javascript:alert(1)").querySelector('[aria-label="Open source"]')).toBeNull();
  });

  it("renders enums as selects, booleans as switches and keeps nullable states distinct", () => {
    const { panel, changes } = mount({ label: "Save", variant: "primary", disabled: false, accessibleDescriptionOverride: "" });
    const control = (name: string) => panel.querySelector<HTMLInputElement & HTMLSelectElement>(`[aria-label="Button ${name}"]`)!;
    expect(control("variant").tagName).toBe("SELECT");
    expect([...control("variant").options].map(option => option.value)).toEqual(["primary", "secondary"]);
    const disabled = control("disabled");
    expect(disabled.getAttribute("role")).toBe("switch");
    expect(disabled.checked).toBe(false);
    expect(disabled.hasAttribute("data-unset")).toBe(false);
    expect(control("loading").hasAttribute("data-unset")).toBe(true);
    expect(control("loading").title).toBe("unset");
    expect(control("accessibleDescriptionOverride").placeholder).toBe('""');
    expect(control("accessibleDescriptionOverride").title).toBe("Empty string");
    expect(control("count").placeholder).toBe("unset");
    disabled.checked = true;
    disabled.dispatchEvent(new Event("change"));
    expect(changes.at(-1)).toMatchObject({ disabled: true });
    control("variant").value = "secondary";
    control("variant").dispatchEvent(new Event("change"));
    expect(changes.at(-1)).toMatchObject({ variant: "secondary" });
    const caption = [...panel.querySelectorAll<HTMLElement>(".design-react-field > span")].find(span => span.textContent === "accessibleDescriptionOverride")!;
    expect(caption.title).toBe("accessibleDescriptionOverride");
  });

  it("suppresses the body when a component has no editable props", () => {
    const { panel } = mount({}, { ...definition, props: [{ name: "onPress", kind: "unsupported", required: false, typeLabel: "() => void" }] });
    expect(panel.hasAttribute("data-empty")).toBe(true);
    expect(panel.querySelector(".design-react-row")).toBeNull();
    expect(panel.querySelector("summary")?.textContent).toBe("Button");
  });
});

describe("design change cards", () => {
  const body = [
    "Proposed inline text change (preview only)",
    "Target: main > h6.px-2.py-1:nth-of-type(1)",
    '- Text: "Plan" → "Plan!!!!"',
  ].join("\n");

  it("names the target for reviewers without selectors", () => {
    const heading = document.body.appendChild(document.createElement("h6"));
    heading.className = "px-2 py-1";
    heading.textContent = "Plan";
    const [section] = parseDesignComment(body) as [Parameters<typeof targetLabel>[0]];
    expect(targetLabel(section, heading)).toBe("Heading “Plan”");
    expect(targetLabel(section, null)).toBe("Heading “Plan”");
    expect(targetLabel({ ...section, component: "PlanHeading" }, heading)).toBe("PlanHeading");
    expect(targetLabel({ target: "main > div.card:nth-of-type(2)", changes: [] }, null)).toBe("div");
    const button = document.body.appendChild(document.createElement("div"));
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "Save all of the pending changes right now");
    expect(targetLabel({ target: "#x", changes: [] }, button)).toBe("Button “Save all of the pending cha…”");
  });

  it("keeps the source behind the shared info button and the selector in the record", () => {
    const heading = document.body.appendChild(document.createElement("h6"));
    heading.textContent = "Plan";
    const recorded = body.replace("\n- Text", "\nComponent: PlanHeading (src/features/plan/plan-heading.tsx:42)\n- Text");
    const container = document.body.appendChild(document.createElement("div"));
    renderDesignComment(container, recorded, { key: "card", resolve: () => heading, note: (node, text) => node.append(text), sourceHref: path => `vscode://file/${path}` });
    const card = container.querySelector(".design-card")!;
    expect(card.querySelector(".design-card-target")?.textContent).toBe("PlanHeading");
    expect(card.querySelector('[aria-label="PlanHeading source"]')).not.toBeNull();
    const visible = [...card.querySelectorAll<HTMLElement>("*")].filter(node => !node.closest("[hidden]") && !node.children.length).map(node => node.textContent).join(" ");
    expect(visible).not.toContain("src/features");
    expect(visible).not.toContain("px-2");
    expect(card.querySelector(".design-diff")?.innerHTML).toBe("Plan<ins>!!!!</ins>");
    expect(parseDesignComment(recorded)[0]).toMatchObject({ target: "main > h6.px-2.py-1:nth-of-type(1)", source: "src/features/plan/plan-heading.tsx:42" });
  });
});
