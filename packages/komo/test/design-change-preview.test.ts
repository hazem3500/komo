// @vitest-environment jsdom
// Before/After on posted design proposals: every kind previews on the live page, says why
// when it can't, outlines what changed and never leaves a preview behind.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDesignComment, renderDesignComment, resetDesignPreviews } from "../src/design-comment";

afterEach(() => {
  resetDesignPreviews();
  document.body.replaceChildren();
});

const move = [
  "Proposed geometry changes (preview only)",
  "Target: nav#list > a:nth-of-type(3)",
  "Layout: flex item, column",
  "- Move Link “Approvals”: from NavList (3rd) → NavList (2nd)",
  "From: nav#list · index 2",
  "To: nav#list · index 1 · before",
].join("\n");
const nav = () => {
  document.body.innerHTML = '<nav id="list"><a id="members">Members</a><a id="reports">Reports</a><a id="approvals">Approvals</a><a id="time">Time off</a></nav><div id="thread"></div>';
  document.querySelector<HTMLElement>("#approvals")!.scrollIntoView = vi.fn();
  return document.querySelector<HTMLElement>("#thread")!;
};
const order = () => [...document.querySelectorAll<HTMLElement>("#list > a")].filter(node => node.style.display !== "none").map(node => node.textContent);
const button = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>(".design-toggle button")].find(node => node.textContent === label)!;
const status = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="status"]')!;

