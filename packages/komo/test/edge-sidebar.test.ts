import { describe, expect, it } from "vitest";
import {
  EDGE_MARGIN,
  EDGE_PARK_CLEARANCE,
  EDGE_PEEK_SLIVER,
  EDGE_SIDEBAR_MIN_HEIGHT,
  EDGE_SIDEBAR_MIN_WIDTH,
  EDGE_SIDEBAR_WIDTH,
  edgeSidebarOffsets,
  edgeSidebarPlacement,
  resizeEdgeBox,
} from "../src/edge-sidebar";

describe("edge sidebar placement", () => {
  const vw = 1440;
  const vh = 900;
  const width = EDGE_SIDEBAR_WIDTH;
  const height = 620;

  it("defaults to the right edge with a 16px margin", () => {
    const g = edgeSidebarPlacement(undefined, width, height, vw, vh);
    expect(g.side).toBe("right");
    expect(g.x).toBe(vw - width - EDGE_MARGIN);
    expect(g.y).toBe(EDGE_MARGIN);
  });

  it("clamps a free placement inside the viewport", () => {
    const g = edgeSidebarPlacement({ x: 0, y: 0 }, width, height, 800, 700);
    expect(g.x).toBe(EDGE_MARGIN);
    expect(g.y).toBe(EDGE_MARGIN);
  });

  it("brings an off-screen saved placement back inside the viewport", () => {
    for (const saved of [{ x: 5000, y: -400 }, { x: -900, y: 4000 }]) {
      const g = edgeSidebarPlacement(saved, width, height, 1280, 800);
      expect(g.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(g.x + width).toBeLessThanOrEqual(1280 - EDGE_MARGIN);
      expect(g.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(g.y + height).toBeLessThanOrEqual(800 - EDGE_MARGIN);
    }
  });

  it("parks off the right edge and peeks with a sliver", () => {
    const g = edgeSidebarPlacement({ x: 1044, y: 16 }, width, height, vw, vh);
    const offsets = edgeSidebarOffsets(g, vw);
    expect(g.x + offsets.parked).toBe(vw + EDGE_PARK_CLEARANCE);
    expect(g.x + offsets.peek).toBe(vw - EDGE_PEEK_SLIVER);
  });

  it("parks off the left edge when docked left", () => {
    const g = edgeSidebarPlacement(
      { x: 16, y: 16, edgeX: "left" },
      width,
      height,
      vw,
      vh
    );
    const offsets = edgeSidebarOffsets(g, vw);
    expect(g.x + offsets.parked).toBe(-(width + EDGE_PARK_CLEARANCE));
    expect(g.x + offsets.peek).toBe(EDGE_PEEK_SLIVER - width);
  });

  it("keeps a docked panel pinned to its edge after resizing", () => {
    const g = edgeSidebarPlacement(
      { x: 264, y: 16, edgeX: "right" },
      width,
      height,
      640,
      700
    );
    expect(g.x).toBe(Math.max(EDGE_MARGIN, 640 - width - EDGE_MARGIN));
    expect(g.side).toBe("right");
  });
});

describe("edge sidebar resize", () => {
  const start = { left: 200, top: 40, width: 380, height: 400 };

  it("grows from the east and south edges", () => {
    const next = resizeEdgeBox("se", start, 40, 30, 1440, 900);
    expect(next).toEqual({ left: 200, top: 40, width: 420, height: 430 });
  });

  it("keeps the opposite edge fixed when resizing west or north", () => {
    const next = resizeEdgeBox("nw", start, 50, 20, 1440, 900);
    expect(next.left + next.width).toBe(start.left + start.width);
    expect(next.top + next.height).toBe(start.top + start.height);
    expect(next.width).toBe(330);
    expect(next.height).toBe(380);
  });

  it("does not shrink past the minimum size", () => {
    const next = resizeEdgeBox("se", start, -400, -400, 1440, 900);
    expect(next.width).toBe(EDGE_SIDEBAR_MIN_WIDTH);
    expect(next.height).toBe(EDGE_SIDEBAR_MIN_HEIGHT);
  });
});