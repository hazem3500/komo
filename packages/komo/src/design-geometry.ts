import { previewMessage, changePreviewStyles, inlineStyleSnapshot } from './design-preview.js';
import type { DesignTarget } from './design-target.js';
import { bindMove, moveLines, moveReason, type MoveRecord } from './design-move.js';
import { isMac, shortcutKeys } from './kbd.js';

/** One previewed geometry change, as the proposal and DesignEdit record it. */
export type GeometryChange = {
  mode: 'translate' | 'offset' | 'size' | 'flex-basis' | 'span' | 'structure';
  /** Layout the element sat in, e.g. "flex item, row". */
  layout: string;
  dx?: number; dy?: number;
  property?: string; from?: string; to?: string;
  /** A structural move: the element and its place before and after. */
  move?: MoveRecord;
  effects: string[];
};
type Entry = { element?: DesignTarget; kind?: string; property?: string; geometry?: GeometryChange[] };
type Hooks = {
  signal: AbortSignal;
  options: Pick<import("./design-mode.js").DesignModeOptions, "root" | "bounds" | "host" | "targetAt" | "design" | "reservedKey" | "visibility">;
  selected(): DesignTarget | null;
  select(element: Element): void;
  /** Select what a click at this point would, as Design mode's canvas does. */
  pick(x: number, y: number): void;
  /** The page shows its state without this session's edits (Before, or Design mode suspended). */
  before(): boolean;
  enabled(): boolean;
  remember(element: DesignTarget, property: string): void;
  track(element: DesignTarget, property: string): void;
  tokens(): typeof import('./react-props-panel.js') | null;
  /** The inspector's controls, where the Layout section carries geometry notes. */
  panel(): HTMLElement;
  history: Entry[];
  update(): void;
};

