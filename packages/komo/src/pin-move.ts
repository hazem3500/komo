import { button, el } from "./dom.js";

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

/** Installed only after an explicit Move pin action; ordinary pins have no drag listeners. */
export function startPinMove(options: {
  root: ShadowRoot;
  pin: HTMLButtonElement;
  point: Point;
  bounds(): Bounds;
  preview(point: Point): void;
  finish(point: Point | null): void;
}) {
  const { pin, root } = options;
  const view = pin.ownerDocument.defaultView!;
  const listening = new AbortController();
  const signal = listening.signal;
  let point = { ...options.point };
  let start: { pointer: number; x: number; y: number; point: Point } | null = null;
  let dragged = false;
  let done = false;
  const bar = el("section", "pin-move");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Move pin");
  const instructions = el("p", "", "Drag this pin. Arrow keys move it; Shift moves farther. Enter saves; Escape cancels.");
  instructions.id = `pin-move-${Math.random().toString(36).slice(2, 8)}`;
  const status = el("span", "pin-move-status");
  status.setAttribute("role", "status");
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    listening.abort();
    if (start && pin.hasPointerCapture?.(start.pointer)) pin.releasePointerCapture(start.pointer);
    start = null;
    bar.remove();
    delete pin.dataset.moving;
    delete pin.dataset.dragging;
    pin.removeAttribute("aria-describedby");
    const changed = point.x !== options.point.x || point.y !== options.point.y;
    options.finish(commit && changed ? point : null);
  };
  const update = (next: Point, announce = false) => {
    const bounds = options.bounds();
    point = {
      x: Math.max(bounds.left, Math.min(bounds.right, next.x)),
      y: Math.max(bounds.top, Math.min(bounds.bottom, next.y)),
    };
    options.preview(point);
    if (announce) status.textContent = `Pin moved ${Math.round(point.x - options.point.x)} pixels horizontally, ${Math.round(point.y - options.point.y)} vertically. Enter saves.`;
  };
  bar.append(instructions, button("Save position", () => finish(true), "primary"), button("Cancel move", () => finish(false), "secondary"), status);
  root.append(bar);
  pin.dataset.moving = "true";
  pin.dataset.dragging = "true";
  pin.setAttribute("aria-describedby", instructions.id);
  pin.addEventListener("pointerdown", event => {
    if (event.button !== 0 || start) return;
    event.preventDefault();
    event.stopPropagation();
    start = { pointer: event.pointerId, x: event.clientX, y: event.clientY, point };
    dragged = false;
    pin.setPointerCapture(event.pointerId);
  }, { signal });
  pin.addEventListener("pointermove", event => {
    if (!start || event.pointerId !== start.pointer) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    dragged = true;
    event.preventDefault();
    update({ x: start.point.x + dx, y: start.point.y + dy });
  }, { signal });
  pin.addEventListener("pointerup", event => {
    if (!start || event.pointerId !== start.pointer) return;
    const pointer = start.pointer;
    if (dragged) update({ x: start.point.x + event.clientX - start.x, y: start.point.y + event.clientY - start.y });
    start = null;
    if (pin.hasPointerCapture?.(pointer)) pin.releasePointerCapture(pointer);
    if (dragged) finish(true);
  }, { signal });
  for (const type of ["pointercancel", "lostpointercapture"])
    pin.addEventListener(type, () => { if (start) finish(false); }, { signal });
  pin.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
  view.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(false);
      return;
    }
    if (!event.composedPath().includes(pin) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    const movement = delta[event.key];
    if (!movement && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (movement) update({ x: point.x + movement.x, y: point.y + movement.y }, true);
    else finish(true);
  }, { capture: true, signal });
  view.addEventListener("resize", () => finish(false), { signal });
  pin.focus({ preventScroll: true });
  return { cancel: () => finish(false) };
}
