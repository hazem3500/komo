import {
  inspectableAncestor,
  inspectableFor,
  isEditablePropValue,
  type InspectableScalar,
  type InspectableProp,
  type RegisteredInspectableComponent,
} from "./react-inspector.js";
import {
  applyTokenToElement,
  canUndoDesignToken,
  compatibleTokens,
  declaredTokenFor,
  elementTokenBindingFor,
  hasDesignTokenChanges,
  noteElementTokenOverride,
  previewThemeToken,
  proposedDesignTokenChanges,
  resetDesignTokens,
  resetThemeToken,
  restoreElementProperty,
  syncElementTokenBinding,
  tokenImpactCount,
  tokenSourceFor,
  tokenValue,
  undoDesignToken,
  type KomoDesignToken,
  type RegisteredDesignTokenSource,
} from "./design-tokens.js";

const originals = new Map<HTMLElement, Map<string, InspectableScalar>>();
const edits = new WeakMap<HTMLElement, Array<{ propName: string; before: InspectableScalar; after: InspectableScalar }>>();
const styledRoots = new WeakSet<ShadowRoot>();
const commentHandlers = new WeakMap<HTMLButtonElement, AbortController>();
// React props, inline token chips and shared theme values, in the inspector's compact field style.
const panelStyles = `.design-react-source{display:block;padding:0 0 8px;color:#77736f;font-size:10px;overflow-wrap:anywhere}.design-react-inside{padding:10px 12px}.design-react-inside button{padding:0;border:0;background:none;color:#bda6ef;font:inherit;cursor:pointer}.design-react-inside button:hover{text-decoration:underline}.design-react-field.design-field{display:grid;grid-template-columns:76px minmax(0,1fr);gap:0 8px;height:auto;min-height:28px;margin-top:4px;background:none;box-shadow:none;color:#898680;font-size:11px}.design-react-field>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.design-react-field.design-field>:is(input,select){box-sizing:border-box;width:100%;min-width:0;height:28px;padding:0 8px;border:0;border-radius:6px;background:#ffffff0a;color:#f1efeb;font:inherit;font-size:11px}.design-react-field.design-field>:is(input,select):focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}.design-react-field input[type=checkbox]{justify-self:end;width:14px;height:14px;accent-color:#bda6ef}.design-react-field input:disabled{opacity:.55;cursor:not-allowed}.design-react-type{display:none}.design-react-field .design-token-binding{grid-column:2;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;margin-top:4px;color:#77736f;font-size:10px}.design-react-field .design-token-binding select{min-width:0;height:24px;border:0;border-radius:6px;background:#ffffff0a;color:#e9e6e1;padding:0 6px;font:inherit;font-size:10px}.design-react-field .design-token-binding[data-mode=token] select{background:#bda6ef24;color:#e6dcfb}.design-token-binding__state{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.design-field>.design-token-binding{display:contents}.design-field:has(>.design-token-binding)>input[data-property]{padding-right:28px}.design-token-icon,.design-token-detach,.design-field>.design-token-binding select{position:absolute;top:4px;right:4px;width:20px;height:20px;box-sizing:border-box;border-radius:5px}.design-token-icon{display:grid;place-items:center;color:#77736f;opacity:0;pointer-events:none;transition:opacity .12s}.design-token-icon::before{content:'';width:6px;height:6px;border:1.2px solid currentColor;border-radius:1.5px;rotate:45deg}.design-field:is(:hover,:focus-within) .design-token-icon{opacity:1}.design-field>.design-token-binding select{margin:0;padding:0;border:0;opacity:0;cursor:pointer;appearance:none}.design-field>.design-token-binding select:hover+.design-token-icon,.design-field:has(.design-token-binding select:hover) .design-token-icon{background:#ffffff14;color:#e9e6e1}.design-field:has(.design-token-binding select:focus-visible) :is(.design-token-icon,.design-token-chip){outline:2px solid #bda6ef;outline-offset:1px;opacity:1}.design-field[data-token-mode=override] .design-token-icon{opacity:1;color:#e7c27d}.design-token-chip,.design-token-detach{display:none}.design-field:is([data-token-mode=token],[data-token-mode=connected])>input[data-property]{visibility:hidden}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-chip{position:absolute;inset:4px 28px 4px var(--lead,4px);display:flex;align-items:center;gap:5px;padding:0 6px;border-radius:4px;background:#bda6ef1f;color:#e6dcfb;font-size:11px;white-space:nowrap;overflow:hidden;pointer-events:none}.design-token-chip::before{content:'';flex:none;width:5px;height:5px;border:1.2px solid #c8b5f4;border-radius:1px;rotate:45deg}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-binding select{left:var(--lead,4px);right:28px;width:auto}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-icon{display:none}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-detach{display:grid;place-items:center;color:#898680}.design-token-detach:hover{background:#ffffff14;color:#f1efeb}.design-token-detach svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round}.design-theme-group .design-react-source{padding:0 0 6px}.design-theme-heading{display:block;padding:8px 0 2px;color:#77736f;font-size:10px;text-transform:capitalize}.design-theme-token{position:relative;display:grid;grid-template-columns:96px minmax(0,1fr) 20px;align-items:center;gap:6px;margin-top:4px}.design-theme-token>span{overflow:hidden;color:#898680;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.design-theme-token[data-changed]>span{color:#e6dcfb}.design-theme-token[data-changed]::before{content:'';position:absolute;top:calc(50% - 2px);left:-8px;width:4px;height:4px;border-radius:50%;background:#bda6ef}.design-theme-reset{display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:none;color:#77736f;cursor:pointer}.design-theme-reset:disabled{visibility:hidden}.design-theme-reset:hover{background:#ffffff14;color:#f1efeb}.design-theme-reset svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}`;

