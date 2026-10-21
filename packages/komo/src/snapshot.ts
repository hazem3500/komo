// Opt-in comment snapshots (`snapshots` in the options). Loaded on demand the first
// time a signed-in reviewer composes a comment with snapshots turned on, so nothing
// here reaches the mount bundle. Everything runs in the page: no extension and no
// third-party renderer. The image is the target element serialised into an SVG
// foreignObject with its computed styles inlined, drawn to a canvas and encoded as
// WebP; the HTML is a trimmed, redacted outerHTML. Both read the page's own
// document, which is Frame's viewport iframe when the page is framed.
import type { KomoSnapshots } from "./types.js";

/** Why the image was left out; sent with the HTML so the thread can say so. */
export type SnapshotNote = "cross-origin" | "too-large" | "unsupported" | "failed";
export interface CapturedSnapshot {
  /** A `data:image/webp` URL of the element and some padding. */
  image?: string;
  /** Trimmed outerHTML without scripts, handlers or typed values. */
  html?: string;
  note?: SnapshotNote;
}

/** Hosts mark private regions with this attribute: a target inside one is never captured. */
export const OPT_OUT = "data-komo-no-snapshot";
/** komo's own UI on the page: its host, Design mode stand-ins, previews and Frame's viewport. */
const OWN = "[data-branch-comments],[data-komo-move-clone],[data-komo-viewport],[data-komo-design-tokens],[data-komo-snapshot-sandbox]";
export const PLACEHOLDER = "[redacted]";
const DROP = new Set(["script", "noscript", "template", "style", "link", "meta", "base", "title"]);
const URL_ATTRIBUTE = /^(?:href|src|action|formaction|xlink:href|poster|data|background)$/i;
/** Inputs whose value is typed by the reviewer; buttons and toggles carry page text. */
const typed = (element: Element) =>
  element.localName === "textarea" ||
  (element.localName === "input" &&
    !/^(?:button|submit|reset|image|checkbox|radio|range|color)$/i.test(element.getAttribute("type") ?? ""));

export const HTML_LIMIT = 20_000;
export const ATTRIBUTE_LIMIT = 200;
export const TEXT_LIMIT = 500;
const cap = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** True when the element can't be captured: komo's UI, or inside a host's no-snapshot region. */
export const skipped = (element: Element) => !!element.closest(`[${OPT_OUT}],${OWN}`);

/** Copy an element's attributes onto its shallow clone, minus handlers, script URLs and komo's markers. */
function cleanAttributes(clone: Element, limit = Infinity) {
  for (const { name, value } of [...clone.attributes]) {
    if (
      /^on/i.test(name) ||
      name === "srcdoc" ||
      (name.startsWith("data-komo-") && name !== OPT_OUT) ||
      (URL_ATTRIBUTE.test(name) && /^\s*(?:javascript|vbscript):/i.test(value))
    )
      clone.removeAttribute(name);
    else if (value.length > limit) clone.setAttribute(name, cap(value, limit));
  }
}
/** Typed values and redacted elements show the placeholder; everything else stays as written. */
function redactField(original: Element, clone: Element) {
  const value = (original as HTMLInputElement).value ?? original.getAttribute("value") ?? "";
  if (original.localName === "textarea") clone.textContent = value ? PLACEHOLDER : "";
  else if (value || clone.hasAttribute("value")) clone.setAttribute("value", PLACEHOLDER);
}

/**
 * The element's outerHTML, trimmed for a comment: no scripts, styles or event
 * handlers, attribute values and text capped, typed values (inputs, textareas,
 * passwords) replaced by a placeholder, and `redact(element)` matches reduced to
 * the placeholder. Subtrees that don't fit in `limit` bytes are cut with a comment.
 */
