import type { FrameView, frameView as placeView } from "./review-layout.js";

type Box = { left: number; top: number; width: number; height: number };
type Size = [number, number];
/** A chosen viewport: the browser window, the space beside the comments, or a fixed size. */
type Choice = Size | "window" | "available";
export type FrameSizeControls = {
  /** Place the logical viewport in the box, both in page CSS pixels; `window` is the window's size. */
  view(box: Box, window: number[]): FrameView;
  /** True when a remembered size or zoom differs from the default, the window at Fit. */
  sized: boolean;
  /** The reviewer wants a separate viewport (only offered when the host enables it). */
  readonly separate: boolean;
  /**
   * Viewport mode's state: showing the page in its own viewport, loading, or
   * in place because it can't, with the reason shown in the bar.
   */
  status(state: { active: boolean; loading?: boolean; reason?: string }): void;
  /** Follow the frame in its box, in window pixels; null hides the controls. */
  update(box: Box | null, zoom?: number): void;
  destroy(): void;
};

export const FRAME_PRESETS: Array<[string, number, number]> = [
  ["Wide", 1440, 900],
  ["Laptop", 1280, 800],
  ["Tablet", 768, 1024],
  ["Mobile", 390, 844],
];
// Restored and typed sizes stay within sane viewports.
const LIMITS = [[240, 3840], [240, 2160]];
/** Remembered sizes carry this version; anything older predates the window-at-Fit default. */
const VERSION = 2;
const css = `.frame-size{position:fixed;inset:0;pointer-events:none;z-index:3;font-size:12px;font-weight:500;line-height:1;color:#d6d3ce}.frame-size>*{pointer-events:auto;position:fixed}.frame-size [hidden]{display:none}.frame-bar,.frame-zoom,.frame-custom{display:flex;align-items:center;gap:6px}.frame-size button,.frame-size input,.frame-zoom,.frame-menu{font:inherit;color:inherit;background:#1c1c1c;border:1px solid #ffffff14;border-radius:8px;height:28px;padding:0 10px;cursor:pointer}.frame-size button:hover{background:#262626}.frame-size :focus-visible{outline:2px solid var(--accent,#bda6ef);outline-offset:1px}.frame-zoom{gap:2px;padding:2px}.frame-zoom button{height:22px;border:0;padding:0 8px}.frame-size [aria-pressed=true],.frame-size [aria-checked=true]{background:#ffffff1f;color:#f1efeb}.frame-menu{display:grid;height:auto;min-width:200px;padding:4px;border:0;border-radius:10px;background:#232323;box-shadow:0 0 0 1px #ffffff14,0 12px 32px #0008;font-size:11px;cursor:auto}.frame-menu>button{display:flex;gap:12px;padding:0 8px;border:0;background:none}.frame-menu>button>span{margin-left:auto}.frame-menu>button::after{content:"";width:7px;height:3.5px;align-self:center;margin:-3px 3px 0 0;border:solid #0000;border-width:0 0 1.5px 1.5px;rotate:-45deg}.frame-menu>[aria-checked=true]::after{border-color:#bda6ef}.frame-size .frame-menu>[aria-checked=true]{background:none}.frame-size span,.frame-readout,.frame-custom{color:#898680;font-variant-numeric:tabular-nums}.frame-custom{gap:4px;padding:4px 4px 2px;border-top:1px solid #ffffff0d}.frame-custom input{width:64px;padding:0 6px;cursor:text}.frame-handle{width:10px;margin-left:-5px;cursor:ew-resize;touch-action:none}.frame-corner{width:18px;height:18px;margin:-9px 0 0 -9px;cursor:nwse-resize;touch-action:none}.frame-handle::after,.frame-corner::after{content:'';position:absolute;left:3px;top:calc(50% - 20px);width:4px;height:40px;border-radius:2px;background:#ffffff40}.frame-corner::after{inset:4px;width:auto;height:auto;background:none;border:solid #ffffff59;border-width:0 2px 2px 0;border-radius:0 0 4px 0}.frame-handle:hover::after,.frame-handle[data-active]::after{background:var(--accent,#bda6ef)}.frame-corner:hover::after,.frame-corner[data-active]::after{border-color:var(--accent,#bda6ef)}.frame-readout{padding:5px 8px;border-radius:6px;background:#1c1c1cf2;color:#f1efeb}.frame-bar{white-space:nowrap}.frame-bar .frame-scale{min-width:44px;color:#f1efeb;font-size:14px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}.frame-note{position:relative;display:flex;align-items:center;gap:2px;min-width:0;padding-left:4px}.frame-note>span:first-child{overflow:hidden;text-overflow:ellipsis}.frame-bar .frame-info{flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:none;color:#898680}.frame-bar .frame-info:hover{background:#ffffff12;color:#f1efeb}.frame-info::before{content:"i";display:inline-grid;place-items:center;width:12px;height:12px;border:1.2px solid;border-radius:50%;font:italic 600 9px/1 Georgia,serif}.frame-size .frame-tip{position:absolute;z-index:1;top:calc(100% + 8px);right:0;width:260px;padding:10px;border-radius:10px;background:#191819;box-shadow:0 0 0 1px #ffffff1a,0 12px 40px #0008;color:#e9e6e1;font-weight:400;line-height:1.45;white-space:normal;opacity:0;visibility:hidden;transition:opacity .15s}.frame-info:is(:hover,:focus-visible)+.frame-tip{opacity:1;visibility:visible}.frame-note[data-reason]>span:first-child{color:#f3c27a}`;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Record<string, string> = {},
  text = "",
) => {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  node.textContent = text;
  return node;
};
const place = (node: HTMLElement, left: number, top: number, height?: number) =>
  Object.assign(node.style, {
    left: `${left}px`,
    top: `${top}px`,
    height: height === undefined ? "" : `${height}px`,
  });
