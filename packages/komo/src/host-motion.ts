// While komo itself drives a preview (an option under the pointer or the arrow keys, a token
// under the pointer, Before/After), the host's own transitions would otherwise run on every
// step: the page jitters, panel reads land mid-transition and the geometry guard sees motion
// the user never started. A hold marks the previewed element with one attribute; a stylesheet
// adopted by its root turns transitions off in its subtree, and animations a step started
// finish. Its inline style is never touched. The mark goes two frames after the last release,
// once the host has rendered the value it was handed, so restoring starts no transition either.

/** Present on an element, and so its subtree, while komo previews it. */
export const STILL = "data-komo-still";

const css = `:is([${STILL}],[${STILL}] *),:is([${STILL}],[${STILL}] *)::before,:is([${STILL}],[${STILL}] *)::after{transition:none!important}`;
type Hold = { count: number; root: Node; seen: Set<Animation>; frame?: number };
const holds = new Map<Element, Hold>();
const sheets = new Map<Node, { sheet: CSSStyleSheet; count: number }>();

const animations = (element: Element) => element.getAnimations?.({ subtree: true }) ?? [];

function adopt(root: Node, element: Element, add: boolean) {
  const target = root as Document | ShadowRoot;
  if (!target.adoptedStyleSheets) return;
  let entry = sheets.get(root);
  try {
    if (add && !entry) {
      const sheet = new (element.ownerDocument.defaultView ?? window).CSSStyleSheet();
      sheet.replaceSync(css);
      sheets.set(root, entry = { sheet, count: 0 });
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    }
    if (!entry) return;
    entry.count += add ? 1 : -1;
    if (entry.count) return;
    sheets.delete(root);
    target.adoptedStyleSheets = target.adoptedStyleSheets.filter(sheet => sheet !== entry!.sheet);
  } catch { /* Without constructable sheets, finishing what a step started still applies. */ }
}

/** Finish what a preview started; the host's own running and endless animations go on. */
function settle(element: Element, hold: Hold) {
  // Style is current, so a render this step caused has made its animations.
  void element.getBoundingClientRect();
  for (const animation of animations(element))
    if (!hold.seen.has(animation) && Number.isFinite(animation.effect?.getComputedTiming().endTime)) try { animation.finish(); } catch { /* Kept. */ }
}

/** Hold host motion on `element` and its subtree for one preview step; returns its release. */
export function holdHostMotion(element: Element): () => void {
  let hold = holds.get(element);
  if (hold) cancelAnimationFrame(hold.frame!);
  else {
    holds.set(element, hold = { count: 0, root: element.getRootNode(), seen: new Set(animations(element)) });
    element.setAttribute(STILL, "");
    adopt(hold.root, element, true);
  }
  const current = hold;
  current.count++;
  requestAnimationFrame(() => { if (holds.get(element) === current) settle(element, current); });
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--current.count) return;
    current.frame = requestAnimationFrame(() => current.frame = requestAnimationFrame(() => {
      if (current.count || holds.get(element) !== current) return;
      settle(element, current);
      holds.delete(element);
      element.removeAttribute(STILL);
      adopt(current.root, element, false);
    }));
  };
}

/** Run a preview with host motion held; its undo releases the hold once the host settles. */
export function stillPreview(element: Element | undefined, preview: () => (() => void) | void): () => void {
  const release = element ? holdHostMotion(element) : () => {};
  let undo: (() => void) | void;
  try { undo = preview(); } catch (error) { release(); throw error; }
  // The release waits for the host's next render, so the undo below is held too.
  return () => { try { undo?.(); } finally { release(); } };
}
