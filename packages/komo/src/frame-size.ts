type Box = { left: number; top: number; width: number; height: number };
type Size = [number, number];
export type FrameView = Box & { scale: number; pan: boolean };
export type FrameSizeControls = {
  /** Place the logical viewport in the box, both in page CSS pixels. */
  view(box: Box): FrameView;
  /** True when a remembered size or zoom differs from the fitted default. */
  sized: boolean;
  /** Follow the frame in its box, in window pixels; null hides the controls. */
  update(box: Box | null, zoom?: number): void;
  destroy(): void;
};

export const FRAME_PRESETS: Array<[string, number, number]> = [
  ["Desktop", 1440, 900],
  ["Laptop", 1280, 800],
  ["Tablet", 768, 1024],
  ["Mobile", 390, 844],
];
const MIN = 200;
const MAX = 4000;
const css = `.frame-size{position:fixed;inset:0;pointer-events:none;z-index:3;font-size:12px;font-weight:500;line-height:1;color:#d6d3ce}.frame-size>*{pointer-events:auto;position:fixed}.frame-size [hidden]{display:none}.frame-bar,.frame-zoom,.frame-custom{display:flex;align-items:center;gap:6px}.frame-size button,.frame-size input,.frame-zoom,.frame-menu{font:inherit;color:inherit;background:#1c1c1c;border:1px solid #ffffff14;border-radius:8px;height:28px;padding:0 10px;cursor:pointer}.frame-size button:hover{background:#262626}.frame-size :focus-visible{outline:2px solid var(--accent,#bda6ef);outline-offset:1px}.frame-zoom{gap:2px;padding:2px}.frame-zoom button{height:22px;border:0;padding:0 8px}.frame-size [aria-pressed=true],.frame-size [aria-checked=true]{background:#ffffff1f;color:#f1efeb}.frame-menu{display:grid;gap:2px;height:auto;min-width:200px;padding:4px;border-radius:10px;box-shadow:0 8px 24px #0008;cursor:auto}.frame-menu button{display:flex;justify-content:space-between;gap:16px;border:0}.frame-size span,.frame-readout,.frame-custom{color:#898680;font-variant-numeric:tabular-nums}.frame-custom{gap:4px;padding:4px 4px 2px;border-top:1px solid #ffffff0d}.frame-custom input{width:64px;padding:0 6px;cursor:text}.frame-handle{width:10px;margin-left:-5px;cursor:ew-resize;touch-action:none}.frame-corner{width:18px;height:18px;margin:-9px 0 0 -9px;cursor:nwse-resize;touch-action:none}.frame-handle::after,.frame-corner::after{content:'';position:absolute;left:3px;top:calc(50% - 20px);width:4px;height:40px;border-radius:2px;background:#ffffff40}.frame-corner::after{inset:4px;width:auto;height:auto;background:none;border:solid #ffffff59;border-width:0 2px 2px 0;border-radius:0 0 4px 0}.frame-handle:hover::after,.frame-handle[data-active]::after{background:var(--accent,#bda6ef)}.frame-corner:hover::after,.frame-corner[data-active]::after{border-color:var(--accent,#bda6ef)}.frame-readout{padding:5px 8px;border-radius:6px;background:#1c1c1cf2;color:#f1efeb}`;

/**
 * Fit scales a logical viewport larger than the box down to show all of it,
 * centred; 100% keeps CSS pixels and pans. Without a size the box is the viewport.
 */