function scalarLabel(value: InspectableScalar): string {
  return value === undefined ? "unset" : JSON.stringify(value) ?? "unset";
}

export function hasReactPropChanges(element: HTMLElement): boolean {
  return !!originals.get(element)?.size;
}

export interface ReactTextEditStart {
  propName: string;
  before: string;
}

/** Only an explicit registered textProp can drive a React-rendered inline edit. */
export function beginReactTextEdit(element: HTMLElement): ReactTextEditStart | null {
  const component = inspectableFor(element);
  const propName = component?.definition.textProp;
  const definition = component?.definition.props.find((prop) => prop.name === propName);
  if (!component || !propName || definition?.kind !== "string") return null;
  const before = component.props[propName];
  if (typeof before !== "string" || before.length > 500) return null;
  let baseline = originals.get(element);
  if (!baseline) originals.set(element, (baseline = new Map()));
  if (!baseline.has(propName)) baseline.set(propName, before);
  return { propName, before };
}

/** Preview through the registered React state callback; never mutate React's DOM. */
export function previewReactTextEdit(
  element: HTMLElement,
  propName: string,
  value: string,
): boolean {
  const component = inspectableFor(element);
  const definition = component?.definition.props.find((prop) => prop.name === propName);
  if (
    !component || component.definition.textProp !== propName || definition?.kind !== "string" ||
    value.length > 500 || !isEditablePropValue(definition, value)
  ) return false;
  component.setProps({ ...component.props, [propName]: value });
  return true;
}

export function finishReactTextEdit(
  element: HTMLElement,
  propName: string,
  before: string,
  after: string,
): void {
  if (before === after) {
    const baseline = originals.get(element);
    if (baseline?.get(propName) === before && !(edits.get(element) ?? []).some((edit) => edit.propName === propName)) {
      baseline.delete(propName);
      if (!baseline.size) originals.delete(element);
    }
    return;
  }
  let elementEdits = edits.get(element);
  if (!elementEdits) edits.set(element, (elementEdits = []));
  elementEdits.push({ propName, before, after });
}

export function cancelReactTextEdit(element: HTMLElement, propName: string, before: string): void {
  previewReactTextEdit(element, propName, before);
  const baseline = originals.get(element);
  if (baseline?.get(propName) === before && !(edits.get(element) ?? []).some((edit) => edit.propName === propName)) {
    baseline.delete(propName);
    if (!baseline.size) originals.delete(element);
  }
}

export function canUndoReactProp(element: HTMLElement | null): boolean {
  return !!element && !!edits.get(element)?.length;
}

