const SIDEBAR_WIDTH = 380;
const PAGE_SCALE = 0.9;
const PAGE_GAP = 24;
/** Reflow Frame keeps room above the page for its size controls. */
export const FRAME_BAR = 48;
export const REVIEW_BREAKPOINT = 760;

export const isCompactReview = (width: number, height: number) =>
  width <= REVIEW_BREAKPOINT || (width <= 1000 && height <= 500);

export function reviewLayout(
  width: number,
  height: number,
  expanded: boolean,
  pageHeight = height,
  account = false,
  /** Fit the page's full width beside the sidebar instead of letting it run under the left edge. */
  fit = false,
  scaled = true,
) {
  const desktop = expanded && !isCompactReview(width, height);
  const mobile = expanded && !desktop;
  const right = desktop ? SIDEBAR_WIDTH + PAGE_GAP : 0;
  const scale = desktop && scaled ? (fit ? Math.min(PAGE_SCALE, (width - right - PAGE_GAP) / width) : PAGE_SCALE) : 1;
  const sheetTop = mobile ? (account ? 0 : height * 0.18) : height;
  // A fitted frame is the viewport scaled down, so pages sized with 100vh fill it exactly.
  const frameHeight = mobile ? pageHeight : desktop ? (scaled ? height * (fit ? scale : PAGE_SCALE) : Math.max(1, height - PAGE_GAP - FRAME_BAR)) : height;
  const left = desktop ? (fit || !scaled ? PAGE_GAP : width - right - width * scale) : 0;
  const top = desktop ? (scaled ? (height - frameHeight) / 2 : FRAME_BAR) : 0;
  return {
    desktop,
    mobile,
    framed: desktop,
    sheetTop,
    bottom: height - top - frameHeight,
    scale,
    left,
    top,
    right,
    visibleTop: Math.max(0, top),
    visibleHeight: Math.max(0, frameHeight + Math.min(0, top)),
    visibleLeft: Math.max(0, left),
    visibleWidth: width - right - Math.max(0, left),
    height: frameHeight,
    dockCenter: desktop ? width - SIDEBAR_WIDTH / 2 : width / 2,
  };
}

export function mobileComposerPosition(
  width: number,
  height: number,
  top: number,
  cardWidth: number,
  cardHeight: number,
) {
  return {
    x: Math.max(12, (width - cardWidth) / 2),
    y: top + Math.max(12, (height - cardHeight) / 2),
  };
}

type Box = { left: number; top: number; width: number; height: number };
export type FrameView = Box & { scale: number; pan: boolean };
/**
 * Place a logical viewport in Frame's box. Fit shows all of it, centred, and
 * never upscales; 100% keeps CSS pixels and pans when it is larger than the box.
 */
export function frameView(box: Box, [width, height]: number[], actual: boolean): FrameView {
  const scale = actual ? 1 : Math.min(1, box.width / width, box.height / height);
  return {
    width,
    height,
    scale,
    pan: width * scale > box.width + 0.5 || height * scale > box.height + 0.5,
    left: box.left + Math.max(0, (box.width - width * scale) / 2),
    top: box.top + Math.max(0, (box.height - height * scale) / 2),
  };
}

type Edges = { left: number; top: number; right: number; bottom: number };
/** The box a pin occupies around its point when there is no pin element to measure. */
export const pinBox = ({ x, y }: { x: number; y: number }): Edges => ({ left: x - 4, top: y - 28, right: x + 12, bottom: y + 4 });
/**
 * Place a komo card beside a pin's on-screen box, in window pixels: right, left,
 * below, then above, the first that fits the review area; otherwise the roomiest, clamped.
 */
export function placeCard(pin: Edges, width: number, height: number, area: Edges) {
  const fit = (start: number, size: number, low: number, high: number) =>
    Math.max(low, Math.min(start, high - size));
  const x = fit(pin.left, width, area.left, area.right);
  const y = fit(pin.top, height, area.top, area.bottom);
  const options = [
    [pin.right + 8, y],
    [pin.left - width - 8, y],
    [x, pin.bottom + 8],
    [x, pin.top - 8 - height],
  ];
  const visible = ([left, top]: number[]) =>
    Math.max(0, Math.min(left + width, area.right) - Math.max(left, area.left)) *
    Math.max(0, Math.min(top + height, area.bottom) - Math.max(top, area.top));
  const best =
    options.find((option) => visible(option) >= width * height - 1) ??
    options.reduce((a, b) => (visible(b) > visible(a) ? b : a));
  return {
    x: fit(best[0], width, area.left, area.right),
    y: fit(best[1], height, area.top, area.bottom),
  };
}
