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
  it("refreshes an unsaved semantic draft's actual preview and values without changing a custom literal", async () => {
    const root = document.documentElement;
    root.setAttribute("data-review-mode", "dark");
    document.body.innerHTML = '<p id="target">Example</p><div id="draft"></div>';
    const target = document.querySelector<HTMLElement>("#target")!;
    const container = document.querySelector<HTMLElement>("#draft")!;
    target.scrollIntoView = vi.fn();
    const body = "Proposed design-token changes (preview only)\nElement color: #cccccc [text.secondary] → #eeeeee [text.primary]\n\nProposed style changes (preview only)\n- background-color: transparent → #ef3340";
    const saved = document.body.appendChild(document.createElement("div"));
    renderDesignComment(saved, body, { key: "saved", resolve: () => target, compact: true, note: (element, text) => element.append(text) });
    const updates: string[] = [];
    const design = { tokens: {
      id: "draft-theme",
      list: (theme?: Record<string, string>) => [
        { path: "text.primary", type: "color" as const, value: theme?.mode === "light" ? "#222222" : "#eeeeee", properties: ["color"] },
        { path: "text.secondary", type: "color" as const, value: theme?.mode === "light" ? "#555555" : "#cccccc", properties: ["color"] },
      ],
      resolve: () => ({ color: { path: "text.secondary" } }),
    }, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => root.getAttribute("data-review-mode")!, apply: (id: string) => root.setAttribute("data-review-mode", id) }] };
    try {
      await renderDraftProposal(container, body, () => target, { design, onUpdate: value => updates.push(value) });
      expect(getComputedStyle(target).color).toBe("rgb(238, 238, 238)");
      root.setAttribute("data-review-mode", "light");
      await vi.waitFor(() => expect(getComputedStyle(target).color).toBe("rgb(34, 34, 34)"));
      expect(getComputedStyle(target).backgroundColor).toBe("rgb(239, 51, 64)");
      expect(container.textContent).toContain("#555555");
      expect(container.textContent).toContain("#222222");
      expect(container.textContent).not.toContain("#eeeeee");
      expect(saved.textContent).toContain("#eeeeee");
      expect(updates.at(-1)).toContain("#555555 [text.secondary] → #222222 [text.primary]");
      container.querySelector<HTMLButtonElement>(".design-toggle button")!.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(target.getAttribute("style")).toBeNull();
      root.setAttribute("data-review-mode", "dark");
      await vi.waitFor(() => expect(container.textContent).toContain("#eeeeee"));
      expect(target.getAttribute("style")).toBeNull();
      container.querySelectorAll<HTMLButtonElement>(".design-toggle button")[1].click();
      expect(getComputedStyle(target).color).toBe("rgb(238, 238, 238)");
      resetDesignPreviews();
      expect(target.getAttribute("style")).toBeNull();
    } finally { root.removeAttribute("data-review-mode"); }
  });

  it("ignores a late theme-token response after an unsaved draft is cancelled", async () => {
    const target = document.body.appendChild(document.createElement("p"));
    const container = document.body.appendChild(document.createElement("div"));
    let finish!: (tokens: import("../src/design-system").DesignToken[]) => void;
    const pending = new Promise<import("../src/design-system").DesignToken[]>(resolve => { finish = resolve; });
    const onUpdate = vi.fn();
    const rendering = renderDraftProposal(container, "Proposed design-token changes (preview only)\nElement color: #111111 → #eeeeee [text.primary]", () => target, { design: { tokens: { id: "late-theme", list: () => pending, resolve: () => ({}) } }, onUpdate });
    resetDesignPreviews();
    finish([{ path: "text.primary", type: "color", value: "#222222", properties: ["color"] }]);
    await rendering;
    expect(target.getAttribute("style")).toBeNull();
    expect(container.childElementCount).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not adopt a replacement style target when an unsaved theme preview refreshes", async () => {
    const root = document.documentElement;
    root.setAttribute("data-review-mode", "dark");
    document.body.innerHTML = '<main><p id="target">Original</p></main><div id="draft"></div>';
    const original = document.querySelector<HTMLElement>("#target")!;
    const container = document.querySelector<HTMLElement>("#draft")!;
    const design = { tokens: { id: "retained-theme", list: (theme?: Record<string, string>) => [{ path: "text.primary", type: "color" as const, value: theme?.mode === "light" ? "#222222" : "#eeeeee", properties: ["color"] }], resolve: () => ({}) }, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => root.getAttribute("data-review-mode")!, apply: (id: string) => root.setAttribute("data-review-mode", id) }] };
    try {
      await renderDraftProposal(container, "Proposed design-token changes (preview only)\nTarget: #target\nElement color: #111111 → #eeeeee [text.primary]", () => document.querySelector("#target"), { design });
      const replacement = document.createElement("p"); replacement.id = "target";
      original.replaceWith(replacement);
      root.setAttribute("data-review-mode", "light");
      await vi.waitFor(() => expect(container.textContent).toContain("#222222"));
      expect(replacement.getAttribute("style")).toBeNull();
      expect(original.getAttribute("style")).toBeNull();
      expect(container.querySelector('.design-toggle button[aria-pressed="true"]')!.textContent).toBe("Before");
    } finally { root.removeAttribute("data-review-mode"); }
  });

  it.each(["replace", "remove"])("invalidates After when a parent %ss the entire owner", async action => {
    document.body.innerHTML = '<main><a id="link"><strong>Old title</strong></a></main>';
    const target = document.querySelector<HTMLElement>("#link")!;
    const container = document.body.appendChild(document.createElement("div"));
    renderDraftProposal(container, text, () => document.querySelector("#link"));
    expect(target.textContent).toBe("New title");
    const replacement = document.createElement("a");
    replacement.id = "link";
    replacement.textContent = "Old title";
    if (action === "replace") target.replaceWith(replacement);
    else target.remove();
    const [before, after] = container.querySelectorAll<HTMLButtonElement>(".design-toggle button");
    await vi.waitFor(() => expect(before.getAttribute("aria-pressed")).toBe("true"));
    expect(after.disabled).toBe(true);
    if (action === "remove") document.querySelector("main")!.append(replacement);
    after.click();
    expect(replacement.textContent).toBe("Old title");
    expect(container.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
    renderDraftProposal(container, text, () => document.querySelector("#link"));
    expect(container.querySelectorAll<HTMLButtonElement>(".design-toggle button")[1].disabled).toBe(true);
    expect(container.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
    resetDesignPreviews();
    replacement.replaceWith(target);
    target.querySelector("strong")!.firstChild!.textContent = "Host update after cleanup";
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(target.textContent).toBe("Host update after cleanup");
  });

  it.each(["reparent", "shadow host"])("tracks owner attachment through %s changes", async kind => {
    const host = document.body.appendChild(document.createElement("section"));
    const parent = kind === "shadow host" ? host.attachShadow({ mode: "open" }) : host;
    const target = parent.appendChild(Object.assign(document.createElement("a"), { textContent: "Old title" }));
    const container = document.body.appendChild(document.createElement("div"));
    renderDraftProposal(container, text, () => target);
    expect(target.textContent).toBe("New title");
    if (kind === "reparent") {
      const next = document.body.appendChild(document.createElement("section"));
      next.append(target);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(target.textContent).toBe("New title");
      next.remove();
    } else host.remove();
    await vi.waitFor(() => expect(container.querySelectorAll<HTMLButtonElement>(".design-toggle button")[1].disabled).toBe(true));
    target.firstChild!.textContent = "Host text after loss";
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(target.textContent).toBe("Host text after loss");
  });

  it("takes After back when a host replaces the original text structure", async () => {
    document.body.innerHTML = '<a id="link"><strong>Old title</strong></a>';
    const target = document.querySelector<HTMLElement>("#link")!;
    const container = document.body.appendChild(document.createElement("div"));
    renderDraftProposal(container, text, () => target);
    expect(target.textContent).toBe("New title");
    const moved = target.querySelector("strong")!;
    document.body.append(moved);
    moved.firstChild!.textContent = "Host moved text";
    const replacement = document.createElement("em");
    replacement.textContent = "Host replacement";
    target.replaceChildren(replacement);
    await vi.waitFor(() => expect(container.querySelector('.design-toggle button[aria-pressed="true"]')!.textContent).toBe("Before"));
    expect(target.firstChild).toBe(replacement);
    expect(target.textContent).toBe("Host replacement");
    expect(moved.textContent).toBe("Host moved text");
    expect(container.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
  });

  it("keeps Before selected when the page text no longer matches the proposal", () => {
    document.body.innerHTML = '<a id="link"><strong>Current title</strong></a>';
    const target = document.querySelector<HTMLElement>("#link")!;
    target.scrollIntoView = () => {};
    const container = document.body.appendChild(document.createElement("div"));
    renderDesignComment(container, text, { key: "stale-text", resolve: () => target, note: () => {} });
    const [before, after] = container.querySelectorAll<HTMLButtonElement>(".design-toggle button");
    after.click();
    expect(target.textContent).toBe("Current title");
    expect(before.getAttribute("aria-pressed")).toBe("true");
    expect(after.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
  });

  it("previews nested text without replacing icons, elements or text nodes", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.body.innerHTML = '<a id="link" href="#destination"><svg><title>Icon</title><path d="M0 0h4v4z"/></svg><span>Old <strong>title</strong></span></a>';
    const target = document.querySelector<HTMLElement>("#link")!;
    target.scrollIntoView = () => {};
    const original = target.innerHTML;
    const icon = target.querySelector("svg");
    const node = target.querySelector("strong")!.firstChild;
    const body = 'Proposed inline text change (preview only)\nTarget: #link\n- Text: "IconOld title" → "IconOld heading"';
    const container = document.body.appendChild(document.createElement("div"));
    renderDraftProposal(container, body, () => target);
    expect(target.querySelector("strong")!.textContent).toBe("heading");
    expect(target.querySelector("svg")).toBe(icon);
    expect(target.querySelector("strong")!.firstChild).toBe(node);
    const [before, after] = container.querySelectorAll<HTMLButtonElement>(".design-toggle button");
    expect(after.getAttribute("aria-pressed")).toBe("true");
    before.click();
    expect(target.innerHTML).toBe(original);
    after.click();
    expect(target.querySelector("strong")!.textContent).toBe("heading");
    resetDesignPreviews();
    expect(target.innerHTML).toBe(original);
    expect(target.querySelector("strong")!.firstChild).toBe(node);
  });

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
    expect(container.querySelector(".design-card-target")!.textContent).toBe("Heading “Old title”");
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
    const press = (key: string) => container.querySelector(".design-toggle button")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
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
