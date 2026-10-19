// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDesignComment,
  parseDesignComment,
  renderDesignComment,
  renderDraftProposal,
  resetDesignPreviews,
  shortTarget,
  summarizeDesignComment,
} from "../src/design-comment";

const style = [
  "Proposed style changes (preview only)",
  "Target: #root > main:nth-of-type(1) > h2:nth-of-type(1)",
  "- width: 462px → 308px",
  "- color: rgb(41, 42, 38) → #4f5f42",
  "- display: block → block",
].join("\n");
const text = 'Proposed inline text change (preview only)\n- Text: "Old title" → "New title"\n- Source markup is unchanged; refresh resets this preview.';
const tokens = [
  "Proposed design-token changes (preview only)",
  "Element color: rgb(41, 42, 38) → var(--color-brand) [color.brand]",
  "Shared theme spacing.card (--spacing-card): 28px → 32px; preview scope .promo-card (1 matching elements)",
  "Token references are preserved for element assignments; refresh resets previews.",
].join("\n");
const props = [
  "Proposed React prop changes (preview only)",
  "Component: PromoCard",
  "Source: examples/react-props/src/card.tsx:19",
  "- tone: quiet → loud [custom value]",
].join("\n");

afterEach(() => {
  resetDesignPreviews();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("design comments", () => {
  it.each(["svg", "path"])("previews and restores %s styles in drafts and posted cards", (kind) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.body.innerHTML = '<svg id="icon"><path id="shape" d="M0 0h10v10z"/></svg><svg id="other"/>';
    const target = document.querySelector<SVGElement>(kind === "svg" ? "#icon" : "#shape")!;
    target.scrollIntoView = () => {};
    target.style.setProperty("fill", "currentColor", "important");
    const original = target.getAttribute("style");
    const body = `Proposed style changes (preview only)\nTarget: #${target.id}\n- color: rgb(87, 84, 86) → #2468ff\n- fill: currentColor → #ef3340`;
    const card = document.body.appendChild(document.createElement("div"));
    renderDraftProposal(card, body, selector => document.querySelector(selector!));
    expect(target.style.color).toBe("rgb(36, 104, 255)");
    expect(target.style.fill).toBe("rgb(239, 51, 64)");
    const [before, after] = card.querySelectorAll<HTMLButtonElement>(".design-toggle button");
    before.click();
    expect(target.getAttribute("style")).toBe(original);
    after.click();
    expect(target.style.color).toBe("rgb(36, 104, 255)");
    resetDesignPreviews();
    expect(target.getAttribute("style")).toBe(original);
    expect(document.getElementById("other")!.getAttribute("style")).toBeNull();
    renderDesignComment(card, body, { key: "posted-svg", resolve: selector => document.querySelector(selector!), note: () => {} });
    card.querySelectorAll<HTMLButtonElement>(".design-toggle button")[1].click();
    expect(target.style.color).toBe("rgb(36, 104, 255)");
    resetDesignPreviews();
    expect(target.getAttribute("style")).toBe(original);
  });

  it("recognises proposals and keeps notes the reviewer wrote around them", () => {
    expect(isDesignComment("Just a comment")).toBe(false);
    expect(isDesignComment(`Tighter please\n\n${style}`)).toBe(true);
    const blocks = parseDesignComment(`Tighter please\n\n${style}\n\n${text}`);
    expect(blocks[0]).toEqual({ text: "Tighter please" });
    expect(blocks[1]).toMatchObject({
      title: "Style changes",
      target: "#root > main:nth-of-type(1) > h2:nth-of-type(1)",
      changes: [
        { label: "width", before: "462px", after: "308px", apply: { kind: "style", property: "width" } },
        { label: "color", before: "rgb(41, 42, 38)", after: "#4f5f42" },
      ],
    });
    expect(blocks[2]).toMatchObject({ title: "Text change", changes: [{ label: "Text", before: "Old title", after: "New title" }] });
  });

  it("parses token and React prop proposals", () => {
    const [tokenBlock] = parseDesignComment(tokens);
    expect(tokenBlock).toMatchObject({
      title: "Token changes",
      changes: [
        { label: "color", after: "var(--color-brand)", token: "color.brand", apply: { kind: "style", property: "color" } },
        { label: "spacing.card", before: "28px", after: "32px", apply: { kind: "variable", property: "--spacing-card" } },
      ],
    });
    const [propBlock] = parseDesignComment(props);
    expect(propBlock).toMatchObject({ component: "PromoCard", source: "examples/react-props/src/card.tsx:19", changes: [{ label: "tone", before: "quiet", after: "loud" }] });
    expect((propBlock as { changes: Array<{ apply?: unknown }> }).changes[0].apply).toBeUndefined();
  });

  it("summarises for the sidebar", () => {
    expect(shortTarget("#root > div.demo-row:nth-of-type(1) > h2:nth-of-type(1)")).toBe("h2");
    expect(summarizeDesignComment(style)).toBe("Design change · 2 edits on h2");
    expect(summarizeDesignComment(`Tighter please\n\n${text}`)).toBe("Tighter please\nDesign change · 1 edit");
  });

  it("renders a change card and previews Before/After on the page", () => {
    document.body.innerHTML = '<h2 id="title" style="width: 462px">Old title</h2>';
    const title = document.getElementById("title")!;
    title.scrollIntoView = () => {};
    const container = document.createElement("div");
    const render = () =>
      renderDesignComment(container, `${style}\n\n${tokens}`, {
        key: "c1",
        resolve: () => title,
        note: (element, value) => element.append(value),
      });
    render();
    expect([...container.querySelectorAll(".design-card-title")].map((node) => node.textContent)).toEqual(["Style changes", "Token changes"]);
    expect(container.querySelector(".design-card-target")!.textContent).toBe("h2");
    expect(container.querySelector(".design-swatch")).not.toBeNull();
    expect(container.querySelector(".design-token")!.textContent).toBe("color.brand");
    // One Before/After switch per comment.
    const [before, after] = container.querySelectorAll<HTMLButtonElement>(".design-toggle button");
    expect(container.querySelectorAll(".design-toggle")).toHaveLength(1);
    after.click();
    expect(title.style.width).toBe("308px");
    expect(document.documentElement.style.getPropertyValue("--spacing-card")).toBe("32px");
    // A redraw keeps the After state; Before restores the page.
    render();
    expect(container.querySelector('.design-toggle button[aria-pressed="true"]')!.textContent).toBe("After");
    container.querySelectorAll<HTMLButtonElement>(".design-toggle button")[0].click();
    expect(title.style.width).toBe("462px");
    expect(document.documentElement.style.getPropertyValue("--spacing-card")).toBe("");
    expect(before.isConnected).toBe(false);
  });

  it("previews text in place and resets previews whose comments are gone", () => {
    document.body.innerHTML = '<h2 id="title">Old title</h2>';
    const title = document.getElementById("title")!;
    const node = title.firstChild;
    title.scrollIntoView = () => {};
    const container = document.createElement("div");
    renderDesignComment(container, text, { key: "c2", resolve: () => title, note: () => {} });
    container.querySelectorAll<HTMLButtonElement>(".design-toggle button")[1].click();
    expect(title.textContent).toBe("New title");
    expect(title.firstChild).toBe(node);
    resetDesignPreviews(new Set(["other"]));
    expect(title.textContent).toBe("Old title");
  });

  it("flips Before/After with B, except while typing", () => {
    document.body.innerHTML = '<h2 id="title" style="width: 462px">Old title</h2><input id="field">';
    const title = document.getElementById("title")!;
    title.scrollIntoView = () => {};
    const container = document.createElement("div");
    document.body.append(container);
    renderDesignComment(container, style, { key: "c4", resolve: () => title, note: () => {} });
    const press = (target: EventTarget, key = "b") =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
    press(document.body);
    expect(title.style.width).toBe("308px");
    press(document.getElementById("field")!);
    expect(title.style.width).toBe("308px");
    press(document.body, "B");
    expect(container.querySelector('.design-toggle button[aria-pressed="true"]')!.textContent).toBe("Before");
  });

  it("shows text edits as one sentence with the change marked", () => {
    const container = document.createElement("div");
    renderDesignComment(container, 'Proposed inline text change (preview only)\n- Text: "Inspect safe props in the flow of a real page." → "Inspect safe props in the flow of a real pages."', { key: "c5", resolve: () => null, note: () => {} });
    const line = container.querySelector(".design-diff")!;
    expect(line.querySelector("del")!.textContent).toBe("page.");
    expect(line.querySelector("ins")!.textContent).toBe("pages.");
    expect(line.textContent).toBe("Inspect safe props in the flow of a real page.pages.");
    expect(container.querySelector(".design-row-prose .design-prop")!.textContent).toBe("Text");
    // Prop strings lose their JSON quotes; short values keep the two-column layout.
    const props = 'Proposed React prop changes (preview only)\nComponent: Headline\n- text: "Old" → "New" [custom value]';
    renderDesignComment(container, props, { key: "c6", resolve: () => null, note: () => {} });
    expect(container.querySelector(".design-before")!.textContent).toBe("Old");
  });

  it("shows Before with ← and After with →", () => {
    document.body.innerHTML = '<h2 id="title" style="width: 462px">Old title</h2>';
    const title = document.getElementById("title")!;
    title.scrollIntoView = () => {};
    const container = document.createElement("div");
    document.body.append(container);
    renderDesignComment(container, style, { key: "c7", resolve: () => title, note: () => {} });
    const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    press("ArrowRight");
    expect(title.style.width).toBe("308px");
    press("ArrowRight");
    expect(title.style.width).toBe("308px");
    press("ArrowLeft");
    expect(container.querySelector('.design-toggle button[aria-pressed="true"]')!.textContent).toBe("Before");
  });

  it("collapses long change lists", () => {
    const long = ["Proposed style changes (preview only)", "Target: p", ...Array.from({ length: 7 }, (_, index) => `- prop-${index}: 0 → ${index + 1}`)].join("\n");
    const container = document.createElement("div");
    renderDesignComment(container, long, { key: "c3", resolve: () => null, note: () => {} });
    expect(container.querySelectorAll(".design-row:not([hidden])")).toHaveLength(4);
    const more = container.querySelector<HTMLButtonElement>(".design-more")!;
    expect(more.textContent).toBe("Show 3 more");
    more.click();
    expect(container.querySelectorAll(".design-row[hidden]")).toHaveLength(0);
  });

  it("renders a compact card for hover previews", () => {
    const container = document.createElement("div");
    renderDesignComment(container, `${style}\n\n${tokens}\n\n${props}`, { key: "c5", resolve: () => null, note: () => {}, compact: true });
    // Three rows across sections, then a count of the rest.
    expect(container.querySelectorAll(".design-row")).toHaveLength(3);
    expect(container.querySelectorAll(".design-card")).toHaveLength(2);
    expect(container.querySelector(".design-source")!.textContent).toBe("+2 more");
    // Hover cards keep the Before/After switch, but never the expand button.
    expect(container.querySelectorAll(".design-toggle")).toHaveLength(1);
    expect(container.querySelector(".design-more")).toBeNull();
  });
});
