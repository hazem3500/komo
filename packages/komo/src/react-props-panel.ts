import {
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
  elementTokenBindingFor,
  hasDesignTokenChanges,
  noteElementTokenOverride,
  previewThemeToken,
  proposedDesignTokenChanges,
  resetDesignTokens,
  syncElementTokenBinding,
  tokenImpactCount,
  tokenSourceFor,
  tokenValue,
  undoDesignToken,
} from "./design-tokens.js";

const originals = new Map<HTMLElement, Map<string, InspectableScalar>>();
const edits = new WeakMap<HTMLElement, Array<{ propName: string; before: InspectableScalar; after: InspectableScalar }>>();
const styledRoots = new WeakSet<ShadowRoot>();
const commentHandlers = new WeakMap<HTMLButtonElement, AbortController>();
const panelStyles = `.design-react-source{display:block;padding:0 0 8px;color:#898680;font-size:10px;overflow-wrap:anywhere}.design-react-field{grid-template-columns:76px minmax(0,1fr);padding:1px 0}.design-react-field input[type=checkbox]{justify-self:end;width:16px;height:16px;accent-color:#bda6ef}.design-react-field input:disabled{opacity:.65;cursor:not-allowed}.design-react-type{grid-column:2;color:#77736f;font-size:10px;margin-top:-5px;overflow-wrap:anywhere}.design-react-group .design-react-field{min-height:36px}.design-token-binding{grid-column:2/-1;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;color:#898680;font-size:10px;padding:0 0 5px}.design-token-binding select{min-width:0;width:100%;height:25px;border:1px solid #ffffff1c;border-radius:7px;background:#252322;color:#e9e6e1;padding:0 7px;font:10px ui-sans-serif,system-ui,sans-serif}.design-token-binding select:focus-visible{outline:2px solid #bda6ef;outline-offset:2px}.design-token-binding[data-mode=custom]::after{content:'Custom override';grid-column:2;color:#bda6ef;font-size:9px}.design-theme-group{margin-top:4px}.design-theme-token{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:7px 0;border-top:1px solid #ffffff12}.design-theme-token small{grid-column:1/-1;color:#898680;font-size:10px}.design-theme-token input,.design-theme-token button{min-width:0;min-height:28px;border:1px solid #ffffff1c;border-radius:7px;background:#252322;color:#f4f0ea;padding:0 8px;font:10px ui-sans-serif,system-ui,sans-serif}.design-theme-token button{cursor:pointer}.design-theme-token :focus-visible{outline:2px solid #bda6ef;outline-offset:2px}.design-theme-token [aria-invalid=true]{border-color:#f17676}`;

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
  const caption = document.createElement("span");
  caption.textContent = "Style token";
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Style token for ${property}`);
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom value";
  select.append(custom);
  for (const token of available) {
    const option = document.createElement("option");
    option.value = token.path;
    option.textContent = token.path;
    select.append(option);
  }
  const update = () => {
    const binding = elementTokenBindingFor(source, element, property);
    const activeToken = available.find((token) =>
      element.style.getPropertyValue(property) === `var(${token.cssVariable})`,
    );
    select.value = activeToken?.path ?? "custom";
    row.dataset.mode = binding?.mode ?? (activeToken ? "token" : "custom");
    row.title = binding?.mode === "custom" && binding.tokenPath
      ? `Custom override of ${binding.tokenPath}`
      : activeToken ? `Using ${activeToken.path} · preview only` : "Uses a custom value";
  };
  const observer = new MutationObserver(update);
  observer.observe(element, { attributes: true, attributeFilter: ["style"] });
  const cleanupObserver = new MutationObserver(() => { if (!row.isConnected) { observer.disconnect(); cleanupObserver.disconnect(); } });
  cleanupObserver.observe(row.ownerDocument, { childList: true, subtree: true });
  select.addEventListener("change", () => {
    const before = element.style.getPropertyValue(property);
    const token = available.find((item) => item.path === select.value);
    if (token) {
      if (applyTokenToElement(source, element, token, property, { recordHistory: false }))
        onEdit(before, element.style.getPropertyValue(property), token.path);
    } else {
      const control = row.parentElement?.querySelector<HTMLInputElement | HTMLSelectElement>("[data-property]");
      const value = control?.value ?? getComputedStyle(element).getPropertyValue(property).trim();
      const cssValue = control?.type === "number" && value.trim() !== "" ? `${value}px` : value;
      element.style.setProperty(property, cssValue);
      noteElementTokenOverride(source, element, property, cssValue);
      onEdit(before, cssValue);
    }
    update();
  });
  row.append(caption, select);
  update();
  return row;
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

/** Shared theme editing stays secondary; per-element token choice lives on each knob. */
export function createDesignThemePanel(element: HTMLElement, onEdit: () => void, styleRoot?: ShadowRoot): HTMLElement | null {
  const source = tokenSourceFor(element);
  if (!source || !source.tokens.length) return null;
  ensurePanelStyles(styleRoot);
  const group = document.createElement("details");
  group.className = "design-group design-theme-group";
  group.open = false;
  const summary = document.createElement("summary");
  summary.textContent = "Edit shared theme values";
  group.append(summary);
  const note = document.createElement("small");
  note.className = "design-react-source";
  note.textContent = "Affects all matching elements · preview only";
  group.append(note);
  for (const token of source.tokens) {
    const row = document.createElement("div");
    row.className = "design-theme-token";
    const label = document.createElement("span");
    label.textContent = token.path;
    const value = document.createElement("input");
    value.type = "text";
    value.autocomplete = "off";
    value.value = tokenValue(source, token);
    value.setAttribute("aria-label", `Shared theme value for ${token.path}`);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.textContent = "Preview";
    preview.setAttribute("aria-label", `Preview shared theme change for ${token.path}`);
    preview.addEventListener("click", () => {
      const valid = previewThemeToken(source, token, value.value.trim());
      value.setAttribute("aria-invalid", String(!valid));
      if (valid) onEdit();
    });
    const scope = document.createElement("small");
    scope.textContent = `${tokenImpactCount(source, token)} matches · ${token.impactSelector}`;
    row.append(label, value, preview, scope);
    group.append(row);
  }
  return group;
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
): HTMLElement | null {
  const component = inspectableFor(element);
  if (!component) return null;
  if (styleRoot && !styledRoots.has(styleRoot)) {
    const style = document.createElement("style");
    style.textContent = panelStyles;
    styleRoot.append(style);
    styledRoots.add(styleRoot);
  }
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
