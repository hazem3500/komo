// Komo-styled popups for the Design panel's native selects. The select stays the
// focusable trigger and the value store, so `.value`, `change`, `disabled` and
// labels keep working; only its system popup is replaced by a listbox that lives
// inside the panel, next to the field. One delegated set of listeners serves every
// select in a container, including ones added later (props, tokens, theme).
// The trigger's chevron ships here too, so a select only looks custom once it is.
// Comments stay out of the CSS string: they would ship in the bundle.
const css = `.design-field>select{appearance:none;padding-right:20px;cursor:pointer;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1.5 3 4 5.5 6.5 3' fill='none' stroke='%23898680' stroke-width='1.2'/%3E%3C/svg%3E") right 7px center/8px no-repeat}.komo-select{position:absolute;z-index:20;box-sizing:border-box;width:max-content;max-height:240px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:4px;border-radius:10px;background:#232323;box-shadow:0 0 0 1px #ffffff14,0 12px 32px #0008;color:#d9d6d1;font-size:11px;font-weight:400;line-height:1.2;text-align:left;cursor:default;transform-origin:top;animation:komo-select-in var(--duration-fast,250ms) var(--ease-smooth-out,cubic-bezier(.22,1,.36,1)) backwards}.komo-select[data-up]{transform-origin:bottom}@keyframes komo-select-in{from{opacity:0;transform:scale(.97)}}@media (prefers-reduced-motion:reduce){.komo-select{animation:none}}.komo-select [role=option]{display:flex;align-items:center;gap:8px;min-height:26px;padding:0 8px;border-radius:6px;white-space:nowrap;cursor:pointer}.komo-select [role=option] span{flex:1;overflow:hidden;text-overflow:ellipsis}.komo-select [data-active]{background:#ffffff14;color:#f1efeb}.komo-select [aria-selected=true]{color:#f1efeb}.komo-select [aria-selected=true]::after{content:'';flex:none;width:7px;height:3.5px;margin:-3px 1px 0 0;border:solid #bda6ef;border-width:0 0 1.5px 1.5px;rotate:-45deg}.komo-select [aria-disabled=true]{opacity:.4;cursor:default}.komo-select small{display:block;padding:8px 8px 4px;color:#77736f;font-size:10px;font-weight:500}.komo-select [role=group]+[role=group],.komo-select [role=option]+[role=group]{margin-top:4px;border-top:1px solid #ffffff0d}@media (pointer:coarse){.komo-select{max-height:320px;font-size:13px}.komo-select [role=option]{min-height:40px}}`;

const containers = new WeakSet<HTMLElement>();
const styled = new WeakSet<Node>();
let count = 0;
let current: { select: HTMLSelectElement; close(): void } | undefined;

/**
 * Replace the system popup of every select inside `container`, now and later.
 * Called on each render, it also closes a popup whose select was just replaced.
 */
