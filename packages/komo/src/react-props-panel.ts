import { inlineStyleSnapshot } from "./design-preview.js";
import { previewStyle, watchPopup } from "./design-popup.js";
import { isDesignTarget, type DesignTarget } from "./design-target.js";
import {
  adaptComponentEditor,
  currentInspectableElement,
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
  resetAllDesignTokens,
  resetDesignTokens,
  resetThemeToken,
  restoreElementProperty,
  showThemeBefore,
  syncElementTokenBinding,
  tokenImpactCount,
  tokenSourceFor,
  tokenValue,
  undoDesignToken,
  type KomoDesignToken,
  type RegisteredDesignTokenSource,
} from "./design-tokens.js";
import type { ComponentIdentity, DesignSystem, DesignToken, DesignTokenType, ThemeAxis, TokenAdapter, TokenUsage } from "./design-system.js";
import type { ThemeValues, TokenPickerOptions } from "./token-picker.js";
import {
  closestToken,
  customTokenOverride,
  effectiveTokenUsage,
  hasCustomTokenOverrides,
  hasTokenSwaps,
  listTokens,
  markOffToken,
  offTokenMarker,
  previewToken,
  proposedTokenSwaps,
  refreshTokenSwaps,
  rememberTokenUsage,
  refreshTokenBaseline,
  resetAllTokenSwaps,
  resetTokenSwaps,
  resolveTokens,
  showTokenSwapsBefore,
  swappedProperties,
  swappedToken,
  swapToken,
  themeState,
  tokenName,
  tokensFor,
  tokenTitle,
  watchThemes,
} from "./token-adapter.js";
export { originalTokenStyle as originalDesignTokenStyle } from "./token-adapter.js";

const originals = new Map<DesignTarget, Map<string, InspectableScalar>>();
const edits = new Map<DesignTarget, Array<{ propName: string; before: InspectableScalar; after: InspectableScalar }>>();
/** Move only prop state; DOM styles, tokens and text keep their original ownership. */
export function retainReactPropTarget(element: DesignTarget): DesignTarget | null {
  const next = currentInspectableElement(element);
  if (!isDesignTarget(next)) return null;
  if (next !== element) {
    for (const map of [originals, edits, afterProps] as Array<Map<DesignTarget, unknown>>) {
      if (map.has(element)) { map.set(next, map.get(element)); map.delete(element); }
    }
  }
  return next;
}

export function retainReactPropSelection(
  previous: DesignTarget,
  controls: HTMLElement,
  context: { root: ShadowRoot; host: HTMLElement },
  history: ReadonlyArray<{ kind?: string; props?: boolean; element: DesignTarget }>,
  textTools: import("./inline-text-editor.js").InlineTextTools | null,
  retain: (element: DesignTarget, panel: HTMLElement | undefined) => void,
): boolean {
  if (previous instanceof HTMLElement && (textTools?.element === previous || textTools?.hasChanges(previous))) return false;
  const element = retainReactPropTarget(previous);
  if (!element || element === previous || context.host.contains(element)) return false;
  const panel = controls.querySelector<HTMLElement>(".design-react-group:not(.design-react-discovered)") ?? undefined;
  const focused = context.root.activeElement;
  for (const entry of history) if (!entry.kind && entry.props && entry.element === previous) entry.element = element;
  retain(element, panel);
  if (focused instanceof HTMLElement && panel?.contains(focused)) focused.focus({ preventScroll: true });
  return true;
}

export function attachDesignSystemControls(
  element: DesignTarget,
  controls: HTMLElement,
  panel: typeof import("./design-panel.js"),
  context: { root: ShadowRoot; design?: DesignSystem },
  options: {
    signal: AbortSignal;
    select(element: DesignTarget): void;
    refresh(): void;
    retainedProps?: HTMLElement;
    updateActions(): void;
    history: Array<{ element: DesignTarget; undo(): void; props?: boolean } | { kind: string; element: DesignTarget }>;
    syncStyles(): void;
    onStyleEdit: Parameters<typeof attachStyleTokenControls>[3];
    isFieldDirty?: (control: Element) => boolean;
  },
): void {
  const { root, design } = context;
  const { retainedProps, syncStyles, updateActions } = options;
  if (!retainedProps && controls.querySelector(".design-react-group, .design-theme-group")) return;
  const recordUndo = (undo?: () => void, props = false) => {
    if (undo) options.history.push({ element: props ? retainReactPropTarget(element) ?? element : element, props, undo: () => { undo(); syncStyles(); } });
    syncStyles();
    updateActions();
  };
  // Switching a theme re-renders the selection, so tokens, values and the outline follow it.
  attachThemeSwitcher(controls, design, () => options.select(element), root, options.signal);
  const props = retainedProps ?? createReactPropsPanel(element, undo => recordUndo(undo, true), root, options.select, design, options.refresh);
  if (props && !retainedProps) controls.prepend(props);
  attachStyleTokenControls(element, panel.fields, controls, options.onStyleEdit, root, panel.valueFor, panel.toHex, design, recordUndo, options.isFieldDirty);
  const theme = createDesignThemePanel(element, panel, options.updateActions, root);
  if (theme) controls.append(theme);
}

