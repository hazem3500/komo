import { cssSelector } from './design-export.js';
import { elementLabel } from './element-label.js';
import { changePreviewStyles, inlineStyleSnapshot } from './design-preview.js';
import type { DesignTarget } from './design-target.js';

/** Where a box sits: its parent (selector, label, component) and its index among the parent's element children. */
export type Place = { parent: string; label: string; index: number; component?: string; position?: 'before' | 'after' | 'inside' };
export type MoveRecord = { label: string; target: string; from: Place; to: Place };

type Entry = {
  element: DesignTarget;
  geometry?: Array<{ mode: string; layout: string; move?: MoveRecord; effects: string[] }>;
  undo?(): void;
  /** The live destination: before `before` in `parent`, appended when null. */
  place?: { parent: Element; before: Element | null; selectors: [string, string | null] };
  clone?: HTMLElement; display?: string; priority?: string; sig?: string | null;
};
export type MoveHooks = {
  signal: AbortSignal;
  host: HTMLElement;
  targetAt(x: number, y: number): Element | null;
  selected(): DesignTarget | null;
  pick(x: number, y: number): void;
  enabled(): boolean;
  /** Design mode shows the page without this session's edits (Before, or suspended). */
  before(): boolean;
  remember(element: DesignTarget, property: string): void;
  track(element: DesignTarget, property: string): void;
  history: Entry[];
  update(): void;
  component(element: Element): string | undefined;
  layout(element: DesignTarget): string;
  announce(text: string): void;
  /** Ghost the selection outline by a pointer delta while dragging; null ends the drag. */
  drag(delta: [number, number] | null): void;
};
export type Drop = { parent: Element; before: Element | null; position: 'before' | 'after' | 'inside'; ref: Element | null };

