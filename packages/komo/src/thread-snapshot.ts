// Saved comment snapshots in the review UI: thumbnails on list rows and the open
// card, the "element not found" fallback, the full-size viewer and the composer's
// preview of a pending capture. Loaded on demand the first time a thread with a
// snapshot, or a captured draft, is shown, so none of it reaches the mount bundle.
//
// Snapshot reads need the session's bearer token, so images can't be plain <img src>
// URLs: each is fetched once it is on screen, kept per URL (the URL's `v=` changes
// when a snapshot is replaced) and shown through a blob URL that is revoked as soon
// as its element leaves komo's UI. HTML is only ever shown as text.
import { button, el } from "./dom.js";
import type { Thread } from "./types.js";

export interface SnapshotContext {
  root: ShadowRoot;
  /** The current session token; reads wait for one. */
  token(): string | null;
  /** The comments API's origin. Snapshot URLs anywhere else never receive the token. */
  origin(): string;
  /** Drafts whose capture is left out when they post. */
  dropped: WeakSet<Thread["anchor"]>;
  /** Opens a page through komo's navigation (the host router when there is one). */
  go(url: URL): void;
  notify(text: string, action?: { label: string; run: () => void }): void;
  /** Removes the thread's snapshots, optimistically. */
  remove(thread: Thread): void;
}
type Snapshotted = Pick<Thread, "anchor" | "snapshot" | "page" | "id">;
type Pending = { image?: string; html?: string; note?: string };

const css = `.komo-snapshot{display:block;width:fit-content;margin-top:8px;padding:0;border:0;border-radius:6px;background:none;color:inherit;font:inherit;cursor:zoom-in;line-height:0}
.komo-snapshot img{display:block;width:72px;height:48px;border-radius:6px;object-fit:cover;object-position:left top;background:color-mix(in oklab,currentColor 8%,transparent);outline:1px solid color-mix(in oklab,currentColor 16%,transparent);outline-offset:-1px}
.komo-snapshot:not([data-ready]){background:color-mix(in oklab,currentColor 8%,transparent)}
.komo-snapshot:not([data-ready]) img{visibility:hidden}
.komo-snapshot[hidden]{display:none}
.komo-snapshot:focus-visible{outline:2px solid var(--accent,#bda6ef);outline-offset:2px}
.komo-snapshot[data-large]{width:auto;max-width:100%}
.komo-snapshot[data-large] img{width:auto;height:auto;min-width:72px;min-height:48px;max-width:100%;max-height:180px;object-fit:contain}
.thread-item>.komo-snapshot{margin:6px 12px 0 calc(12px + var(--komo-avatar,20px) + var(--komo-gutter,8px))}
.dialog:has(.thread-navigation:not([hidden]) .komo-snapshot-view) .message .komo-snapshot{display:none}
.komo-snapshot-view{margin-top:8px}
.komo-snapshot-view p{margin:0 0 6px}
.komo-snapshot-code{box-sizing:border-box;max-height:160px;margin:0;padding:8px;overflow:auto;border-radius:6px;background:color-mix(in oklab,currentColor 8%,transparent);font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin}
.komo-snapshot-code:focus-visible{outline:2px solid var(--accent,#bda6ef);outline-offset:2px}
.komo-snapshot-text{justify-self:start;margin-top:8px;padding:4px 8px;border:0;border-radius:6px;background:color-mix(in oklab,currentColor 8%,transparent);color:inherit;font-family:inherit;font-size:11px;line-height:1.4;cursor:pointer}
.komo-snapshot-draft{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#999}
.komo-snapshot-draft .komo-snapshot{margin:0}
.komo-snapshot-draft span{flex:1;min-width:0}
.komo-snapshot-draft .icon{width:28px;height:28px}
.komo-snapshot-viewer{box-sizing:border-box;max-width:min(1200px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:12px;overflow:hidden;border:0;border-radius:16px;background:#242424;color:#eee;box-shadow:inset 0 0 0 1px #ffffff1f,0 24px 64px -16px rgb(0 0 0/55%);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;pointer-events:auto;color-scheme:dark}
.komo-snapshot-viewer[open]{display:flex;flex-direction:column;gap:8px;animation:komo-snapshot-in var(--duration-fast,250ms) var(--ease-smooth-out,cubic-bezier(.22,1,.36,1))}
.komo-snapshot-viewer::backdrop{background:rgb(0 0 0/40%);pointer-events:auto}
.komo-snapshot-viewer header{display:flex;align-items:center;gap:8px}
.komo-snapshot-viewer h2{flex:1;margin:0;padding-left:4px;font-size:13px;font-weight:600}
.komo-snapshot-viewer .icon{width:28px;height:28px;border-radius:8px;color:#bbb}
.komo-snapshot-viewer .icon:hover{background:#ffffff14;color:#eee}
.komo-snapshot-viewer .icon:focus-visible{outline:2px solid var(--accent,#bda6ef);outline-offset:-2px}
.komo-snapshot-viewer img{display:block;min-height:0;max-width:100%;max-height:calc(100dvh - 104px);margin:auto;border-radius:8px;object-fit:contain}
.komo-snapshot-viewer .komo-snapshot-code{max-height:calc(100dvh - 104px);width:min(720px,calc(100vw - 56px))}
@keyframes komo-snapshot-in{from{opacity:0;scale:.98;translate:0 4px}}
@media (prefers-reduced-motion:reduce){.komo-snapshot-viewer[open]{animation:none}}
@media (pointer:coarse){.komo-snapshot-viewer .icon,.komo-snapshot-draft .icon{width:44px;height:44px}}`;