export function snapshotHtml(
  element: Element,
  redact?: (element: Element) => boolean,
  limit = HTML_LIMIT,
): string {
  const document = element.ownerDocument;
  let left = limit;
  const copy = (node: Node): Node | null => {
    if (node.nodeType === 3) {
      const text = cap(node.nodeValue ?? "", TEXT_LIMIT);
      left -= text.length;
      return document.createTextNode(text);
    }
    if (node.nodeType !== 1) return null;
    const original = node as Element;
    if (DROP.has(original.localName) || original.matches(OWN)) return null;
    const clone = original.cloneNode(false) as Element;
    cleanAttributes(clone, ATTRIBUTE_LIMIT);
    if (typed(original)) redactField(original, clone);
    left -= clone.outerHTML.length;
    if (original.hasAttribute(OPT_OUT)) return clone;
    if (redact?.(original)) {
      if (!typed(original)) clone.textContent = PLACEHOLDER;
      return clone;
    }
    if (original.localName === "textarea") return clone;
    for (const child of original.childNodes) {
      if (left <= 0) {
        clone.append(document.createComment(" trimmed "));
        break;
      }
      const next = copy(child);
      if (next) clone.append(next);
    }
    return clone;
  };
  const root = copy(element) as Element | null;
  if (!root) return "";
  // The running estimate ignores escaping and multi-byte text: drop trailing leaves until it fits.
  let html = root.outerHTML;
  if (bytes(html) <= limit) return html;
  const marker = document.createComment(" trimmed ");
  root.append(marker);
  for (let over = bytes(root.outerHTML) - limit; over > 0 && root.firstChild !== marker; over = bytes(root.outerHTML) - limit) {
    while (over > 0 && root.firstChild !== marker) {
      let leaf: Node = marker.previousSibling!;
      while (leaf.lastChild) leaf = leaf.lastChild;
      over -= leaf.nodeType === 1 ? (leaf as Element).outerHTML.length : (leaf.nodeValue?.length ?? 0) + 7;
      leaf.parentNode!.removeChild(leaf);
    }
  }
  html = root.outerHTML;
  return bytes(html) > limit ? "" : html;
}

class Skip extends Error {
  constructor(public reason: SnapshotNote) {
    super(reason);
  }
}

export const IMAGE_BYTES = 250_000;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 2000;
const PADDING = 16;
const MAX_NODES = 3000;
const FONT_BYTES = 2_000_000;

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
/** A resource as a data URL. Another origin that won't share it would taint the canvas. */
async function fetchData(url: string, view: Window): Promise<string> {
  if (url.startsWith("data:")) return url;
  const absolute = new URL(url, view.document.baseURI);
  try {
    const response = await fetch(absolute, { mode: "cors", signal: AbortSignal.timeout(5000) });
    return response.ok ? await readBlob(await response.blob()) : "";
  } catch {
    if (absolute.origin !== view.location.origin) throw new Skip("cross-origin");
    return "";
  }
}

/** A loaded image as a data URL, at no more than the pixels it is drawn with. */
async function imageData(image: HTMLImageElement, scale: number, view: Window) {
  const src = image.currentSrc || image.src;
  if (!src || src.startsWith("data:")) return src;
  await image.decode().catch(() => {});
  const width = Math.min(image.naturalWidth, Math.ceil(image.offsetWidth * scale) || image.naturalWidth);
  const height = Math.round((width * image.naturalHeight) / (image.naturalWidth || 1));
  if (width && height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png");
    } catch {
      /* Tainted: the image came from another origin without CORS. Ask for it with CORS. */
    }
  }
  return fetchData(src, view);
}

/** Computed styles of each tag in an unstyled document, so clones only carry what differs. */
function baselines() {
  const frame = document.createElement("iframe");
  frame.setAttribute("data-komo-snapshot-sandbox", "");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-10px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  document.documentElement.append(frame);
  const sandbox = frame.contentDocument!;
  try {
    // Standards mode, like the page; hosts that block document.write keep the quirks defaults.
    sandbox.open();
    sandbox.write("<!doctype html><html><head></head><body></body></html>");
    sandbox.close();
  } catch {
    /* Trusted Types or a sandbox; about:blank's defaults are close enough. */
  }
  const cache = new Map<string, Map<string, string>>();
  return {
    of(element: Element) {
      const key = `${element.namespaceURI} ${element.localName}`;
      let styles = cache.get(key);
      if (!styles) {
        const sample = sandbox.createElementNS(element.namespaceURI, element.localName);
        (sandbox.body ?? sandbox.documentElement).append(sample);
        const computed = sandbox.defaultView!.getComputedStyle(sample);
        styles = new Map();
        for (let i = 0; i < computed.length; i++) styles.set(computed[i]!, computed.getPropertyValue(computed[i]!));
        sample.remove();
        cache.set(key, styles);
      }
      return styles;
    },
    dispose: () => frame.remove(),
  };
}

