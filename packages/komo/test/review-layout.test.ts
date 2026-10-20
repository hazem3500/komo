import { describe, expect, it } from "vitest";
import { frameView, mobileComposerPosition, pinBox, placeCard, reviewLayout } from "../src/review-layout";

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
    expect(layout.top).toBe(48);
    expect(layout.visibleWidth).toBe(852);
    expect(layout.height).toBe(728);
    expect(layout.left + layout.visibleWidth).toBe(876);
  });
});

describe("frame view", () => {
  const box = { left: 24, top: 48, width: 852, height: 728 };
  it("fits the browser window's own size into the box by default, scaled down", () => {
    const window = frameView(box, [1280, 800], false);
    expect(window).toMatchObject({ width: 1280, height: 800, pan: false, left: 24 });
    expect(window.scale).toBeCloseTo(852 / 1280);
    expect(window.scale).toBeLessThan(1);
    expect(frameView(box, [852, 728], false)).toEqual({ width: 852, height: 728, scale: 1, pan: false, left: 24, top: 48 });
  });
  it("fits a larger logical viewport, centred, and never upscales a smaller one", () => {
    const desktop = frameView(box, [1440, 900], false);
    expect(desktop.scale).toBeCloseTo(852 / 1440);
    expect(desktop.left).toBe(24);
    expect(desktop.top).toBeCloseTo(48 + (728 - 900 * desktop.scale) / 2);
    expect(desktop.pan).toBe(false);
    const mobile = frameView(box, [390, 844], false);
    expect(mobile.scale).toBeCloseTo(728 / 844);
    expect(mobile.left).toBeCloseTo(24 + (852 - 390 * mobile.scale) / 2);
    expect(frameView(box, [390, 600], false)).toMatchObject({ scale: 1, pan: false, left: 255, top: 112 });
  });
  it("keeps CSS pixels at 100% and pans a viewport larger than the box", () => {
    expect(frameView(box, [1440, 900], true)).toMatchObject({ scale: 1, pan: true, left: 24, top: 48 });
    expect(frameView(box, [768, 600], true)).toMatchObject({ scale: 1, pan: false });
  });
});

describe("card placement", () => {
  const area = { left: 12, top: 12, right: 550, bottom: 700 };
  const pin = (x: number, y: number) => ({ left: x, top: y, right: x + 34, bottom: y + 34 });
  it("prefers the right of the pin, then the left", () => {
    expect(placeCard(pin(100, 200), 320, 140, area)).toEqual({ x: 142, y: 200 });
    expect(placeCard(pin(450, 200), 320, 140, area)).toEqual({ x: 122, y: 200 });
  });
  it("goes below, then above, when neither side has room, without covering the pin", () => {
    expect(placeCard(pin(250, 200), 320, 140, area)).toEqual({ x: 230, y: 242 });
    expect(placeCard(pin(250, 600), 320, 140, area)).toEqual({ x: 230, y: 452 });
  });
  it("clamps the roomiest side into the area when nothing fits", () => {
    const place = placeCard(pin(250, 300), 320, 680, area);
    expect(place.x).toBeGreaterThanOrEqual(12);
    expect(place.x + 320).toBeLessThanOrEqual(550);
    expect(place.y).toBeGreaterThanOrEqual(12);
    expect(place.y + 680).toBeLessThanOrEqual(700);
  });
  it("treats a bare point as a pin-sized box", () => {
    expect(pinBox({ x: 100, y: 100 })).toEqual({ left: 96, top: 72, right: 112, bottom: 104 });
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