const styled = new WeakMap<ShadowRoot, HTMLStyleElement>();
function style(root: ShadowRoot) {
  let sheet = styled.get(root);
  if (!sheet?.isConnected) {
    sheet = el("style", "", css);
    styled.set(root, sheet);
    root.append(sheet);
  }
}

// Reads share the server's 60 requests per reviewer per minute with polling and
// writes, so at most two run at once and 20 start in any minute; the rest wait.
export const READS_PER_MINUTE = 20;
const waiting: (() => void)[] = [];
let running = 0;
const started: number[] = [];
let wake = 0;
function pump() {
  const now = performance.now();
  while (started.length && now - started[0]! >= 60_000) started.shift();
  while (waiting.length && running < 2 && started.length < READS_PER_MINUTE) {
    running++;
    started.push(now);
    waiting.shift()!();
  }
  if (waiting.length && !wake && started.length >= READS_PER_MINUTE)
    wake = window.setTimeout(() => ((wake = 0), pump()), 60_000 - (now - started[0]!));
}
const slot = () =>
  new Promise<() => void>((resolve) => {
    waiting.push(() => resolve(() => (running--, pump())));
    pump();
  });

// Fetched snapshots by session and URL, so another sign-in never sees this one's.
// A missing snapshot (404) stays missing; other failures are forgotten so a later
// view retries. The oldest entries go past 40.
const cache = new Map<string, Promise<Blob | null>>();
export function readSnapshot(url: string, context: SnapshotContext): Promise<Blob | null> {
  const token = context.token();
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Promise.resolve(null);
  }
  if (!token || target.origin !== context.origin()) return Promise.resolve(null);
  const key = `${token} ${url}`;
  let entry = cache.get(key);
  if (entry) return entry;
  entry = slot().then(async (done) => {
    try {
      const response = await fetch(target, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(String(response.status));
      return await response.blob();
    } finally {
      done();
    }
  });
  cache.set(key, entry);
  entry.catch(() => cache.get(key) === entry && cache.delete(key));
  for (const old of cache.keys()) if (cache.size > 40) cache.delete(old);
  return entry;
}

// Mounted images and their blob URLs. Elements are observed while connected; once
// one leaves komo's UI its URL is revoked, and it loads again if it comes back.
const sources = new WeakMap<HTMLImageElement, { url: string; context: SnapshotContext; done?: (ok: boolean) => void }>();
const live = new Map<HTMLImageElement, string>();
const watched = new WeakSet<ShadowRoot>();
let visible: IntersectionObserver | undefined;
const SELECTOR = "img[data-komo-snapshot]";

function show(image: HTMLImageElement) {
  const source = sources.get(image);
  if (!source || live.has(image) || !image.isConnected) return;
  void readSnapshot(source.url, source.context).then(
    (blob) => {
      if (!image.isConnected || live.has(image)) return;
      if (!blob) return source.done?.(false);
      const src = URL.createObjectURL(blob);
      live.set(image, src);
      image.src = src;
      source.done?.(true);
    },
    () => source.done?.(false),
  );
}
function release() {
  for (const [image, src] of live)
    if (!image.isConnected) {
      URL.revokeObjectURL(src);
      live.delete(image);
      image.removeAttribute("src");
    }
}
function observe(image: HTMLImageElement) {
  if (visible) visible.observe(image);
  else show(image);
}
function watch(root: ShadowRoot) {
  if (watched.has(root)) return;
  watched.add(root);
  if (typeof IntersectionObserver === "function")
    visible ??= new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) show(entry.target as HTMLImageElement);
    });
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes)
        if (node instanceof Element) {
          for (const image of node.matches(SELECTOR) ? [node] : node.querySelectorAll(SELECTOR))
            if (!image.isConnected) visible?.unobserve(image);
        }
      for (const node of record.addedNodes)
        if (node instanceof Element && node.isConnected)
          for (const image of node.matches(SELECTOR) ? [node] : node.querySelectorAll(SELECTOR))
            observe(image as HTMLImageElement);
    }
    release();
  }).observe(root, { childList: true, subtree: true });
}