const styledRoots = new WeakSet<ShadowRoot>();
const commentHandlers = new WeakMap<HTMLButtonElement, AbortController>();
// React props, inline token chips and shared theme values, in the inspector's compact field style.
const panelStyles = `.design-react-source{display:block;padding:0 0 8px;color:#77736f;font-size:10px;overflow-wrap:anywhere}.design-react-inside{padding:10px 12px}.design-react-inside button{padding:0;border:0;background:none;color:#bda6ef;font:inherit;cursor:pointer}.design-react-inside button:hover{text-decoration:underline}.design-react-field.design-field{display:grid;grid-template-columns:76px minmax(0,1fr);gap:0 8px;height:auto;min-height:28px;margin-top:4px;background:none;box-shadow:none;color:#898680;font-size:11px}.design-react-field>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.design-react-field.design-field>:is(input,select){box-sizing:border-box;width:100%;min-width:0;height:28px;padding:0 8px;border:0;border-radius:6px;background-color:#ffffff0a;color:#f1efeb;font:inherit;font-size:11px}.design-react-field.design-field>:is(input,select):focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}.design-react-field.design-field>select{padding-right:20px}.design-react-field input[type=checkbox]{justify-self:end;width:14px;height:14px;accent-color:#bda6ef}.design-react-field input:disabled{opacity:.55;cursor:not-allowed}.design-react-type{display:none}.design-react-field .design-token-binding{grid-column:2;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;margin-top:4px;color:#77736f;font-size:10px}.design-react-field .design-token-binding select{min-width:0;height:24px;border:0;border-radius:6px;appearance:none;background:#ffffff0a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Cpath d='M1.5 3 4 5.5 6.5 3' fill='none' stroke='%23898680' stroke-width='1.2'/%3E%3C/svg%3E") right 6px center/8px no-repeat;color:#e9e6e1;padding:0 18px 0 6px;font:inherit;font-size:10px;cursor:pointer}.design-react-field .design-token-binding[data-mode=token] select{background-color:#bda6ef24;color:#e6dcfb}.design-token-binding__state{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.design-field>.design-token-binding{display:contents}.design-field:has(>.design-token-binding)>input[data-property]{padding-right:28px}.design-token-icon,.design-token-detach,.design-field>.design-token-binding select{position:absolute;top:4px;right:4px;width:20px;height:20px;box-sizing:border-box;border-radius:5px}.design-token-icon{display:grid;place-items:center;color:#77736f;opacity:0;pointer-events:none;transition:opacity .12s}.design-token-icon::before{content:'';width:6px;height:6px;border:1.2px solid currentColor;border-radius:1.5px;rotate:45deg}.design-field:is(:hover,:focus-within) .design-token-icon{opacity:1}.design-field>.design-token-binding select{margin:0;padding:0;border:0;opacity:0;cursor:pointer;appearance:none}.design-field>.design-token-binding select:hover+.design-token-icon,.design-field:has(.design-token-binding select:hover) .design-token-icon{background:#ffffff14;color:#e9e6e1}.design-field:has(.design-token-binding select:focus-visible) :is(.design-token-icon,.design-token-chip){outline:2px solid #bda6ef;outline-offset:1px;opacity:1}.design-field[data-token-mode=override] .design-token-icon{opacity:1;color:#e7c27d}.design-token-chip,.design-token-detach{display:none}.design-field:is([data-token-mode=token],[data-token-mode=connected])>[data-property]{visibility:hidden}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-chip{position:absolute;inset:4px 28px 4px var(--lead,4px);display:flex;align-items:center;gap:5px;padding:0 6px;border-radius:4px;background:#bda6ef1f;color:#e6dcfb;font-size:11px;white-space:nowrap;overflow:hidden;pointer-events:none}.design-token-chip::before{content:'';flex:none;width:5px;height:5px;border:1.2px solid #c8b5f4;border-radius:1px;rotate:45deg}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-binding select{left:var(--lead,4px);right:28px;width:auto}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-icon{display:none}.design-field:is([data-token-mode=token],[data-token-mode=connected]) .design-token-detach{display:grid;place-items:center;color:#898680}.design-token-detach:hover{background:#ffffff14;color:#f1efeb}.design-token-detach svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round}.design-theme-group .design-react-source{padding:0 0 6px}.design-theme-heading{display:block;padding:8px 0 2px;color:#77736f;font-size:10px;text-transform:capitalize}.design-theme-token{position:relative;display:grid;grid-template-columns:96px minmax(0,1fr) 20px;align-items:center;gap:6px;margin-top:4px}.design-theme-token>span{overflow:hidden;color:#898680;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.design-theme-token[data-changed]>span{color:#e6dcfb}.design-theme-token[data-changed]::before{content:'';position:absolute;top:calc(50% - 2px);left:-8px;width:4px;height:4px;border-radius:50%;background:#bda6ef}.design-theme-reset{display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:none;color:#77736f;cursor:pointer}.design-theme-reset:disabled{visibility:hidden}.design-theme-reset:hover{background:#ffffff14;color:#f1efeb}.design-theme-reset svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.design-token-off{position:absolute;top:8px;right:24px;display:grid;place-items:center;width:12px;height:12px}.design-token-off::before{content:'';width:4px;height:4px;border-radius:50%;background:#e7c27d;opacity:.7}.design-token-off[hidden]{display:none}.design-field:has(>.design-token-binding>.design-token-off:not([hidden]))>input[data-property]{padding-right:38px}.design-theme-switch{padding:6px 12px 8px}.design-theme-switch .design-react-field>span{text-transform:capitalize}.design-theme-options{display:flex;min-width:0;padding:2px;border-radius:6px;background:#ffffff0a}.design-theme-options button{flex:1;min-width:0;height:24px;padding:0 6px;border:0;border-radius:4px;background:none;color:#898680;font:inherit;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.design-theme-options button:hover{color:#f1efeb}.design-theme-options button[aria-pressed=true]{background:#ffffff1a;color:#f1efeb}.design-theme-options button:focus-visible{outline:1px solid #bda6ef;outline-offset:-1px}@media (max-width:520px){.design-theme-options button{height:30px}.design-react-field.design-field>:is(input,select){height:34px}.design-token-icon,.design-token-detach,.design-field>.design-token-binding select{top:7px}.design-token-off{top:11px}}.design-react-row{display:grid;grid-template-columns:minmax(0,1fr) 28px;align-items:center;gap:4px}.design-react-row>.design-react-field{flex:1;min-width:0;grid-template-columns:minmax(88px,.8fr) minmax(0,1fr);min-height:32px;gap:0 10px;margin-top:6px}.design-react-row .design-react-field>:is(input,select){height:32px}.design-react-row .design-react-field>span{white-space:normal;overflow-wrap:anywhere;line-height:1.4}.design-react-row>.design-theme-reset{flex:none;width:28px;height:28px;margin-top:6px}.design-react-row>.design-theme-reset[hidden]{display:none}.design-react-preview{font-size:10px;color:#8e8799}.design-react-group>.design-react-source:first-of-type{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.design-react-advanced{margin-top:10px}.design-react-advanced>summary{color:#898680;font-size:11px;cursor:pointer}.design-react-field input[readonly]{color:#aaa;background:#ffffff06;cursor:text}.design-react-row .design-react-field>input[type=checkbox]{width:16px;height:16px;margin:8px 0}.design-react-row .design-react-field:has(input[type=checkbox]){cursor:pointer}@media(max-width:520px){.design-react-row .design-react-field>:is(input,select){height:36px}.design-react-row>.design-theme-reset{width:32px;height:32px}}.design-theme-switch{position:relative;flex:none;padding:0}.design-theme-switch>summary{display:flex;align-items:center;gap:5px;max-width:90px;min-height:28px;padding:0 8px;border-radius:7px;background:#ffffff08;color:#b7b1c2;font-size:11px;list-style:none;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.design-theme-switch>summary::-webkit-details-marker{display:none}.design-theme-switch>summary::after{content:"⌄";color:#77736f}.design-theme-switch[open]>summary,.design-theme-switch>summary:hover{background:#ffffff14;color:#f1efeb}.design-theme-popup{position:absolute;z-index:12;top:calc(100% + 6px);right:0;box-sizing:border-box;width:min(280px,calc(100vw - 48px));max-height:50dvh;overflow:auto;padding:10px 12px;border:1px solid #ffffff1a;border-radius:10px;background:#191819;box-shadow:0 12px 40px #0008}.design-theme-popup .design-react-field{grid-template-columns:68px minmax(0,1fr)}.design-theme-popup .design-react-field+ .design-react-field{margin-top:8px}`;
// The token picker's "Matches … · Use token" suggestion under an off-token field.
const matchStyles = `.design-token-match{grid-column:1/-1;display:flex;align-items:center;gap:6px;min-width:0;margin-top:-2px;padding:0 4px;color:#77736f;font-size:10px}.design-token-match[hidden]{display:none}.design-token-match>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.design-token-match button{flex:none;padding:0;border:0;background:none;color:#bda6ef;font:inherit;cursor:pointer}.design-token-match button:hover{text-decoration:underline}.design-token-match button:focus-visible{outline:1px solid #bda6ef;outline-offset:2px;border-radius:2px}@media (pointer:coarse){.design-token-match button{min-height:32px}}`;