const round = (value: number) => Math.round(value * 100) / 100;
const px = (value: number) => `${round(value)}px`;
const num = (value: string) => parseFloat(value) || 0;
const sum = (css: CSSStyleDeclaration, keys: string[]) => keys.reduce((total, key) => total + num(css.getPropertyValue(key)), 0);
const X = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'];
const Y = ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'];
const REPLACED = 'img,video,canvas,iframe,embed,object';
const FORM = 'input,select,textarea,button';
const BASE = ['flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'max-width', 'max-height', 'min-width', 'min-height'];

const up = (node: Element) => node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
const svgRoot = (element: Element) => element instanceof SVGSVGElement && !element.ownerSVGElement;

/** The parent whose layout places this box; `display: contents` wrappers are skipped. */
function boxParent(element: Element) {
  let node: Element | null = element.assignedSlot ?? up(element);
  while (node && getComputedStyle(node).display === 'contents') node = node.assignedSlot ?? up(node);
  return node;
}

/** Why a box can't be previewed, or null. Each reason names the element's own problem. */
export function geometryReason(element: Element | null): string | null {
  if (!element?.isConnected) return 'Select an element on the page.';
  if (element === document.body || element === document.documentElement) return "The page root can't be moved or resized.";
  if (element instanceof SVGElement && !svgRoot(element)) return "SVG shapes can't be moved or resized. Select the SVG root.";
  if (!(element instanceof HTMLElement) && !svgRoot(element)) return 'Only HTML boxes and SVG roots can be moved or resized.';
  const css = getComputedStyle(element);
  const display = css.display;
  if (display === 'none') return 'display: none has no box';
  if (display === 'contents') return 'display: contents has no box';
  if (display === 'inline' && !svgRoot(element) && !element.matches(`${REPLACED},${FORM}`)) return "Inline text box can't be resized";
  if (display.startsWith('table-')) return 'Table cells and rows size with their table. Select the table.';
  if (/ruby|math/.test(display)) return `display: ${display} boxes can't be moved or resized.`;
  const rects = element.getClientRects().length;
  const box = element.getBoundingClientRect();
  if (!rects || !box.width || !box.height) return 'This element has no rendered box.';
  if (rects > 1) return "Boxes split across lines or columns can't be previewed.";
  for (let node: Element | null = element; node && node !== document.documentElement; node = up(node)) {
    const style = getComputedStyle(node);
    const transform = style.transform && style.transform !== 'none' ? new DOMMatrix(style.transform) : null;
    const scale = !style.scale || style.scale === 'none' ? [1] : style.scale.split(/\s+/).map(Number);
    if ((style.rotate && style.rotate !== 'none') || (transform && (!transform.is2D || transform.b || transform.c || transform.a <= 0 || transform.d <= 0)) ||
        scale.length > 2 || scale.some(value => !(value > 0)))
      return "Rotated, skewed, 3D or mirrored boxes can't be previewed.";
    if (node.getAnimations?.().some(animation => animation.playState === 'running' &&
        (animation.effect as KeyframeEffect | null)?.getKeyframes?.().some(frame => Object.keys(frame).some(key => /transform|translate|scale|rotate|width|height|inset|left|top|right|bottom|flex|grid/i.test(key)))))
      return "Wait for this element's animation to finish.";
  }
  return null;
}

/** The nearest ancestor that can be moved and resized, for "Select parent". */
export function eligibleAncestor(element: Element) {
  for (let node = up(element); node && node !== document.body && node !== document.documentElement; node = up(node))
    if (!geometryReason(node)) return node;
  return null;
}

type Layout = {
  kind: 'flex' | 'grid' | 'flow' | 'positioned';
  label: string; position: string;
  parent: Element | null; parentStyle?: CSSStyleDeclaration;
  /** Flex main axis is horizontal. */
  row?: boolean;
};

function layoutOf(element: DesignTarget): Layout {
  const css = getComputedStyle(element);
  const position = css.position;
  const parent = boxParent(element);
  const parentStyle = parent ? getComputedStyle(parent) : undefined;
  const pinned = position === 'absolute' || position === 'fixed';
  const display = pinned ? '' : parentStyle?.display ?? '';
  const where = position === 'static' ? '' : `, position: ${position}`;
  if (/flex/.test(display)) {
    const row = parentStyle!.flexDirection.startsWith('row') === !parentStyle!.writingMode.startsWith('vertical');
    return { kind: 'flex', row, parent, parentStyle, position, label: `flex item, ${row ? 'row' : 'column'}${where}` };
  }
  if (/grid/.test(display)) return { kind: 'grid', parent, parentStyle, position, label: `grid item${where}` };
  return { kind: position === 'static' ? 'flow' : 'positioned', parent, parentStyle, position, label: position === 'static' ? 'normal flow' : `position: ${position}` };
}

/** Grid track edges along one axis, in the container's local content-box pixels. */
function tracks(container: Element, style: CSSStyleDeclaration, horizontal: boolean) {
  const sizes = (horizontal ? style.gridTemplateColumns : style.gridTemplateRows).split(/\s+/).filter(part => /^[\d.]+px$/.test(part)).map(num);
  const gap = num(horizontal ? style.columnGap : style.rowGap);
  const starts: number[] = [], ends: number[] = [];
  let at = 0;
  for (const size of sizes) { starts.push(at); ends.push(at + size); at += size + gap; }
  const rect = container.getBoundingClientRect();
  const scale = (horizontal ? rect.width / (container as HTMLElement).offsetWidth : rect.height / (container as HTMLElement).offsetHeight) || 1;
  const origin = (horizontal ? rect.left : rect.top) + scale * sum(style, horizontal ? ['padding-left', 'border-left-width'] : ['padding-top', 'border-top-width']);
  return { starts, ends, gap, scale, origin, size: sizes.at(-1) ?? 0 };
}

/** How many tracks from `start` make the span whose end edge is nearest `edge`. */
export function spanFor(starts: number[], ends: number[], gap: number, size: number, start: number, edge: number) {
  const all = [...ends];
  while (size > 0 && all.length < starts.length + 12 && all.at(-1)! + gap / 2 < edge) all.push(all.at(-1)! + gap + size);
  let best = start;
  for (let index = start; index < all.length; index++) if (Math.abs(all[index] - edge) < Math.abs(all[best] - edge)) best = index;
  return best - start + 1;
}

/**
 * The geometry section of a Design proposal. Agents read the mode (translate,
 * offset, size, flex-basis, span), the delta or values, and every side effect.
 */
export function geometryProposal(changes: GeometryChange[]) {
  const { moves, sizes, layout } = net(changes);
  const note = (effects: string[]) => effects.map(effect => ` · ${effect}`).join('');
  const lines = [
    ...moves.flatMap(move => move.move ? moveLines(move.move) : [`- Move (${move.mode}): Δx ${px(move.dx!)}, Δy ${px(move.dy!)}${note(move.effects)}`]),
    ...sizes.map(size => `- Resize (${size.mode}) ${size.property}: ${size.from} → ${size.to}${note(size.effects)}`),
  ];
  return lines.length ? `Proposed geometry changes (preview only)\nLayout: ${layout}\n${lines.join('\n')}` : undefined;
}

/** Net effect of a sequence of gestures: summed moves per mode, and each property's first and last value. */
function net(changes: GeometryChange[]) {
  const moves = new Map<string, GeometryChange>(), sizes = new Map<string, GeometryChange>();
  let layout = '';
  for (const change of changes) {
    layout = change.layout;
    if (change.property) {
      const prior = sizes.get(change.property);
      sizes.delete(change.property);
      sizes.set(change.property, { ...change, from: prior?.from ?? change.from });
    } else if (change.move) {
      // Structural moves net to the first origin and the last destination.
      const prior = moves.get(change.mode);
      moves.set(change.mode, { ...change, move: { ...change.move, from: prior?.move?.from ?? change.move.from } });
    } else {
      const prior = moves.get(change.mode);
      moves.set(change.mode, { ...change, dx: (prior?.dx ?? 0) + change.dx!, dy: (prior?.dy ?? 0) + change.dy!, effects: [...new Set([...prior?.effects ?? [], ...change.effects])] });
    }
  }
  return {
    layout,
    moves: [...moves.values()].filter(({ move, dx, dy }) => move ? move.from.parent !== move.to.parent || move.from.index !== move.to.index : round(dx!) || round(dy!)),
    sizes: [...sizes.values()].filter(size => size.from !== size.to),
  };
}

/** Size facts shared by the handles and a gesture. */
function boxInfo(element: DesignTarget) {
  const css = getComputedStyle(element);
  const border = css.boxSizing === 'border-box';
  const width = num(css.width), height = num(css.height);
  const replaced = svgRoot(element) || element.matches(REPLACED);
  const aspect = css.aspectRatio && css.aspectRatio !== 'auto' ? css.aspectRatio.replace(/^auto\s*/, '') : '';
  // min and max that meet leave the axis nothing to resize.
  const pinned = (axis: string) => /px$/.test(css.getPropertyValue(`max-${axis}`)) && num(css.getPropertyValue(`max-${axis}`)) <= num(css.getPropertyValue(`min-${axis}`));
  const ratio = (replaced || aspect) && height ? width / height : 0;
  const both = !pinned('width') && !pinned('height');
  return { css, border, width, height, replaced, aspect, ratio,
    borderWidth: width + (border ? 0 : sum(css, X)), borderHeight: height + (border ? 0 : sum(css, Y)),
    axes: ratio ? [both, both] : [!pinned('width'), !pinned('height')] };
}

type Line = { at: number; from: number; to: number };
/**
 * Edges a resize can snap to: the parent's content edges and centre, and each sibling's edges
 * across the flow; siblings along it move with the resize, so their edges would be stale.
 */
function snapLines(element: Element, { parent, kind, row }: Layout, sx: number, sy: number) {
  const x: Line[] = [], y: Line[] = [];
  if (!parent) return { x, y };
  const flow = kind === 'flow' || (kind === 'flex' && !row), across = kind !== 'flex' || !row;
  const box = parent.getBoundingClientRect(), style = getComputedStyle(parent);
  const left = box.left + sx * sum(style, ['padding-left', 'border-left-width']), right = box.right - sx * sum(style, ['padding-right', 'border-right-width']);
  const top = box.top + sy * sum(style, ['padding-top', 'border-top-width']), bottom = box.bottom - sy * sum(style, ['padding-bottom', 'border-bottom-width']);
  for (const at of [left, right, (left + right) / 2]) x.push({ at, from: box.top, to: box.bottom });
  // A parent stacking its children grows with them, so only its top edge holds still.
  for (const at of flow ? [top] : [top, bottom, (top + bottom) / 2]) y.push({ at, from: box.left, to: box.right });
  for (const child of [...parent.children].slice(0, 60)) {
    const rect = child.getBoundingClientRect();
    if (child === element || (!rect.width && !rect.height)) continue;
    if (across) x.push({ at: rect.left, from: rect.top, to: rect.bottom }, { at: rect.right, from: rect.top, to: rect.bottom });
    if (!flow) y.push({ at: rect.top, from: rect.left, to: rect.right }, { at: rect.bottom, from: rect.left, to: rect.right });
  }
  return { x, y };
}

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Gesture = {
  element: DesignTarget;
  /** 1 width, 2 height, 3 both. */
  kind: number;
  /** Which way each axis grows: +1 right or down, -1 left or up, from the handle. */
  ex: number; ey: number;
  source: Element; pointer?: number; keyboard?: boolean;
  x: number; y: number; dx: number; dy: number; sx: number; sy: number;
  width: number; height: number; minWidth: number; minHeight: number;
  start: Box; rect: DOMRect; layout: Layout;
  /** Computed values at the start; the live declaration would read the preview back. */
  css: Record<string, string>;
  snap: boolean; ratio: number; ratioText: string; lock: boolean;
  stretch: { width?: string; height?: string };
  grid?: Array<ReturnType<typeof tracks> & { start: number; edge: number; from: string }>;
  lines: { x: Line[]; y: Line[] };
  changes: GeometryChange[];
  before: Map<string, ReturnType<typeof inlineStyleSnapshot>>;
};

const HANDLES = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
// Handles: 7px squares in 12px hit areas reaching 8px outside the box and 4px in; boxes under 24px
// draw none (their edges still drag) and under 40px drop the midpoints. Snap within 4px; show within 12px.
const SQUARE = 7, OUT = 8, IN = 4, TINY = 24, SMALL = 40, SNAP = 4, NEAR = 12;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function bindGeometry(hooks: Hooks) {
  const node = (tag: string, className: string, parent: Element) => parent.appendChild(Object.assign(document.createElement(tag), { className }));
  const surface = document.createElement('div');
  surface.className = 'design-geometry';
  const style = document.createElement('style');
  style.textContent = `.design-geometry{--komo-sel:var(--komo-selection,#0c93f5);position:fixed;inset:0;pointer-events:none;z-index:2}.design-geometry[hidden],.design-geometry [hidden],.design-geometry-note[hidden],.design-geometry-note [hidden]{display:none}.design-geometry:not([data-on])>:not(.design-geometry__live){display:none}.design-outline[data-kind=selected]:has(~.design-geometry[data-on]:not([hidden])){outline:0}:host(.design-active[data-komo-overlays-hidden]) :is(.design-geometry,.design-outline,.pins){visibility:hidden}.design-geometry>*{position:fixed;box-sizing:border-box}.design-geometry__frame{border:1px solid var(--komo-sel);outline:0}.design-geometry__frame:focus-visible{box-shadow:0 0 0 2px color-mix(in oklab,var(--komo-sel) 35%,transparent)}.design-geometry__frame,.design-geometry__handle{transition:opacity .12s ease}.design-geometry__handle{opacity:0;pointer-events:auto;touch-action:none}.design-geometry:is([data-near],[data-active],[data-focus]) .design-geometry__handle{opacity:1}.design-geometry[data-quiet] .design-geometry__handle{opacity:0;pointer-events:none}.design-geometry[data-quiet] .design-geometry__frame{opacity:.4}.design-geometry[data-preview] .design-geometry__frame{opacity:0}.design-geometry__handle::before{content:'';position:absolute;left:var(--x);top:var(--y);width:${SQUARE}px;height:${SQUARE}px;box-sizing:border-box;border-radius:1px;background:#fff;border:1px solid var(--komo-sel);box-shadow:0 1px 2px #0000001f}.design-geometry__handle:hover::before,.design-geometry__handle[data-active]::before{background:var(--komo-sel)}.design-geometry__handle[data-small]::before{display:none}[data-handle=n],[data-handle=s]{cursor:ns-resize}[data-handle=e],[data-handle=w]{cursor:ew-resize}[data-handle=nw],[data-handle=se]{cursor:nwse-resize}[data-handle=ne],[data-handle=sw]{cursor:nesw-resize}.design-geometry__guide{background:var(--komo-selection,#0c93f5)}.design-geometry__readout{translate:-50% 0;padding:2px 6px;border-radius:4px;background:var(--komo-sel);color:#fff;font:500 11px/16px system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 1px 3px #0003}.design-geometry[data-dragging] :is(.design-geometry__handle,.design-geometry__guide){display:none}.design-geometry__line{background:var(--komo-sel);border-radius:1px}.design-geometry__drop{border:2px dashed var(--komo-sel);border-radius:4px}.design-geometry__chip{translate:none}.design-geometry__live{width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media (prefers-reduced-motion:reduce){.design-geometry__frame,.design-geometry__handle{transition:none}}.design-geometry-note{display:grid;gap:8px;padding:0 12px 12px;color:#a19d97;font-size:11px;line-height:1.45}.design-geometry-note p{margin:0}.design-geometry-note div{display:flex;flex-wrap:wrap;gap:6px}.design-geometry-note button{height:24px;padding:0 8px;border-radius:6px;background:#ffffff0f;color:#e9e6e1;font-size:11px}.design-geometry-note button:hover{background:#ffffff1a}.design-geometry-note button[aria-pressed=true]{background:color-mix(in oklab,var(--accent,#bda6ef) 32%,transparent)}.design-inspector__eye{display:grid;place-items:center;flex:none;min-width:28px;height:28px;border-radius:7px;color:#909090}.design-inspector__eye:hover{background:#161616;color:#eee}.design-inspector__eye svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.3}`;
  const frame = node('div', 'design-geometry__frame', surface);
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-roledescription', 'selection');
  const handles = HANDLES.map(name => {
    const handle = node('div', 'design-geometry__handle', surface);
    handle.dataset.handle = name;
    handle.setAttribute('aria-hidden', 'true');
    return { name, handle, ex: name.includes('e') ? 1 : name.includes('w') ? -1 : 0, ey: name.includes('s') ? 1 : name.includes('n') ? -1 : 0 };
  });
  const guides = [node('div', 'design-geometry__guide', surface), node('div', 'design-geometry__guide', surface)];
  const readout = node('div', 'design-geometry__readout', surface);
  readout.setAttribute('aria-hidden', 'true');
  const live = node('p', 'design-geometry__live', surface);
  live.setAttribute('role', 'status');
  // Reasons, side effects and the grid option live in the panel's Layout section, never over the page.
  const note = document.createElement('div');
  note.className = 'design-geometry-note';
  note.title = previewMessage;
  const text = node('p', '', note);
  const tray = node('div', '', note);
  const action = (label: string) => Object.assign(node('button', '', tray), { type: 'button', textContent: label }) as HTMLButtonElement;
  const parent = action('Select parent');
  const snap = action('Snap to grid tracks');
  snap.setAttribute('aria-pressed', 'false');
  snap.title = 'Resize changes grid-column-end / grid-row-end spans instead of width and height';
  hooks.options.root.append(style, surface);
  let gesture: Gesture | undefined;
  let rejected: Element | null = null;
  let snapping = false;
  let axes = [false, false];
  // Where the outline is drawn, the pointer and what it's over, for showing handles only near the selection.
  let outline: { left: number; top: number; right: number; bottom: number } | null = null;
  let point = { x: -1e4, y: -1e4 }, over: EventTarget[] = [], pending = 0;
  let hidden = false, held: { at: number; was: boolean } | undefined;
  // The configured visibility key, e.g. " (⇧H)" on Apple platforms or " (Shift+H)" elsewhere.
  const visibility = hooks.options.visibility;
  const keys = visibility ? ` (${shortcutKeys(visibility).keys.join(isMac() ? '' : '+')})` : '';
  /** A tap toggled the overlays; a hold (over 350ms) peeked, so its release puts them back. */
  // Labels name the shipped keys in the platform's own glyphs: ⌥⇧⌘ on Apple platforms, Alt, Shift and Ctrl elsewhere.
  const command = isMac() ? 'Meta' : 'Control';
  // Modifiers in the order shortcut help shows them: Control, Alt, Shift, Meta.
  const chord = (mods: string[], key: string) => (mods = ['Control', 'Alt', 'Shift', 'Meta'].filter(mod => mods.includes(mod)), isMac())
    ? `${mods.map(mod => ({ Alt: '⌥', Shift: '⇧', Meta: '⌘' } as Record<string, string>)[mod]).join('')}${key.length > 3 ? ' ' : ''}${key}`
    : `${mods.map(mod => mod === 'Control' ? 'Ctrl' : mod).join('+')}+${key}`;
  const release = (at: number) => { if (held && at - held.at > 350) peek(held.was); held = undefined; };
  const eye = Object.assign(document.createElement('button'), { type: 'button', className: 'design-inspector__eye' });
  /** Hide every Design overlay (selection, hover outline, pins and move feedback), or show them again. */
  function peek(on: boolean) {
    hidden = on;
    hooks.options.host.toggleAttribute('data-komo-overlays-hidden', on);
    eye.setAttribute('aria-pressed', String(on));
    eye.setAttribute('aria-label', eye.title = `${on ? 'Show' : 'Hide'} selection${keys}`);
    eye.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>${on ? '<path d="M2.5 13.5l11-11"/>' : ''}</svg>`;
  }
  peek(false);
  // Canvas selection color for outlines, handles, Design mode's hover outline and move feedback; the panel keeps its accent.
  const color = hooks.options.design?.selectionColor;
  if (color) hooks.options.host.style.setProperty('--komo-selection', color);
  eye.addEventListener('click', () => peek(!hidden));
  /**
   * Handles show near the pointer, while resizing or dragging, or with keyboard focus; over the panel,
   * while typing in a field or with the color picker open they step back, and a hover preview drops the outline.
   */
  function state() {
    const root = hooks.options.root, inspector = hooks.panel().closest('.design-inspector'), focused = root.activeElement;
    const popup = root.querySelector('.komo-select:popover-open,.komo-tokens:popover-open');
    const typing = !!focused && !!inspector?.contains(focused) && focused.matches('input,textarea,select,[contenteditable]');
    surface.toggleAttribute('data-quiet', !gesture && (!!popup || typing || !!root.querySelector('.komo-color') || (!!inspector && over.includes(inspector))));
    surface.toggleAttribute('data-preview', !!popup && over.includes(popup));
    surface.toggleAttribute('data-near', !!outline && point.x > outline.left - NEAR && point.x < outline.right + NEAR && point.y > outline.top - NEAR && point.y < outline.bottom + NEAR);
    surface.toggleAttribute('data-active', !!gesture || surface.hasAttribute('data-dragging'));
    surface.toggleAttribute('data-focus', focused === frame);
  }
  const later = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; state(); }); };
  const controller = new AbortController();
  // A later field edit of the same property supersedes a resize: the style rows carry the net value.
  const recorded = (element: DesignTarget) => hooks.history.reduce<GeometryChange[]>((list, entry) => entry.element !== element ? list
    : entry.geometry ? [...list, ...entry.geometry] : entry.property ? list.filter(change => change.property !== entry.property) : list, []);
  const move = bindMove({
    signal: controller.signal, host: hooks.options.host, targetAt: hooks.options.targetAt, history: hooks.history as never,
    selected: hooks.selected, pick: hooks.pick, enabled: hooks.enabled, before: hooks.before,
    remember: hooks.remember, track: hooks.track, update: hooks.update,
    component: element => hooks.tokens()?.designContext(element as DesignTarget, hooks.options.design).find(line => line.startsWith('Component: '))?.slice(11).replace(/ \(.*\)$/, ''),
    layout: element => layoutOf(element).label,
    announce: text => { live.textContent = text; },
    drag(delta) {
      surface.toggleAttribute('data-dragging', !!delta);
      frame.style.translate = delta ? `${delta[0]}px ${delta[1]}px` : '';
    },
  });
  surface.append(...move.nodes);
  const said = (changes: GeometryChange[]) => changes.map(change => `${change.property} ${change.to}`).join(', ');

  function finish(cancel = false) {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    const { element, before } = current;
    const values = new Map([...before.keys()].map(property => [property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]]));
    for (const [property, [value, priority]] of values) if (value === before.get(property)!.value && priority === before.get(property)!.priority) values.delete(property);
    const restore = () => [...before.values()].reverse().forEach(snapshot => snapshot.restore());
    changePreviewStyles(element, before.keys(), restore);
    restore();
    if (!cancel && values.size) {
      const bindings: Array<(() => void) | undefined> = [];
      for (const property of values.keys()) hooks.remember(element, property);
      changePreviewStyles(element, values.keys(), () => {
        for (const [property, [value]] of values) {
          const binding = hooks.tokens()?.noteDesignTokenOverride(element, property, value);
          bindings.push(binding?.undo);
          element.style.setProperty(property, value, binding?.priority ?? before.get(property)!.priority);
          hooks.track(element, property);
        }
      });
      hooks.history.push({ element, geometry: current.changes, undo() {
        changePreviewStyles(element, before.keys(), () => {
          restore();
          bindings.reverse().forEach(undo => undo?.());
          for (const property of before.keys()) { hooks.tokens()?.syncDesignTokenBinding(element, property); hooks.track(element, property); }
        });
        restore();
      } } as Entry);
      live.textContent = `Resized: ${said(current.changes)}`;
    }
    if (current.pointer !== undefined && current.source.hasPointerCapture(current.pointer)) current.source.releasePointerCapture(current.pointer);
    current.source.removeAttribute('data-active');
    readout.hidden = guides[0].hidden = guides[1].hidden = true;
    hooks.update();
    render();
  }

  function start(kind: number, ex: number, ey: number, source: Element, pointer?: PointerEvent) {
    finish(true);
    const element = hooks.selected();
    if (!hooks.enabled() || !element || geometryReason(element) || element === rejected) return;
    const info = boxInfo(element), { css, width, height, borderWidth, borderHeight, border, replaced, aspect, ratio } = info;
    if (!info.axes[kind === 2 ? 1 : 0] || !info.axes[kind === 1 ? 0 : 1]) return;
    const rect = element.getBoundingClientRect();
    const layout = layoutOf(element);
    const snap = snapping && layout.kind === 'grid';
    const stretch: Gesture['stretch'] = {};
    const parentStyle = layout.parentStyle, box = layout.parent?.getBoundingClientRect();
    const resolve = (self: string, items: string) => ['stretch', 'normal'].includes(self === 'auto' ? items : self) && !replaced && !aspect;
    const fills = (horizontal: boolean, extent: number) => Math.abs((horizontal ? rect.width + sum(css, ['margin-left', 'margin-right']) * rect.width / borderWidth : rect.height + sum(css, ['margin-top', 'margin-bottom']) * rect.height / borderHeight) - extent) < 1.5;
    let grid: Gesture['grid'];
    if (layout.kind === 'flex' && box && parentStyle && resolve(css.alignSelf, parentStyle.alignItems)) {
      const scale = layout.row ? rect.height / borderHeight : rect.width / borderWidth;
      const content = layout.row ? box.height - scale * sum(parentStyle, Y) : box.width - scale * sum(parentStyle, X);
      if (fills(!layout.row, content)) stretch[layout.row ? 'height' : 'width'] = 'align-self';
    }
    if (layout.kind === 'grid' && parentStyle) {
      grid = [true, false].map(horizontal => {
        const line = tracks(layout.parent!, parentStyle, horizontal);
        const from = (horizontal ? rect.left : rect.top) - line.origin, to = (horizontal ? rect.right : rect.bottom) - line.origin;
        let start = 0;
        line.starts.forEach((edge, index) => { if (Math.abs(edge * line.scale - from) < Math.abs(line.starts[start] * line.scale - from)) start = index; });
        const end = spanFor(line.starts, line.ends, line.gap, line.size, start, to / line.scale) + start - 1;
        if ((horizontal ? resolve(css.justifySelf, parentStyle.justifyItems) : resolve(css.alignSelf, parentStyle.alignItems)) && line.ends.length &&
            fills(horizontal, ((line.ends[end] ?? line.ends.at(-1)!) - line.starts[start]) * line.scale))
          stretch[horizontal ? 'width' : 'height'] = horizontal ? 'justify-self' : 'align-self';
        return { ...line, start, edge: to / line.scale, from: horizontal ? css.gridColumnEnd : css.gridRowEnd };
      });
    }
    const properties = snap ? ['grid-column-end', 'grid-row-end'] : ['width', 'height', 'flex-basis', 'flex-grow', 'flex-shrink'];
    const sx = rect.width / borderWidth, sy = rect.height / borderHeight;
    gesture = { element, kind, ex, ey, source, pointer: pointer?.pointerId,
      x: pointer?.clientX ?? 0, y: pointer?.clientY ?? 0, dx: 0, dy: 0, sx, sy,
      width, height, start: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      rect, layout, snap, ratio, lock: false, stretch, grid, lines: snapLines(element, layout, sx, sy),
      css: Object.fromEntries(BASE.map(property => [property, css.getPropertyValue(property)])),
      ratioText: aspect || `${round(width)} / ${round(height)}`,
      minWidth: border ? Math.max(16, sum(css, X)) : 16, minHeight: border ? Math.max(16, sum(css, Y)) : 16,
      changes: [], before: new Map(properties.map(property => [property, inlineStyleSnapshot(element, property)])) };
  }

  function span(current: Gesture, dx: number, dy: number, set: (property: string, value: string) => void) {
    current.changes = [];
    for (const horizontal of [true, false]) {
      if (current.kind === (horizontal ? 2 : 1)) continue;
      const line = current.grid![horizontal ? 0 : 1];
      if (!line.ends.length) return false;
      const count = spanFor(line.starts, line.ends, line.gap, line.size, line.start, line.edge + (horizontal ? dx : dy) / line.scale);
      const property = horizontal ? 'grid-column-end' : 'grid-row-end';
      set(property, `span ${count}`);
      current.changes.push({ mode: 'span', layout: current.layout.label, property, from: line.from, to: `span ${count}`,
        effects: [`spans ${count} ${horizontal ? 'column' : 'row'} track${count > 1 ? 's' : ''}`] });
    }
    return true;
  }

  function size(current: Gesture, dx: number, dy: number, set: (property: string, value: string) => void) {
    const { element, kind, layout, css } = current;
    // Shift on a corner keeps the box's own proportions; only a real aspect ratio is a side effect.
    const ratio = current.ratio || (current.lock ? current.width / current.height : 0);
    let width = current.width + dx / current.sx, height = current.height + dy / current.sy;
    if (ratio) {
      if (kind === 1 || (kind === 3 && Math.abs(dx / current.sx) / current.width >= Math.abs(dy / current.sy) / current.height)) height = width / ratio;
      else width = height * ratio;
      const floor = Math.max(1, current.minWidth / width, current.minHeight / height);
      width *= floor; height *= floor;
    } else { width = Math.max(current.minWidth, width); height = Math.max(current.minHeight, height); }
    const wanted = new Map<string, number>([...(ratio || kind !== 2 ? [['width', width]] : []), ...(ratio || kind !== 1 ? [['height', height]] : [])] as Array<[string, number]>);
    const effects = new Map<string, string[]>([...wanted.keys()].map(property => [property, []]));
    const main = layout.kind === 'flex' && layout.position !== 'absolute' && layout.position !== 'fixed' ? (layout.row ? 'width' : 'height') : '';
    const basis = !!main && wanted.has(main) && css['flex-basis'] !== 'auto';
    const grow = css['flex-grow'] !== '0';
    for (const [property, value] of wanted) set(property, px(value));
    if (main && wanted.has(main)) {
      const notes = effects.get(main)!;
      if (basis || grow) notes.push(`${main} overrides flex: ${css.flex || `${css['flex-grow']} ${css['flex-shrink']} ${css['flex-basis']}`}`);
      if (basis) { set('flex-basis', px(wanted.get(main)!)); notes.push(`sets flex-basis: ${px(wanted.get(main)!)}`); }
      if (grow) { set('flex-grow', '0'); notes.push('sets flex-grow: 0'); }
      if (num(getComputedStyle(element).getPropertyValue(main)) < wanted.get(main)! - 0.5 && css['flex-shrink'] !== '0') {
        set('flex-shrink', '0'); notes.push('sets flex-shrink: 0');
      }
    }
    for (const [property, value] of wanted) {
      const notes = effects.get(property)!;
      const used = num(getComputedStyle(element).getPropertyValue(property));
      if (current.stretch[property as 'width']) notes.push(`${property} overrides ${current.stretch[property as 'width']}: stretch`);
      if (current.ratio && notes.length < 9 && property === (kind === 2 ? 'height' : 'width')) notes.push(`keeps aspect ratio ${current.ratioText}`);
      if (Math.abs(used - value) > 0.5) {
        const limit = css[`${used < value ? 'max' : 'min'}-${property}`];
        notes.push(used < value ? `limited by ${limit !== 'none' ? `max-${property}: ${limit}` : 'its container'}` : `held at ${!['auto', '0px'].includes(limit) ? `min-${property}: ${limit}` : 'its content size'}`);
        wanted.set(property, used);
        set(property, px(used));
        if (property === main && basis) set('flex-basis', px(used));
      }
    }
    current.changes = [...wanted].map(([property, value]) => ({
      mode: property === main && basis ? 'flex-basis' : 'size', layout: layout.label, property,
      from: px(property === 'width' ? current.width : current.height), to: px(value), effects: effects.get(property)!,
    }));
    return true;
  }

  /** Preview a pointer or keyboard delta in screen pixels; `free` skips snapping (Alt, keys). */
  function apply(dx: number, dy: number, free = true) {
    const current = gesture;
    if (!current) return;
    if (!hooks.enabled() || hooks.selected() !== current.element || geometryReason(current.element)) { finish(true); return; }
    const { element, before, start, kind } = current;
    const run = (x: number, y: number) => {
      current.dx = x; current.dy = y;
      let ok = true;
      changePreviewStyles(element, before.keys(), () => {
        const set = (property: string, value: string) => element.style.setProperty(property, value, before.get(property)!.priority);
        // Each step starts from the host's values, so an earlier step's side effect can't linger.
        for (const [property, snapshot] of before) element.style.setProperty(property, snapshot.value, snapshot.priority);
        ok = (current.snap ? span : size)(current, x * current.ex, y * current.ey, set);
      });
      return ok;
    };
    if (!run(dx, dy)) {
      rejected = element;
      finish(true);
      return;
    }
    let rect = element.getBoundingClientRect();
    // Layout decides which edge moves; snap whichever did, then measure again.
    const edges = (horizontal: boolean): Array<[number, number]> => horizontal
      ? [[rect.left, rect.left - start.left], [rect.right, rect.right - start.right]]
      : [[rect.top, rect.top - start.top], [rect.bottom, rect.bottom - start.bottom]];
    const snapping = !free && !current.snap;
    const correction = (horizontal: boolean) => {
      const grown = horizontal ? rect.width - start.width : rect.height - start.height;
      let best = 0, gap = SNAP;
      if (snapping && kind & (horizontal ? 1 : 2) && Math.abs(grown) > 0.5)
        // Only an edge that carries the resize; a transform's drift on the far edge would amplify.
        for (const [edge, moved] of edges(horizontal)) if (Math.abs(moved) > 0.5 && Math.abs(moved) >= Math.abs(grown) / 3)
          for (const line of current.lines[horizontal ? 'x' : 'y'])
            if (Math.abs(line.at - edge) <= gap) { gap = Math.abs(line.at - edge); best = (line.at - edge) * grown / moved; }
      return best;
    };
    const cx = correction(true), cy = correction(false);
    if (cx || cy) {
      run(dx + cx * current.ex, dy + cy * current.ey);
      rect = element.getBoundingClientRect();
    }
    guides.forEach((guide, index) => {
      const horizontal = !index;
      guide.hidden = true;
      if (snapping && kind & (horizontal ? 1 : 2)) for (const [edge, moved] of edges(horizontal)) {
        const line = Math.abs(moved) > 0.5 && Math.abs(moved) >= Math.abs(horizontal ? rect.width - start.width : rect.height - start.height) / 3 && current.lines[horizontal ? 'x' : 'y'].find(line => Math.abs(line.at - edge) < 0.75);
        if (!line) continue;
        const from = Math.min(line.from, horizontal ? rect.top : rect.left), to = Math.max(line.to, horizontal ? rect.bottom : rect.right);
        guide.hidden = false;
        Object.assign(guide.style, horizontal ? { left: px(line.at), top: px(from), width: '1px', height: px(to - from) } : { left: px(from), top: px(line.at), width: px(to - from), height: '1px' });
      }
    });
    current.rect = rect;
    readout.textContent = `${Math.round(rect.width / current.sx)} × ${Math.round(rect.height / current.sy)}`;
    readout.hidden = false;
    render();
  }

  function render() {
    move.sync();
    const element = hooks.selected();
    const visible = hooks.enabled() && !!element?.isConnected;
    surface.hidden = !visible;
    surface.removeAttribute('data-on');
    outline = null;
    // The panel note stays while the canvas is undecorated, so its own buttons stay clickable.
    note.hidden = !element?.isConnected;
    if (!visible) finish(true);
    if (!element?.isConnected) return;
    if (element !== rejected) rejected = null;
    // A moved element shows through its stand-in: outline it there, without resize handles.
    const box = move.shown(element), moved = box !== element;    const reason = moved ? null : geometryReason(element) ?? (rejected ? "Host styles override this preview. Select the parent or another element." : null);
    const still = moveReason(element, box);
    if ((reason || moved) && gesture) finish(true);
    const panel = hooks.panel();
    const home = [...panel.querySelectorAll('.design-section')].find(section => section.querySelector('summary')?.textContent === 'Layout') ?? panel;
    if (note.parentElement !== home) home.append(note);
    const ancestor = reason || still ? eligibleAncestor(element) : null;
    parent.hidden = !ancestor;
    if (ancestor) parent.setAttribute('aria-label', `Select movable parent ${ancestor.tagName.toLowerCase()}`);
    snap.hidden = !!reason || moved || layoutOf(element).kind !== 'grid';
    snap.setAttribute('aria-pressed', String(snapping));
    const { moves, sizes } = net(recorded(element));
    const done = moves.flatMap(change => change.move ? [moveLines(change.move)[0].slice(2)] : []);
    let seen = true;
    try { seen = !!localStorage.getItem('komo:geometry-moved'); } catch { /* No hint without storage. */ }
    text.textContent = [reason, still].filter(Boolean).join(' · ') || [...new Set([...done, ...[...gesture?.changes ?? [], ...moves, ...sizes].flatMap(change => change.effects)])].join(' · ')
      || (seen || moved ? '' : 'Drag to reorder · M, then ⌥↑/⌥↓');
    const heading = panel.closest('.design-inspector')?.querySelector('.design-inspector__heading');
    if (heading && eye.parentElement !== heading) heading.querySelector('.design-inspector__fold')?.before(eye);
    text.hidden = !text.textContent;
    note.hidden = text.hidden && parent.hidden && snap.hidden;
    const rect = box.getBoundingClientRect();
    const bounds = hooks.options.bounds?.(box) ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if ((reason && still) || !visible || rect.right <= bounds.left || rect.left >= bounds.right || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return;
    surface.setAttribute('data-on', '');
    const info = boxInfo(element);
    axes = reason || moved ? [false, false] : info.axes;
    const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`;
    frame.setAttribute('aria-label', `${still ? 'Resize' : 'Move or resize'} ${label}: ${still ? '' : `${chord(['Alt'], '↑/↓')} move, ${chord(['Alt', 'Shift'], '↑/↓')} move out or into, `}${chord([command], 'arrows')} resize, ${chord(['Shift', command], 'arrows')} by 10px`);
    // The outline sits on the border box in whole device pixels; each square centres on its 1px line.
    const dpr = devicePixelRatio || 1, whole = (value: number) => Math.round(value * dpr) / dpr;
    const left = whole(rect.left), top = whole(rect.top), right = whole(rect.right), bottom = whole(rect.bottom);
    outline = { left, top, right, bottom };
    // On a background close to the selection color, the selection turns magenta so it stays visible.
    const rgb = (node: Element, property: 'backgroundColor') => getComputedStyle(node)[property].match(/[\d.]+/g)?.map(Number) ?? [];
    const [own, mark] = [rgb(box, 'backgroundColor'), rgb(guides[0], 'backgroundColor')];
    surface.style.setProperty('--komo-sel', own.length > 2 && (own[3] ?? 1) > 0.5 && Math.hypot(own[0] - mark[0], own[1] - mark[1], own[2] - mark[2]) < 90 ? '#e5359b' : '');
    Object.assign(frame.style, {
      left: px(left), top: px(top), width: px(right - left), height: px(bottom - top),
      clipPath: `inset(${[bounds.top - top, right - bounds.right, bottom - bounds.bottom, bounds.left - left].map(value => px(Math.max(0, value))).join(' ')})`,
    });
    // Hit areas reach outward so the body stays draggable; boxes under 24px draw no squares at all.
    const tiny = right - left < TINY || bottom - top < TINY, inward = tiny ? 0 : IN, reach = OUT + IN - inward;
    const corners = axes[0] && axes[1];
    const line = (low: number, high: number, side: number) => side < 0 ? low + 0.5 : side > 0 ? high - 0.5 : whole((low + high) / 2) + 0.5;
    const span = (low: number, high: number, side: number): [number, number] => side < 0 ? [low - reach, low + inward] : side > 0 ? [high - inward, high + reach]
      : high - low - 2 * inward >= OUT + IN ? [low + inward, high - inward] : [(low + high - OUT - IN) / 2, (low + high + OUT + IN) / 2];
    for (const { handle, ex, ey } of handles) {
      const x = line(left, right, ex), y = line(top, bottom, ey);
      const edge = !ex || !ey;
      const [x0, x1] = span(left, right, ex), [y0, y1] = span(top, bottom, ey);
      handle.hidden = (edge ? !axes[ex ? 0 : 1] || !!info.ratio : !corners) || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
      handle.toggleAttribute('data-small', tiny || (edge && corners && (ex ? bottom - top : right - left) < SMALL));
      Object.assign(handle.style, { left: px(x0), top: px(y0), width: px(x1 - x0), height: px(y1 - y0) });
      handle.style.setProperty('--x', px(x - SQUARE / 2 - x0));
      handle.style.setProperty('--y', px(y - SQUARE / 2 - y0));
    }
    // The size chip sits below the box, clear of the squares, or above it at the bottom edge.
    const below = bottom + SQUARE + 30 < bounds.bottom;
    Object.assign(readout.style, { left: px(Math.max(bounds.left + 40, Math.min(bounds.right - 40, (left + right) / 2))), top: px(below ? bottom + SQUARE + 4 : top - SQUARE - 24) });
    state();
  }

  parent.addEventListener('click', () => {
    const element = hooks.selected();
    const ancestor = element && eligibleAncestor(element);
    if (ancestor) hooks.select(ancestor);
  });
  snap.addEventListener('click', () => { finish(true); snapping = !snapping; render(); });
  for (const { handle, ex, ey } of handles) {
    const kind = (ex ? 1 : 0) + (ey ? 2 : 0);
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      start(kind, ex, ey, handle, event);
      handle.toggleAttribute('data-active', !!gesture);
      state();
      if (gesture) handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (gesture?.pointer !== event.pointerId) return;
      gesture.lock = event.shiftKey && kind === 3;
      apply(event.clientX - gesture.x, event.clientY - gesture.y, event.altKey);
    });
    handle.addEventListener('pointerup', () => finish());
    handle.addEventListener('pointercancel', () => finish(true));
    handle.addEventListener('lostpointercapture', () => finish(true));
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  }
  frame.addEventListener('blur', () => { if (gesture?.keyboard) finish(); });
  // Capture before Design mode's document handler. On the canvas, M focuses the selection; there,
  // Alt + arrows move it between elements and Ctrl or ⌘ + arrows resize it from the bottom-right
  // (Shift for 10px), and Escape returns to the canvas. On the canvas, arrows keep selecting.
  window.addEventListener('keydown', event => {
    const arrow = ARROWS[event.key], path = event.composedPath(), focused = path[0] === frame;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const typing = path.some(node => node instanceof Element && node.matches('input,textarea,select,[contenteditable]:not([contenteditable=false])'));
    // In Design mode the comments visibility key hides the overlays: a tap toggles, a hold peeks.
    const key = visibility;
    if (key && !typing && hooks.options.host.classList.contains('design-active') && event.key.toLowerCase() === key.key
        && event.shiftKey === key.shift && event.altKey === key.alt && event.ctrlKey === key.ctrl && event.metaKey === key.meta) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) { held = { at: event.timeStamp, was: hidden }; peek(!hidden); }
      return;
    }
    const element = hooks.selected();
    let run: (() => void) | undefined;
    if (!gesture && focused && event.key === 'Escape') run = () => frame.blur();
    else if (plain && event.key.toLowerCase() === 'm' && !focused && !typing && !path.includes(hooks.options.host) && surface.hasAttribute('data-on') && !hooks.options.reservedKey?.(event))
      run = () => frame.focus({ preventScroll: true });
    else if (focused && arrow && element && event.altKey && !event.ctrlKey && !event.metaKey && !gesture)
      run = () => move.key(element, arrow[0] + arrow[1] > 0, event.shiftKey);
    if (run) { event.preventDefault(); event.stopImmediatePropagation(); run(); return; }
    if (!(event.key === 'Escape' && gesture) && (!focused || !arrow || !(event.ctrlKey || event.metaKey) || event.altKey)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!arrow) return finish(true);
    const kind = arrow[0] ? 1 : 2;
    if (gesture && gesture.kind !== kind) finish();
    if (!gesture && axes[kind - 1]) start(kind, 1, 1, frame);
    if (!gesture) return;
    gesture.keyboard = true;
    const line = gesture.grid?.[kind - 1];
    // Snapping steps one track; otherwise one local CSS pixel, or ten with Shift.
    const step = gesture.snap ? (line!.size + line!.gap) * line!.scale : (event.shiftKey ? 10 : 1) * (kind === 1 ? gesture.sx : gesture.sy);
    apply(gesture.dx + arrow[0] * step, gesture.dy + arrow[1] * step);
  }, { capture: true, signal: controller.signal });
  // macOS sends no arrow keyup while ⌘ is held, so releasing the modifier also commits.
  window.addEventListener('keyup', event => {
    // Releasing the letter or any of the combo's modifiers ends a hold; macOS sends no letter keyup while ⌘ is down.
    if (held && visibility && (event.key.toLowerCase() === visibility.key || (({ Shift: visibility.shift, Alt: visibility.alt, Control: visibility.ctrl, Meta: visibility.meta }) as Record<string, boolean>)[event.key]))
      release(event.timeStamp);
    if (gesture?.keyboard && /^(Arrow|Control|Meta)/.test(event.key)) finish();
  }, { capture: true, signal: controller.signal });
  window.addEventListener('scroll', () => {
    if (gesture?.pointer !== undefined) {
      const rect = gesture.element.getBoundingClientRect();
      const shiftX = rect.left - gesture.rect.left, shiftY = rect.top - gesture.rect.top;
      gesture.x += shiftX; gesture.y += shiftY;
      for (const key of ['left', 'right'] as const) gesture.start[key] += shiftX;
      for (const key of ['top', 'bottom'] as const) gesture.start[key] += shiftY;
      for (const line of gesture.lines.x) { line.at += shiftX; line.from += shiftY; line.to += shiftY; }
      for (const line of gesture.lines.y) { line.at += shiftY; line.from += shiftX; line.to += shiftX; }
      apply(gesture.dx - shiftX, gesture.dy - shiftY);
    }
    render();
  }, { capture: true, passive: true, signal: controller.signal });
  window.addEventListener('pointermove', event => { point = { x: event.clientX, y: event.clientY }; over = event.composedPath(); later(); }, { capture: true, passive: true, signal: controller.signal });
  for (const type of ['focusin', 'focusout']) window.addEventListener(type, later, { capture: true, signal: controller.signal });
  // Focus leaving mid-hold never delivers the keyup, so it ends the peek too.
  window.addEventListener('blur', () => release(Infinity), { signal: controller.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(Infinity); }, { signal: controller.signal });
  readout.hidden = guides[0].hidden = guides[1].hidden = true;
  render();
  hooks.signal.addEventListener('abort', () => { finish(true); controller.abort(); cancelAnimationFrame(pending); peek(false); surface.remove(); style.remove(); note.remove(); eye.remove(); }, { once: true });
  return {
    render, cancel: () => finish(true),
    /** The geometry section for this element's proposal, from the gestures still in history. */
    proposal: (element: DesignTarget) => { move.detach(); return geometryProposal(recorded(element)); },
    /** True while a structural move hides the element; its `display` row is not a style proposal. */
    moved: (element: DesignTarget) => recorded(element).some(change => change.move),
  };
}