/** Revokes the blob URLs shown in `root`, when its komo unmounts. */
export function disposeSnapshots(root: ShadowRoot) {
  for (const [image, src] of live)
    if (image.getRootNode() === root) {
      URL.revokeObjectURL(src);
      live.delete(image);
      image.removeAttribute("src");
      visible?.unobserve(image);
    }
}

/** What the snapshot shows, for alt text: the element's label or text, or its tag. */
export function snapshotAlt(thread: Pick<Thread, "anchor">) {
  const { context, text } = thread.anchor;
  const label = (context?.label || text || "").replace(/\s+/g, " ").trim();
  const subject = label
    ? `“${label.length > 60 ? `${label.slice(0, 59)}…` : label}”`
    : context?.tag
      ? `the ${context.tag} element`
      : "the commented element";
  return `Snapshot of ${subject} when the comment was left`;
}

/** The note an HTML snapshot starts with when its image couldn't be drawn. */
const NOTE = /^<!-- komo: (no image snapshot, [^>]*?)\.? -->\s*/;
export function splitNote(html: string) {
  const match = NOTE.exec(html);
  return match
    ? { note: `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}.`, code: html.slice(match[0].length) }
    : { note: "", code: html };
}

/** Markup as inert text in a scrollable, focusable region. */
function code(html: string) {
  const block = el("pre", "komo-snapshot-code");
  block.textContent = html;
  block.tabIndex = 0;
  block.setAttribute("role", "region");
  block.setAttribute("aria-label", "HTML snapshot");
  return block;
}

/**
 * The full-size viewer: a modal dialog like shortcut help. Escape, the close button
 * or a click outside close it and return focus to the control that opened it.
 */