export function proposedReactChanges(element: HTMLElement): string | undefined {
  const baseline = originals.get(element);
  const component = inspectableFor(element);
  if (!baseline?.size || !component) return undefined;
  const source = tokenSourceFor(element);
  const rows = [...baseline].map(([name, before]) => {
    const prop = component.definition.props.find((item) => item.name === name);
    const styleProperty = (prop as (typeof prop & { styleProperty?: string }))?.styleProperty;
    const after = component.props[name];
    const token = styleProperty && typeof after === "string"
      ? source?.tokens.find((item) => item.properties.includes(styleProperty) && after === `var(${item.cssVariable})`)
      : undefined;
    return `- ${name}: ${scalarLabel(before)} → ${scalarLabel(after)}${token ? ` [${token.path}]` : " [custom value]"}`;
  });
  return [
    "Proposed React prop changes (preview only)",
    `Component: ${component.definition.name}`,
    `Source: ${component.definition.source}:${component.definition.line}`,
    ...rows,
    "Preview values use the app's React state callback; Komo does not write source files.",
  ].join("\n");
}

export function proposedDesignChanges(element: HTMLElement): string | undefined {
  return [proposedReactChanges(element), proposedDesignTokenChanges(element)]
    .filter((value): value is string => !!value)
    .join("\n\n") || undefined;
}

export function installCommentCapture(
  button: HTMLButtonElement,
  selected: () => HTMLElement | null,
  onComment: (element: Element, proposal?: string) => void,
): void {
  commentHandlers.get(button)?.abort();
  const controller = new AbortController();
  commentHandlers.set(button, controller);
  button.addEventListener("click", (event) => {
    const element = selected();
    if (!element) return;
    const tokenProposal = proposedDesignTokenChanges(element);
    if (!inspectableFor(element) && !tokenProposal) return;
    event.stopImmediatePropagation();
    onComment(element, proposedDesignChanges(element));
  }, { capture: true, signal: controller.signal });
}

export function canUndoDesignTokenEdit(element: HTMLElement | null): boolean {
  return canUndoDesignToken(element);
}

export function hasDesignTokenEdit(element: HTMLElement): boolean {
  return hasDesignTokenChanges(element);
}

export function undoDesignTokenEdit(element: HTMLElement): void {
  undoDesignToken(element);
}

export function resetDesignTokenEdits(element: HTMLElement): void {
  resetDesignTokens(element);
}

function ensurePanelStyles(styleRoot?: ShadowRoot): void {
  if (!styleRoot || styledRoots.has(styleRoot)) return;
  const style = document.createElement("style");
  style.textContent = panelStyles;
  styleRoot.append(style);
  styledRoots.add(styleRoot);
}