function scalarLabel(value: InspectableScalar): string {
  return value === undefined ? "unset" : JSON.stringify(value) ?? "unset";
}

const afterProps = new Map<DesignTarget, Record<string, InspectableScalar>>();
const componentSource = (component: RegisteredInspectableComponent) => component.definition.source
  ? `${component.definition.source}${component.definition.line ? `:${component.definition.line}` : ""}` : "";
/** Before/After for React prop previews and shared theme values. */
export function showDesignBefore(on: boolean): void {
  if (on)
    for (const [element, baseline] of originals) {
      const component = inspectableFor(element);
      if (!component) continue;
      afterProps.set(element, component.props);
      component.setProps({ ...component.props, ...Object.fromEntries(baseline) });
    }
  else for (const [element, props] of afterProps) inspectableFor(element)?.setProps(props);
  if (!on) afterProps.clear();
  showThemeBefore(on);
  showTokenSwapsBefore(on);
}

export function hasReactPropChanges(element: DesignTarget): boolean {
  return !!originals.get(element)?.size;
}

export interface ReactTextEditStart {
  propName: string;
  before: string;
}

/** Only an explicit registered textProp can drive a React-rendered inline edit. */
export function beginReactTextEdit(element: DesignTarget): ReactTextEditStart | null {
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
  element: DesignTarget,
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
  element: DesignTarget,
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

export function cancelReactTextEdit(element: DesignTarget, propName: string, before: string): void {
  previewReactTextEdit(element, propName, before);
  const baseline = originals.get(element);
  if (baseline?.get(propName) === before && !(edits.get(element) ?? []).some((edit) => edit.propName === propName)) {
    baseline.delete(propName);
    if (!baseline.size) originals.delete(element);
  }
}

export function canUndoReactProp(element: DesignTarget | null): boolean {
  return !!element && !!edits.get(element)?.length;
}

export function proposedReactChanges(element: DesignTarget): string | undefined {
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
    ...(componentSource(component) ? [`Source: ${componentSource(component)}`] : []),
    ...rows,
    "Runtime preview only; inline feedback does not write source files.",
  ].join("\n");
}

/**
 * What the app's component adapter names for `element`. A component registered
 * with useKomoInspectable wins: on its root, and around any element inside it
 * unless the adapter names a component nested within the registered root.
 */
function adapterIdentity(element: Element, design?: DesignSystem): ComponentIdentity | null {
  if (inspectableFor(element)) return null;
  let identity: ComponentIdentity | null | undefined;
  try { identity = design?.components?.identify(element); } catch { /* An adapter that throws names nothing. */ }
  const owner = inspectableAncestor(element);
  return identity?.name && (!owner || (owner.root !== identity.element && owner.root.contains(identity.element))) ? identity : null;
}

const oneLine = (value: unknown) => String(value).replace(/\s+/g, " ").trim();

/**
 * Context lines for a proposal, so agents and the CLI know what the change was
 * made in: "Theme: mode=dark", "Component: PromoCard (src/card.tsx:19)" and
 * 'Props: tone="calm"'. The registered React component wins, then the app's
 * component adapter, then the registered component around the element.
 */
export function designContext(element: DesignTarget, design?: DesignSystem): string[] {
  const theme = Object.entries(themeState(design)).map(([axis, option]) => `${oneLine(axis)}=${oneLine(option)}`).join(", ");
  let identity: { name: string; source?: string; props?: Record<string, unknown> } | null | undefined = adapterIdentity(element, design);
  const own = inspectableFor(element);
  const registered = own ? { root: element, component: own } : identity ? undefined : inspectableAncestor(element);
  if (registered) {
    const { definition, props } = registered.component;
    // Props as the page had them, before this session's previews.
    identity = { name: definition.name, source: componentSource(registered.component), props: { ...props, ...Object.fromEntries(originals.get(registered.root) ?? []) } };
  }
  const props = Object.entries(identity?.props ?? {})
    .filter(([, value]) => value === null || ["boolean", "number"].includes(typeof value) || (typeof value === "string" && value.length <= 80))
    .slice(0, 12)
    // A stray arrow would read as a change on the comment card.
    .map(([name, value]) => `${oneLine(name)}=${JSON.stringify(value).replace(/→/g, "\\u2192")}`);
  return [
    theme && `Theme: ${theme}`,
    identity?.name && `Component: ${oneLine(identity.name)}${identity.source ? ` (${oneLine(identity.source)})` : ""}`,
    props.length && `Props: ${props.join(", ")}`,
  ].filter((line): line is string => !!line);
}

export function proposedDesignChanges(element: DesignTarget): string | undefined {
  return [proposedReactChanges(element), proposedDesignTokenChanges(element), proposedTokenSwaps(element)]
    .filter((value): value is string => !!value)
    .join("\n\n") || undefined;
}

export function installCommentCapture(
  button: HTMLButtonElement,
  selected: () => DesignTarget | null,
  onComment: (element: Element, proposal?: string) => void,
): void {
  commentHandlers.get(button)?.abort();
  const controller = new AbortController();
  commentHandlers.set(button, controller);
  button.addEventListener("click", (event) => {
    const element = selected();
    if (!element) return;
    const tokenProposal = proposedDesignTokenChanges(element) || hasTokenSwaps(element);
    if (!inspectableFor(element) && !tokenProposal) return;
    event.stopImmediatePropagation();
    onComment(element, proposedDesignChanges(element));
  }, { capture: true, signal: controller.signal });
}