export async function openSnapshotViewer(root: ShadowRoot, content: { src?: string; html?: string; alt: string }, release?: () => void) {
  style(root);
  const previous = root.activeElement as HTMLElement | null;
  const dialog = el("dialog", "komo-snapshot-viewer");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", content.alt);
  const header = el("header");
  const close = button("Close snapshot", () => finish(), "icon", "close");
  close.removeAttribute("title");
  header.append(el("h2", "", content.src ? "Snapshot" : "HTML snapshot"), close);
  dialog.append(header);
  if (content.src) {
    const image = el("img");
    image.alt = content.alt;
    image.src = content.src;
    dialog.append(image);
    // Open at the image's size, not empty first.
    await image.decode().catch(() => {});
  } else {
    const { note, code: markup } = splitNote(content.html ?? "");
    if (note) dialog.append(el("p", "", note));
    dialog.append(code(markup));
  }
  const listeners = new AbortController();
  const { signal } = listeners;
  const finish = () => {
    if (signal.aborted) return;
    listeners.abort();
    dialog.close();
    dialog.remove();
    release?.();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  dialog.addEventListener("close", finish, { signal });
  // The viewer owns the keyboard while open: komo's and the host's shortcuts wait.
  window.addEventListener(
    "keydown",
    (event) => {
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
      }
    },
    { capture: true, signal },
  );
  let outside = false;
  const beyond = (event: MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  dialog.addEventListener("pointerdown", (event) => (outside = beyond(event)), { signal });
  dialog.addEventListener("click", (event) => outside && beyond(event) && finish(), { signal });
  root.append(dialog);
  dialog.showModal();
  close.focus();
  return dialog;
}

/** A small button with the image, loaded when it scrolls into view; Enter or a click opens it full size. */
function thumbnail(url: string, thread: Pick<Thread, "anchor">, context: SnapshotContext, large = false, failed?: () => void) {
  const alt = snapshotAlt(thread);
  const image = el("img");
  image.alt = alt;
  image.dataset.komoSnapshot = "";
  image.decoding = "async";
  const open = el("button", "komo-snapshot");
  open.type = "button";
  open.setAttribute("aria-haspopup", "dialog");
  if (large) open.dataset.large = "";
  open.append(image);
  sources.set(image, {
    url,
    context,
    done: (ok) => {
      if (ok) open.dataset.ready = "";
      else if (!open.dataset.ready) failed ? failed() : (open.hidden = true);
    },
  });
  open.addEventListener("click", () => {
    void readSnapshot(url, context).then((blob) => {
      if (!blob) return;
      const src = URL.createObjectURL(blob);
      void openSnapshotViewer(context.root, { src, alt }, () => URL.revokeObjectURL(src));
    });
  });
  return open;
}

/** Swaps the slot for its content; images already on the page start watching now, the rest when attached. */
function place(slot: HTMLElement, node: HTMLElement, root: ShadowRoot) {
  watch(root);
  slot.replaceWith(node);
  const image = node.querySelector<HTMLImageElement>(SELECTOR);
  if (image?.isConnected) observe(image);
}
function textButton(url: string, thread: Pick<Thread, "anchor">, context: SnapshotContext) {
  const open = button("HTML snapshot", () => {
    void readSnapshot(url, context).then(async (blob) => {
      if (blob) void openSnapshotViewer(context.root, { html: await blob.text(), alt: snapshotAlt(thread) });
    });
  }, "komo-snapshot-text");
  open.removeAttribute("title");
  open.setAttribute("aria-haspopup", "dialog");
  return open;
}

/**
 * The fallback for a card whose element isn't on the page: the image, larger, or
 * when there is none, the HTML as text with the note saying why the image is missing.
 */
function fallback(thread: Snapshotted, context: SnapshotContext) {
  const { image, html } = thread.snapshot!;
  const view = el("div", "komo-snapshot-view");
  const showHtml = () => {
    if (!html) return view.remove();
    void readSnapshot(html, context).then(async (blob) => {
      if (!blob) return view.remove();
      const { note, code: markup } = splitNote(await blob.text());
      view.replaceChildren(el("p", "", note || "How it looked, as HTML:"), code(markup));
    }, () => view.remove());
  };
  view.append(el("p", "", "How it looked:"));
  if (image) view.append(thumbnail(image, thread, context, true, showHtml));
  else showHtml();
  return view;
}

/** The composer's pending capture, with a button that drops it before posting. */
function draft(shot: Pending, anchor: Thread["anchor"], context: SnapshotContext) {
  const row = el("div", "komo-snapshot-draft");
  const alt = snapshotAlt({ anchor });
  if (shot.image) {
    const open = el("button", "komo-snapshot");
    open.type = "button";
    open.dataset.ready = "";
    open.setAttribute("aria-haspopup", "dialog");
    const image = el("img");
    image.alt = alt;
    image.src = shot.image;
    open.append(image);
    open.addEventListener("click", () => void openSnapshotViewer(context.root, { src: shot.image, alt }));
    row.append(open);
  }
  row.append(el("span", "", shot.image ? (shot.html ? "Snapshot and HTML attached" : "Snapshot attached") : "HTML snapshot attached"));
  const drop = button("Remove snapshot", () => {
    context.dropped.add(anchor);
    row.closest("form")?.querySelector("textarea")?.focus();
    row.remove();
  }, "icon", "trash");
  row.append(drop);
  return row;
}

/** "Left on /route": the page the comment was left on, opened again with the comment. */
function route(thread: Snapshotted, context: SnapshotContext) {
  const url = new URL(thread.page, location.origin);
  url.searchParams.set("comment", thread.id);
  const link = el("a", "thread-route", thread.page);
  link.href = url.href;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    context.go(url);
  });
  const line = el("p", "", "Left on ");
  line.append(link);
  return line;
}

/**
 * Fills a slot komo's core left for a snapshot. Modes: 0 a list row (images only),
 * 1 the open card (the image's thumbnail, or a button that opens the HTML as text),
 * 2 how it looked, for a card on another page, 3 the composer's pending capture,
 * 4 a card whose element isn't on this page: its route, then how it looked.
 * Nothing is fetched until an image is on screen.
 */
export function mountSnapshot(slot: HTMLElement, context: SnapshotContext, mode: number, thread: Snapshotted, capture?: Promise<Pending | null>) {
  const { image, html } = thread.snapshot ?? {};
  style(context.root);
  if (mode === 3)
    return void capture?.then((shot) => {
      if (shot && (shot.image || shot.html) && slot.isConnected && !context.dropped.has(thread.anchor))
        place(slot, draft(shot, thread.anchor, context), context.root);
    });
  let node =
    mode > 1
        ? (image || html) && fallback(thread, context)
        : image
          ? thumbnail(image, thread, context)
          : mode && html && textButton(html, thread, context);
  if (mode === 4) {
    const group = el("div");
    group.append(route(thread, context), ...(node ? [node] : []));
    node = group;
  }
  if (node) place(slot, node, context.root);
}

/** Confirms, then removes a thread's snapshots at once; a failed delete puts them back. */
export function confirmRemove(thread: Thread, context: SnapshotContext) {
  context.notify("Remove this comment’s snapshot?", {
    label: "Remove",
    run: () => {
      context.remove(thread);
      context.notify("Snapshot removed");
    },
  });
}
