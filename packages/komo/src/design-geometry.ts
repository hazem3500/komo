import { previewMessage, changePreviewStyles, inlineStyleSnapshot } from './design-preview.js';
import type { DesignTarget } from './design-target.js';

type Hooks = {
  signal: AbortSignal;
  options: Pick<import("./design-mode.js").DesignModeOptions, "root" | "bounds">;
  selected(): DesignTarget | null;
  enabled(): boolean;
  remember(element: DesignTarget, property: string): void;
  track(element: DesignTarget, property: string): void;
  tokens(): typeof import('./react-props-panel.js') | null;
  history: { push(edit: { element: DesignTarget; undo(): void }): unknown };
  update(): void;
};

/** Only axis-aligned, positive 2D coordinate chains have an unambiguous local delta. */
export function geometryTarget(element: Element | null) {
  if (!(element instanceof HTMLElement) || !element.isConnected || element === document.body || element === document.documentElement)
    return 'Select a regular HTML box. SVG and page roots are unavailable.';
  const css = getComputedStyle(element);
  if (!['block', 'flow-root', 'inline-block'].includes(css.display) || !['static', 'relative'].includes(css.position) ||
      css.writingMode !== 'horizontal-tb' || css.aspectRatio !== 'auto' || element.isContentEditable || element.matches('input,textarea,select,iframe,video,canvas'))
    return 'Move and resize require a normal-flow HTML box without an aspect ratio.';
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/flex|grid|table/.test(style.display) || style.columnCount !== 'auto' || style.perspective !== 'none' ||
        style.rotate !== 'none' || (style.translate !== 'none' && !/^-?[\d.]+(?:px|%)(?: -?[\d.]+(?:px|%))?$/.test(style.translate)) ||
        node.getAnimations().some(animation => animation.playState === 'running'))
      return 'This layout or animation does not support geometry previews.';
    const matrix = new DOMMatrix(style.transform);
    const scale = style.scale === 'none' ? [1] : style.scale.split(/\s+/).map(Number);
    if (!matrix.is2D || matrix.b || matrix.c || matrix.a <= 0 || matrix.d <= 0 || scale.length > 2 || scale.some(value => !(value > 0)))
      return 'Rotation, skew, 3D and negative scales are unavailable.';
  }
  if (!element.offsetWidth || !element.offsetHeight || element.getClientRects().length !== 1 ||
      css.maxWidth !== 'none' || css.maxHeight !== 'none' || !['0px', 'auto'].includes(css.minWidth) || !['0px', 'auto'].includes(css.minHeight))
    return 'Constrained or fragmented boxes are unavailable.';
  return null;
}