export function canUndoDesignTokenEdit(element: DesignTarget | null): boolean {
  return canUndoDesignToken(element);
}

export function hasDesignTokenEdit(element: DesignTarget): boolean {
  return hasDesignTokenChanges(element) || hasTokenSwaps(element) || hasCustomTokenOverrides(element);
}

export function undoDesignTokenEdit(element: DesignTarget): void {
  undoDesignToken(element);
}

export function resetDesignTokenEdits(element: DesignTarget): void {
  resetDesignTokens(element);
  resetTokenSwaps(element);
}

function ensurePanelStyles(styleRoot?: ShadowRoot): void {
  if (!styleRoot || styledRoots.has(styleRoot)) return;
  const style = document.createElement("style");
  style.textContent = panelStyles + matchStyles;
  styleRoot.append(style);
  styledRoots.add(styleRoot);
}

/**
 * The token select keeps its value and labels but opens the token picker, loaded on
 * demand, instead of a plain list. A mouse opens on press; a touch or pen on a
 * release that did not move, since a drag that starts there scrolls the panel.
 */
function pickerTrigger(select: HTMLSelectElement, options: () => Omit<TokenPickerOptions, "trigger">) {
  select.dataset.picker = "token";
  select.setAttribute("aria-haspopup", "dialog");
  select.setAttribute("aria-expanded", "false");
  let loaded: typeof import("./token-picker.js") | undefined;
  const show = (toggle: boolean) => import("./token-picker.js").then((picker) => {
    loaded = picker;
    if (!select.isConnected || select.disabled || (!toggle && select.getAttribute("aria-expanded") === "true")) return;
    picker.openTokenPicker({ trigger: select, ...options() }, toggle);
  }, () => {});
  let press: PointerEvent | undefined;
  select.addEventListener("pointerdown", (event) => {
    if (event.button) return;
    event.preventDefault();
    press = event.pointerType === "mouse" ? undefined : event;
    if (press) return;
    select.focus();
    void show(true);
  });
  select.addEventListener("pointerup", (event) => {
    if (press && Math.abs(event.clientY - press.clientY) <= 10) void show(true);
    press = undefined;
  });
  for (const type of ["mousedown", "touchend"]) select.addEventListener(type, (event) => { if (event.cancelable) event.preventDefault(); });
  select.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || !["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    void show(false);
  });
  return {
    prepare: () => loaded?.refreshTokenPicker(select),
    refresh: () => loaded?.refreshTokenPicker(select, { trigger: select, ...options() }),
  };
}

function scheduleThemeFieldSync(target: Element, refresh: () => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const view = target.ownerDocument.defaultView;
  if (!view) return;
  refresh();
  let frame = 0;
  let runs = 0;
  const tick = () => {
    if (signal.aborted) return;
    refresh();
    if (++runs > 120) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      for (let node: Element | null = target; node; node = node.parentElement) {
        if (node.getAnimations?.().some(animation => animation.playState === "running")) {
          tick();
          return;
        }
      }
    });
  };
  tick();
  view.setTimeout(() => { if (!signal.aborted) refresh(); }, 320);
}

function bindFieldThemeRefresh(
  label: HTMLElement,
  element: Element,
  input: Element,
  refresh: () => void,
  isFieldDirty?: (control: Element) => boolean,
): void {
  const root = label.getRootNode();
  const events = new AbortController();
  const cleanup = new MutationObserver(() => { if (!input.isConnected) events.abort(); });
  cleanup.observe(root instanceof ShadowRoot ? root : document, { childList: true, subtree: true });
  root.addEventListener("komo-theme-change", () => {
    if (isFieldDirty?.(input)) return;
    scheduleThemeFieldSync(element, refresh, events.signal);
  }, { signal: events.signal });
  events.signal.addEventListener("abort", () => cleanup.disconnect(), { once: true });
}

