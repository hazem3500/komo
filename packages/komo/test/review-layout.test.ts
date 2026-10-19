import { describe, expect, it } from "vitest";
import { mobileComposerPosition, reviewLayout } from "../src/review-layout";

describe("review viewport layout", () => {
  it.each([
    [320, 568],
    [390, 844],
    [760, 600],
    [844, 390],
  ])(
    "reserves a bottom sheet without horizontal overflow at %i × %i",
    (width, height) => {
      const layout = reviewLayout(width, height, true);
      expect(layout.mobile).toBe(true);
      expect(height - layout.sheetTop).toBeGreaterThanOrEqual(height / 2);
      expect(layout.framed).toBe(false);
      expect(layout.left).toBe(0);
      expect(layout.visibleWidth).toBe(width);
      expect(layout.scale).toBe(1);
      expect(layout.height).toBe(height);
      expect(layout.top).toBe(0);
    },
  );
  it("keeps the page unscaled when the keyboard reduces visible space", () => {
    const layout = reviewLayout(390, 450, true, 844);
    expect(layout.height / layout.scale).toBeCloseTo(844);
    expect(layout.scale).toBe(1);
    expect(layout.top).toBe(0);
  });
  it.each([844, 450])(
    "gives mobile accounts the visible viewport at height %i",
    (height) => {
      const layout = reviewLayout(390, height, true, 844, true);
      expect(layout.sheetTop).toBe(0);
      expect(layout.framed).toBe(false);
      expect(layout.top).toBe(0);
      expect(reviewLayout(1280, 800, true, 800, true).right).toBe(404);
    },
  );
  it("restores the full page when closed", () => {
    const layout = reviewLayout(390, 844, false);
    expect(layout.framed).toBe(false);
    expect(layout.scale).toBe(1);
    expect(layout.height).toBe(844);
    expect(layout.left).toBe(0);
  });
  it("fits the whole viewport, scaled, beside the comment column", () => {
    const layout = reviewLayout(1440, 900, true, 900, false, true);
    expect(layout.left).toBe(24);
    // The frame is the viewport scaled down: same aspect, so 100vw × 100vh fills it.
    expect(layout.scale * 1440).toBeCloseTo(1440 - 404 - 24);
    expect(layout.height).toBeCloseTo(900 * layout.scale);
    expect(layout.top).toBeCloseTo((900 - layout.height) / 2);
    expect(layout.left + layout.scale * 1440).toBeLessThanOrEqual(1440 - layout.right);
  });
  it("keeps the desktop comment column", () => {
    const layout = reviewLayout(1280, 800, true);
    expect(layout.desktop).toBe(true);
    expect(layout.right).toBe(404);
    expect(layout.dockCenter).toBe(1090);
  });
  it("reflows an unscaled Frame without changing native CSS-pixel dimensions", () => {
    const layout = reviewLayout(1280, 800, true, 800, false, true, false);
    expect(layout.scale).toBe(1);
    expect(layout.left).toBe(24);
    expect(layout.top).toBe(24);
    expect(layout.visibleWidth).toBe(852);
    expect(layout.height).toBe(752);
    expect(layout.left + layout.visibleWidth).toBe(876);
  });
});

describe("mobile composer", () => {
  it.each([
    [844, 0],
    [420, 0],
    [420, 180],
  ])(
    "centers in the visible viewport at height %i and offset %i",
    (height, top) => {
      const position = mobileComposerPosition(390, height, top, 354, 120);
      expect(position.x).toBe(18);
      expect(position.y + 60).toBe(top + height / 2);
      expect(position.y).toBeGreaterThanOrEqual(top + 12);
    },
  );
});
