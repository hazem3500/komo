// The page komo reviews: this document, or the document of Frame's same-origin
// viewport iframe while that iframe shows the page. komo's own UI always stays in
// this window; page reads (elements at a point, rectangles, queries, events) go
// through these helpers so they reach into the frame and map back to the screen.
// The mapping itself loads with viewport mode (frame-iframe.ts); until then
// every helper is the plain same-document read.
import type { PreviewTarget } from "./design-system.js";

/** The viewport iframe's name: komo inside it stays inert, so only one instance reviews. */
export const FRAME_NAME = "komo-viewport";
/** True inside Frame's viewport iframe. */
export const framedByKomo = () => {
  try {
    return window.name === FRAME_NAME && !!window.frameElement?.hasAttribute("data-komo-viewport");
  } catch {
    return false;
  }
};
let frame: HTMLIFrameElement | null = null;
let generation: AbortController | undefined;
type Watch = (document: Document, signal: AbortSignal) => void;
const watchers = new Set<[Watch, AbortSignal | undefined]>();

function frameDocument(): Document | null {
  try {
    return frame?.contentDocument ?? null;
  } catch {
    return null;
  }
}
/** The page's document: Frame's viewport iframe when it is showing, else this document. */
export const pageDocument = (): Document => frameDocument() ?? document;
export const pageWindow = (): Window => pageDocument().defaultView ?? window;
/** Where adapters apply page-wide previews and theme switches. */
export const previewTarget = (): PreviewTarget => {
  const document = pageDocument();
  return { document, root: document.documentElement };
};
/** The viewport iframe while it shows the page. */
export const pageFrame = () => (frameDocument() ? frame : null);

/** Cross-realm checks: nodes from the viewport iframe fail `instanceof` against this window's classes. */
export const isElement = (node: unknown): node is Element =>
  (node as Node | null)?.nodeType === 1;
export const isHTMLElement = (node: unknown): node is HTMLElement =>
  isElement(node) && node.namespaceURI === "http://www.w3.org/1999/xhtml";
export const isSVGElement = (node: unknown): node is SVGElement =>
  isElement(node) && node.namespaceURI === "http://www.w3.org/2000/svg";

type Rect = { left: number; top: number; width: number; height: number };
/** An element's bounding box on screen, after the viewport iframe's offset and scale. */
export let screenRect = (node: Element): DOMRect => node.getBoundingClientRect();
/** A rectangle in `view`'s client pixels, in this window's client pixels. */
export let toScreen = (rect: Rect, _view: Window | null): DOMRect =>
  new DOMRect(rect.left, rect.top, rect.width, rect.height);
/** A screen point in `view`'s client pixels. */
export let toView = (x: number, y: number, _view: Window | null) => ({ x, y });
/** A pointer event's position on screen, wherever it was dispatched. */
export let clientPoint = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY });
/** Page elements under a screen point, reaching into the viewport iframe. */
export let pageElementsAt = (x: number, y: number): Element[] => document.elementsFromPoint(x, y);
/** `element`'s place in `page`: the same app rendered in Frame's viewport iframe. */
export let counterpart = (element: Element, page: Document): Element | null =>
  element.ownerDocument === page ? element : null;
/** Viewport mode installs the real mapping when it loads. */
export function installFrameGeometry(geometry: {
  screenRect: typeof screenRect;
  toScreen: typeof toScreen;
  toView: typeof toView;
  clientPoint: typeof clientPoint;
  pageElementsAt: typeof pageElementsAt;
  counterpart: typeof counterpart;
}) {
  ({ screenRect, toScreen, toView, clientPoint, pageElementsAt, counterpart } = geometry);
}

/**
 * Run `watch` for every document the viewport iframe shows, now and after each
 * navigation; its signal aborts when that document goes away or `signal` aborts.
 */
export function eachFrameDocument(watch: Watch, signal?: AbortSignal) {
  if (signal?.aborted) return;
  const entry: [Watch, AbortSignal | undefined] = [watch, signal];
  watchers.add(entry);
  signal?.addEventListener("abort", () => watchers.delete(entry), { once: true });
  const current = frameDocument();
  if (current && generation) watch(current, combine(generation.signal, signal));
}
const combine = (a: AbortSignal, b?: AbortSignal) => (b ? AbortSignal.any([a, b]) : a);
/** Listen on the viewport iframe's document (or window) too, for as long as `options.signal` allows. */
export function onFrame(
  type: string,
  listener: (event: never) => void,
  options?: AddEventListenerOptions,
  on: "document" | "window" = "document",
) {
  eachFrameDocument((document, signal) => {
    (on === "window" ? document.defaultView : document)?.addEventListener(type, listener as EventListener, { ...options, signal });
  }, options?.signal);
}
/** Frame mode sets this when its iframe shows a same-origin page, and clears it on exit or fallback. */
export function setPageFrame(next: HTMLIFrameElement | null) {
  generation?.abort();
  generation = undefined;
  frame = next;
  const current = frameDocument();
  if (!current) return;
  generation = new AbortController();
  for (const [watch, signal] of watchers) watch(current, combine(generation.signal, signal));
}
