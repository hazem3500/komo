let id = 0;

/** Visible names come from field metadata, never from the current value. */
export function fieldLabel(control: HTMLElement, field: { property: string; label: string; kind?: string; min?: number; max?: number }, container: HTMLElement, inline = false): HTMLLabelElement {
  container.dataset.fieldLabel = field.label;
  if (!inline) container.style.marginTop = "20px";
  const label = document.createElement("label");
  label.className = "design-field__label";
  if (!inline) label.style.cssText = "position:absolute;inset:auto 0 calc(100% + 4px);color:#b5b1ab;font-size:10px;line-height:14px;white-space:normal;overflow-wrap:anywhere;cursor:default";
  control.id ||= `komo-field-${++id}`;
  label.htmlFor = control.id;
  // Units show inside numeric fields (field-controls.ts); the label is the name alone.
  label.textContent = field.label;
  return label;
}