/** Add token references directly to the existing style-property row. */
export function createElementTokenControl(
  element: HTMLElement,
  property: string,
  onEdit: (before: string, after: string, tokenPath?: string) => void,
  styleRoot?: ShadowRoot,
): HTMLElement | null {
  const source = tokenSourceFor(element);
  if (!source) return null;
  const available = compatibleTokens(source, property);
  if (!available.length) return null;
  ensurePanelStyles(styleRoot);
  const row = document.createElement("span");
  row.className = "design-token-binding";
  row.setAttribute("data-mode", "custom");
  // Bound fields show the token as a chip over the value; the chip and the token icon open the choices.
  const icon = document.createElement("span");
  icon.className = "design-token-icon";
  icon.setAttribute("aria-hidden", "true");
  const chip = document.createElement("span");
  chip.className = "design-token-chip";
  chip.setAttribute("aria-hidden", "true");
  const detach = document.createElement("button");
  detach.type = "button";
  detach.className = "design-token-detach";
  detach.title = "Detach token";
  detach.setAttribute("aria-label", `Detach token from ${property}`);
  detach.innerHTML = '<svg viewBox="0 0 12 12"><path d="M5 3.5 6.5 2a2.1 2.1 0 0 1 3 3L8 6.5M7 8.5 5.5 10a2.1 2.1 0 0 1-3-3L4 5.5M2 2l8 8"/></svg>';
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Style token for ${property}`);
  const state = document.createElement("small");
  state.className = "design-token-binding__state";
  state.setAttribute("aria-live", "polite");
  const id = `komo-token-${property}-${Math.random().toString(36).slice(2, 8)}`;
  state.id = id;
  select.setAttribute("aria-describedby", id);
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom value";
  select.append(custom);
  for (const token of available) {
    const option = document.createElement("option");
    const resolved = tokenValue(source, token);
    option.value = token.path;
    option.textContent = resolved ? `${token.path} · ${resolved}` : token.path;
    select.append(option);
  }
  const update = () => {
    const binding = elementTokenBindingFor(source, element, property);
    const declared = binding ? null : declaredTokenFor(source, element, property);
    const linked = binding?.mode === "token" ? available.find((token) => token.path === binding.tokenPath) : undefined;
    const active = linked ?? declared?.token;
    select.value = active?.path ?? "custom";
    chip.textContent = active?.path ?? "";
    const was = binding?.declaredPath;
    const mode = linked ? "token" : declared ? "connected" : was ? "override" : "custom";
    row.dataset.mode = mode;
    row.parentElement?.setAttribute("data-token-mode", mode);
    state.textContent = mode === "token"
      ? was && was !== linked?.path ? `Rebound from ${was} · preview` : `Linked to ${linked?.path} · preview`
      : mode === "connected"
        ? `Connected ${declared?.origin === "inline" ? "inline" : "from stylesheet"}`
        : mode === "override" ? `Custom override · was ${was}` : "";
    select.title = state.textContent || "Choose a token";
  };
  const observer = new MutationObserver(update);
  observer.observe(element, { attributes: true, attributeFilter: ["style"] });
  const cleanupObserver = new MutationObserver(() => { if (!row.isConnected) { observer.disconnect(); cleanupObserver.disconnect(); } });
  cleanupObserver.observe(row.ownerDocument, { childList: true, subtree: true });
  select.addEventListener("change", () => {
    const before = element.style.getPropertyValue(property);
    const token = available.find((item) => item.path === select.value);
    const binding = elementTokenBindingFor(source, element, property);
    if (token && binding && token.path === binding.declaredPath) {
      // Choosing the page's own token again removes the preview instead of duplicating it inline.
      restoreElementProperty(source, element, property);
      onEdit(before, element.style.getPropertyValue(property), token.path);
    } else if (token) {
      if (token.path !== declaredTokenFor(source, element, property)?.token.path || binding) {
        if (applyTokenToElement(source, element, token, property, { recordHistory: false }))
          onEdit(before, element.style.getPropertyValue(property), token.path);
      }
    } else {
      const control = row.parentElement?.querySelector<HTMLInputElement | HTMLSelectElement>("[data-property]");
      const value = control?.value ?? getComputedStyle(element).getPropertyValue(property).trim();
      // Bare numbers are pixels, except unitless weights and line heights.
      const cssValue = /^-?[\d.]+$/.test(value.trim()) && !/weight|line/.test(property) ? `${value.trim()}px` : value;
      noteElementTokenOverride(source, element, property, cssValue);
      element.style.setProperty(property, cssValue);
      onEdit(before, cssValue);
    }
    update();
  });
  detach.addEventListener("click", () => {
    // Detaching keeps the token's current value as a raw override.
    const token = available.find((item) => item.path === select.value);
    const control = row.parentElement?.querySelector<HTMLInputElement>("input[data-property]");
    const value = token && tokenValue(source, token);
    if (control && value) control.value = control.type === "number" ? String(parseFloat(value)) : value;
    select.value = "custom";
    select.dispatchEvent(new Event("change"));
    row.parentElement?.querySelector<HTMLElement>("[data-property]")?.focus();
  });
  row.append(chip, select, icon, detach, state);
  queueMicrotask(update);
  update();
  return row;
}

/** Properties whose before/after is described by token provenance instead of raw CSS. */
export function tokenBoundProperties(element: HTMLElement): Set<string> {
  const source = tokenSourceFor(element);
  return new Set(source?.elementBindings.get(element)?.keys() ?? []);
}

export function attachStyleTokenControls<T extends { property: string; kind?: string }>(
  element: HTMLElement,
  fields: readonly T[],
  container: HTMLElement,
  onEdit: (field: T, input: HTMLInputElement | HTMLSelectElement, before: string) => void,
  styleRoot?: ShadowRoot,
  valueFor?: (field: T, element: HTMLElement) => string,
  toHex?: (value: string) => string,
): void {
  for (const field of fields) {
    const label = [...container.querySelectorAll<HTMLElement>("[data-field-property]")]
      .find((candidate) => candidate.dataset.fieldProperty === field.property);
    if (!label || label.querySelector(".design-token-binding")) continue;
    const input = label.querySelector<HTMLInputElement | HTMLSelectElement>("[data-property]");
    if (!input) continue;
    const control = createElementTokenControl(element, field.property,
      (before) => {
        onEdit(field, input, before);
        if (valueFor) input.value = valueFor(field, element);
        const dial = label.querySelector<HTMLInputElement>('input[type="range"],input[type="color"]');
        if (dial) dial.value = field.kind === "color" && toHex ? toHex(input.value) : input.value;
      }, styleRoot);
    if (control) label.append(control);
  }
}

type ThemeFields = Pick<typeof import("./design-panel.js"), "fieldControl" | "fields" | "toHex">;
type ThemeField = Parameters<ThemeFields["fieldControl"]>[0];

/** Whether the Shared theme section stays open when the panel re-renders, e.g. after Undo. */
let themeOpen = false;

/**
 * Shared theme editing stays secondary; per-element token choice lives on each knob.
 * Token rows reuse the panel's own fields and preview live, like every other field.
 */
export function createDesignThemePanel(
  element: HTMLElement,
  panel: ThemeFields,
  onEdit: () => void,
  styleRoot?: ShadowRoot,
): HTMLElement | null {
  const source = tokenSourceFor(element);
  if (!source || !source.tokens.length) return null;
  ensurePanelStyles(styleRoot);
  const group = document.createElement("details");
  group.className = "design-group design-theme-group";
  group.open = themeOpen;
  group.addEventListener("toggle", () => { if (group.isConnected) themeOpen = group.open; });
  const summary = document.createElement("summary");
  summary.textContent = "Shared theme";
  const note = document.createElement("small");
  note.className = "design-react-source";
  note.textContent = "Changes every element using these tokens";
  group.append(summary, note);
  // Long lists group by the first path segment, e.g. color, spacing, radius.
  const sets = new Map<string, KomoDesignToken[]>();
  for (const token of source.tokens) {
    const key = token.path.split(".")[0];
    sets.set(key, [...sets.get(key) ?? [], token]);
  }
  const grouped = source.tokens.length > 6 && sets.size > 1;
  for (const [key, tokens] of grouped ? sets : new Map([["", source.tokens]])) {
    if (key) {
      const heading = document.createElement("small");
      heading.className = "design-theme-heading";
      heading.textContent = key;
      group.append(heading);
    }
    for (const token of tokens) group.append(themeRow(source, token, panel, onEdit, key));
  }
  return group;
}

function themeRow(
  source: RegisteredDesignTokenSource,
  token: KomoDesignToken,
  panel: ThemeFields,
  onEdit: () => void,
  key: string,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "design-theme-token";
  const label = document.createElement("span");
  label.textContent = key ? token.path.slice(key.length + 1) || token.path : token.path;
  label.title = `${token.path} · ${tokenImpactCount(source, token)} matching · ${token.impactSelector}`;
  // Borrow the matching style field's kind and glyph; sizes keep their unit and scrub.
  const base = panel.fields.find((field) => token.properties.includes(field.property));
  const field: ThemeField = {
    property: token.cssVariable,
    label: `Shared theme value for ${token.path}`,
    kind: token.type === "dimension" ? "size" : base?.kind ?? "text",
    glyph: token.type === "color" ? undefined : base?.glyph,
    values: base?.values,
  };
  let live = false;
  const box = panel.fieldControl(field, {
    element: source.root,
    begin: () => { live = false; },
    apply: (control, _property, value) => {
      const valid = value !== null && previewThemeToken(source, token, value.trim(), live);
      control.setAttribute("aria-invalid", String(!valid));
      if (valid) {
        live = true;
        sync();
        onEdit();
      }
    },
    commit: (control, _property, final) => {
      if (final === false) return;
      live = false;
      if (control.getAttribute("aria-invalid") === "true") show();
    },
  });
  const control = box.querySelector<HTMLInputElement | HTMLSelectElement>("[data-property]")!;
  const swatch = box.querySelector<HTMLInputElement>('input[type="color"]');
  const show = () => {
    const value = tokenValue(source, token);
    control.value = value;
    if (swatch) swatch.value = panel.toHex(value);
    control.removeAttribute("aria-invalid");
    sync();
  };
  const sync = () => {
    reset.disabled = !row.toggleAttribute("data-changed", source.themeEdits.has(token.path));
    if (token.type === "fontFamily") control.title = control.value;
  };
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "design-theme-reset";
  reset.title = "Reset to page value";
  reset.setAttribute("aria-label", `Reset ${token.path}`);
  reset.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2.5 2.5v3h3M3 5.5a5.5 5.5 0 1 1-.5 2.5"/></svg>';
  reset.addEventListener("click", () => {
    resetThemeToken(source, token);
    show();
    onEdit();
  });
  show();
  row.append(label, box, reset);
  return row;
}

export function noteDesignTokenOverride(element: HTMLElement, property: string, value: string): void {
  const source = tokenSourceFor(element);
  if (source) noteElementTokenOverride(source, element, property, value);
}

export function syncDesignTokenBinding(element: HTMLElement, property: string): void {
  const source = tokenSourceFor(element);
  if (source) syncElementTokenBinding(source, element, property);
}

export function undoReactProp(element: HTMLElement): void {
  const edit = edits.get(element)?.pop();
  const component = inspectableFor(element);
  if (!edit || !component) return;
  component.setProps({ ...component.props, [edit.propName]: edit.before });
  const baseline = originals.get(element);
  if (baseline) {
    const initial = baseline.get(edit.propName);
    if (Object.is(initial, edit.before)) baseline.delete(edit.propName);
    if (!baseline.size) originals.delete(element);
  }
}

export function resetReactProps(element: HTMLElement): void {
  const baseline = originals.get(element);
  const component = inspectableFor(element);
  if (!baseline?.size || !component) return;
  component.setProps({ ...component.props, ...Object.fromEntries(baseline) });
  originals.delete(element);
  edits.delete(element);
}

/** Props belong to the registered root; a descendant only points back to it. */
function insideComponent(
  element: HTMLElement,
  select: ((root: HTMLElement) => void) | undefined,
  styleRoot?: ShadowRoot,
): HTMLElement | null {
  const owner = inspectableAncestor(element);
  if (!owner) return null;
  ensurePanelStyles(styleRoot);
  const line = document.createElement("small");
  line.className = "design-react-source design-react-group design-react-inside";
  line.append(`Inside ${owner.component.definition.name}`);
  if (select) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Select component";
    button.addEventListener("click", () => select(owner.root));
    line.append(" · ", button);
  }
  return line;
}

function recordChange(
  element: HTMLElement,
  component: RegisteredInspectableComponent,
  propName: string,
  value: InspectableScalar,
  control: HTMLInputElement | HTMLSelectElement,
  onEdit: () => void,
) {
  const definition = component.definition.props.find((prop) => prop.name === propName);
  if (!definition || !isEditablePropValue(definition, value)) {
    control.setAttribute("aria-invalid", "true");
    return false;
  }
  control.removeAttribute("aria-invalid");
  const before = component.props[propName];
  if (Object.is(before, value)) return true;
  let elementOriginals = originals.get(element);
  if (!elementOriginals) originals.set(element, (elementOriginals = new Map()));
  const initial = elementOriginals.has(propName)
    ? elementOriginals.get(propName)
    : before;
  if (Object.is(initial, value)) elementOriginals.delete(propName);
  else elementOriginals.set(propName, initial);
  if (!elementOriginals.size) originals.delete(element);
  let elementEdits = edits.get(element);
  if (!elementEdits) edits.set(element, (elementEdits = []));
  elementEdits.push({ propName, before, after: value });
  component.setProps({ ...component.props, [propName]: value });
  onEdit();
  return true;
}

export function createReactPropsPanel(
  element: HTMLElement,
  onEdit: () => void,
  styleRoot?: ShadowRoot,
  select?: (root: HTMLElement) => void,
): HTMLElement | null {
  const component = inspectableFor(element);
  if (!component) return insideComponent(element, select, styleRoot);
  ensurePanelStyles(styleRoot);
  const group = document.createElement("details");
  group.className = "design-group design-react-group";
  group.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "React props";
  group.append(summary);
  const source = document.createElement("small");
  source.className = "design-react-source";
  source.textContent = `${component.definition.name} · ${component.definition.source}:${component.definition.line}`;
  group.append(source);

  for (const prop of component.definition.props) {
    const styleProperty = (prop as InspectableProp & { styleProperty?: string }).styleProperty;
    const row = document.createElement("label");
    row.className = "design-field design-react-field";
    const caption = document.createElement("span");
    caption.textContent = prop.name;
    const value = component.props[prop.name];
    let control: HTMLInputElement | HTMLSelectElement;
    if (prop.kind === "enum") {
      const select = document.createElement("select");
      for (const optionValue of prop.values ?? []) {
        const option = document.createElement("option");
        option.value = String(optionValue);
        option.textContent = String(optionValue);
        select.append(option);
      }
      if (value === undefined && !prop.required) {
        const unset = document.createElement("option");
        unset.value = "";
        unset.textContent = "unset";
        select.prepend(unset);
      }
      select.value = value === undefined ? "" : String(value);
      control = select;
    } else {
      const input = document.createElement("input");
      if (prop.kind === "boolean") {
        input.type = "checkbox";
        input.checked = value === true;
      } else if (prop.kind === "number") {
        input.type = "number";
        input.step = "any";
        input.value = typeof value === "number" ? String(value) : "";
      } else {
        input.type = "text";
        input.maxLength = 500;
        input.autocomplete = "off";
        input.value = typeof value === "string" ? value : "";
      }
      control = input;
    }
    control.setAttribute("aria-label", `${component.definition.name} ${prop.name}`);
    if (prop.kind === "unsupported") {
      control = document.createElement("input");
      control.disabled = true;
      control.value = `Read only · ${prop.typeLabel}`;
      control.setAttribute("aria-label", `${component.definition.name} ${prop.name}, read only`);
      row.title = `Komo does not edit ${prop.typeLabel} props.`;
    } else {
      const apply = () => {
        const raw = control instanceof HTMLInputElement && control.type === "checkbox"
          ? control.checked
          : control.value;
        let next: InspectableScalar = raw as string;
        if (prop.kind === "number")
          next = String(raw).trim() === "" ? undefined : Number(raw);
        else if (prop.kind === "enum") {
          const matched = (prop.values ?? []).find((item) => String(item) === raw);
          next = raw === "" && !prop.required ? undefined : matched;
        } else if (prop.kind === "boolean") next = raw === true;
        recordChange(element, component, prop.name, next, control, onEdit);
      };
      control.addEventListener("change", apply);
    }
    row.append(caption, control);
    const type = document.createElement("small");
    type.className = "design-react-type";
    type.textContent = `${prop.typeLabel}${prop.required ? " · required" : " · optional"}`;
    row.append(type);
    row.title ||= type.textContent;
    if (prop.kind === "string" && styleProperty) {
      const tokenSource = tokenSourceFor(element);
      const tokens = tokenSource ? compatibleTokens(tokenSource, styleProperty) : [];
      if (tokens.length) {
        const binding = document.createElement("span");
        binding.className = "design-token-binding";
        const caption = document.createElement("span");
        caption.textContent = "Style token";
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Style token for ${prop.name}`);
        const custom = document.createElement("option");
        custom.value = "custom";
        custom.textContent = "Custom value";
        select.append(custom);
        for (const token of tokens) {
          const option = document.createElement("option");
          option.value = token.path;
          option.textContent = token.path;
          select.append(option);
        }
        const sync = () => {
          const active = tokens.find((token) => component.props[prop.name] === `var(${token.cssVariable})`);
          select.value = active?.path ?? "custom";
          binding.dataset.mode = active ? "token" : "custom";
        };
        select.addEventListener("change", () => {
          const token = tokens.find((item) => item.path === select.value);
          const next = token ? `var(${token.cssVariable})` : (typeof component.props[prop.name] === "string" && String(component.props[prop.name]).startsWith("var(")
            ? element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(styleProperty).trim() ?? ""
            : typeof component.props[prop.name] === "string" ? component.props[prop.name] as string : "");
          if (recordChange(element, component, prop.name, next, control, onEdit)) sync();
        });
        binding.append(caption, select);
        row.append(binding);
        sync();
      }
    }
    group.append(row);
  }
  return group;
}
