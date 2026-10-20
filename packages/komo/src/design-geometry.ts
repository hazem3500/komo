import { previewMessage, changePreviewStyles, inlineStyleSnapshot } from './design-preview.js';
import type { DesignTarget } from './design-target.js';

/** One previewed geometry change, as the proposal and DesignEdit record it. */
export type GeometryChange = {
  mode: 'translate' | 'offset' | 'size' | 'flex-basis' | 'span';
  /** Layout the element sat in, e.g. "flex item, row". */
  layout: string;
  dx?: number; dy?: number;
  property?: string; from?: string; to?: string;
  effects: string[];
};
type Entry = { element: DesignTarget; kind?: string; geometry?: GeometryChange[] };
type Hooks = {
  signal: AbortSignal;
  options: Pick<import("./design-mode.js").DesignModeOptions, "root" | "bounds">;
  selected(): DesignTarget | null;
  select(element: Element): void;
  enabled(): boolean;
  remember(element: DesignTarget, property: string): void;
  track(element: DesignTarget, property: string): void;
  tokens(): typeof import('./react-props-panel.js') | null;
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
const BASE = ['flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'direction', 'top', 'left', 'right', 'max-width', 'max-height', 'min-width', 'min-height'];

const up = (node: Element) => node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
const svgRoot = (element: Element) => element instanceof SVGSVGElement && !element.ownerSVGElement;

/** The parent whose layout places this box; `display: contents` wrappers are skipped. */
function boxParent(element: Element) {
  let node: Element | null = element.assignedSlot ?? up(element);
  while (node && getComputedStyle(node).display === 'contents') node = node.assignedSlot ?? up(node);
  return node;
}

/** Top-level, whitespace-separated parts of a CSS value: "calc(5% + 3px) 8px" → two parts. */
function parts(value: string) {
  const found: string[] = [];
  let depth = 0, current = '';
  for (const character of value.trim()) {
    if (character === '(') depth++;
    else if (character === ')') depth--;
    if (/\s/.test(character) && !depth) { if (current) found.push(current); current = ''; }
    else current += character;
  }
  if (current) found.push(current);
  return found;
}

/** Add a pixel delta to the host's own translate, keeping its units and any z part. */
export function composeTranslate(host: string, dx: number, dy: number) {
  const [x = '0px', y = '0px', z] = !host || host === 'none' ? [] : parts(host);
  const add = (value: string, delta: number) => !round(delta) ? value : /^-?[\d.]+(?:e-?\d+)?px$/.test(value) ? px(num(value) + delta)
    : `calc(${value} ${delta < 0 ? '-' : '+'} ${px(Math.abs(delta))})`;
  return [add(x, dx), add(y, dy), ...(z ? [z] : [])].join(' ');
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
    ...moves.map(move => `- Move (${move.mode}): Δx ${px(move.dx!)}, Δy ${px(move.dy!)}${note(move.effects)}`),
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
    } else {
      const prior = moves.get(change.mode);
      moves.set(change.mode, { ...change, dx: (prior?.dx ?? 0) + change.dx!, dy: (prior?.dy ?? 0) + change.dy!, effects: [...new Set([...prior?.effects ?? [], ...change.effects])] });
    }
  }
  return {
    layout,
    moves: [...moves.values()].filter(move => round(move.dx!) || round(move.dy!)),
    sizes: [...sizes.values()].filter(size => size.from !== size.to),
  };
}

type Gesture = {
  element: DesignTarget; kind: number; button: HTMLButtonElement; pointer?: number;
  x: number; y: number; dx: number; dy: number; sx: number; sy: number;
  width: number; height: number; minWidth: number; minHeight: number;
  host: string; rect: DOMRect; origin: { left: number; top: number }; layout: Layout;
  /** Computed values at the start; the live declaration would read the preview back. */
  css: Record<string, string>;
  offset: boolean; snap: boolean; ratio: number; ratioText: string;
  stretch: { width?: string; height?: string };
  grid?: Array<ReturnType<typeof tracks> & { start: number; edge: number; from: string }>;
  changes: GeometryChange[];
  before: Map<string, ReturnType<typeof inlineStyleSnapshot>>;
};

