import { describe, expect, it } from "vitest";
import { byAge, collisions, hitArea, pinStacks, stackFaces, stackWidth } from "../src/pin-stacks";
import type { Thread } from "../src/types";
const thread = (id: string, selector = "#hero", unstacked = false): Thread => ({
  id,
  createdAt: Number(id),
  updatedAt: 0,
  page: "/",
  resolved: false,
  resolvedBy: null,
  comments: [],
  anchor: {
    selector,
    text: "",
    x: 0.5,
    y: 0.5,
    width: 0,
    height: 0,
    pageX: 20,
    pageY: 20,
    viewportWidth: 1000,
    unstacked,
  },
});
describe("component indicator stacks", () => {
  it("keeps a stable oldest anchor even when API order changes", () => {
    const first = thread("1"),
      second = thread("2"),
      other = thread("3", "#footer");
    const stacks = pinStacks([second, other, first], (t) => t.anchor.selector);
    expect(stacks.get("2")).toEqual([first, second]);
    expect(stacks.has("3")).toBe(false);
  });
  it("leaves moved and resolved comments out of the stack", () => {
    const moved = thread("2", "#hero", true),
      resolved = { ...thread("3"), resolved: true };
    expect(
      pinStacks([thread("1"), moved, resolved], (t) => t.anchor.selector).size
    ).toBe(0);
  });
  it("groups aliases of one component but not missing targets", () => {
    const element = {};
    expect(
      pinStacks([thread("1"), thread("2", "main > h1")], () => element).size
    ).toBe(2);
    expect(pinStacks([thread("1"), thread("2")], () => null).size).toBe(0);
  });
});
describe("stack collapse rules", () => {
  it("draws up to three faces, then the first author and a count", () => {
    expect([1, 2, 3, 4, 9].map(stackFaces)).toEqual([1, 2, 3, 1, 1]);
  });
  it("overlaps each face by 60% and keeps a 24px target", () => {
    expect(stackWidth(2, 20)).toBeCloseTo(20 + 8 + 4);
    expect(stackWidth(3, 20)).toBeCloseTo(20 + 16 + 4);
    expect(stackWidth(2, 12)).toBe(24);
    expect(stackWidth(5, 20)).toBeCloseTo(20 + 26 + 4);
  });
  it("orders by creation, then id", () => {
    const a = thread("2"),
      b = { ...thread("1"), createdAt: 2 },
      c = thread("3");
    expect([c, a, b].sort(byAge).map((t) => t.id)).toEqual(["1", "2", "3"]);
  });
});
describe("collision clusters", () => {
  const box = (x: number, y = 100, right = false) => hitArea(x, y, right);
  it("uses the resting pin's 24px hit area beside its tip", () => {
    expect(hitArea(100, 100, false)).toEqual({ left: 91, top: 82, right: 115, bottom: 106 });
    expect(hitArea(100, 100, true)).toEqual({ left: 85, top: 82, right: 109, bottom: 106 });
    expect(hitArea(100, 100, false, 40)).toEqual({ left: 91, top: 82, right: 131, bottom: 106 });
  });
  it("merges overlapping areas transitively and keeps the rest apart", () => {
    expect(collisions([box(100), box(120), box(140), box(400), box(100, 300)])).toEqual([[0, 1, 2], [3], [4]]);
    // Touching edges do not overlap.
    expect(collisions([box(100), box(124)])).toEqual([[0], [1]]);
  });
  it("never merges a moved pin", () => {
    expect(collisions([box(100), null, box(110)])).toEqual([[0, 2], [1]]);
  });
  it("collides sooner as Frame scales the page down", () => {
    // Anchors 30 CSS px apart, measured on screen after the Frame scale.
    const at = (scale: number) => collisions([box(200 * scale), box((200 + 30) * scale)]).length;
    expect(at(1)).toBe(2);
    expect(at(0.9)).toBe(2);
    expect(at(0.75)).toBe(1);
    expect(at(0.5)).toBe(1);
  });
});
