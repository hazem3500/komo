// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeTranslate, eligibleAncestor, geometryProposal, geometryReason, spanFor, type GeometryChange } from "../src/design-geometry.js";
import { parseDesignComment } from "../src/design-comment.js";
// @ts-expect-error CLI modules are plain JavaScript.
import { designEditFromComment, formatDesignEdit, parseDesignEdit } from "../cli/design-edit.mjs";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

/** jsdom has no layout: give every element one 100×40 box unless a test says otherwise. */
function layout(rects = 1) {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => Array.from({ length: rects }, () => new DOMRect(0, 0, 100, 40)) as unknown as DOMRectList);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 100, 40));
}
const html = (markup: string) => { document.body.innerHTML = markup; };
const $ = (selector: string) => document.querySelector(selector)!;

describe("geometry eligibility reasons", () => {
  it("accepts flex and grid items, positioned boxes, replaced inline media and SVG roots", () => {
    layout();
    html(`<div style="display:flex"><div id="flex">a</div></div><div style="display:grid"><span id="grid">b</span></div>
      <div id="abs" style="position:absolute">c</div><div id="sticky" style="position:sticky">d</div><div id="ratio" style="aspect-ratio:16/9">e</div>
      <p><img id="img" alt=""><svg id="svg"><rect id="rect"/></svg><button id="button">f</button></p>`);
    for (const id of ["flex", "abs", "sticky", "ratio", "img", "svg", "button"]) expect(geometryReason($(`#${id}`)), id).toBeNull();
  });

  it("names the precise reason for boxes it can't preview", () => {
    layout();
    html(`<p id="p">Copy <span id="inline">inline</span></p><div id="contents" style="display:contents"><b>x</b></div><div id="none" style="display:none"></div>
      <table><tbody><tr><td id="cell">1</td></tr></tbody></table><svg><g id="group"><rect id="rect"/></g></svg>`);
    expect(geometryReason($("#inline"))).toBe("Inline text box can't be resized");
    expect(geometryReason($("#contents"))).toBe("display: contents has no box");
    expect(geometryReason($("#none"))).toBe("display: none has no box");
    expect(geometryReason($("#cell"))).toBe("Table cells and rows size with their table. Select the table.");
    expect(geometryReason($("#rect"))).toBe("SVG shapes can't be moved or resized. Select the SVG root.");
    expect(geometryReason(document.body)).toBe("The page root can't be moved or resized.");
    expect(geometryReason(document.createElement("div"))).toBe("Select an element on the page.");
  });

  it("explains unrendered and fragmented boxes", () => {
    html(`<div id="empty"></div>`);
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [] as unknown as DOMRectList);
    expect(geometryReason($("#empty"))).toBe("This element has no rendered box.");
    vi.restoreAllMocks();
    layout(2);
    expect(geometryReason($("#empty"))).toBe("Boxes split across lines or columns can't be previewed.");
  });

  it("selects the nearest movable ancestor for Select parent", () => {
    layout();
    html(`<section id="section"><div id="contents" style="display:contents"><p id="p"><span id="inline">x</span></p></div></section><svg id="svg"><g><rect id="rect"/></g></svg>`);
    expect(eligibleAncestor($("#inline"))).toBe($("#p"));
    expect(eligibleAncestor($("#p"))).toBe($("#section"));
    expect(eligibleAncestor($("#rect"))).toBe($("#svg"));
    expect(eligibleAncestor($("#section"))).toBeNull();
  });
});

describe("geometry math", () => {
  it("composes with the host translate, keeping units and the z part", () => {
    expect(composeTranslate("none", 12.345, -4)).toBe("12.35px -4px");
    expect(composeTranslate("", 1, 2)).toBe("1px 2px");
    expect(composeTranslate("10px", 5, 5)).toBe("15px 5px");
    expect(composeTranslate("5% 8px", 3, -2)).toBe("calc(5% + 3px) 6px");
    expect(composeTranslate("calc(5% + 3px) 1em 4px", -6, 0)).toBe("calc(calc(5% + 3px) - 6px) 1em 4px");
  });

  it("picks the span whose end edge is nearest, adding implicit tracks", () => {
    const starts = [0, 110, 220], ends = [100, 210, 320];
    expect(spanFor(starts, ends, 10, 100, 0, 90)).toBe(1);
    expect(spanFor(starts, ends, 10, 100, 0, 170)).toBe(2);
    expect(spanFor(starts, ends, 10, 100, 1, 330)).toBe(2);
    expect(spanFor(starts, ends, 10, 100, 0, 520)).toBe(5);
    expect(spanFor(starts, ends, 10, 100, 0, -50)).toBe(1);
  });
});