const CLONE = 'data-komo-move-clone';
// Phrasing-only, replaced, form and table-structure elements never take a dropped box.
const LEAF = 'p,h1,h2,h3,h4,h5,h6,a,button,label,select,option,textarea,input,img,video,audio,canvas,iframe,embed,object,svg,br,hr,pre,picture,table,thead,tbody,tfoot,tr,colgroup,col,caption,script,style,template,slot';
const RUN = 'p,h1,h2,h3,h4,h5,h6,a,label,button,span,em,strong,b,i,small,code';
const display = (node: Element) => getComputedStyle(node).display;
const clone = (node: Element) => node.hasAttribute(CLONE);
const ordinal = (n: number) => `${n}${n % 100 > 10 && n % 100 < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** Element children that take part in the parent's layout, without preview clones or `skip`. */
const kids = (parent: Element, skip?: Element) => [...parent.children].filter(child => child !== skip && !clone(child) && !/^(none|contents)$/.test(display(child)) && !child.matches('script,style,template'));
/** The next or previous laid-out sibling, skipping preview clones and `skip`. */
function sibling(node: Element, later: boolean, skip?: Element) {
  let next = later ? node.nextElementSibling : node.previousElementSibling;
  while (next && (next === skip || clone(next) || /^(none|contents)$/.test(display(next)))) next = later ? next.nextElementSibling : next.previousElementSibling;
  return next;
}
/** Reading order: is this box after the point? Same line compares x, otherwise y. */
const after = (rect: DOMRect, x: number, y: number) => rect.top < y && rect.bottom > y ? rect.left + rect.width / 2 > x : rect.top + rect.height / 2 > y;
/** Does the parent lay this child out beside its siblings (a row), rather than above and below them? */
function row(node: Element) {
  const parent = node.parentElement!, rect = node.getBoundingClientRect();
  const near = kids(parent, node).map(child => child.getBoundingClientRect());
  if (!near.length) { const css = getComputedStyle(parent); return /flex/.test(css.display) && css.flexDirection.startsWith('row'); }
  return near.some(other => other.top < rect.bottom - 1 && other.bottom > rect.top + 1);
}

/** Why a box can't be moved between elements, or null. */
export function moveReason(element: Element | null, box: Element | null = element): string | null {
  const parent = element?.parentElement;
  if (!element?.isConnected || !parent) return 'Select an element on the page.';
  if (element === document.body || parent === document.body || parent === document.documentElement) return "The page and app roots can't be moved.";
  if (element instanceof SVGElement && element.ownerSVGElement) return "SVG shapes can't be moved. Select the SVG root.";
  if (element.matches('thead,tbody,tfoot,caption,colgroup,col')) return "Table sections can't be moved. Select the table.";
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement)
    if ((display(node) === 'inline' && !(node instanceof SVGSVGElement) && !node.matches('img,video,canvas,iframe,embed,object,input,select,textarea,button')) || (node === parent && node.matches(RUN)))
      return "Inline text runs can't be moved. Select the paragraph or the block around them.";
  if (!box || /^(none|contents)$/.test(display(box)) || !box.getClientRects().length) return 'This element has no box to move.';
  return null;
}

/** Can `parent` take `element` as a child? Table rows stay in their section and cells in a row of their table. */
function accepts(parent: Element, element: Element, host: HTMLElement) {
  if (parent === element || element.contains(parent) || clone(parent) || parent.closest(`[${CLONE}]`) || host.contains(parent)) return false;
  if (element.matches('tr')) return parent === element.parentElement;
  if (element.matches('td,th')) return parent.matches('tr') && parent.closest('table') === element.closest('table');
  return parent instanceof HTMLElement && parent !== document.body && parent !== document.documentElement && !parent.matches(LEAF) && !/^(inline|contents|none)$/.test(display(parent));
}

export function bindMove(hooks: MoveHooks) {
  const known = new Set<Entry>();
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  let rule = '';
  let press: { x: number; y: number; id: number } | undefined;
  let dragging = false, drop: Drop | null = null, frame = 0;
  const latest = (element: Element) => [...hooks.history].reverse().find(entry => entry.element === element && entry.place);
  const live = (entry: Entry | undefined) => !!entry && latest(entry.element) === entry && !hooks.before() && entry.element.isConnected;
  /** What the page shows for this element: its clone while moved, else itself. */
  const shown = (element: Element): Element => { const entry = latest(element); return live(entry) && entry!.clone?.isConnected ? entry!.clone : element; };
  const detach = () => known.forEach(entry => entry.clone?.remove());
  const label = (element: Element) => hooks.component(element) ?? elementLabel(element);
  // Containers read best as their component, role or name, else tag#id or tag.class.
  const where = (element: Element) => hooks.component(element) ?? (element.matches('[role],[aria-label]') ? elementLabel(element)
    : `${element.localName}${element.id ? `#${element.id}` : element.classList[0] ? `.${element.classList[0]}` : ''}`);
  const place = (parent: Element, index: number, position?: Place['position']): Place => {
    const component = hooks.component(parent);
    return { parent: cssSelector(parent), label: where(parent), index, ...(component ? { component } : {}), ...(position ? { position } : {}) };
  };
  const indexIn = (parent: Element, before: Element | null, element: Element) => {
    const list = kids(parent, element);
    const at = before ? list.findIndex(child => child === before || !!(before.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING)) : -1;
    return at < 0 ? list.length : at;
  };
  const describe = (target: Drop, element: Element) => target.position === 'inside'
    ? `Into ${where(target.parent)} · position ${indexIn(target.parent, target.before, element) + 1}`
    : `${target.position === 'before' ? 'Before' : 'After'} ${label(target.ref!)}`;

  /** A faithful, inert copy: computed styles inlined so it lays out the same in its new parent. */
  function copy(element: DesignTarget, entry: Entry) {
    const root = element.cloneNode(true) as HTMLElement;
    const sources = [element, ...element.querySelectorAll('*')], copies = [root, ...root.querySelectorAll('*')];
    copies.forEach((node, index) => { node.removeAttribute('id'); if (!index || sources.length < 400) paint(node, sources[index]); });
    root.style.display = entry.display!;
    root.setAttribute(CLONE, '');
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
    return root;
  }
  function paint(node: Element, source: Element) {
    const css = getComputedStyle(source), style = (node as HTMLElement).style;
    for (const name of css) style.setProperty(name, css.getPropertyValue(name));
    style.setProperty('transition', 'none');
    style.setProperty('animation', 'none');
  }

  /** Put each live clone where its move says, hide its original, and drop the rest; survives host re-renders. */
  function sync() {
    for (const entry of known) {
      const { element, place } = entry;
      if (!hooks.history.includes(entry)) known.delete(entry);
      if (!live(entry) || !place) { entry.clone?.remove(); continue; }
      // A renderer that rewrote the style attribute brings the original back.
      if (element.style.getPropertyValue('display') !== 'none') element.style.setProperty('display', 'none', entry.priority);
      if (!place.parent.isConnected || (place.before && place.before.parentNode !== place.parent)) {
        detach();
        place.parent = document.querySelector(place.selectors[0]) ?? place.parent;
        const before = place.selectors[1] ? document.querySelector(place.selectors[1]) : null;
        place.before = before?.parentNode === place.parent ? before : null;
      }
      if (!place.parent.isConnected) { entry.clone?.remove(); continue; }
      // Renderer commits and panel edits on the hidden original rebuild its stand-in.
      const sig = `${element.getAttribute('style')}\n${element.getAttribute('class')}\n${element.innerHTML}`;
      if (entry.sig !== sig) { entry.clone?.remove(); entry.clone = undefined; entry.sig = sig; }
      entry.clone ??= copy(element, entry);
      if (entry.clone.parentNode !== place.parent || entry.clone.nextSibling !== place.before) place.parent.insertBefore(entry.clone, place.before);
    }
    const element = hooks.selected();
    const selector = !dragging && hooks.enabled() && element && shown(element) === element && !moveReason(element) && cssSelector(element);
    const next = dragging ? '*{cursor:grabbing!important}' : selector ? `${selector},${selector} *{cursor:move}` : '';
    if (next !== rule) sheet.replaceSync(rule = next);
  }
  const observer = new MutationObserver(() => {
    if (known.size && !frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });

  /** Preview the element at `target`; returns the announcement, or null when nothing would change. */
  function commit(element: DesignTarget, target: Drop) {
    // Stand-ins leave the page below, so the drop anchors on the next real node.
    while (target.before && clone(target.before)) target.before = target.before.nextElementSibling;
    const prior = latest(element);
    const now = prior?.clone?.isConnected ? prior.clone : element;
    if (target.parent === now.parentElement && (target.before === now || target.before === sibling(now, true))) return null;
    // Selectors and indexes describe the page itself, without any stand-ins.
    detach();
    const parent = element.parentElement!;
    const from = prior?.geometry![0].move!.from ?? place(parent, kids(parent).indexOf(element));
    const move: MoveRecord = { label: label(element), target: prior?.geometry![0].move!.target ?? cssSelector(element), from,
      to: place(target.parent, indexIn(target.parent, target.before, element), target.position) };
    const snapshot = inlineStyleSnapshot(element, 'display');
    const entry: Entry = {
      element, display: prior?.display ?? display(element), priority: snapshot.priority,
      place: { parent: target.parent, before: target.before, selectors: [cssSelector(target.parent), target.before ? cssSelector(target.before) : null] },
      geometry: [{ mode: 'structure', layout: hooks.layout(element), move, effects: [] }],
      undo() {
        changePreviewStyles(element, ['display'], () => snapshot.restore());
        hooks.track(element, 'display');
      },
    };
    known.add(entry);
    hooks.history.push(entry);
    hooks.remember(element, 'display');
    changePreviewStyles(element, ['display'], () => element.style.setProperty('display', 'none', snapshot.priority));
    hooks.track(element, 'display');
    sync();
    hooks.update();
    try { localStorage.setItem('komo:geometry-moved', '1'); } catch { /* The first-use hint shows again. */ }
    return `Moved ${target.position === 'inside' ? `into ${where(target.parent)}` : `${target.position} ${label(target.ref!)}`}`;
  }

  /** The nearest valid drop at a screen point: between siblings along their flow, or into a container. */
  function dropAt(x: number, y: number, element: Element): Drop | null {
    let node = hooks.targetAt(x, y);
    while (node && node !== document.body && (!node.parentElement || !accepts(node.parentElement, element, hooks.host) || /^(inline|contents)$/.test(display(node))))
      node = node.parentElement;
    if (!node || node === document.body || element.contains(node)) return null;
    const rect = node.getBoundingClientRect(), across = row(node);
    const [start, size, at] = across ? [rect.left, rect.width, x] : [rect.top, rect.height, y];
    const band = Math.min(12, size / 4);
    // Boxes holding their own text are leaves; only structural containers take a drop inside.
    const holds = [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent!.trim());
    if (!holds && accepts(node, element, hooks.host) && at > start + band && at < start + size - band) {
      const before = kids(node, element).find(child => after(child.getBoundingClientRect(), x, y)) ?? null;
      return { parent: node, before, position: 'inside', ref: null };
    }
    const later = at >= start + size / 2;
    return { parent: node.parentElement!, before: later ? node.nextElementSibling : node, position: later ? 'after' : 'before', ref: node };
  }

  /** Keyboard moves from where the element shows now: earlier, later, out after its parent, or into the previous sibling. */
  function step(element: DesignTarget, later: boolean, structural: boolean): Drop | null {
    const prior = latest(element);
    const now = live(prior) && prior!.clone?.isConnected ? prior!.clone : element;
    const parent = now.parentElement!;
    if (structural && !later) {
      const outer = parent.parentElement;
      return outer && accepts(outer, element, hooks.host) ? { parent: outer, before: parent.nextElementSibling, position: 'after', ref: parent } : null;
    }
    const near = sibling(now, later && !structural, element);
    if (structural) return near && accepts(near, element, hooks.host) ? { parent: near, before: null, position: 'inside', ref: null } : null;
    return near ? { parent, before: later ? near.nextElementSibling : near, position: later ? 'after' : 'before', ref: near } : null;
  }

  // Drop feedback: an insertion line along the parent's flow, the container's outline and a label chip.
  const line = document.createElement('div'), box = document.createElement('div'), chip = document.createElement('div');
  line.className = 'design-geometry__line';
  box.className = 'design-geometry__drop';
  chip.className = 'design-geometry__readout design-geometry__chip';
  for (const node of [line, box, chip]) node.hidden = true;
  const px = (value: number) => `${Math.round(value * 100) / 100}px`;
  function feedback(target: Drop | null, element: Element, x: number, y: number) {
    line.hidden = box.hidden = chip.hidden = !target;
    if (!target) return;
    const set = (node: HTMLElement, left: number, top: number, width: number, height: number) =>
      Object.assign(node.style, { left: px(left), top: px(top), width: px(width), height: px(height) });
    box.hidden = target.position !== 'inside';
    const area = target.parent.getBoundingClientRect();
    set(box, area.left, area.top, area.width, area.height);
    const list = kids(target.parent, element);
    const index = indexIn(target.parent, target.before, element);
    const [prev, next] = [list[index - 1], list[index]].map(node => node?.getBoundingClientRect());
    const near = list[index] ?? list[index - 1];
    line.hidden = !near;
    if (near) {
      const r = (next ?? prev)!;
      // Beside its siblings the line stands upright between them; stacked, it lies between them.
      if (row(near)) set(line, next ? (prev && prev.top < next.bottom && prev.bottom > next.top ? (prev.right + next.left) / 2 : next.left - 2) - 1 : prev!.right + 1, r.top, 2, r.height);
      else set(line, r.left, next ? (prev ? (prev.bottom + next.top) / 2 : next.top - 2) - 1 : prev!.bottom + 1, r.width, 2);
    }
    chip.textContent = describe(target, element);
    Object.assign(chip.style, { left: px(x + 14), top: px(y + 18) });
  }
  function end() {
    press = undefined;
    drop = null;
    if (dragging) { dragging = false; hooks.drag(null); }
    feedback(null, document.body, 0, 0);
    sync();
  }

  const options = { capture: true, signal: hooks.signal };
  window.addEventListener('pointerdown', event => {
    const element = hooks.selected();
    if (event.button || event.metaKey || event.ctrlKey || !hooks.enabled() || !element || event.composedPath().includes(hooks.host) || moveReason(element, shown(element))) return;
    const rect = shown(element).getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    // Hold Design mode's selection until the press turns out to be a click.
    event.preventDefault();
    event.stopImmediatePropagation();
    press = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }, options);
  window.addEventListener('pointermove', event => {
    const element = hooks.selected();
    if (!press || event.pointerId !== press.id || !element) return;
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    if (!dragging && Math.hypot(dx, dy) < 4) return;
    event.stopImmediatePropagation();
    if (!dragging) { dragging = true; sync(); }
    hooks.drag([dx, dy]);
    drop = dropAt(event.clientX, event.clientY, element);
    feedback(drop, element, event.clientX, event.clientY);
  }, options);
  window.addEventListener('pointerup', event => {
    const element = hooks.selected();
    if (!press || event.pointerId !== press.id) return;
    const was = dragging, target = drop;
    end();
    if (!was) { if (element && shown(element) === element) hooks.pick(event.clientX, event.clientY); return; }
    event.stopImmediatePropagation();
    const said = element && target && commit(element, target);
    if (said) hooks.announce(said);
  }, options);
  window.addEventListener('pointercancel', () => press && end(), options);
  window.addEventListener('keydown', event => {
    if (!dragging || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    end();
  }, options);
  hooks.signal.addEventListener('abort', () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    detach();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet);
  }, { once: true });

  return {
    nodes: [line, box, chip], shown, sync,
    /** Alt + arrows on the focused selection: ↑/← earlier, ↓/→ later, Shift+↑ out after the parent, Shift+↓ into the previous sibling. */
    key(element: DesignTarget, later: boolean, structural: boolean) {
      const reason = moveReason(element, shown(element));
      const target = reason ? null : step(element, later, structural);
      hooks.announce(reason ?? (target && commit(element, target)) ??(structural ? (later ? 'No container before it to move into' : "Can't move out of this parent") : later ? 'Already last' : 'Already first'));
    },
    /** Stand-ins leave the page while a proposal records selectors; the next frame puts them back. */
    detach() { detach(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); }); },
  };
}

/** "Move Button “Save”: from Toolbar (3rd) → Sidebar (1st)", then the machine-readable From and To lines. */
export function moveLines(move: MoveRecord) {
  const at = (place: Place) => `${place.parent} · index ${place.index}${place.position ? ` · ${place.position}` : ''}${place.component ? ` · component ${place.component}` : ''}`;
  return [
    `- Move ${move.label}: from ${move.from.label} (${ordinal(move.from.index + 1)}) → ${move.to.label} (${ordinal(move.to.index + 1)})`,
    `From: ${at(move.from)}`,
    `To: ${at(move.to)}`,
  ];
}