describe("Before/After for every posted proposal", () => {
  it("parses resizes with what they also set, moves with both places, and translations", () => {
    const [geometry] = parseDesignComment([
      "Proposed geometry changes (preview only)",
      "Target: #card",
      "Layout: flex item, row",
      "- Resize (size) width: 180px → 224px · width overrides flex: 1 1 0% · sets flex-basis: 224px · sets flex-grow: 0",
      "- Resize (span) grid-column-end: auto → span 2 · spans 2 column tracks",
      "- Move (translate): Δx 12px, Δy -4px",
    ].join("\n"));
    expect(geometry).toMatchObject({ changes: [
      { label: "width", before: "180px", after: "224px", apply: { kind: "style", property: "width", also: [["flex-basis", "224px"], ["flex-grow", "0"]] } },
      { label: "grid-column-end", before: "auto", after: "span 2", apply: { kind: "style", property: "grid-column-end", also: [] } },
      { label: "translate", after: "12px -4px", apply: { kind: "style", property: "translate" } },
    ] });
    expect(parseDesignComment(move)[0]).toMatchObject({ changes: [{ label: "Link “Approvals”", before: "NavList · 3rd", after: "2nd",
      apply: { kind: "move", from: { parent: "nav#list", index: 2 }, to: { parent: "nav#list", index: 1 } } }] });
  });

  it("reads a move as one sentence, previews it with a stand-in, outlines both spots and restores the page exactly", () => {
    const container = nav();
    const original = document.querySelector("#list")!.outerHTML;
    const approvals = document.querySelector<HTMLElement>("#approvals")!;
    renderDesignComment(container, move, { key: "move", resolve: () => approvals, note: () => {}, design: { selectionColor: "#ff00aa" } });
    // The element is named once, in the heading, with both places below it and no repeated row.
    expect(container.querySelector(".design-card-title")!.textContent).toBe("Moved Link “Approvals”");
    expect(container.querySelector(".design-card-target")!.textContent).toBe("NavList · 3rd → 2nd");
    expect(container.querySelectorAll(".design-row")).toHaveLength(0);
    // A design thread opens on Before: the page as it is now.
    expect(button(container, "Before").getAttribute("aria-pressed")).toBe("true");
    expect(button(container, "After").disabled).toBe(false);
    expect(button(container, "After").querySelector("svg")).not.toBeNull();
    button(container, "After").click();
    expect(order()).toEqual(["Members", "Approvals", "Reports", "Time off"]);
    expect(approvals.style.getPropertyValue("display")).toBe("none");
    const clone = document.querySelector("[data-komo-move-clone]")!;
    expect(clone.hasAttribute("id")).toBe(false);
    expect(clone.getAttribute("aria-hidden")).toBe("true");
    // The new spot in the selection colour, and a faint outline where it was.
    const marks = [...document.querySelectorAll<HTMLElement>(".design-mark")];
    expect(marks).toHaveLength(2);
    expect(marks[0].style.outline).toContain("dashed");
    expect(marks[1].style.outline).toContain("solid");
    expect(marks[1].style.outline).toContain("#ff00aa");
    button(container, "Before").click();
    expect(document.querySelector("#list")!.outerHTML).toBe(original);
    expect(document.querySelectorAll(".design-mark")).toHaveLength(0);
  });

  it("disables After with a short reason when the element is missing, already moved or blocked, and keeps the diff", () => {
    let container = nav();
    renderDesignComment(container, move, { key: "missing", resolve: () => null, note: () => {} });
    expect(button(container, "After").disabled).toBe(true);
    expect(status(container).textContent).toBe("Element not found on this page");
    expect(container.querySelector(".design-card-target")!.textContent).toBe("NavList · 3rd → 2nd");
    // The page already shows the move.
    container = nav();
    const approvals = document.querySelector<HTMLElement>("#approvals")!;
    document.querySelector("#list")!.insertBefore(approvals, document.querySelector("#reports"));
    renderDesignComment(container, move, { key: "shipped", resolve: () => approvals, note: () => {} });
    expect(button(container, "After").disabled).toBe(true);
    expect(button(container, "After").title).toBe("Already moved on this page");
    // A reason from the host, such as the reviewer's own pending Design mode edits.
    container = nav();
    const target = document.querySelector<HTMLElement>("#approvals")!;
    let pending = "Send or reset your Design mode edits first";
    const options = { key: "blocked", resolve: () => target, note: () => {}, blocked: () => pending };
    renderDesignComment(container, move, options);
    expect(button(container, "After").disabled).toBe(true);
    expect(status(container).textContent).toBe(pending);
    pending = "";
    renderDesignComment(container, move, options);
    expect(button(container, "After").disabled).toBe(false);
    expect(status(container).hidden).toBe(true);
  });

  it("previews a resize with what it also sets, and restores the original style attribute", () => {
    document.body.innerHTML = '<div id="card" style="color: red">Card</div><div id="thread"></div>';
    const card = document.querySelector<HTMLElement>("#card")!;
    card.scrollIntoView = vi.fn();
    const container = document.querySelector<HTMLElement>("#thread")!;
    renderDesignComment(container, "Proposed geometry changes (preview only)\nTarget: #card\nLayout: flex item, row\n- Resize (size) width: 180px → 224px · sets flex-basis: 224px · sets flex-grow: 0",
      { key: "resize", resolve: () => card, note: () => {} });
    button(container, "After").click();
    expect([card.style.width, card.style.flexBasis, card.style.flexGrow]).toEqual(["224px", "224px", "0"]);
    expect(document.querySelectorAll(".design-mark")).toHaveLength(1);
    // Before eases back to the measured values, then hands the style attribute back as it was.
    vi.useFakeTimers();
    button(container, "Before").click();
    vi.advanceTimersByTime(500);
    vi.useRealTimers();
    expect(card.getAttribute("style")).toBe("color: red");
  });

  it("previews prop values through the app's component editor and hands them back", () => {
    document.body.innerHTML = '<div id="promo">Promo</div><div id="thread"></div>';
    const promo = document.querySelector<HTMLElement>("#promo")!;
    promo.scrollIntoView = vi.fn();
    const container = document.querySelector<HTMLElement>("#thread")!;
    let props: Record<string, string | number | boolean | undefined> = { tone: "quiet", size: 2 };
    const release = vi.fn();
    const design = { components: {
      identify: (element: Element) => ({ name: "PromoCard", element }),
      editor: () => ({ schema: [{ name: "tone", kind: "enum" as const, required: false, typeLabel: "quiet | loud" }], read: () => props, apply: (next: typeof props) => { props = next; }, release }),
    } };
    const body = 'Proposed React prop changes (preview only)\nTarget: #promo\nComponent: PromoCard\n- tone: "quiet" → "loud" [custom value]';
    renderDesignComment(container, body, { key: "prop", resolve: () => promo, note: () => {}, design });
    button(container, "After").click();
    expect(props).toEqual({ tone: "loud", size: 2 });
    button(container, "Before").click();
    expect(props).toEqual({ tone: "quiet", size: 2 });
    expect(release).toHaveBeenCalledWith(["tone"]);
    // Without an editor, After says why instead of doing nothing.
    renderDesignComment(container, body, { key: "prop-2", resolve: () => promo, note: () => {} });
    button(container, "After").click();
    expect(button(container, "After").getAttribute("aria-pressed")).toBe("false");
    expect(status(container).textContent).toBe("This component can't preview props here");
  });

  it("never leaves a preview behind when the thread closes or switches", () => {
    const container = nav();
    const list = document.querySelector("#list")!.outerHTML;
    const approvals = document.querySelector<HTMLElement>("#approvals")!;
    renderDesignComment(container, move, { key: "open", resolve: () => approvals, note: () => {} });
    button(container, "After").click();
    expect(order()[1]).toBe("Approvals");
    // Switching threads keeps only the open thread's comments.
    resetDesignPreviews(new Set(["another-thread"]));
    expect(document.querySelector("#list")!.outerHTML).toBe(list);
    expect(document.querySelectorAll(".design-mark, [data-komo-move-clone]")).toHaveLength(0);
  });

  it("flips the open thread with B", () => {
    const container = nav();
    const approvals = document.querySelector<HTMLElement>("#approvals")!;
    renderDesignComment(container, move, { key: "keys", resolve: () => approvals, note: () => {} });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(button(container, "After").getAttribute("aria-pressed")).toBe("true");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(button(container, "Before").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-komo-move-clone]")).toBeNull();
  });
});