describe("geometry proposal text", () => {
  const changes: GeometryChange[] = [
    { mode: "translate", layout: "flex item, row", dx: 12, dy: -4, effects: [] },
    { mode: "flex-basis", layout: "flex item, row", property: "width", from: "260px", to: "300px", effects: ["width overrides flex: 1 1 0%", "sets flex-basis: 300px", "sets flex-grow: 0"] },
    { mode: "translate", layout: "flex item, row", dx: 3.333, dy: 4, effects: [] },
    { mode: "flex-basis", layout: "flex item, row", property: "width", from: "300px", to: "240px", effects: ["width overrides flex: 1 1 0%", "sets flex-basis: 240px", "sets flex-grow: 0"] },
    { mode: "size", layout: "flex item, row", property: "height", from: "38px", to: "38px", effects: [] },
  ];

  it("nets moves and sizes per gesture sequence with mode and side effects", () => {
    expect(geometryProposal(changes)).toBe([
      "Proposed geometry changes (preview only)",
      "Layout: flex item, row",
      "- Move (translate): Δx 15.33px, Δy 0px",
      "- Resize (flex-basis) width: 260px → 240px · width overrides flex: 1 1 0% · sets flex-basis: 240px · sets flex-grow: 0",
    ].join("\n"));
    expect(geometryProposal([])).toBeUndefined();
    expect(geometryProposal([{ mode: "translate", layout: "normal flow", dx: 3, dy: 0, effects: [] }, { mode: "translate", layout: "normal flow", dx: -3, dy: 0, effects: [] }])).toBeUndefined();
  });

  const body = `Make the action narrower.

Proposed style changes (preview only)
Target: #cta
- translate: none → 15.33px 0px
- width: 260px → 240px
- flex-basis: 0% → 240px
- flex-grow: 1 → 0

Proposed geometry changes (preview only)
Target: #cta
Layout: flex item, row
- Move (translate): Δx 15.33px, Δy 0px
- Resize (flex-basis) width: 260px → 240px · width overrides flex: 1 1 0% · sets flex-basis: 240px · sets flex-grow: 0
- Resize (span) grid-column-end: auto → span 2 · spans 2 column tracks
- Move (offset): Δx 0px, Δy 0px`;

  it("parses into DesignEdit geometry changes for agents", () => {
    const edit = designEditFromComment(body, "button");
    expect(edit.changes.filter((change: { kind: string }) => change.kind === "geometry")).toEqual([
      { kind: "geometry", mode: "translate", dx: 15.33, dy: 0, layout: "flex item, row" },
      { kind: "geometry", mode: "flex-basis", property: "width", from: "260px", to: "240px", layout: "flex item, row", effects: ["width overrides flex: 1 1 0%", "sets flex-basis: 240px", "sets flex-grow: 0"] },
      { kind: "geometry", mode: "span", property: "grid-column-end", from: "auto", to: "span 2", layout: "flex item, row", effects: ["spans 2 column tracks"] },
    ]);
    expect(edit.changes.filter((change: { kind: string }) => change.kind === "css")).toHaveLength(4);
    expect(formatDesignEdit(edit)).toContain("Geometry changes record how a move or resize was previewed");
    expect(parseDesignEdit(JSON.stringify(edit))).toEqual(edit);
  });

  it("validates geometry changes in fenced edits", () => {
    const edit = (change: object) => JSON.stringify({ komo: "design-edit", version: 1, target: { selector: "a" }, changes: [{ kind: "geometry", ...change }] });
    expect(parseDesignEdit(edit({ mode: "offset", dx: 1, dy: 2, extra: true })).changes[0]).toEqual({ kind: "geometry", mode: "offset", dx: 1, dy: 2 });
    expect(parseDesignEdit(edit({ mode: "rotate", dx: 1, dy: 2 }))).toBeNull();
    expect(parseDesignEdit(edit({ mode: "translate", dx: "1", dy: 2 }))).toBeNull();
    expect(parseDesignEdit(edit({ mode: "size", property: "width", from: "1px" }))).toBeNull();
    expect(parseDesignEdit(edit({ mode: "size", property: "width", from: "1px", to: "2px", effects: [3] }))).toBeNull();
  });

  it("renders geometry rows in the change card without previewing them as CSS", () => {
    const section = parseDesignComment(body).find(block => "title" in block && block.title === "Geometry changes");
    expect(section).toMatchObject({ target: "#cta" });
    const rows = (section as { changes: Array<{ label: string; after: string; apply?: unknown }> }).changes;
    expect(rows.map(row => row.label)).toEqual(["Move (translate)", "Resize (flex-basis) width", "Resize (span) grid-column-end", "Move (offset)"]);
    expect(rows.every(row => !row.apply)).toBe(true);
  });
});