export function bindGeometry(hooks: Hooks) {
  const surface = document.createElement('div');
  surface.className = 'design-geometry';
  surface.title = previewMessage;
  const style = document.createElement('style');
  style.textContent = `.design-geometry{position:fixed;inset:0;pointer-events:none;z-index:4}.design-geometry[hidden],.design-geometry [hidden]{display:none}.design-geometry button{position:fixed;pointer-events:auto;touch-action:none;min-width:28px;min-height:28px;padding:4px 8px;background:#fff;color:#25233a;border:1px solid #7151c8;border-radius:6px;font:12px system-ui;box-shadow:0 2px 6px #0002}.design-geometry button:focus-visible{outline:3px solid #7151c8;outline-offset:3px}.design-geometry button[aria-pressed=true]{background:#e9dfff}.design-geometry p{position:fixed;max-width:280px;margin:0;padding:6px 8px;border-radius:6px;background:#25233a;color:#fff;font:12px system-ui}`;
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
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
  surface.append(message);
  hooks.options.root.append(style, surface);
  type Gesture = {
    element: HTMLElement; kind: number; button: HTMLButtonElement; pointer?: number;
    x: number; y: number; dx: number; dy: number; sx: number; sy: number;
    width: number; height: number; minWidth: number; minHeight: number; tx: number; ty: number;
    rect: DOMRect; before: Map<string, ReturnType<typeof inlineStyleSnapshot>>;
  };
  let gesture: Gesture | undefined;
  let rejected: Element | null = null;
  const controller = new AbortController();
  function finish(cancel = false) {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    const { element, before } = current;
    const values = new Map([...before.keys()].map(property => [property, element.style.getPropertyValue(property)]));
    const restore = () => [...before.values()].reverse().forEach(snapshot => snapshot.restore());
    changePreviewStyles(element, before.keys(), restore);
    restore();
    if (!cancel && [...values].some(([property, value]) => value !== before.get(property)!.value)) {
      const bindings: Array<(() => void) | undefined> = [];
      for (const property of values.keys()) hooks.remember(element, property);
      changePreviewStyles(element, values.keys(), () => {
        for (const [property, value] of values) {
          const binding = hooks.tokens()?.noteDesignTokenOverride(element, property, value);
          bindings.push(binding?.undo);
          element.style.setProperty(property, value, binding?.priority ?? before.get(property)!.priority);
          hooks.track(element, property);
        }
      });
      hooks.history.push({ element, undo() {
        changePreviewStyles(element, before.keys(), () => {
          restore();
          bindings.reverse().forEach(undo => undo?.());
          for (const property of before.keys()) { hooks.tokens()?.syncDesignTokenBinding(element, property); hooks.track(element, property); }
        });
        restore();
      } });
    }
    current.button.setAttribute('aria-pressed', 'false');
    if (current.pointer !== undefined && current.button.hasPointerCapture(current.pointer)) current.button.releasePointerCapture(current.pointer);
    hooks.update();
    render();
  }
  function start(kind: number, pointer?: PointerEvent) {
    finish(true);
    const element = hooks.selected();
    if (!hooks.enabled() || geometryTarget(element) || !(element instanceof HTMLElement)) return;
    if (element === rejected) return;
    const css = getComputedStyle(element), rect = element.getBoundingClientRect();
    const matrix = new DOMMatrix(css.transform);
    const scales = css.scale === 'none' ? [1, 1] : css.scale.split(/\s+/).map(Number);
    const width = parseFloat(css.width), height = parseFloat(css.height);
    const borderWidth = width + (css.boxSizing === 'border-box' ? 0 : ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((n, key) => n + (parseFloat(css[key as keyof CSSStyleDeclaration] as string) || 0), 0));
    const borderHeight = height + (css.boxSizing === 'border-box' ? 0 : ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((n, key) => n + (parseFloat(css[key as keyof CSSStyleDeclaration] as string) || 0), 0));
    const translate = css.translate === 'none' ? ['0', '0'] : css.translate.split(/\s+/);
    const length = (value: string = '0', size: number) => parseFloat(value) * (value.endsWith('%') ? size / 100 : 1);
    const properties = kind === 0 ? ['translate'] : kind === 1 ? ['width'] : kind === 2 ? ['height'] : ['width', 'height'];
    gesture = { element, kind, button: buttons[kind], pointer: pointer?.pointerId,
      x: pointer?.clientX ?? 0, y: pointer?.clientY ?? 0, dx: 0, dy: 0,
      sx: rect.width / borderWidth / (kind ? 1 : matrix.a * scales[0]),
      sy: rect.height / borderHeight / (kind ? 1 : matrix.d * (scales[1] ?? scales[0])),
      width, height,
      minWidth: css.boxSizing === 'border-box' ? Math.max(16, ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((n, key) => n + (parseFloat(css[key as keyof CSSStyleDeclaration] as string) || 0), 0)) : 16,
      minHeight: css.boxSizing === 'border-box' ? Math.max(16, ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((n, key) => n + (parseFloat(css[key as keyof CSSStyleDeclaration] as string) || 0), 0)) : 16,
      tx: length(translate[0], borderWidth), ty: length(translate[1], borderHeight), rect,
      before: new Map(properties.map(property => [property, inlineStyleSnapshot(element, property)])) };
    buttons[kind].setAttribute('aria-pressed', 'true');
    message.textContent = 'Armed · arrows adjust · Enter commits · Escape cancels';
    if (pointer) buttons[kind].setPointerCapture(pointer.pointerId);
  }
  function apply(dx: number, dy: number) {
    const current = gesture;
    if (!current) return;
    if (!hooks.enabled() || hooks.selected() !== current.element || geometryTarget(current.element)) { finish(true); return; }
    current.dx = dx; current.dy = dy;
    const { element, kind, sx, sy, before } = current;
    changePreviewStyles(element, before.keys(), () => {
      const set = (property: string, value: string) => element.style.setProperty(property, value, before.get(property)!.priority);
      if (!kind) set('translate', `${current.tx + dx / sx}px ${current.ty + dy / sy}px`);
      else {
        if (kind !== 2) set('width', `${Math.max(current.minWidth, current.width + dx / sx)}px`);
        if (kind !== 1) set('height', `${Math.max(current.minHeight, current.height + dy / sy)}px`);
      }
    });
    const measured = getComputedStyle(element);
    if ([...before.keys()].some(property => {
      const actual = measured.getPropertyValue(property).split(/\s+/).map(parseFloat);
      const expected = element.style.getPropertyValue(property).split(/\s+/).map(parseFloat);
      return expected.some((value, index) => !Number.isFinite(actual[index] ?? 0) || Math.abs((actual[index] ?? 0) - value) > 0.1);
    })) {
      rejected = element;
      finish(true);
      return;
    }
    current.rect = element.getBoundingClientRect();
    render();
  }
  function render() {
    const element = hooks.selected();
    const visible = hooks.enabled() && !!element?.isConnected;
    surface.hidden = !visible;
    if (!visible) { finish(true); return; }
    if (element !== rejected) rejected = null;
    const reason = geometryTarget(element) ?? (rejected ? 'Host sizing or translation rules prevent this preview. Select another element.' : null);
    if (reason && gesture) finish(true);
    const rect = element!.getBoundingClientRect();
    const bounds = hooks.options.bounds?.(element!) ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (rect.right <= bounds.left || rect.left >= bounds.right || rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
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
    message.hidden = !reason && !gesture;
    if (reason) message.textContent = reason;
    place(message, rect.left, rect.top - 68);
  }
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
      const step = event.shiftKey ? 10 : 1;
      apply(gesture.dx + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) * gesture.sx,
        gesture.dy + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) * gesture.sy);
    }
  }, { capture: true, signal: controller.signal });
  window.addEventListener('scroll', () => {
    if (gesture?.pointer !== undefined) {
      const rect = gesture.element.getBoundingClientRect();
      gesture.x += rect.left - gesture.rect.left; gesture.y += rect.top - gesture.rect.top;
      apply(gesture.dx - (rect.left - gesture.rect.left), gesture.dy - (rect.top - gesture.rect.top));
    }
    render();
  }, { capture: true, passive: true, signal: controller.signal });
  render();
  hooks.signal.addEventListener('abort', () => { finish(true); controller.abort(); surface.remove(); style.remove(); }, { once: true });
  return { render, cancel: () => finish(true) };
}