export function attach(container: HTMLElement): void {
  if (current && !current.select.isConnected) current.close();
  // Style the root the panel is in now; a container rendered detached gets it on a later call.
  const root = container.getRootNode();
  if ((root instanceof ShadowRoot || root === document) && !styled.has(root)) {
    styled.add(root);
    const style = document.createElement("style");
    style.textContent = css;
    (root instanceof ShadowRoot ? root : document.head).append(style);
  }
  if (containers.has(container)) return;
  containers.add(container);
  const target = (event: Event) => {
    const select = event.composedPath()[0];
    return select instanceof HTMLSelectElement && !select.disabled && !select.multiple ? select : null;
  };
  container.addEventListener("focusin", (event) => {
    const select = target(event);
    if (select && !select.hasAttribute("aria-haspopup")) {
      select.setAttribute("aria-haspopup", "listbox");
      select.setAttribute("aria-expanded", "false");
    }
  });
  const toggle = (select: HTMLSelectElement, focus: boolean) => {
    if (current?.select === select) return current.close();
    // Focusing a select from a tap can show the system picker on iOS, so taps leave focus be.
    if (focus) select.focus();
    open(select);
  };
  // A mouse opens on press, like a native select. A touch or pen opens on release, and only
  // if it did not move: a drag that starts on a select is the panel scrolling.
  let press: { id: number; x: number; y: number } | undefined;
  container.addEventListener("pointerdown", (event) => {
    const select = target(event);
    if (!select || event.button) return;
    event.preventDefault();
    if (event.pointerType === "mouse") toggle(select, true);
    else press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, true);
  container.addEventListener("pointerup", (event) => {
    const select = target(event);
    const start = press;
    press = undefined;
    if (select && start?.id === event.pointerId && !far(event, start)) toggle(select, false);
  }, true);
  // Compatibility mouse events, a tap's touchend and its click would each reach the system picker.
  for (const type of ["mousedown", "touchend", "click"])
    container.addEventListener(type, (event) => { if (target(event) && event.cancelable) event.preventDefault(); }, true);
  container.addEventListener("keydown", (event) => {
    const select = target(event);
    if (!select || current?.select === select || event.ctrlKey || event.metaKey) return;
    if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    open(select);
  }, true);
}

/** Whether a pointer travelled past a tap's slop since it went down. */
const far = (event: PointerEvent, from: { x: number; y: number }) =>
  Math.hypot(event.clientX - from.x, event.clientY - from.y) > 10;

/** The nearest box that clips the popup: a scrolling ancestor, else the viewport. */
function bounds(from: Element) {
  const view = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  for (let node = from.parentElement; node; node = node.parentElement)
    if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) {
      const rect = node.getBoundingClientRect();
      return {
        top: Math.max(rect.top, 0), left: Math.max(rect.left, 0),
        bottom: Math.min(rect.bottom, view.bottom), right: Math.min(rect.right, view.right),
      };
    }
  return view;
}

