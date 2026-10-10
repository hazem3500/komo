/**
 * Runtime bridge for explicitly registered React roots.
 *
 * TypeScript types do not exist at runtime. A build-time manifest supplies the
 * small, safe subset that can be edited; the consuming React app supplies a
 * state callback so preview changes go through React's normal render cycle.
 */
export type InspectableScalar = string | number | boolean | undefined;

export interface InspectableProp {
  name: string;
  kind: "string" | "number" | "boolean" | "enum" | "unsupported";
  required: boolean;
  values?: Array<string | number | boolean>;
  typeLabel: string;
}

export interface InspectableComponent {
  id: string;
  name: string;
  source: string;
  line: number;
  props: InspectableProp[];
  /** Explicitly map a leaf text rendering to one editable string prop. */
  textProp?: string;
}

export interface RegisteredInspectableComponent {
  definition: InspectableComponent;
  props: Record<string, InspectableScalar>;
  onChange(next: Record<string, InspectableScalar>): void;
  setProps(next: Record<string, InspectableScalar>): void;
}

export interface ReactPropEdit {
  element: HTMLElement;
  propName: string;
  before: InspectableScalar;
  after: InspectableScalar;
}

const registered = new WeakMap<Element, RegisteredInspectableComponent>();

function isScalar(value: unknown): value is InspectableScalar {
  return (
    value === undefined ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

export function isEditablePropValue(
  prop: InspectableProp,
  value: unknown,
): value is InspectableScalar {
  if (value === undefined) return !prop.required;
  if (!isScalar(value) || prop.kind === "unsupported") return false;
  if (prop.kind === "string") return typeof value === "string" && value.length <= 500;
  if (prop.kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (prop.kind === "boolean") return typeof value === "boolean";
  return prop.kind === "enum" && (prop.values ?? []).includes(value);
}

function safeProps(
  definition: InspectableComponent,
  props: Record<string, unknown>,
): Record<string, InspectableScalar> {
  const result: Record<string, InspectableScalar> = {};
  for (const prop of definition.props) {
    if (prop.kind === "unsupported") continue;
    const value = props[prop.name];
    if (isEditablePropValue(prop, value)) result[prop.name] = value;
  }
  return result;
}

/** Register one opt-in root. Never infers ownership from React private internals. */
export function registerInspectableRoot(
  element: HTMLElement,
  definition: InspectableComponent,
  props: Record<string, unknown>,
  onChange: (next: Record<string, InspectableScalar>) => void,
): () => void {
  const textProp = definition.textProp && definition.props.some(
    (prop) => prop.name === definition.textProp && prop.kind === "string",
  ) ? definition.textProp : undefined;
  const current = safeProps(definition, props);
  const record: RegisteredInspectableComponent = {
    definition,
    props: current,
    onChange,
    setProps(next) {
      const validated = safeProps(definition, next);
      if (Object.keys(validated).length !== Object.keys(next).length) return;
      for (const prop of definition.props) {
        if (prop.kind !== "unsupported" && prop.required && !(prop.name in validated)) return;
      }
      record.props = validated;
      record.onChange(validated);
    },
  };
  registered.set(element, record);
  element.dataset.komoInspectable = definition.id;
  if (textProp) element.dataset.komoTextProp = textProp;
  else delete element.dataset.komoTextProp;
  return () => {
    if (registered.get(element) !== record) return;
    registered.delete(element);
    if (element.dataset.komoInspectable === definition.id)
      delete element.dataset.komoInspectable;
    if (element.dataset.komoTextProp === textProp)
      delete element.dataset.komoTextProp;
  };
}

/** Refresh a registered root's latest state and callback without replacing its identity. */
export function updateInspectableRoot(
  element: HTMLElement | null,
  definition: InspectableComponent,
  props: Record<string, unknown>,
  onChange: (next: Record<string, InspectableScalar>) => void,
): void {
  if (!element) return;
  const record = registered.get(element);
  if (!record || record.definition.id !== definition.id) return;
  record.definition = definition;
  record.props = safeProps(definition, props);
  record.onChange = onChange;
  const textProp = definition.textProp && definition.props.some(
    (prop) => prop.name === definition.textProp && prop.kind === "string",
  ) ? definition.textProp : undefined;
  if (textProp) element.dataset.komoTextProp = textProp;
  else delete element.dataset.komoTextProp;
}

/** Find the nearest explicitly registered React component root for a DOM target. */
export function inspectableFor(
  target: Element | null,
): RegisteredInspectableComponent | null {
  let current = target;
  while (current) {
    const registeredComponent = registered.get(current);
    if (
      registeredComponent &&
      current.getAttribute("data-komo-inspectable") ===
        registeredComponent.definition.id
    )
      return registeredComponent;
    current = current.parentElement;
  }
  return null;
}
