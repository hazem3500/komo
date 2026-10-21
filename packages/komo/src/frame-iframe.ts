// Frame's viewport mode: the current page in a same-origin iframe sized to the
// chosen viewport, so media queries, viewport units, matchMedia, resize events and
// window.innerWidth are real. komo keeps running in this window and reaches into
// the frame through frame-target.ts. Loaded on demand when viewport mode is on.

import { el } from "./dom.js";
import { FRAME_NAME, installFrameGeometry, pageFrame, setPageFrame } from "./frame-target.js";

/** A frame's content box and scale, in this window's client pixels. */
function placement(view: Window | null) {
  const element = view && view !== window ? (view.frameElement as HTMLElement | null) : null;
  if (!element) return null;
  const outer = element.getBoundingClientRect();
  const scale = outer.width / (element.offsetWidth || 1) || 1;
  return { left: outer.left + element.clientLeft * scale, top: outer.top + element.clientTop * scale, scale };
}
function toScreen(rect: { left: number; top: number; width: number; height: number }, view: Window | null) {
  const frame = placement(view);
  return frame
    ? new DOMRect(frame.left + rect.left * frame.scale, frame.top + rect.top * frame.scale, rect.width * frame.scale, rect.height * frame.scale)
    : new DOMRect(rect.left, rect.top, rect.width, rect.height);
}
function toView(x: number, y: number, view: Window | null) {
  const frame = placement(view);
  return frame ? { x: (x - frame.left) / frame.scale, y: (y - frame.top) / frame.scale } : { x, y };
}
// From here on komo's page reads reach into the viewport iframe and map back to the screen.
installFrameGeometry({
  toScreen,
  toView,
  screenRect(node) {
    const rect = node.getBoundingClientRect();
    const view = node.ownerDocument.defaultView;
    return view === window ? rect : toScreen(rect, view);
  },
  clientPoint(event) {
    const view = event.view;
    if (!view || view === window) return { x: event.clientX, y: event.clientY };
    const point = toScreen({ left: event.clientX, top: event.clientY, width: 0, height: 0 }, view);
    return { x: point.left, y: point.top };
  },
  pageElementsAt(x, y) {
    const target = pageFrame();
    // komo's own layers cover the frame (its iframe sits in komo's shadow root), so test the visible box.
    const port = target?.parentElement?.getBoundingClientRect();
    if (!target || !port || x < port.left || x >= port.right || y < port.top || y >= port.bottom)
      return document.elementsFromPoint(x, y);
    const local = toView(x, y, target.contentWindow);
    return target.contentDocument!.elementsFromPoint(local.x, local.y);
  },
  // The same app rendered in the frame: the element at the same path from body, or its nearest id.
  counterpart(element, page) {
    if (element.ownerDocument === page) return element;
    const parts: string[] = [];
    for (let node: Element | null = element; node && node !== node.ownerDocument.documentElement; node = node.parentElement) {
      if (node.id || node === node.ownerDocument.body) {
        parts.unshift(node.id ? `#${CSS.escape(node.id)}` : "body");
        break;
      }
      parts.unshift(`${node.localName}:nth-child(${[...node.parentElement!.children].indexOf(node) + 1})`);
    }
    try {
      return parts.length ? page.querySelector(parts.join(">")) : page.documentElement;
    } catch {
      return null;
    }
  },
});

export interface FrameViewportPlacement {
  /** The visible frame, in window pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The page's own viewport, in CSS pixels. */
  logical: number[];
  scale: number;
  pan: boolean;
}
export interface FrameViewport {
  readonly iframe: HTMLIFrameElement;
  /** The visible frame; it scrolls the page's viewport when 100% is larger than the space. */
  readonly port: HTMLElement;
  place(placement: FrameViewportPlacement): void;
  destroy(): void;
}
export interface FrameViewportOptions {
  /** komo's shadow root: the stage sits under its pins, cards and sidebar. */
  parent: ShadowRoot;
  before: Node | null;
  url: string;
  background: string;
  /** Where the first document opens, in its CSS pixels. */
  scroll: number;
  /** How long the first document may take, in ms. */
  timeout?: number;
  /** A same-origin document is showing (the first, or one after a full navigation) and komo reads through it. */
  ready(): void;
  /** The frame can't show a same-origin page; `reason` is shown to the reviewer. */
  failed(reason: string): void;
  /** The page moved: its URL (pushState, popstate, hashchange), its DOM, its size or the port's pan. */
  changed(): void;
}

const css = `.frame-stage{position:fixed;inset:0;z-index:0;background:#080808;pointer-events:auto}.frame-port{position:absolute;overflow:clip;border-radius:12px;overscroll-behavior:contain}.frame-port[data-pan]{overflow:auto;scrollbar-width:thin;scrollbar-color:#5a5a5a transparent}.frame-stage[data-loading]{visibility:hidden;pointer-events:none}.frame-port iframe{display:block;border:0;transform-origin:0 0;color-scheme:normal}`;

