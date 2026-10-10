import {
  inspectableFor,
  isEditablePropValue,
  type InspectableScalar,
  type RegisteredInspectableComponent,
} from "./react-inspector.js";

const originals = new Map<HTMLElement, Map<string, InspectableScalar>>();
const edits = new WeakMap<HTMLElement, Array<{ propName: string; before: InspectableScalar; after: InspectableScalar }>>();
const styledRoots = new WeakSet<ShadowRoot>();
const commentHandlers = new WeakMap<HTMLButtonElement, AbortController>();
const panelStyles = `.design-react-source{display:block;padding:0 0 8px;color:#898680;font-size:10px;overflow-wrap:anywhere}.design-react-field{grid-template-columns:76px minmax(0,1fr);padding:1px 0}.design-react-field input[type=checkbox]{justify-self:end;width:16px;height:16px;accent-color:#bda6ef}.design-react-field input:disabled{opacity:.65;cursor:not-allowed}.design-react-type{grid-column:2;color:#77736f;font-size:10px;margin-top:-5px;overflow-wrap:anywhere}.design-react-group .design-react-field{min-height:36px}`;

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
    if (!element || !inspectableFor(element)) return;
    event.stopImmediatePropagation();
    onComment(element, proposedReactChanges(element));
  }, { capture: true, signal: controller.signal });
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
): HTMLElement | null {
  const component = inspectableFor(element);
  if (!component) return null;
  const root = element.getRootNode();
  if (root instanceof ShadowRoot && !styledRoots.has(root)) {
    const style = document.createElement("style");
    style.textContent = panelStyles;
    root.append(style);
    styledRoots.add(root);
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