const clamp = (value: number, axis = 0) =>
  Math.round(Math.min(LIMITS[axis][1], Math.max(LIMITS[axis][0], value)));

/**
 * The reviewer's remembered choice, or the default (the window at Fit) for
 * nothing stored, unreadable values and entries from before versioning, which
 * kept implicit sizes from the old Fit default.
 */
export function readFrameSize(raw: string | null): { size: Choice; actual: boolean; inPlace: boolean } {
  try {
    const stored = JSON.parse(raw ?? "null");
    if (stored?.v !== VERSION) return { size: "window", actual: false, inPlace: false };
    const size: Choice =
      stored.size === "available"
        ? "available"
        : Array.isArray(stored.size) && stored.size.length === 2 && stored.size.every(Number.isFinite)
          ? [clamp(stored.size[0]), clamp(stored.size[1], 1)]
          : "window";
    return { size, actual: stored.actual === true, inPlace: stored.inPlace === true };
  } catch {
    return { size: "window", actual: false, inPlace: false };
  }
}
/**
 * What to remember for an explicit choice; null for the default, so it is never
 * pinned. `inPlace` records choosing In place over Viewport mode.
 */
export const frameSizeRecord = (size: Choice, actual: boolean, inPlace = false) =>
  size === "window" && !actual && !inPlace
    ? null
    : JSON.stringify({ v: VERSION, size: size === "window" ? null : size, actual, ...(inPlace ? { inPlace } : {}) });
const dimensions = ([width, height]: number[]) =>
  `${Math.round(width)} × ${Math.round(height)}`;

/**
 * Frame size controls: presets, a custom size, edge handles and Fit / 100%.
 * They own the chosen size, remembered under `key`, and call `apply` when it changes.
 */