/** Why a URL that didn't load as a same-origin document can't be framed. */
export async function frameFailure(url: string): Promise<string> {
  if (new URL(url, location.href).origin !== location.origin)
    return "The viewport URL is on another origin, so komo can't reach into it.";
  // A fresh same-origin realm's fetch, in case the app wraps or replaces this window's.
  const probe = el("iframe");
  probe.hidden = true;
  document.body.append(probe);
  try {
    const response = await (probe.contentWindow?.fetch ?? fetch)(url, { redirect: "manual", credentials: "include" });
    if (response.type === "opaqueredirect")
      return "The page redirected to another origin, so komo can't reach into it.";
    const options = response.headers.get("x-frame-options")?.toLowerCase() ?? "";
    if (options.includes("deny"))
      return "The page sends X-Frame-Options: DENY, which blocks a separate viewport.";
    const ancestors = /frame-ancestors([^;,]*)/i.exec(response.headers.get("content-security-policy") ?? "")?.[1].trim();
    if (ancestors !== undefined && !/'self'|\*|https?:/.test(ancestors))
      return `The page's Content-Security-Policy (frame-ancestors ${ancestors || "'none'"}) blocks a separate viewport.`;
  } catch {
    /* Offline or blocked: fall through to the general reason. */
  } finally {
    probe.remove();
  }
  return "The page didn't load as a same-origin document in a separate viewport.";
}

export function openFrameViewport(options: FrameViewportOptions): FrameViewport {
  const style = el("style");
  style.textContent = css;
  const stage = el("div", "frame-stage");
  const port = el("div", "frame-port");
  stage.dataset.loading = "";
  port.style.background = options.background;
  const iframe = el("iframe");
  // The framed page's own komo sees this and stays inert; komo here does the reviewing.
  iframe.name = FRAME_NAME;
  iframe.dataset.komoViewport = "";
  iframe.title = "Page viewport";
  port.append(iframe);
  stage.append(port);
  options.parent.insertBefore(style, options.before);
  options.parent.insertBefore(stage, options.before);
  const abort = new AbortController();
  let shown: Document | null = null;
  // Failed or destroyed: nothing more reaches the callbacks.
  let closed = false;
  const fail = (reason: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    setPageFrame(null);
    options.failed(reason);
  };
  const timer = window.setTimeout(
    () => fail(`The page took longer than ${Math.round((options.timeout ?? 15000) / 1000)} seconds to load in a separate viewport.`),
    options.timeout ?? 15000,
  );
  function watch(view: Window, signal: AbortSignal) {
    const changed = () => queueMicrotask(() => !closed && options.changed());
    // Client-side routers change the URL with history calls that fire no event.
    for (const method of ["pushState", "replaceState"] as const) {
      const original = view.history[method];
      view.history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        changed();
        return result;
      };
    }
    for (const type of ["popstate", "hashchange", "resize"])
      view.addEventListener(type, changed, { signal });
    // Page DOM changes move pins, as on komo's own page.
    const mutations = new MutationObserver(changed);
    mutations.observe(view.document.documentElement, { childList: true, subtree: true, characterData: true });
    signal.addEventListener("abort", () => mutations.disconnect(), { once: true });
  }
  iframe.addEventListener("load", () => {
    if (closed) return;
    let current: Document | null = null;
    try {
      current = iframe.contentDocument;
      if (current && iframe.contentWindow!.location.origin !== location.origin) current = null;
    } catch {
      current = null;
    }
    if (!current || current.URL === "about:blank") {
      // A later navigation left the origin: fall back with the reason.
      if (shown) {
        return fail("The page navigated to another origin, so komo can't reach into it.");
      }
      void frameFailure(options.url).then(fail);
      return;
    }
    clearTimeout(timer);
    // Open where the reviewer was reading.
    if (!shown) iframe.contentWindow!.scrollTo({ top: options.scroll, behavior: "instant" });
    shown = current;
    setPageFrame(iframe);
    watch(iframe.contentWindow!, abort.signal);
    delete stage.dataset.loading;
    options.ready();
  }, { signal: abort.signal });
  port.addEventListener("scroll", () => options.changed(), { passive: true, signal: abort.signal });
  iframe.src = options.url;
  return {
    iframe,
    port,
    place({ left, top, width, height, logical, scale, pan }) {
      Object.assign(port.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      // Leaving 100% resets the pan, so the next 100% starts at the frame's top-left.
      if (!pan) port.scrollTo(0, 0);
      port.toggleAttribute("data-pan", pan);
      Object.assign(iframe.style, {
        width: `${logical[0]}px`,
        height: `${logical[1]}px`,
        transform: scale === 1 ? "" : `scale(${scale})`,
      });
    },
    destroy() {
      closed = true;
      clearTimeout(timer);
      abort.abort();
      setPageFrame(null);
      stage.remove();
      style.remove();
    },
  };
}
