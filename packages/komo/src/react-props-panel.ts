import {
  inspectableFor,
  isEditablePropValue,
  type InspectableScalar,
  type RegisteredInspectableComponent,
} from "./react-inspector.js";
import {
  applyTokenToElement,
  canUndoDesignToken,
  hasDesignTokenChanges,
  previewThemeToken,
  proposedDesignTokenChanges,
  resetDesignTokens,
  tokenImpactCount,
  tokenSourceFor,
  tokenValue,
  undoDesignToken,
} from "./design-tokens.js";

const originals = new Map<HTMLElement, Map<string, InspectableScalar>>();
const edits = new WeakMap<HTMLElement, Array<{ propName: string; before: InspectableScalar; after: InspectableScalar }>>();
const styledRoots = new WeakSet<ShadowRoot>();
const commentHandlers = new WeakMap<HTMLButtonElement, AbortController>();
const panelStyles = `.design-react-source{display:block;padding:0 0 8px;color:#898680;font-size:10px;overflow-wrap:anywhere}.design-react-field{grid-template-columns:76px minmax(0,1fr);padding:1px 0}.design-react-field input[type=checkbox]{justify-self:end;width:16px;height:16px;accent-color:#bda6ef}.design-react-field input:disabled{opacity:.65;cursor:not-allowed}.design-react-type{grid-column:2;color:#77736f;font-size:10px;margin-top:-5px;overflow-wrap:anywhere}.design-react-group .design-react-field{min-height:36px}.design-token{display:grid;gap:6px;padding:8px 0;border-top:1px solid #ffffff12}.design-token__title{display:flex;justify-content:space-between;gap:8px;font-size:11px}.design-token__title small,.design-token__scope{color:#898680;font-size:10px}.design-token__controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}.design-token input,.design-token select{min-width:0;height:30px;border:1px solid #ffffff1c;border-radius:7px;background:#252322;color:#f4f0ea;padding:0 8px;font:inherit}.design-token button{min-height:30px;border:1px solid #ffffff1c;border-radius:7px;background:#302d31;color:#eee8f7;padding:0 9px;font:inherit;cursor:pointer}.design-token button:focus-visible,.design-token input:focus-visible,.design-token select:focus-visible{outline:2px solid #bda6ef;outline-offset:2px}.design-token [aria-invalid=true]{border-color:#f17676}`;

function scalarLabel(value: InspectableScalar): string {
  return value === undefined ? "unset" : JSON.stringify(value) ?? "unset";
}

export function hasReactPropChanges(element: HTMLElement): boolean {
  return !!originals.get(element)?.size;
}

export function canUndoReactProp(element: HTMLElement | null): boolean {
  return !!element && !!edits.get(element)?.length;
}

export function proposedReactChanges(element: HTMLElement): string | undefined {
  const baseline = originals.get(element);
  const component = inspectableFor(element);
  if (!baseline?.size || !component) return undefined;
  const rows = [...baseline].map(
    ([name, before]) => `- ${name}: ${scalarLabel(before)} → ${scalarLabel(component.props[name])}`,
  );
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

export function createDesignTokensPanel(element: HTMLElement, onEdit: () => void): HTMLElement | null {
  const source = tokenSourceFor(element);
  if (!source || !source.tokens.length) return null;
  const group = document.createElement("details");
  group.className = "design-group design-token-group";
  group.open = false;
  const summary = document.createElement("summary");
  summary.textContent = "Tokens & theme";
  group.append(summary);
  const intro = document.createElement("small");
  intro.className = "design-react-source";
  intro.textContent = "Registered CSS variables · preview only";
  group.append(intro);

  for (const token of source.tokens) {
    const row = document.createElement("section");
    row.className = "design-token";
    const title = document.createElement("div");
    title.className = "design-token__title";
    const path = document.createElement("span");
    path.textContent = token.path;
    const type = document.createElement("small");
    type.textContent = token.type;
    title.append(path, type);
    row.append(title);

    const selector = document.createElement("select");
    selector.setAttribute("aria-label", `CSS property for ${token.path}`);
    for (const property of token.properties) {
      const option = document.createElement("option");
      option.value = property;
      option.textContent = property;
      selector.append(option);
    }
    const assign = document.createElement("button");
    assign.type = "button";
    assign.textContent = "Use token on element";
    assign.addEventListener("click", () => {
      if (applyTokenToElement(source, element, token, selector.value)) onEdit();
    });
    const localControls = document.createElement("div");
    localControls.className = "design-token__controls";
    localControls.append(selector, assign);
    row.append(localControls);

    const value = document.createElement("input");
    value.type = "text";
    value.autocomplete = "off";
    value.value = tokenValue(source, token);
    value.setAttribute("aria-label", `Shared theme value for ${token.path}`);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.textContent = `Preview shared change (${tokenImpactCount(source, token)})`;
    preview.addEventListener("click", () => {
      const valid = previewThemeToken(source, token, value.value.trim());
      value.setAttribute("aria-invalid", String(!valid));
      if (valid) onEdit();
    });
    const themeControls = document.createElement("div");
    themeControls.className = "design-token__controls";
    themeControls.append(value, preview);
    row.append(themeControls);
    const scope = document.createElement("small");
    scope.className = "design-token__scope";
    scope.textContent = `Shared preview · ${token.impactSelector} · ${tokenImpactCount(source, token)} matching elements`;
    row.append(scope);
    group.append(row);
  }
  return group;
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
    group.append(row);
  }
  return group;
}