export function bindGeometry(hooks: Hooks) {
  const surface = document.createElement('div');
  surface.className = 'design-geometry';
  surface.title = previewMessage;
  const style = document.createElement('style');
  style.textContent = `.design-geometry{position:fixed;inset:0;pointer-events:none;z-index:4}.design-geometry[hidden],.design-geometry [hidden]{display:none}.design-geometry button{position:fixed;pointer-events:auto;touch-action:none;min-width:28px;min-height:28px;padding:4px 8px;background:#fff;color:#25233a;border:1px solid #7151c8;border-radius:6px;font:12px system-ui;box-shadow:0 2px 6px #0002}.design-geometry button:focus-visible{outline:3px solid #7151c8;outline-offset:3px}.design-geometry button[aria-pressed=true]{background:#e9dfff}.design-geometry div{position:fixed;display:flex;flex-wrap:wrap;align-items:center;gap:4px;max-width:320px}.design-geometry div button{position:static}.design-geometry p{margin:0;padding:6px 8px;border-radius:6px;background:#25233a;color:#fff;font:12px system-ui}`;
  const tray = document.createElement('div');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const action = (label: string) => Object.assign(document.createElement('button'), { type: 'button', textContent: label });
  const parent = action('Select parent');
  const snap = action('Snap to grid tracks');
  snap.setAttribute('aria-pressed', 'false');
  snap.title = 'Resize changes grid-column-end / grid-row-end spans instead of width and height';
  tray.append(message, parent, snap);
  const kinds = ['Move', 'Resize width', 'Resize height', 'Resize width and height'];
  const buttons = kinds.map(label => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label === 'Move' ? label : label === 'Resize width' ? '↔' : label === 'Resize height' ? '↕' : '↘';
    button.setAttribute('aria-label', label);
    button.title = `${label}: drag, or Enter to arm, arrows to adjust, Enter to commit, Escape to cancel`;
    surface.append(button);
    return button;
  });
  surface.append(tray);
  hooks.options.root.append(style, surface);
  let gesture: Gesture | undefined;
  let rejected: Element | null = null;
  let snapping = false;
  const controller = new AbortController();
  const recorded = (element: DesignTarget) => hooks.history.flatMap(entry => entry.element === element ? entry.geometry ?? [] : []);

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
    }
    current.button.setAttribute('aria-pressed', 'false');
    if (current.pointer !== undefined && current.button.hasPointerCapture(current.pointer)) current.button.releasePointerCapture(current.pointer);
    hooks.update();
    render();
  }

  function start(kind: number, pointer?: PointerEvent) {
    finish(true);
    const element = hooks.selected();
    if (!hooks.enabled() || !element || geometryReason(element) || element === rejected) return;
    const css = getComputedStyle(element), rect = element.getBoundingClientRect();
    const layout = layoutOf(element);
    const matrix = css.transform && css.transform !== 'none' ? new DOMMatrix(css.transform) : new DOMMatrix();
    const scales = !css.scale || css.scale === 'none' ? [1, 1] : css.scale.split(/\s+/).map(Number);
    const border = css.boxSizing === 'border-box';
    const width = num(css.width), height = num(css.height);
    const borderWidth = width + (border ? 0 : sum(css, X)), borderHeight = height + (border ? 0 : sum(css, Y));
    const replaced = svgRoot(element) || element.matches(REPLACED);
    const aspect = css.aspectRatio && css.aspectRatio !== 'auto' ? css.aspectRatio.replace(/^auto\s*/, '') : '';
    const ratio = (replaced || aspect) && height ? width / height : 0;
    const snap = kind > 0 && snapping && layout.kind === 'grid';
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
    const properties = !kind ? ['translate', 'left', 'right', 'top']
      : snap ? ['grid-column-end', 'grid-row-end'] : ['width', 'height', 'flex-basis', 'flex-grow', 'flex-shrink'];
    gesture = { element, kind, button: buttons[kind], pointer: pointer?.pointerId,
      x: pointer?.clientX ?? 0, y: pointer?.clientY ?? 0, dx: 0, dy: 0,
      sx: rect.width / borderWidth / (kind ? 1 : matrix.a * scales[0]),
      sy: rect.height / borderHeight / (kind ? 1 : matrix.d * (scales[1] ?? scales[0])),
      width, height, host: css.translate, rect, origin: { left: rect.left, top: rect.top }, layout, offset: false, snap, ratio, stretch, grid,
      css: Object.fromEntries(BASE.map(property => [property, css.getPropertyValue(property)])),
      ratioText: aspect || `${round(width)} / ${round(height)}`,
      minWidth: border ? Math.max(16, sum(css, X)) : 16, minHeight: border ? Math.max(16, sum(css, Y)) : 16,
      changes: [], before: new Map(properties.map(property => [property, inlineStyleSnapshot(element, property)])) };
    buttons[kind].setAttribute('aria-pressed', 'true');
    message.textContent = 'Armed · arrows adjust · Enter commits · Escape cancels';
    if (pointer) buttons[kind].setPointerCapture(pointer.pointerId);
  }

  function move(current: Gesture, dx: number, dy: number, set: (property: string, value: string) => void) {
    const { element, css, layout, origin, sx, sy } = current;
    const local = [dx / sx, dy / sy];
    const landed = () => {
      const moved = element.getBoundingClientRect();
      return Math.abs(moved.left - origin.left - dx) < 1.5 && Math.abs(moved.top - origin.top - dy) < 1.5;
    };
    if (!current.offset) {
      set('translate', composeTranslate(current.host, local[0], local[1]));
      if (landed()) {
        current.changes = [{ mode: 'translate', layout: layout.label, dx: local[0], dy: local[1], effects: [] }];
        return true;
      }
      // A host rule beats inline translate; relative offsets still move the box without reflow.
      if (layout.position !== 'relative') return false;
      set('translate', current.before.get('translate')!.value);
      current.offset = true;
    }
    const rtl = css.direction === 'rtl';
    const side = rtl ? 'right' : 'left';
    set(side, px(num(css[side]) + (rtl ? -local[0] : local[0])));
    set('top', px(num(css.top) + local[1]));
    current.changes = [{ mode: 'offset', layout: layout.label, dx: local[0], dy: local[1], effects: [`host styles override translate; moves with ${side}/top offsets`] }];
    return landed();
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
    const { element, kind, layout, css, ratio } = current;
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
      if (ratio && notes.length < 9 && property === (kind === 2 ? 'height' : 'width')) notes.push(`keeps aspect ratio ${current.ratioText}`);
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

  function apply(dx: number, dy: number) {
    const current = gesture;
    if (!current) return;
    if (!hooks.enabled() || hooks.selected() !== current.element || geometryReason(current.element)) { finish(true); return; }
    current.dx = dx; current.dy = dy;
    const { element, kind, before } = current;
    let ok = true;
    changePreviewStyles(element, before.keys(), () => {
      const set = (property: string, value: string) => element.style.setProperty(property, value, before.get(property)!.priority);
      // Each step starts from the host's values, so an earlier step's side effect can't linger.
      for (const [property, snapshot] of before) element.style.setProperty(property, snapshot.value, snapshot.priority);
      ok = !kind ? move(current, dx, dy, set) : current.snap ? span(current, dx, dy, set) : size(current, dx, dy, set);
    });
    if (!ok) {
      rejected = element;
      finish(true);
      return;
    }
    message.textContent = current.changes.map(change => change.property
      ? [`${change.property} ${change.to}`, ...change.effects].join(' · ')
      : [`Δx ${px(change.dx!)} Δy ${px(change.dy!)}`, ...change.effects].join(' · ')).join(' · ');
    current.rect = element.getBoundingClientRect();
    render();
  }

  function render() {
    const element = hooks.selected();
    const visible = hooks.enabled() && !!element?.isConnected;
    surface.hidden = !visible;
    if (!visible) { finish(true); return; }
    if (element !== rejected) rejected = null;
    const reason = geometryReason(element) ?? (rejected ? "Host styles override this preview. Select the parent or another element." : null);
    if (reason && gesture) finish(true);
    const rect = element!.getBoundingClientRect();
    const bounds = hooks.options.bounds?.(element!) ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const area = rect.width || rect.height ? rect : (element!.firstElementChild ?? up(element!) ?? element!).getBoundingClientRect();
    if (area.right <= bounds.left || area.left >= bounds.right || area.bottom <= bounds.top || area.top >= bounds.bottom) {
      surface.hidden = true;
      return;
    }
    const place = (node: HTMLElement, x: number, y: number) => Object.assign(node.style, {
      left: `${Math.max(bounds.left + 4, Math.min(bounds.right - Math.max(node.offsetWidth, 30) - 4, x))}px`,
      top: `${Math.max(bounds.top + 4, Math.min(bounds.bottom - Math.max(node.offsetHeight, 30) - 4, y))}px`,
    });
    buttons.forEach((button, kind) => {
      button.hidden = !!reason;
      place(button, kind === 0 ? rect.left : kind === 2 ? rect.left + rect.width / 2 : rect.right - 14,
        kind === 0 ? rect.top - 34 : kind === 1 ? rect.top + rect.height / 2 : rect.bottom - 14);
    });
    const ancestor = reason ? eligibleAncestor(element!) : null;
    parent.hidden = !ancestor;
    if (ancestor) parent.setAttribute('aria-label', `Select movable parent ${ancestor.tagName.toLowerCase()}`);
    snap.hidden = !!reason || layoutOf(element!).kind !== 'grid';
    snap.setAttribute('aria-pressed', String(snapping));
    const { moves, sizes } = net(recorded(element!));
    const effects = [...new Set([...moves, ...sizes].flatMap(change => change.effects))];
    if (reason) message.textContent = reason;
    else if (!gesture) message.textContent = effects.join(' · ');
    message.hidden = !message.textContent;
    tray.hidden = message.hidden && parent.hidden && snap.hidden;
    place(tray, area.left, area.top - 38 - tray.offsetHeight);
  }

  parent.addEventListener('click', () => {
    const element = hooks.selected();
    const ancestor = element && eligibleAncestor(element);
    if (ancestor) hooks.select(ancestor);
  });
  snap.addEventListener('click', () => { finish(true); snapping = !snapping; render(); });
  buttons.forEach((button, kind) => {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); button.focus({ preventScroll: true }); start(kind, event);
    });
    button.addEventListener('pointermove', event => {
      if (gesture?.pointer !== event.pointerId) return;
      apply(event.clientX - gesture.x, event.clientY - gesture.y);
    });
    button.addEventListener('pointerup', () => finish());
    button.addEventListener('pointercancel', () => finish(true));
    button.addEventListener('lostpointercapture', () => finish(true));
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener('blur', () => finish(true));
  });
  // Capture before Design mode's document handler, but only own handle commands.
  window.addEventListener('keydown', event => {
    const kind = buttons.indexOf(event.composedPath()[0] as HTMLButtonElement);
    if (kind < 0 || !['Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') finish(true);
    else if (event.key === 'Enter' || event.key === ' ') { if (gesture) finish(); else start(kind); }
    else if (gesture) {
      // Snapping steps one track; otherwise one local CSS pixel, or ten with Shift.
      const step = (horizontal: boolean) => gesture!.snap ? (gesture!.grid![horizontal ? 0 : 1].size + gesture!.grid![horizontal ? 0 : 1].gap) * gesture!.grid![horizontal ? 0 : 1].scale
        : (event.shiftKey ? 10 : 1) * (horizontal ? gesture!.sx : gesture!.sy);
      apply(gesture.dx + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * step(true),
        gesture.dy + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) * step(false));
    }
  }, { capture: true, signal: controller.signal });
  window.addEventListener('scroll', () => {
    if (gesture?.pointer !== undefined) {
      const rect = gesture.element.getBoundingClientRect();
      const shiftX = rect.left - gesture.rect.left, shiftY = rect.top - gesture.rect.top;
      gesture.x += shiftX; gesture.y += shiftY;
      gesture.origin.left += shiftX; gesture.origin.top += shiftY;
      apply(gesture.dx - shiftX, gesture.dy - shiftY);
    }
    render();
  }, { capture: true, passive: true, signal: controller.signal });
  render();
  hooks.signal.addEventListener('abort', () => { finish(true); controller.abort(); surface.remove(); style.remove(); }, { once: true });
  return {
    render, cancel: () => finish(true),
    /** The geometry section for this element's proposal, from the gestures still in history. */
    proposal: (element: DesignTarget) => geometryProposal(recorded(element)),
  };
}