/** Declarations that differ from the tag's default or from what the parent passes down. */
function declarations(computed: CSSStyleDeclaration, base: Map<string, string>, parent?: CSSStyleDeclaration) {
  let css = "";
  for (let i = 0; i < computed.length; i++) {
    const name = computed[i]!;
    if (name.startsWith("--")) continue;
    const value = computed.getPropertyValue(name);
    if (value !== base.get(name) || (parent && value !== parent.getPropertyValue(name))) css += `${name}:${value};`;
  }
  return css;
}

const URL_VALUE = /url\((['"]?)(.*?)\1\)/g;

/** Fonts the clone uses, as @font-face rules with their first source inlined. */
async function fontFaces(document: Document, families: Set<string>, view: Window) {
  const faces: string[] = [];
  let budget = FONT_BYTES;
  const visit = async (rules: CSSRuleList, base: string) => {
    for (const rule of rules) {
      if ((rule as CSSGroupingRule).cssRules) await visit((rule as CSSGroupingRule).cssRules, base);
      if (!rule.cssText.startsWith("@font-face")) continue;
      const style = (rule as CSSFontFaceRule).style;
      const family = style.getPropertyValue("font-family").replace(/["']/g, "").trim().toLowerCase();
      const source = style.getPropertyValue("src").match(/url\((['"]?)(.*?)\1\)/)?.[2];
      if (!families.has(family) || !source || budget <= 0) continue;
      const data = await fetchData(new URL(source, base).href, view).catch(() => "");
      if (!data) continue;
      budget -= data.length;
      faces.push(
        `@font-face{font-family:"${family}";src:url("${data}");${["font-weight", "font-style", "font-stretch", "unicode-range"]
          .map((name) => (style.getPropertyValue(name) ? `${name}:${style.getPropertyValue(name)};` : ""))
          .join("")}}`,
      );
    }
  };
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // Another origin's stylesheet; its fonts fall back.
    }
    await visit(rules, sheet.href ?? document.baseURI);
  }
  return faces.join("");
}

/** The nearest painted background behind the element, so the padding matches the page. */
function backdrop(element: Element, view: Window) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const color = view.getComputedStyle(node).backgroundColor;
    if (color && !/^(?:transparent|rgba\(.*,\s*0\))$/.test(color)) return color;
  }
  return "#fff";
}

/** The element as an SVG image with every computed style inlined. */
async function render(element: Element, redact: ((element: Element) => boolean) | undefined, scale: number) {
  const page = element.ownerDocument;
  const view = page.defaultView!;
  const rect = element.getBoundingClientRect();
  // Layout size, not the on-screen one: Frame may scale the page.
  const width = (element as HTMLElement).offsetWidth ?? rect.width;
  const height = Math.min((element as HTMLElement).offsetHeight ?? rect.height, MAX_HEIGHT);
  if (!width || !height) throw new Skip("failed");
  const base = baselines();
  const pending: Promise<unknown>[] = [];
  const families = new Set<string>();
  const urls = new Map<string, Promise<string>>();
  const styled: [Element, string][] = [];
  let pseudo = "";
  let nodes = 0;
  // Settled later, together; a rejection before then is not an unhandled one.
  const later = <T,>(promise: Promise<T>) => (promise.catch(() => {}), promise);
  const inline = (css: string) => {
    for (const [, , url] of css.matchAll(URL_VALUE))
      if (url && !url.startsWith("data:") && !urls.has(url)) urls.set(url, later(fetchData(url, view)));
    return css;
  };
  const copy = (node: Node, parent?: CSSStyleDeclaration): Node | null => {
    if (node.nodeType === 3) return page.createTextNode(node.nodeValue ?? "");
    if (node.nodeType !== 1) return null;
    const original = node as Element;
    const name = original.localName;
    if (DROP.has(name) || original.matches(OWN)) return null;
    if (++nodes > MAX_NODES) throw new Skip("too-large");
    const computed = view.getComputedStyle(original);
    if (computed.display === "none") return null;
    let clone: Element;
    if (name === "canvas" || name === "video") {
      // Their pixels, as an image; another origin's video or canvas taints them.
      clone = page.createElement("img");
      const canvas = document.createElement("canvas");
      canvas.width = (original as HTMLCanvasElement).width || (original as HTMLVideoElement).videoWidth || 1;
      canvas.height = (original as HTMLCanvasElement).height || (original as HTMLVideoElement).videoHeight || 1;
      try {
        canvas.getContext("2d")!.drawImage(original as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
        clone.setAttribute("src", canvas.toDataURL("image/png"));
      } catch {
        throw new Skip("cross-origin");
      }
    } else if (name === "iframe" || name === "embed" || name === "object") {
      clone = page.createElement("div"); // Another document can't be drawn here.
    } else {
      clone = original.cloneNode(false) as Element;
      cleanAttributes(clone);
      for (const attribute of ["id", "class", "srcset", "sizes", "loading", "style"]) clone.removeAttribute(attribute);
    }
    if (typed(original)) {
      clone.removeAttribute("value");
      if (clone.hasAttribute("placeholder") && redact?.(original)) clone.setAttribute("placeholder", PLACEHOLDER);
    }
    if (name === "img")
      pending.push(later(imageData(original as HTMLImageElement, scale, view).then((src) => clone.setAttribute("src", src))));
    families.add(computed.fontFamily.split(",")[0]!.replace(/["']/g, "").trim().toLowerCase());
    let css = declarations(computed, base.of(original), parent);
    if (!parent)
      // The root lays out at the top left of the image, at its own size, untransformed.
      css += `${computed.display === "inline" ? "display:inline-block;" : ""}margin:0;position:relative;inset:auto;float:none;transform:none;translate:none;rotate:none;scale:none;flex:none;box-sizing:border-box;width:${width}px;height:${height}px;max-width:none;max-height:none;min-width:0;min-height:0;`;
    const hidden = original.hasAttribute(OPT_OUT) && !!parent;
    // A private region inside the target keeps its box and loses its contents.
    if (hidden) css += "color:transparent;background:#e5e5e5;background-image:none;";
    styled.push([clone, inline(css)]);
    for (const which of ["::before", "::after"]) {
      const generated = view.getComputedStyle(original, which);
      if (hidden || /^(?:none|normal)$/.test(generated.content)) continue;
      clone.setAttribute("data-snapshot", String(nodes));
      pseudo += `[data-snapshot="${nodes}"]${which}{${inline(declarations(generated, base.of(original), computed))}content:${generated.content};}`;
    }
    if (hidden) return clone;
    if (redact?.(original)) {
      if (!typed(original)) clone.textContent = PLACEHOLDER;
      return clone;
    }
    if (name === "textarea") return clone;
    for (const child of original.childNodes) {
      // A picture draws its chosen source through its img.
      if (name === "picture" && (child as Element).localName !== "img") continue;
      const next = copy(child, computed);
      if (next) clone.append(next);
    }
    return clone;
  };
  try {
    // The page's paint is settled: fonts loaded, the element laid out.
    await page.fonts?.ready;
    const root = copy(element) as Element;
    const resolved = new Map(await Promise.all([...urls].map(async ([url, data]) => [url, await data] as const)));
    const swap = (css: string) =>
      css.replace(URL_VALUE, (match, _quote, url: string) => (resolved.has(url) ? `url("${resolved.get(url)}")` : match));
    for (const [clone, css] of styled) clone.setAttribute("style", swap(css));
    pseudo = swap(pseudo);
    await Promise.all(pending);
    const wrapper = page.createElement("div");
    wrapper.setAttribute(
      "style",
      `width:${width + PADDING * 2}px;height:${height + PADDING * 2}px;padding:${PADDING}px;box-sizing:border-box;overflow:hidden;background:${backdrop(element, view)}`,
    );
    const sheet = page.createElement("style");
    sheet.textContent = (await fontFaces(page, families, view)) + pseudo;
    wrapper.append(sheet, root);
    const outer = { width: width + PADDING * 2, height: height + PADDING * 2 };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outer.width}" height="${outer.height}"><foreignObject x="0" y="0" width="100%" height="100%">${new XMLSerializer().serializeToString(wrapper)}</foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    return { image, ...outer };
  } finally {
    base.dispose();
  }
}

const encode = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve, reject) => {
    try {
      canvas.toBlob(resolve, "image/webp", quality);
    } catch (error) {
      reject(error);
    }
  });

/** The element plus padding as WebP, at most 1200px wide and `maxBytes` in size. */
export async function snapshotImage(element: Element, options: KomoSnapshots = {}): Promise<string> {
  const limit = options.maxBytes ?? IMAGE_BYTES;
  const view = element.ownerDocument.defaultView ?? window;
  const width = (element as HTMLElement).offsetWidth || element.getBoundingClientRect().width;
  let scale = Math.min(view.devicePixelRatio || 1, 2, MAX_WIDTH / (width + PADDING * 2));
  const drawn = await render(element, options.redact, scale);
  const canvas = document.createElement("canvas");
  let quality = 0.8;
  for (let attempt = 0; attempt < 12 && drawn.width * scale >= 48; attempt++) {
    canvas.width = Math.max(1, Math.round(drawn.width * scale));
    canvas.height = Math.max(1, Math.round(drawn.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Skip("unsupported");
    context.drawImage(drawn.image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null;
    try {
      blob = await encode(canvas, quality);
    } catch {
      // Something in the clone still came from another origin.
      throw new Skip("cross-origin");
    }
    if (!blob || blob.type !== "image/webp") throw new Skip("unsupported");
    if (blob.size <= limit) return readBlob(blob);
    // Lower the quality first (0.8, 0.65, 0.5), then the size, by about what is over.
    if (quality > 0.5) quality = Math.round((quality - 0.15) * 100) / 100;
    else scale *= Math.min(0.85, Math.max(0.3, Math.sqrt(limit / blob.size) * 0.95));
  }
  throw new Skip("too-large");
}

/**
 * Capture what the options ask for. Returns null when there is nothing to keep:
 * the target is gone, is komo's own UI, or sits in a no-snapshot region. An image
 * that can't be read (another origin's pixels) falls back to the HTML, with a note.
 */
export async function captureSnapshot(
  element: Element | null,
  options: KomoSnapshots,
): Promise<CapturedSnapshot | null> {
  if (!element?.isConnected || skipped(element)) return null;
  const result: CapturedSnapshot = {};
  const html = () => snapshotHtml(element, options.redact);
  // The markup is read at once, as the reviewer saw it.
  if (options.html) result.html = html();
  if (options.image) {
    // Drawing walks every computed style; let the composer open first.
    await new Promise((resolve) =>
      typeof requestIdleCallback === "function" ? requestIdleCallback(resolve, { timeout: 500 }) : setTimeout(resolve),
    );
    try {
      result.image = await snapshotImage(element, options);
    } catch (error) {
      result.note = error instanceof Skip ? error.reason : "failed";
      if (result.note === "cross-origin") result.html ??= html();
    }
  }
  return result.image || result.html || result.note ? result : null;
}

/** What `POST threads/:id/snapshot` receives, once per kind. */
export interface SnapshotUpload {
  kind: "image" | "html";
  /** The image's data URL, or the HTML. */
  data: string;
  /** With the HTML, why the image is missing. */
  note?: SnapshotNote;
}

const captures = new WeakMap<object, Promise<CapturedSnapshot | null>>();
/**
 * The snapshot of a draft's target, captured once per anchor: the composer reads it
 * for a preview, and posting passes `post` to upload each kind after the thread is
 * saved. Never rejects; a failed upload is logged and the comment stays posted.
 */
export function snapshotFor<Anchor extends object>(
  anchor: Anchor,
  resolve: (anchor: Anchor) => Element | null,
  options: KomoSnapshots,
  post?: (body: SnapshotUpload) => Promise<unknown>,
): Promise<CapturedSnapshot | null> {
  let capture = captures.get(anchor);
  if (!capture) {
    capture = options.image || options.html ? captureSnapshot(resolve(anchor), options).catch(() => null) : Promise.resolve(null);
    captures.set(anchor, capture);
  }
  if (post)
    void capture.then(async (shot) => {
      for (const kind of ["image", "html"] as const)
        if (shot?.[kind])
          await post({ kind, data: shot[kind]!, ...(kind === "html" && shot.note ? { note: shot.note } : {}) }).catch(
            (reason: unknown) =>
              console.info(`komo: the comment posted without its ${kind} snapshot.`, reason instanceof Error ? reason.message : reason),
          );
    });
  return capture;
}