export function mountFrameSize(
  root: ShadowRoot,
  /** The visible frame: the page root in place, the viewport iframe's port otherwise. */
  surface: () => HTMLElement,
  key: string,
  /** Re-layout; `toggled` when the reviewer switched between Viewport and In place. */
  apply: (toggled?: boolean) => void,
  // Passed in, so this chunk does not pull the eager layout module into a shared chunk.
  frameView: typeof placeView,
  /** The host enabled viewport mode (frame.mode "iframe"). */
  viewport = false,
): FrameSizeControls {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* Storage is blocked: use the default, the window at Fit. */
  }
  const restored = readFrameSize(raw);
  let { size, actual } = restored;
  let separate = viewport && !restored.inPlace;
  let state: { active: boolean; loading?: boolean; reason?: string } = { active: false };
  let current: FrameView | null | undefined;
  // Only the reviewer's own choices are remembered: a preset, a custom size, a drag,
  // an arrow-key resize or the zoom. Choosing the default forgets the entry.
  const remember = () => {
    try {
      const record = frameSizeRecord(size, actual, viewport && !separate);
      if (record) localStorage.setItem(key, record);
      else localStorage.removeItem(key);
    } catch {
      /* Keep the size for this session when storage is blocked. */
    }
  };
  // An old or unreadable entry is dropped, so it can't come back.
  if (raw !== null && raw !== frameSizeRecord(size, actual, viewport && !separate)) remember();
  const change = (next: Choice, zoom: boolean, persist = true, own = separate) => {
    size = next;
    actual = zoom;
    const toggled = own !== separate || (own && !!state.reason && !state.active);
    separate = own;
    apply(toggled);
    if (persist) remember();
  };
  const layer = element("div", "frame-size");
  const style = element("style", "", {}, css);
  const bar = element("div", "frame-bar", {
    role: "toolbar",
    "aria-label": "Frame size",
  });
  const trigger = element("button", "frame-size-trigger", {
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });
  const scale = element("span", "frame-scale", { "aria-live": "polite", title: "Zoom" });
  const zoom = element("div", "frame-zoom", {
    role: "group",
    "aria-label": "Zoom",
  });
  const fit = element("button", "", { type: "button", title: "Show the whole viewport" }, "Fit");
  const full = element("button", "", { type: "button", title: "Actual CSS pixels" }, "100%");
  zoom.append(fit, full);
  // Viewport shows the page in its own iframe; In place reflows this page.
  const mode = element("div", "frame-zoom frame-mode", { role: "group", "aria-label": "Viewport", hidden: "" });
  const own = element("button", "", { type: "button", title: "The page in its own viewport: real media queries" }, "Viewport");
  const inPlace = element("button", "", { type: "button", title: "This page, resized in place" }, "In place");
  mode.append(own, inPlace);
  // In place, the page keeps the browser window's media queries; say so when they disagree.
  const note = element("span", "frame-note", { hidden: "" });
  const noteText = element("span", "", {}, "Layout follows your browser window");
  const info = element("button", "frame-info", {
    type: "button",
    "aria-label": "Why the layout follows your browser window",
    "aria-describedby": "frame-tip",
  });
  const tip = element("span", "frame-tip", { id: "frame-tip", role: "tooltip" });
  const windowTip = `Media queries, window.innerWidth and resize events still match your browser window, because the page has no viewport of its own here. ${viewport ? "Choose Viewport to see its real breakpoints." : "Resize the browser window to see another breakpoint."}`;
  note.append(noteText, info, tip);
  bar.append(trigger, scale, zoom, mode, note);
  const menu = element("div", "frame-menu", {
    role: "menu",
    "aria-label": "Frame size",
    hidden: "",
  });
  const choices: Array<[name: string, label: string, choice: Choice]> = [
    ["Desktop", "Your window", "window"],
    ["Available", "Available space", "available"],
    ...FRAME_PRESETS.map(
      ([name, width, height]) => [name, `${name} ${width}`, [width, height]] as [string, string, Size],
    ),
  ];
  const readouts: HTMLElement[] = [];
  const items = choices.map(([, label, choice]) => {
    const item = element("button", "", {
      type: "button",
      role: "menuitemradio",
    });
    const readout = element("span", "", {}, typeof choice === "string" ? "" : dimensions(choice));
    readouts.push(readout);
    item.append(label, readout);
    item.addEventListener("click", () => {
      close();
      change(choice, actual);
    });
    return item;
  });
  const custom = element("form", "frame-custom", {
    "aria-label": "Custom size",
  });
  const fields = ["Width", "Height"].map((label, index) =>
    element("input", "", {
      "aria-label": label,
      inputmode: "numeric",
      type: "number",
      min: String(LIMITS[index][0]),
      max: String(LIMITS[index][1]),
      required: "",
    }),
  );
  custom.append(
    fields[0],
    "×",
    fields[1],
    element("button", "", { type: "submit" }, "Set"),
  );
  custom.addEventListener("submit", (event) => {
    event.preventDefault();
    close();
    change([clamp(+fields[0].value), clamp(+fields[1].value, 1)], actual);
  });
  menu.append(...items, custom);
  const edge = element("div", "frame-handle", {
    role: "slider",
    tabindex: "0",
    "aria-label": "Frame width",
    "aria-orientation": "horizontal",
    "aria-valuemin": String(LIMITS[0][0]),
    "aria-valuemax": String(LIMITS[0][1]),
  });
  const corner = element("div", "frame-corner", {
    role: "button",
    tabindex: "0",
    "aria-label": "Frame size: arrow keys change width and height",
  });
  const readout = element("div", "frame-readout", { hidden: "", role: "status" });
  layer.append(bar, menu, edge, corner, readout);
  root.append(style, layer);

  let ratio = 1;
  let lastBox: Box | null = null;
  let lastZoom = 1;
  let hideTimer = 0;
  let pending: Size | null = null;
  let frame = 0;
  const logical = (): Size => [current?.width ?? 0, current?.height ?? 0];
  const resize = (next: Size, persist: boolean) => {
    clearTimeout(hideTimer);
    readout.textContent = dimensions(next);
    readout.hidden = false;
    pending = next;
    if (persist) {
      cancelAnimationFrame(frame);
      frame = 0;
      change(next, actual);
      hideTimer = window.setTimeout(() => (readout.hidden = true), 900);
    } else
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (pending) change(pending, actual, false);
      });
  };
  function close() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
  trigger.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      fields.forEach((field, index) => (field.value = String(Math.round(logical()[index]))));
      (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0]).focus();
    }
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    trigger.focus();
  });
  const abort = new AbortController();
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !event.composedPath().some((node) => node === menu || node === trigger)) close();
  }, { capture: true, signal: abort.signal });
  fit.addEventListener("click", () => change(size, false));
  own.addEventListener("click", () => change(size, actual, true, true));
  inPlace.addEventListener("click", () => change(size, actual, true, false));
  full.addEventListener("click", () => change(size, true));
  for (const [handle, both] of [[edge, false], [corner, true]] as const) {
    let start: { x: number; y: number; size: Size; ratio: number } | null = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.dataset.active = "";
      start = { x: event.clientX, y: event.clientY, size: logical(), ratio };
    });
    handle.addEventListener("pointermove", (event) => {
      if (!start) return;
      resize([
        clamp(start.size[0] + (event.clientX - start.x) / start.ratio),
        both ? clamp(start.size[1] + (event.clientY - start.y) / start.ratio, 1) : Math.round(start.size[1]),
      ], false);
    });
    const end = () => {
      if (!start) return;
      start = null;
      delete handle.dataset.active;
      resize(pending ?? logical(), true);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 100 : 10;
      const delta = ({
        ArrowRight: [step, 0],
        ArrowLeft: [-step, 0],
        ...(both ? { ArrowDown: [0, step], ArrowUp: [0, -step] } : {}),
      } as Record<string, Size>)[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const [width, height] = logical();
      resize([clamp(width + delta[0]), clamp(height + delta[1], 1)], true);
    });
  }
  return {
    view(box, window) {
      return (current = frameView(
        box,
        size === "window" ? window : size === "available" ? [box.width, box.height] : size,
        actual,
      ));
    },
    sized: size !== "window" || actual,
    get separate() {
      return separate;
    },
    status(next) {
      state = next;
      if (current) this.update(lastBox, lastZoom);
    },
    update(box, zoom = 1) {
      lastBox = box;
      lastZoom = zoom;
      const view = (current ??=
        box &&
        frameView(
          { left: box.left / zoom, top: box.top / zoom, width: box.width / zoom, height: box.height / zoom },
          [innerWidth / zoom, innerHeight / zoom],
          false,
        ));
      layer.hidden = !box || !view;
      if (!box || !view) return close();
      ratio = view.scale * zoom;
      const frame = surface();
      const rect = frame.getBoundingClientRect();
      // A panned 100% frame is clipped to its box while the document scrolls it.
      if (!state.active) frame.style.clipPath = view.pan
        ? `inset(${[
            box.top - rect.top,
            rect.right - box.left - box.width,
            rect.bottom - box.top - box.height,
            box.left - rect.left,
          ].map((value) => `${Math.max(0, value) / zoom}px`).join(" ")} round ${12 / zoom}px)`
        : frame.style.clipPath;
      const preset = choices.findIndex(([, , choice]) =>
        typeof choice === "string" || typeof size === "string"
          ? choice === size
          : choice[0] === size[0] && choice[1] === size[1],
      );
      trigger.textContent = `${preset < 0 ? "Custom" : choices[preset][0]} · ${dimensions(logical())}`;
      readouts[0].textContent = dimensions([innerWidth / zoom, innerHeight / zoom]);
      readouts[1].textContent = dimensions([box.width / zoom, box.height / zoom]);
      items.forEach((item, index) => item.setAttribute("aria-checked", String(index === preset)));
      fit.setAttribute("aria-pressed", String(!actual));
      full.setAttribute("aria-pressed", String(actual));
      scale.textContent = `${Math.round(view.scale * 100)}%`;
      mode.hidden = !viewport;
      own.setAttribute("aria-pressed", String(separate));
      inPlace.setAttribute("aria-pressed", String(!separate));
      // In place because the viewport can't load: say why, in place of the breakpoint note.
      const failed = separate && !state.active && !state.loading && !!state.reason;
      noteText.textContent = failed ? "Viewport unavailable · showing in place" : state.loading ? "Loading viewport…" : "Layout follows your browser window";
      tip.textContent = failed ? state.reason! : windowTip;
      info.hidden = !!state.loading;
      info.setAttribute("aria-label", failed ? "Why the viewport is unavailable" : "Why the layout follows your browser window");
      note.toggleAttribute("data-reason", failed);
      note.hidden = state.active || (!failed && !state.loading && Math.abs(view.width - innerWidth / zoom) < 1);
      edge.setAttribute("aria-valuenow", String(Math.round(view.width)));
      edge.setAttribute("aria-valuetext", `${dimensions(logical())} pixels`);
      // The bar sits in the gutter above the box; handles follow the visual frame.
      const top = Math.max(8, box.top - 40);
      place(bar, box.left, top);
      bar.style.maxWidth = `${box.width}px`;
      place(menu, box.left, top + 34);
      edge.hidden = corner.hidden = view.pan;
      place(edge, rect.right, rect.top, rect.height);
      place(corner, rect.right, rect.bottom);
      place(readout, Math.max(rect.left + 8, rect.right - 120), rect.bottom - 36);
    },
    destroy() {
      clearTimeout(hideTimer);
      cancelAnimationFrame(frame);
      abort.abort();
      style.remove();
      layer.remove();
    },
  };
}