function open(select: HTMLSelectElement): void {
  current?.close();
  const id = `komo-select-${++count}`;
  const list = document.createElement("div");
  list.className = "komo-select";
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", select.getAttribute("aria-label") ?? select.title);
  const items: { node: HTMLElement; option: HTMLOptionElement }[] = [];
  const add = (option: HTMLOptionElement, parent: HTMLElement) => {
    const node = document.createElement("div");
    node.id = `${id}-${items.length}`;
    node.setAttribute("role", "option");
    node.setAttribute("aria-selected", String(option.selected));
    if (option.disabled) node.setAttribute("aria-disabled", "true");
    if (option.title) node.title = option.title;
    const label = document.createElement("span");
    label.textContent = option.label;
    node.append(label);
    parent.append(node);
    items.push({ node, option });
  };
  for (const child of select.children) {
    if (child instanceof HTMLOptionElement) add(child, list);
    else if (child instanceof HTMLOptGroupElement) {
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", `${id}-g${items.length}`);
      const heading = document.createElement("small");
      heading.id = `${id}-g${items.length}`;
      heading.textContent = child.label;
      group.append(heading);
      for (const option of child.querySelectorAll("option")) add(option, group);
      list.append(group);
    }
  }
  let active = -1;
  const enabled = items.flatMap((item, index) => item.option.disabled ? [] : [index]);
  const activate = (index: number) => {
    if (!(index >= 0)) return;
    items[active]?.node.removeAttribute("data-active");
    active = index;
    const node = items[index].node;
    node.toggleAttribute("data-active", true);
    select.setAttribute("aria-activedescendant", node.id);
    // Scroll only the list, never the panel behind it.
    const top = node.offsetTop, bottom = top + node.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  };
  const step = (by: number) => {
    const at = enabled.indexOf(active);
    activate(enabled[at < 0 ? 0 : Math.max(0, Math.min(enabled.length - 1, at + by))]);
  };
  const choose = (index: number) => {
    const option = items[index]?.option;
    close();
    if (!option || option.disabled || option.selected) return;
    option.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const listeners = new AbortController();
  const { signal } = listeners;
  function close() {
    if (current?.select !== select) return;
    current = undefined;
    listeners.abort();
    list.remove();
    select.setAttribute("aria-expanded", "false");
    select.removeAttribute("aria-activedescendant");
    select.removeAttribute("aria-controls");
  }
  current = { select, close };
  let typed = "";
  let typedAt = 0;
  addEventListener("keydown", (event) => {
    if (!select.isConnected || event.composedPath()[0] !== select) return close();
    const key = event.key;
    if (event.ctrlKey || event.metaKey || event.altKey && !key.startsWith("Arrow")) return;
    if (key === "Tab") return close();
    if (key === "ArrowDown" || key === "ArrowUp") step(key === "ArrowDown" ? 1 : -1);
    else if (key === "Home" || key === "PageUp") activate(enabled[0]);
    else if (key === "End" || key === "PageDown") activate(enabled[enabled.length - 1]);
    else if (key === "Escape") close();
    else if (key === "Enter" || key === " " && !typed) choose(active);
    else if (key.length === 1) {
      // Type-ahead: repeat a letter to cycle, or type a prefix within a second.
      typed = event.timeStamp - typedAt < 1000 ? typed + key.toLowerCase() : key.toLowerCase();
      typedAt = event.timeStamp;
      const start = typed.length === 1 ? enabled.indexOf(active) + 1 : enabled.indexOf(active);
      const order = [...enabled.slice(Math.max(start, 0)), ...enabled.slice(0, Math.max(start, 0))];
      const match = order.find((index) => items[index].option.label.toLowerCase().startsWith(typed));
      if (match !== undefined) activate(match);
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
  addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    if (!path.includes(list) && !path.includes(select)) close();
  }, { capture: true, signal });
  // Scroll events stay inside komo's shadow root, so the panel's own scrolling is heard there.
  const scrolled = (event: Event) => { if (event.target !== list) close(); };
  addEventListener("scroll", scrolled, { capture: true, signal });
  select.getRootNode().addEventListener("scroll", scrolled, { capture: true, signal });
  addEventListener("resize", close, { signal });
  select.addEventListener("blur", close, { signal });
  list.addEventListener("mousedown", (event) => event.preventDefault(), { signal });
  // A touch or pen that scrolls the list must not pick the option it started on.
  let start: { x: number; y: number } | undefined;
  let moved = false;
  list.addEventListener("pointerdown", (event) => {
    start = event.pointerType === "mouse" ? undefined : { x: event.clientX, y: event.clientY };
    moved = false;
  }, { signal });
  list.addEventListener("pointercancel", () => { moved = true; }, { signal });
  list.addEventListener("pointermove", (event) => {
    if (start && far(event, start)) moved = true;
    const node = (event.target as Element).closest?.("[role=option]");
    const index = items.findIndex((item) => item.node === node);
    if (enabled.includes(index) && index !== active) activate(index);
  }, { signal });
  list.addEventListener("click", (event) => {
    // A click inside a <label> row would otherwise refocus its first control.
    event.preventDefault();
    if (moved) return;
    const node = (event.target as Element).closest?.("[role=option]");
    const index = items.findIndex((item) => item.node === node);
    if (enabled.includes(index)) choose(index);
  }, { signal });
  const host = select.closest<HTMLElement>(".design-field") ?? select.parentElement!;
  host.append(list);
  select.setAttribute("aria-haspopup", "listbox");
  select.setAttribute("aria-expanded", "true");
  select.setAttribute("aria-controls", id);
  // A select laid over a small icon anchors to its whole field instead.
  const anchor = (select.offsetWidth < 60 ? host : select).getBoundingClientRect();
  const box = bounds(host);
  const origin = (list.offsetParent ?? host).getBoundingClientRect();
  // As wide as the trigger, or its longest option, within the panel.
  const width = Math.min(Math.max(anchor.width, list.offsetWidth + 2, 120), box.right - box.left - 8);
  const below = box.bottom - anchor.bottom - 8;
  const above = anchor.top - box.top - 8;
  const height = list.scrollHeight;
  const up = height > below && above > below;
  const room = Math.max(up ? above : below, 60);
  const shown = Math.min(height, 240, room);
  list.style.width = `${width}px`;
  list.style.maxHeight = `${Math.min(240, room)}px`;
  list.style.left = `${Math.max(box.left + 4, Math.min(anchor.left, box.right - width - 4)) - origin.left}px`;
  list.style.top = `${(up ? anchor.top - shown - 4 : anchor.bottom + 4) - origin.top}px`;
  list.toggleAttribute("data-up", up);
  activate(items.findIndex((item) => item.option.selected && !item.option.disabled));
  if (active < 0) step(0);
}