export function frameView(box: Box, size: Size | null, actual: boolean): FrameView {
  const [width, height] = size ?? [box.width, box.height];
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
const clamp = (value: number) =>
  Math.round(Math.min(MAX, Math.max(MIN, value)));
const dimensions = ([width, height]: number[]) =>
  `${Math.round(width)} × ${Math.round(height)}`;

/**
 * Frame size controls: presets, a custom size, edge handles and Fit / 100%.
 * They own the chosen size, remembered under `key`, and call `apply` when it changes.
 */
export function mountFrameSize(
  root: ShadowRoot,
  surface: HTMLElement,
  key: string,
  apply: () => void,
): FrameSizeControls {
  let size: Size | null = null;
  let actual = false;
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (stored.size?.every((value: unknown) => Number.isFinite(value)))
      size = [clamp(stored.size[0]), clamp(stored.size[1])];
    actual = stored.actual === true;
  } catch {
    /* Use the fitted default when storage is blocked or unreadable. */
  }
  let current: FrameView | null | undefined;
  const change = (next: Size | null, zoom: boolean, persist = true) => {
    size = next;
    actual = zoom;
    apply();
    if (persist)
      try {
        localStorage.setItem(key, JSON.stringify({ size, actual }));
      } catch {
        /* Keep the size for this session when storage is blocked. */
      }
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
  const zoom = element("div", "frame-zoom", {
    role: "group",
    "aria-label": "Zoom",
  });
  const fit = element("button", "", { type: "button" }, "Fit");
  const full = element("button", "", { type: "button" }, "100%");
  zoom.append(fit, full);
  const scale = element("span", "frame-scale", { "aria-live": "polite" });
  bar.append(trigger, zoom, scale);
  const menu = element("div", "frame-menu", {
    role: "menu",
    "aria-label": "Frame size",
    hidden: "",
  });
  const choices: Array<[string, Size | null]> = [
    ["Fit", null],
    ...FRAME_PRESETS.map(
      ([name, width, height]) => [`${name} ${width}`, [width, height]] as [string, Size],
    ),
  ];
  const items = choices.map(([label, choice], index) => {
    const item = element("button", "", {
      type: "button",
      role: "menuitemradio",
    });
    item.append(label, element("span", "", {}, index ? dimensions(choice!) : ""));
    item.addEventListener("click", () => {
      close();
      change(choice, actual);
    });
    return item;
  });
  const custom = element("form", "frame-custom", {
    "aria-label": "Custom size",
  });
  const fields = ["Width", "Height"].map((label) =>
    element("input", "", {
      "aria-label": label,
      inputmode: "numeric",
      type: "number",
      min: String(MIN),
      max: String(MAX),
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
    change([clamp(+fields[0].value), clamp(+fields[1].value)], actual);
  });
  menu.append(...items, custom);
  const edge = element("div", "frame-handle", {
    role: "slider",
    tabindex: "0",
    "aria-label": "Frame width",
    "aria-orientation": "horizontal",
    "aria-valuemin": String(MIN),
    "aria-valuemax": String(MAX),
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
        both ? clamp(start.size[1] + (event.clientY - start.y) / start.ratio) : Math.round(start.size[1]),
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
      resize([clamp(width + delta[0]), clamp(height + delta[1])], true);
    });
  }
  return {
    view(box) {
      return (current = frameView(box, size, actual));
    },
    sized: !!size || actual,
    update(box, zoom = 1) {
      const view = (current ??=
        box &&
        frameView(
          { left: box.left / zoom, top: box.top / zoom, width: box.width / zoom, height: box.height / zoom },
          null,
          false,
        ));
      layer.hidden = !box || !view;
      if (!box || !view) return close();
      ratio = view.scale * zoom;
      const rect = surface.getBoundingClientRect();
      // A panned 100% frame is clipped to its box while the document scrolls it.
      surface.style.clipPath = view.pan
        ? `inset(${[
            box.top - rect.top,
            rect.right - box.left - box.width,
            rect.bottom - box.top - box.height,
            box.left - rect.left,
          ].map((value) => `${Math.max(0, value) / zoom}px`).join(" ")} round ${12 / zoom}px)`
        : surface.style.clipPath;
      const preset = size
        ? choices.findIndex(([, choice]) => choice?.[0] === size![0] && choice[1] === size![1])
        : 0;
      trigger.textContent = `${preset < 0 ? "Custom" : choices[preset][0].split(" ")[0]} · ${dimensions(logical())}`;
      items.forEach((item, index) => item.setAttribute("aria-checked", String(index === preset)));
      fit.setAttribute("aria-pressed", String(!actual));
      full.setAttribute("aria-pressed", String(actual));
      scale.textContent = `${Math.round(view.scale * 100)}%`;
      edge.setAttribute("aria-valuenow", String(Math.round(view.width)));
      edge.setAttribute("aria-valuetext", `${dimensions(logical())} pixels`);
      // The bar sits in the gutter above the box; handles follow the visual frame.
      const top = Math.max(8, box.top - 40);
      place(bar, box.left, top);
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