/** Custom uses the field's existing transaction handlers for one undoable commit. */
function customPickerValue(element: DesignTarget, property: string, input?: HTMLElement | null): TokenPickerOptions["custom"] {
  if (!(input instanceof HTMLInputElement) || input.type === "number") return;
  return {
    value: getComputedStyle(element).getPropertyValue(property).trim(),
    onPreview(value) {
      const before = inlineStyleSnapshot(element, property);
      element.style.setProperty(property, value, "important");
      return before.restore;
    },
    onSelect(value) {
      input.dispatchEvent(new Event("focus"));
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
  };
}

/**
 * "Matches Text primary · Use token" under a field whose off-token value equals a
 * relevant token's value. Only a suggestion: the field stays unbound until Use token.
 */
function matchSuggestion(field: HTMLElement | null | undefined, row: HTMLElement): { show(match: DesignToken | undefined, use: () => void): void } {
  const line = document.createElement("div");
  line.className = "design-token-match";
  line.hidden = true;
  const text = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Use token";
  line.append(text, button);
  let use = () => {};
  button.addEventListener("click", (event) => {
    event.preventDefault();
    use();
  });
  return {
    show(match, then) {
      if (!line.isConnected) (field ?? row.parentElement)?.after(line);
      line.hidden = !match;
      use = then;
      const propertyLabel = (field ?? row.parentElement)?.dataset.fieldLabel;
      text.textContent = match ? `${propertyLabel ? `${propertyLabel} · ` : ""}Same ${match.type === "color" ? "color" : "value"} as ${match.label || match.path}` : "";
      text.title = match ? `${match.path}${match.ref ? ` · ${match.ref}` : ""} · ${match.value}` : "";
      button.setAttribute("aria-label", match ? `Use token ${match.label || match.path}` : "Use token");
    },
  };
}

/** The adapter's list for each option of the first two- or three-option theme axis, fetched when a picker opens. */
function themeValues(adapter: TokenAdapter, design?: DesignSystem): (() => Promise<ThemeValues[]>) | undefined {
  const axis = (Array.isArray(design?.themes) ? design.themes : []).find((item) => Array.isArray(item?.options) && item.options.length > 1 && item.options.length < 4);
  if (!axis) return undefined;
  return () => Promise.all(axis.options.map((option) =>
    listTokens(adapter, { ...themeState(design), [axis.id]: option.id }).then((list) => ({
      label: titled(option.label, option.id),
      values: new Map(list.map((token) => [token.path, token.value])),
    })))).catch(() => []);
}

/** Add token references directly to the existing style-property row. */
export function createElementTokenControl(
  element: DesignTarget,
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
  const off = offTokenMarker();
  const asToken = (token: KomoDesignToken): DesignToken => ({
    path: token.path, type: token.type as DesignTokenType, value: tokenValue(source, token),
    properties: token.properties, group: token.path.split(".")[0], ref: token.cssVariable,
  });
  const suggestion = matchSuggestion(null, row);
  const choose = (path: string) => {
    select.value = path;
    select.dispatchEvent(new Event("change"));
  };
  pickerTrigger(select, () => ({
    tokens: available.map(asToken),
    property,
    current: select.value,
    custom: customPickerValue(element, property, row.parentElement?.querySelector("[data-property]")),
    onPreview: token => {
      const target = available.find(item => item.path === token.path)!;
      return previewStyle(element, property, `var(${target.cssVariable})`);
    },
    onSelect: (token) => choose(token.path),
  }));
  const update = () => {
    const binding = elementTokenBindingFor(source, element, property);
    const declared = binding ? null : declaredTokenFor(source, element, property);
    const linked = binding?.mode === "token" ? available.find((token) => token.path === binding.tokenPath) : undefined;
    const active = linked ?? declared?.token;
    select.value = active?.path ?? "custom";
    chip.textContent = active ? `Uses ${active.path}` : "";
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
    // Like the default adapter's resolve(): no token reference means off-token.
    off.hidden = mode !== "custom";
    const value = mode === "custom" ? getComputedStyle(element).getPropertyValue(property).trim() : "";
    const match = mode === "custom" ? closestToken(available.map(asToken), value) : undefined;
    if (mode === "custom") markOffToken(off, value, match);
    suggestion.show(match, () => match && choose(match.path));
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
  row.append(chip, select, icon, detach, off, state);
  queueMicrotask(update);
  update();
  return row;
}

/** Properties whose before/after is described by token provenance instead of raw CSS. */
export function tokenBoundProperties(element: DesignTarget): Set<string> {
  const source = tokenSourceFor(element);
  return new Set([...source?.elementBindings.get(element)?.keys() ?? [], ...swappedProperties(element)]);
}

export function attachStyleTokenControls<T extends { property: string; kind?: string }>(
  element: DesignTarget,
  fields: readonly T[],
  container: HTMLElement,
  onEdit: (field: T, input: HTMLInputElement | HTMLSelectElement, before: string) => void,
  styleRoot?: ShadowRoot,
  valueFor?: (field: T, element: DesignTarget) => string,
  toHex?: (value: string) => string,
  design?: DesignSystem,
  onSwap?: (undo: () => void) => void,
  isFieldDirty?: (control: Element) => boolean,
): void | Promise<void> {
  // Fields are found now, so an adapter that answers late never reaches a newer selection's fields.
  const found = fields.flatMap((field) => {
    const label = [...container.querySelectorAll<HTMLElement>("[data-field-property]")]
      .find((candidate) => candidate.dataset.fieldProperty === field.property);
    const input = label?.querySelector<HTMLInputElement | HTMLSelectElement>("[data-property]");
    return label && input ? [{ field, label, input }] : [];
  });
  const each = (attach: (field: T, label: HTMLElement, input: HTMLInputElement | HTMLSelectElement, refresh: () => void) => HTMLElement | null) => {
    for (const { field, label, input } of found) {
      if (label.querySelector(".design-token-binding") || !container.contains(label)) continue;
      const refresh = () => {
        if (valueFor) input.value = valueFor(field, element);
        const dial = label.querySelector<HTMLInputElement>('input[type="range"],input[type="color"]');
        if (dial) dial.value = field.kind === "color" && toHex ? toHex(input.value) : input.value;
      };
      const control = attach(field, label, input, refresh);
      if (control) {
        label.append(control);
        const swatch = label.querySelector<HTMLInputElement>('input[type="color"]');
        const trigger = control.querySelector("select");
        const open = (event: Event) => {
          event.preventDefault();
          trigger?.focus();
          trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        };
        swatch?.addEventListener("click", open);
        swatch?.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") open(event); });
      }
      bindFieldThemeRefresh(label, element, input, refresh, isFieldDirty);
    }
  };
  const adapter = design?.tokens;
  if (!adapter) {
    each((field, _label, input, refresh) => createElementTokenControl(element, field.property, (before) => {
      onEdit(field, input, before);
      refresh();
    }, styleRoot));
    return;
  }
  // The app's adapter replaces CSS-variable chips on fields; it may answer
  // asynchronously, so controls join the already-rendered fields when it does.
  ensurePanelStyles(styleRoot);
  const themes = themeValues(adapter, design);
  return Promise.all([listTokens(adapter, themeState(design)), resolveTokens(adapter, element)]).then(([tokens, usage]) => {
    each((field, label, input, refresh) => createAdapterTokenControl(adapter, element, field.property, tokens, usage[field.property], (undo) => {
      onSwap?.(undo);
      refresh();
    }, label, input, themes, refresh, () => listTokens(adapter, themeState(design))));
  }, () => {});
}

/** A field's token chip, suggestions and off-token marker, driven by the app's adapter. */
export function createAdapterTokenControl(
  adapter: TokenAdapter,
  element: DesignTarget,
  property: string,
  tokens: readonly DesignToken[],
  usage: TokenUsage | undefined,
  onSwap: (undo: () => void) => void,
  label?: HTMLElement,
  input?: HTMLElement,
  themes?: () => Promise<ThemeValues[]>,
  refresh?: () => void,
  reload?: () => Promise<DesignToken[]>,
): HTMLElement | null {
  let available = tokensFor(tokens, property);
  if (!available.length && !usage) return null;
  const initialUsage = rememberTokenUsage(element, property, usage, adapter, tokens);
  const off = usage && "offToken" in usage ? usage.offToken : undefined;
  const match = off === undefined ? undefined : closestToken(available, off);
  const row = document.createElement("span");
  row.className = "design-token-binding";
  const chip = document.createElement("span");
  chip.className = "design-token-chip";
  chip.setAttribute("aria-hidden", "true");
  const icon = document.createElement("span");
  icon.className = "design-token-icon";
  icon.setAttribute("aria-hidden", "true");
  const detach = document.createElement("button");
  detach.type = "button";
  detach.className = "design-token-detach";
  detach.title = "Edit the value";
  detach.setAttribute("aria-label", `Edit ${property} value`);
  detach.innerHTML = '<svg viewBox="0 0 12 12"><path d="M5 3.5 6.5 2a2.1 2.1 0 0 1 3 3L8 6.5M7 8.5 5.5 10a2.1 2.1 0 0 1-3-3L4 5.5M2 2l8 8"/></svg>';
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Style token for ${property}`);
  select.disabled = !available.length;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Choose a token";
  select.append(none);
  // Grouped by the adapter's group, in list order; ungrouped tokens come first.
  const populate = () => {
    select.replaceChildren(none);
    select.disabled = !available.length;
    const groups = new Map<string, HTMLElement>([["", select]]);
    for (const token of available) {
      const key = token.group ?? "";
      let group = groups.get(key);
      if (!group) {
        group = document.createElement("optgroup");
        (group as HTMLOptGroupElement).label = key;
        groups.set(key, group);
      }
      const option = document.createElement("option");
      option.value = token.path;
      option.textContent = `${tokenName(token)}${token.ref ? ` · ${token.ref}` : ""}${token === match ? " · same value" : ""}`;
      option.title = tokenTitle(token);
      group.append(option);
    }
    for (const [key, group] of groups) if (key) select.append(group);
  };
  populate();
  const dot = offTokenMarker();
  if (off !== undefined) markOffToken(dot, off, match);
  const state = document.createElement("small");
  state.className = "design-token-binding__state";
  state.setAttribute("aria-live", "polite");
  let detached = false;
  const suggestion = matchSuggestion(label, row);
  const current = () => {
    const effective = effectiveTokenUsage(element, property, usage);
    return detached ? undefined : effective && "path" in effective ? effective.path : undefined;
  };
  const picker = pickerTrigger(select, () => ({ tokens, property, current: current(), themes,
    custom: customPickerValue(element, property, input),
    onPreview: token => {
      const undo = previewToken(adapter, element, property, token);
      refresh?.();
      return () => { undo(); refresh?.(); };
    }, onSelect: choose }));
  const update = () => {
    const swapped = swappedToken(element, property);
    const path = current();
    const token = path ? tokens.find((item) => item.path === path) : undefined;
    select.value = path && available.some((item) => item.path === path) ? path : "";
    chip.textContent = token ? `Uses ${tokenName(token)}` : path ? `Uses ${path}` : "";
    const mode = !path ? "custom" : swapped ? "token" : "connected";
    row.dataset.mode = mode;
    (label ?? row.parentElement)?.setAttribute("data-token-mode", mode);
    dot.hidden = !!path;
    const effective = effectiveTokenUsage(element, property, usage);
    const value = effective && "offToken" in effective ? effective.offToken : getComputedStyle(element).getPropertyValue(property).trim() || off || "";
    const match = path ? undefined : closestToken(available, value);
    if (!path) markOffToken(dot, value, match);
    state.textContent = token ? `${swapped ? "Preview" : "Uses"} ${tokenTitle(token)}` : path ? `Uses ${path}` : dot.hidden ? "" : dot.title;
    select.title = state.textContent || "Choose a token";
    suggestion.show(dot.hidden ? undefined : match, () => match && choose(match));
  };
  function choose(token: DesignToken) {
    detached = false;
    const from: TokenUsage = initialUsage ?? { offToken: getComputedStyle(element).getPropertyValue(property).trim() };
    const fromToken = "path" in from ? tokens.find((item) => item.path === from.path) : undefined;
    onSwap(swapToken(adapter, element, property, token, from, fromToken));
    update();
  }
  select.addEventListener("change", () => {
    const token = available.find((item) => item.path === select.value);
    if (token) choose(token);
    else update();
  });
  detach.addEventListener("click", () => {
    detached = true;
    update();
    input?.focus();
  });
  row.append(chip, select, icon, detach, dot, state);
  const observer = new MutationObserver(update);
  observer.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
  const events = new AbortController();
  const cleanup = new MutationObserver(() => {
    if (!row.isConnected) { observer.disconnect(); cleanup.disconnect(); events.abort(); }
  });
  cleanup.observe(document, { childList: true, subtree: true });
  const root = label?.getRootNode();
  if (root instanceof ShadowRoot) cleanup.observe(root, { childList: true, subtree: true });
  root?.addEventListener("komo-theme-changing", picker.prepare, { signal: events.signal });
  let request = 0;
  root?.addEventListener("komo-theme-change", () => {
    const at = ++request;
    void (reload?.() ?? Promise.resolve([...tokens])).then(next => {
      if (events.signal.aborted || at !== request) return;
      tokens = next;
      refreshTokenBaseline(element, adapter, tokens);
      available = tokensFor(tokens, property);
      populate();
      update();
      picker.refresh();
    }, () => {});
  }, { signal: events.signal });
  update();
  return row;
}

function watchDesignTheme(design: DesignSystem | undefined, root: ShadowRoot, signal: AbortSignal): void {
  let request = 0;
  watchThemes(design, root.ownerDocument, () => {
    const at = ++request, adapter = design?.tokens;
    root.dispatchEvent(new Event("komo-theme-changing"));
    void (adapter ? listTokens(adapter, themeState(design)) : Promise.resolve([])).then(tokens => {
      if (signal.aborted || at !== request) return;
      root.dispatchEvent(new Event("komo-theme-changing"));
      if (adapter) refreshTokenSwaps(adapter, tokens);
      root.dispatchEvent(new Event("komo-theme-change"));
    }, () => {});
  }, signal);
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
  element: DesignTarget,
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

export function noteDesignTokenOverride(element: DesignTarget, property: string, value: string) {
  const source = tokenSourceFor(element);
  if (source) noteElementTokenOverride(source, element, property, value);
  return customTokenOverride(element, property);
}

export function syncDesignTokenBinding(element: DesignTarget, property: string): void {
  const source = tokenSourceFor(element);
  if (source) syncElementTokenBinding(source, element, property);
}

export function undoReactProp(element: DesignTarget): void {
  element = retainReactPropTarget(element) ?? element;
  const history = edits.get(element);
  const edit = history?.at(-1);
  const component = inspectableFor(element);
  if (!edit || !component) return;
  const initial = history!.find(item => item.propName === edit.propName)!.before;
  history!.pop();
  component.setProps({ ...component.props, [edit.propName]: edit.before });
  let baseline = originals.get(element);
  if (!baseline) originals.set(element, baseline = new Map());
  if (Object.is(initial, edit.before)) {
    baseline.delete(edit.propName);
    component.releaseProps?.([edit.propName]);
  }
  else baseline.set(edit.propName, initial);
  if (!baseline.size) originals.delete(element);
}

/** Undo every prop, token and theme preview, and put switched themes back, e.g. when Design mode closes. */
export function resetPreviews(): void {
  for (const element of [...originals.keys()]) resetReactProps(element);
  originals.clear();
  edits.clear();
  resetAllDesignTokens();
  resetAllTokenSwaps();
  restoreThemes();
}

/** Each axis's option from before Design mode first switched it. */
const themeOriginals = new Map<ThemeAxis, string>();
/** The axis whose control had focus, so a re-render can hand focus back to it. */
let themeFocus: ThemeAxis | undefined;
const themeClosers = new WeakMap<HTMLDetailsElement, () => void>();
const themeWatched = new WeakSet<AbortSignal>();

function currentTheme(axis: ThemeAxis): string | undefined {
  try { return String(axis.current()); } catch { return undefined; }
}

/** Put every axis Design mode switched back to its original option. */
export function restoreThemes(container?: HTMLElement): void {
  for (const [axis, id] of themeOriginals)
    try { if (currentTheme(axis) !== id) axis.apply(id); } catch { /* An adapter that throws keeps its state. */ }
  themeOriginals.clear();
  const menu = container?.querySelector<HTMLDetailsElement>(".design-theme-switch");
  if (menu) { themeClosers.get(menu)?.(); menu.remove(); }
}

const titled = (label: string | undefined, id: string) => label || id.charAt(0).toUpperCase() + id.slice(1);

/**
 * A compact header menu with one row per theme axis: a segmented control for two or
 * three options, a select for more. Theme is context, not an edit, so switching
 * isn't counted, undone, reset or flipped by Before/After; Design mode restores
 * each axis's original option when it closes. `onSwitch` re-renders the panel,
 * so token lists, chips and values follow the new theme.
 */
export function attachThemeSwitcher(
  container: HTMLElement,
  design: DesignSystem | undefined,
  onSwitch: () => void,
  styleRoot?: ShadowRoot,
  signal?: AbortSignal,
): void {
  if (styleRoot && signal && !themeWatched.has(signal)) {
    themeWatched.add(signal);
    watchDesignTheme(design, styleRoot, signal);
  }
  const heading = container.closest(".design-inspector")?.querySelector(".design-inspector__heading");
  const previous = (heading ?? container).querySelector<HTMLDetailsElement>(".design-theme-switch");
  const wasOpen = previous?.open ?? false;
  if (previous) themeClosers.get(previous)?.();
  previous?.remove();
  const group = document.createElement("details");
  group.className = "design-theme-switch";
  const trigger = document.createElement("summary");
  trigger.setAttribute("aria-label", "Preview theme");
  const popup = document.createElement("div");
  popup.className = "design-theme-popup";
  popup.setAttribute("role", "group");
  popup.setAttribute("aria-label", "Theme preview options");
  group.append(trigger, popup);
  const currentLabels: string[] = [];
  const refreshers: Array<() => string> = [];
  const themes = design?.themes;
  let focus: HTMLElement | undefined;
  for (const axis of Array.isArray(themes) ? themes : []) {
    const current = currentTheme(axis);
    const options = Array.isArray(axis?.options) ? axis.options.filter((option) => typeof option?.id === "string") : [];
    if (current === undefined || options.length < 2) continue;
    const label = titled(axis.label, String(axis.id));
    const choose = (id: string) => {
      const before = currentTheme(axis);
      if (id === before) return;
      if (!themeOriginals.has(axis)) themeOriginals.set(axis, before ?? current);
      themeFocus = axis;
      try { axis.apply(id); } catch { /* The page keeps whatever the adapter managed to apply. */ }
      onSwitch();
    };
    const row = document.createElement(options.length > 3 ? "label" : "div");
    row.className = "design-field design-react-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    let control: HTMLElement;
    if (options.length > 3) {
      const select = document.createElement("select");
      for (const option of options) select.append(new Option(titled(option.label, option.id), option.id));
      select.value = current;
      select.setAttribute("aria-label", `${label} theme`);
      select.addEventListener("change", () => choose(select.value));
      control = select;
    } else {
      control = document.createElement("div");
      control.className = "design-theme-options";
      control.setAttribute("role", "group");
      control.setAttribute("aria-label", `${label} theme`);
      for (const option of options) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = titled(option.label, option.id);
        button.setAttribute("aria-pressed", String(option.id === current));
        button.addEventListener("click", () => choose(option.id));
        control.append(button);
      }
    }
    if (themeFocus === axis) focus = control.querySelector<HTMLElement>("[aria-pressed=true]") ?? control;
    refreshers.push(() => {
      const value = currentTheme(axis) ?? current;
      if (control instanceof HTMLSelectElement) control.value = value;
      else control.querySelectorAll("button").forEach((button, index) => button.setAttribute("aria-pressed", String(options[index].id === value)));
      return `${label}: ${titled(options.find(option => option.id === value)?.label, value)}`;
    });
    row.append(caption, control);
    popup.append(row);
  }
  themeFocus = undefined;
  if (!popup.childElementCount) return;
  const sync = () => {
    currentLabels.splice(0, currentLabels.length, ...refreshers.map(refresh => refresh()));
    trigger.textContent = currentLabels[0].split(": ").slice(1).join(": ") + (currentLabels.length > 1 ? ` +${currentLabels.length - 1}` : "");
    trigger.title = `Preview theme · ${currentLabels.join(" · ")}`;
  };
  sync();
  group.open = wasOpen || !!focus;
  const events = new AbortController();
  const popupSignal = events.signal;
  const close = () => { group.open = false; };
  themeClosers.set(group, () => { close(); events.abort(); });
  group.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" && event.target === trigger) {
      event.preventDefault();
      group.open = true;
      popup.querySelector<HTMLElement>("button,select")?.focus();
    }
  });
  group.addEventListener("focusout", event => {
    if (event.relatedTarget instanceof Node && !group.contains(event.relatedTarget)) close();
  });
  ensurePanelStyles(styleRoot);
  if (heading) heading.insertBefore(group, heading.querySelector(".design-inspector__close"));
  else container.prepend(group);
  group.getRootNode().addEventListener("komo-theme-change", sync, { signal: popupSignal });
  group.getRootNode().addEventListener("pointerdown", event => { if (!event.composedPath().includes(group)) close(); }, { capture: true, signal: popupSignal });
  group.ownerDocument.defaultView?.addEventListener("keydown", event => {
    if (!group.open || event.key !== "Escape" || !event.composedPath().includes(group)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
    trigger.focus();
  }, { capture: true, signal: popupSignal });
  watchPopup(trigger, () => { close(); if (!trigger.isConnected) events.abort(); }, popupSignal);
  focus?.focus({ preventScroll: true });
}

export function resetReactProps(element: DesignTarget): void {
  element = retainReactPropTarget(element) ?? element;
  const baseline = originals.get(element);
  const component = inspectableFor(element);
  if (!baseline?.size || !component) return;
  component.setProps({ ...component.props, ...Object.fromEntries(baseline) });
  component.releaseProps?.([...baseline.keys()]);
  originals.delete(element);
  edits.delete(element);
}

/** Props belong to the registered root; a descendant only points back to it. */
function insideComponent(
  element: DesignTarget,
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
  element: DesignTarget,
  component: RegisteredInspectableComponent,
  propName: string,
  value: InspectableScalar,
  control: HTMLInputElement | HTMLSelectElement,
  onEdit: (undo?: () => void) => void,
) {
  element = retainReactPropTarget(element) ?? element;
  const definition = component.definition.props.find((prop) => prop.name === propName);
  if (!definition || !isEditablePropValue(definition, value)) {
    control.setAttribute("aria-invalid", "true");
    return false;
  }
  control.removeAttribute("aria-invalid");
  let before: InspectableScalar;
  try {
    const props = component.props;
    before = props[propName];
    if (Object.is(before, value)) return true;
    component.setProps({ ...props, [propName]: value });
  }
  catch {
    control.setAttribute("aria-invalid", "true");
    control.title = "Runtime preview is unavailable. The component kept its current props.";
    return false;
  }
  let elementOriginals = originals.get(element);
  if (!elementOriginals) originals.set(element, (elementOriginals = new Map()));
  const initial = elementOriginals.has(propName)
    ? elementOriginals.get(propName)
    : (edits.get(element)?.find(edit => edit.propName === propName) ?? { before }).before;
  if (Object.is(initial, value)) {
    elementOriginals.delete(propName);
    component.releaseProps?.([propName]);
  }
  else elementOriginals.set(propName, initial);
  if (!elementOriginals.size) originals.delete(element);
  let elementEdits = edits.get(element);
  if (!elementEdits) edits.set(element, (elementEdits = []));
  elementEdits.push({ propName, before, after: value });
  onEdit(() => undoReactProp(element));
  return true;
}

export function createReactPropsPanel(
  element: DesignTarget,
  onEdit: (undo?: () => void) => void,
  styleRoot?: ShadowRoot,
  select?: (root: DesignTarget) => void,
  design?: DesignSystem,
  refresh?: () => void,
): HTMLElement | null {
  let component = inspectableFor(element);
  if (!component) {
    const found = adapterIdentity(element, design);
    let editor;
    try { editor = found && design?.components?.editor?.(found); } catch { /* Unsupported editors stay read-only. */ }
    if (editor && found && isDesignTarget(found.element)) {
      if (found.element !== element) {
        ensurePanelStyles(styleRoot);
        const line = document.createElement("small");
        line.className = "design-react-source design-react-group design-react-inside";
        line.append(`Inside ${found.name}`);
        if (select) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Select component";
          button.addEventListener("click", () => select(found.element as DesignTarget));
          line.append(" · ", button);
        }
        return line;
      }
      component = adaptComponentEditor(found, editor);
    }
    if (!component) {
      let discovered: HTMLElement | null = null;
      try { discovered = (found && design?.components?.panel?.(found)) || null; } catch { /* A panel that throws shows nothing. */ }
      if (discovered) ensurePanelStyles(styleRoot);
      return discovered ?? insideComponent(element, select, styleRoot);
    }
  }
  ensurePanelStyles(styleRoot);
  const group = document.createElement("details");
  group.className = "design-group design-react-group";
  group.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Properties";
  group.append(summary);
  const source = document.createElement("small");
  source.className = "design-react-source";
  source.textContent = `${component.definition.name}${componentSource(component) ? ` · ${componentSource(component)}` : ""}`;
  source.title = source.textContent;
  group.append(source);
  const hint = document.createElement("small");
  hint.className = "design-react-source design-react-preview";
  hint.textContent = "Runtime preview · Undo or Reset to restore";
  group.append(hint);

  const editable = component;
  const synchronizers: Array<() => void> = [];
  if (refresh && component.subscribe) {
    let frame = 0;
    let dirty = false;
    const events = new AbortController();
    const root = group.getRootNode() as ShadowRoot | Document;
    const schedule = () => {
      if (frame || !group.isConnected) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!group.isConnected) return;
        const root = group.getRootNode() as ShadowRoot | Document;
        const focused = root.activeElement;
        synchronizers.forEach(sync => sync());
        if (focused?.closest(".design-inspector,.komo-tokens,.komo-select") || root.querySelector(".komo-tokens,.komo-select")) return;
        dirty = false;
        refresh();
      });
    };
    const unsubscribe = component.subscribe(() => {
      element = retainReactPropTarget(element) ?? element;
      dirty = true; schedule();
    });
    const scope = styleRoot ?? root;
    scope.addEventListener("focusout", () => { queueMicrotask(() => { if (dirty) schedule(); }); }, { signal: events.signal });
    const stop = () => { unsubscribe(); cancelAnimationFrame(frame); events.abort(); };
    queueMicrotask(() => {
      // Preview cancellation can retain this panel; its subscription follows DOM lifetime.
      if (group.isConnected) watchPopup(group, () => { if (!group.isConnected) stop(); }, events.signal);
      else stop();
    });
  }
  for (const prop of component.definition.props.filter(prop => prop.kind !== "unsupported")) {
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
        input.indeterminate = value === undefined;
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
      row.title = `Inline feedback does not edit ${prop.typeLabel} props.`;
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
        recordChange(element, editable, prop.name, next, control, onEdit);
      };
      control.addEventListener("change", apply);
    }
    caption.title = prop.name;
    row.append(caption, control);
    const wrapper = document.createElement("div");
    wrapper.className = "design-react-row";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "design-theme-reset";
    reset.setAttribute("aria-label", `Reset ${component.definition.name} ${prop.name}`);
    reset.title = "Restore the value before editing";
    reset.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2.5 2.5v3h3M3 5.5a5.5 5.5 0 1 1-.5 2.5"/></svg>';
    const syncReset = () => { reset.hidden = !originals.get(element)?.has(prop.name); };
    synchronizers.push(() => {
      if (control === (control.getRootNode() as ShadowRoot | Document).activeElement || control.getAttribute("aria-expanded") === "true") return;
      const latest = editable.props[prop.name];
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = latest === true;
      else control.value = latest == null ? "" : String(latest);
      syncReset();
    });
    control.addEventListener("change", syncReset);
    reset.addEventListener("click", () => {
      const baseline = originals.get(element);
      if (!baseline?.has(prop.name)) return;
      recordChange(element, editable, prop.name, baseline.get(prop.name), control, onEdit);
      const value = editable.props[prop.name];
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true;
      else control.value = value === undefined ? "" : String(value);
      syncReset();
      control.focus();
    });
    syncReset();
    wrapper.append(row, reset);
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
    group.append(wrapper);
  }
  return group;
}
