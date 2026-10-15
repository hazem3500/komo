const SIDEBAR_WIDTH = 380;
const PAGE_SCALE = 0.9;
const PAGE_GAP = 24;
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
) {
  const desktop = expanded && !isCompactReview(width, height);
  const mobile = expanded && !desktop;
  const right = desktop ? SIDEBAR_WIDTH + PAGE_GAP : 0;
  const scale = desktop ? (fit ? Math.min(PAGE_SCALE, (width - right - PAGE_GAP) / width) : PAGE_SCALE) : 1;
  const sheetTop = mobile ? (account ? 0 : height * 0.18) : height;
  const frameHeight = mobile ? pageHeight : height * (desktop ? PAGE_SCALE : 1);
  const left = desktop ? (fit ? PAGE_GAP : width - right - width * scale) : 0;
  const top = desktop ? (height * (1 - PAGE_SCALE)) / 2 : 0;
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
