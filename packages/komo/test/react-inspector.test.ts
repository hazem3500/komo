// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import {
  inspectableAncestor,
  inspectableFor,
  registerInspectableRoot,
  type InspectableComponent,
  type InspectableScalar,
} from "../src/react-inspector.js";

const definition: InspectableComponent = {
  id: "promo-card",
  name: "PromoCard",
  source: "examples/react-props/src/card.tsx",
  line: 15,
  textProp: "title",
  props: [
    { name: "title", kind: "string", required: true, typeLabel: "string" },
    { name: "tone", kind: "enum", values: ["calm", "bold"], required: true, typeLabel: '"calm" | "bold"' },
    { name: "compact", kind: "boolean", required: false, typeLabel: "boolean | undefined" },
    { name: "visits", kind: "number", required: true, typeLabel: "number" },
    { name: "onActivate", kind: "unsupported", required: true, typeLabel: "(event: Event) => void" },
    { name: "details", kind: "unsupported", required: true, typeLabel: "{ featured: boolean }" },
  ],
};

describe("React props inspector bridge", () => {
  let host: HTMLElement;
  let card: HTMLElement;
  let title: HTMLElement;
  let target: HTMLElement;
  let shadow: ShadowRoot;
  let controller: ReturnType<typeof createDesignMode>;
  let cleanup: () => void;
  let changes: Array<Record<string, InspectableScalar>>;
  let comments: Array<{ element: Element; proposal?: string }>;
  const props: Record<string, InspectableScalar> = {
    title: "A preview title",
    tone: "calm",
    compact: false,
    visits: 3,
  };

  function pointerDown(target: Element) {
    const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 20 }, clientY: { value: 20 }, button: { value: 0 } });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    document.body.innerHTML = '<main><article id="promo"><h2>Card title</h2></article></main><div id="komo"></div>';
    host = document.querySelector<HTMLElement>("#komo")!;
    card = document.querySelector<HTMLElement>("#promo")!;
    title = card.querySelector("h2")!;
    target = card;
    shadow = host.attachShadow({ mode: "open" });
    changes = [];
    comments = [];
    cleanup = registerInspectableRoot(card, definition, props, (next) => changes.push(next));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    controller = createDesignMode({
      root: shadow,
      host,
      targetAt: () => target,
      onComment: (element, proposal) => comments.push({ element, proposal }),
      onExit: () => {},
    });
    controller.setActive(true);
    pointerDown(card);
  });

  afterEach(() => {
    controller.destroy();
    cleanup();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows useful declared controls without callback or opaque fields", async () => {
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-group")).not.toBeNull());
    const group = shadow.querySelector<HTMLDetailsElement>(".design-react-group")!;
    expect(group).not.toBeNull();
    expect(group.textContent).toContain("PromoCard");
    expect(group.textContent).toContain("examples/react-props/src/card.tsx:15");
    expect([...shadow.querySelectorAll("style")].some((style) => style.textContent?.includes(".design-token-binding select"))).toBe(true);
    expect(group.querySelector('[aria-label^="PromoCard onActivate"]')).toBeNull();
    expect(group.querySelector('[aria-label^="PromoCard details"]')).toBeNull();
    expect(inspectableFor(card)?.props).not.toHaveProperty("onActivate");
  });

  it("shows props only on the registered root and points descendants back to it", async () => {
    expect(inspectableFor(title)).toBeNull();
    expect(inspectableAncestor(title)?.root).toBe(card);
    expect(inspectableAncestor(card)).toBeNull();
    await vi.waitFor(() => expect(shadow.querySelector("details.design-react-group")).not.toBeNull());
    target = title;
    pointerDown(title);
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-inside")).not.toBeNull());
    expect(shadow.querySelector("details.design-react-group")).toBeNull();
    const inside = shadow.querySelector<HTMLElement>(".design-react-inside")!;
    expect(inside.textContent).toBe("Inside PromoCard · Select component");
    inside.querySelector("button")!.click();
    await vi.waitFor(() => expect(shadow.querySelector("details.design-react-group")).not.toBeNull());
    expect(shadow.querySelector(".design-react-inside")).toBeNull();
  });

  it("previews valid typed values, rejects invalid enum values, and proposes an explicit comment", async () => {
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-group")).not.toBeNull());
    const titleInput = shadow.querySelector<HTMLInputElement>('[aria-label="PromoCard title"]')!;
    titleInput.value = "A revised preview title";
    titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes.at(-1)?.title).toBe("A revised preview title");

    const tone = shadow.querySelector<HTMLSelectElement>('[aria-label="PromoCard tone"]')!;
    tone.value = "arbitrary-value";
    tone.dispatchEvent(new Event("change", { bubbles: true }));
    expect(tone.getAttribute("aria-invalid")).toBe("true");
    expect(changes).toHaveLength(1);

    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(comments).toHaveLength(1));
    expect(comments[0].element).toBe(card);
    expect(comments[0].proposal).toContain('title: "A preview title" → "A revised preview title"');
    expect(comments[0].proposal).toContain("Source: examples/react-props/src/card.tsx:15");
    // The component's props as the page had them, for the CLI's target.component.
    expect(comments[0].proposal).toContain('\nProps: title="A preview title", tone="calm", compact=false, visits=3\n');
  });

  it("supports undo and reset through the React state callback", async () => {
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-group")).not.toBeNull());
    const titleInput = shadow.querySelector<HTMLInputElement>('[aria-label="PromoCard title"]')!;
    titleInput.value = "One edit";
    titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!.click();
    expect(changes.at(-1)?.title).toBe("A preview title");

    await vi.waitFor(() => expect(shadow.querySelector('[aria-label="PromoCard title"]')).not.toBeNull());
    const currentInput = shadow.querySelector<HTMLInputElement>('[aria-label="PromoCard title"]')!;
    currentInput.value = "Reset me";
    currentInput.dispatchEvent(new Event("change", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:nth-child(2)")!.click();
    expect(changes.at(-1)?.title).toBe("A preview title");
  });

  it("retains props through a brief mode switch and restores them through explicit Reset", async () => {
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-group")).not.toBeNull());
    const titleInput = shadow.querySelector<HTMLInputElement>('[aria-label="PromoCard title"]')!;
    titleInput.value = "Left behind";
    titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes.at(-1)?.title).toBe("Left behind");
    controller.setActive(false);
    expect(changes.at(-1)?.title).toBe("A preview title");
    controller.setActive(true);
    expect(changes.at(-1)?.title).toBe("Left behind");
    expect(shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!.disabled).toBe(false);
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:nth-child(2)")!.click();
    expect(changes.at(-1)?.title).toBe("A preview title");
  });

  it("undoes mixed prop and style commits in their actual order", async () => {
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-group")).not.toBeNull());
    const title = shadow.querySelector<HTMLInputElement>('[aria-label="PromoCard title"]')!;
    title.value = "First edit";
    title.dispatchEvent(new Event("change"));
    const width = shadow.querySelector<HTMLInputElement>('[data-property="width"]')!;
    width.dispatchEvent(new Event("focus"));
    width.value = "123";
    width.dispatchEvent(new Event("input"));
    width.dispatchEvent(new Event("change"));
    const compact = shadow.querySelector<HTMLInputElement>('[aria-label="PromoCard compact"]')!;
    compact.checked = true;
    compact.dispatchEvent(new Event("change"));
    const undo = () => shadow.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click();
    undo();
    expect(changes.at(-1)).toMatchObject({ compact: false, title: "First edit" });
    expect(card.style.width).toBe("123px");
    undo();
    expect(card.style.width).toBe("");
    expect(changes.at(-1)?.title).toBe("First edit");
    undo();
    expect(changes.at(-1)?.title).toBe("A preview title");
  });

  it("routes an explicitly mapped leaf text edit through React state and includes it in the comment proposal", async () => {
    controller.destroy();
    cleanup();
    card.replaceChildren(document.createTextNode("A preview title"));
    cleanup = registerInspectableRoot(card, definition, props, (next) => {
      changes.push(next);
      card.textContent = String(next.title ?? "");
    });
    controller = createDesignMode({
      root: shadow,
      host,
      targetAt: () => card,
      onComment: (element, proposal) => comments.push({ element, proposal }),
      onExit: () => {},
    });
    controller.setActive(true);
    pointerDown(card);
    await vi.waitFor(() => expect(shadow.querySelector(".design-react-group")).not.toBeNull());
    const edit = shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!;
    expect(edit.disabled).toBe(false);
    edit.click();
    await vi.waitFor(() => expect(card.getAttribute("contenteditable")).toBe("true"));
    card.textContent = "Changed in place";
    card.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    expect(changes.at(-1)?.title).toBe("Changed in place");
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));

    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(comments.at(-1)?.proposal).toContain('title: "A preview title" → "Changed in place"'));
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!.click();
    expect(changes.at(-1)?.title).toBe("A preview title");
  });
});
