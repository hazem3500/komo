import { avatar, el } from "./dom.js";
import type { Box } from "./pin-stacks.js";
import type { Thread } from "./types.js";

// Same-target stacks and collision bubbles. Core groups the pins and loads this chunk the
// first time a page has a group to draw.
export type PinUnit = {
  threads: Thread[];
  rect: { x: number; y: number };
  right: boolean;
  box: Box | null;
  owner?: Element;
};
export type GroupContext = {
  root: ShadowRoot;
  bounds: Box;
  pin(thread: Thread): HTMLElement;
  menu(label: string, actions: { label: string; icon: "comment"; onSelect(): void }[]): HTMLDetailsElement;
  summary(thread: Thread): string;
  open(thread: Thread): void;
};

// Matches the fanned state in styles.ts.
const fanned = ".pin-stack:is([data-open],:hover,:focus-within,:has(.active,.hot))";
const styled = new WeakSet<ShadowRoot>();
function style(root: ShadowRoot) {
  if (styled.has(root)) return;
  styled.add(root);
  // Touch fans a stack with a first tap; a tap anywhere else folds it again.
  for (const target of [document, root])
    target.addEventListener("pointerdown", (event) => {
      for (const stack of root.querySelectorAll(".pin-stack[data-open]"))
        if (!event.composedPath().includes(stack)) stack.removeAttribute("data-open");
    }, true);
}

/** A tight avatar stack for comments on one target; it fans out on hover, focus or a tap. */
export function stack({ threads, rect, right, owner }: PinUnit, context: GroupContext): HTMLElement {
  style(context.root);
  const node = el("div", "pin-stack");
  const pointer = (node.dataset.pointer = right ? "right" : "left");
  const name = (owner!.getAttribute("aria-label") || owner!.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", `${threads.length} comments on ${name || "this element"}`);
  if (threads.length > 3) node.dataset.more = `+${threads.length - 1}`;
  // Fanned rows grow up from the anchor, or down when that would leave the page.
  const below = rect.y - 6 - Math.ceil(threads.length / 6) * 38 < context.bounds.top;
  node.toggleAttribute("data-below", below);
  Object.assign(node.style, {
    left: `${right ? rect.x + 9 : rect.x - 9}px`,
    top: `${below ? rect.y - 18 : rect.y + 6}px`,
    translate: `${right ? "-100%" : "0"} ${below ? "0" : "-100%"}`,
  });
  let tap = false;
  node.addEventListener("pointerdown", (event) => {
    tap = event.pointerType !== "mouse" && !node.matches(fanned);
  }, true);
  node.addEventListener("click", (event) => {
    if (!tap) return;
    tap = false;
    event.stopPropagation();
    node.toggleAttribute("data-open", true);
  }, true);
  threads.forEach((thread, index) => {
    const pin = context.pin(thread);
    pin.dataset.pointer = pointer;
    // The oldest comment stays on top of the resting stack.
    pin.style.zIndex = String(threads.length - index);
    node.append(pin);
  });
  return node;
}

/** One count for pins on distinct targets that would overlap; it opens a menu of them. */
export function bubble(units: PinUnit[], threads: Thread[], context: GroupContext): HTMLElement {
  style(context.root);
  const node = context.menu(
    `${threads.length} comments nearby`,
    threads.map((thread) => ({
      label: `${thread.comments[0]?.author.name}: ${context.summary(thread)}`,
      icon: "comment",
      onSelect: () => context.open(thread),
    })),
  );
  node.className += " pin-cluster";
  node.dataset.cluster = threads.map((thread) => thread.id).join(" ");
  const toggle = node.firstElementChild!;
  toggle.className = "";
  toggle.textContent = String(threads.length);
  node.querySelectorAll(".menu-action svg").forEach((glyph, index) => {
    const author = threads[index].comments[0]?.author;
    if (author) glyph.replaceWith(avatar(author));
  });
  let x = 0,
    y = 0;
  for (const { box } of units) {
    x += (box!.left + box!.right) / 2 / units.length;
    y += (box!.top + box!.bottom) / 2 / units.length;
  }
  const { left, top, right, bottom } = context.bounds;
  Object.assign(node.style, {
    left: `${Math.max(left + 14, Math.min(x, right - 14))}px`,
    top: `${Math.max(top + 14, Math.min(y, bottom - 14))}px`,
  });
  return node;
}
