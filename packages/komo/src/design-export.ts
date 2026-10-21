export { designKeyboard } from "./design-keyboard.js";
import { renderKeycaps } from "./kbd.js";
import { el, icon } from "./dom.js";

/** Selection guidance and recovery controls load with the proposal helpers. */
export function selectionViews(options: {
  /** Opens komo's shortcut help, which lists every canvas key and gesture. */
  help?(): void;
  review(): void;
  reset(): void;
  proposals(): Array<string | undefined>;
  message(text: string): void;
  /** Design mode's options, for the Tokens view. */
  mode?: import("./token-page.js").TokenPageHost;
  /** Design mode's chronological history; pending token steps join it. */
  history?: Array<{ kind?: string; step?: object }>;
  /** Re-sync Design mode after a token change. */
  update?(): void;
  /** Return to the empty panel, where the Tokens view opens. */
  clear?(): void;
}) {
  const glyph = (path: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  const empty = el("div", "design-inspector__empty");
  empty.append(icon("design"), el("strong", "", "Select an element"), el("p", "", "Click to inspect · Double-click text to edit"));
  const pending = el("section", "design-inspector__pending");
  const label = el("p");
  const button = (text: string, run: () => void) => {
    const control = el("button", "", text);
    control.type = "button";
    control.addEventListener("click", run);
    return control;
  };
  const review = button("Review previous element", options.review);
  const copy = button("Copy pending proposals", async () => {
    const text = [...options.proposals(), tokens?.proposal()].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(text); options.message("Pending proposals copied"); }
    catch { options.message("Couldn't copy pending proposals. Try again."); }
  });
  pending.append(label, review, copy, button("Reset all previews", options.reset));
  // Tokens are edited page-wide, so the view opens with nothing selected.
  const panel = () => options.mode?.root.querySelector<HTMLElement>(".design-inspector");
  let tokens: import("./token-page.js").PageTokens | undefined;
  const { history = [] } = options;
  /** One history entry per pending token step, in order; new steps are the latest. */
  const sync = () => {
    const steps = new Set(tokens?.steps);
    for (let index = history.length; index--;)
      if (history[index].kind === "token" && !steps.delete(history[index].step!)) history.splice(index, 1);
    for (const step of steps) history.push({ kind: "token", step });
    options.update?.();
  };
  const mode = options.mode && { ...options.mode, link(page: import("./token-page.js").PageTokens) { tokens = page; return sync; } };
  const edit = button("Edit tokens", () => {
    const inspector = panel();
    if (inspector && mode) void import("./token-page.js").then(module => module.openTokenPage(inspector, mode), () => options.message("Tokens unavailable · try again"));
  });
  edit.className = "design-inspector__tokens";
  // The full list of keys and gestures lives in shortcut help.
  const help = button("Keyboard shortcuts", () => options.help?.());
  help.className = "design-inspector__help";
  help.setAttribute("aria-label", "Keyboard shortcuts");
  help.setAttribute("aria-keyshortcuts", "?");
  help.append(renderKeycaps(["?"], "?"));
  help.hidden = !options.help;
  empty.append(edit, help);
  // Pending token edits stay visible in the element view; the chip opens the Tokens view.
  const chip = button("", () => {
    options.clear?.();
    tokens?.open();
  });
  chip.className = "design-inspector__token-chip";
  chip.title = "Open the Tokens view";
  chip.hidden = true;
  return {
    empty, pending, chip,
    get tokens() { return tokens; },
    icons: {
      undo: glyph("M5.5 3.5 2.5 6.5l3 3m-3-3h7a4 4 0 0 1 0 8h-2"),
      reset: glyph("M2.5 2.5v3h3M3 5.5a5.5 5.5 0 1 1-.5 2.5"),
    },
    styles: '@keyframes design-status{from{opacity:0;translate:0 2px}}.design-inspector__count{white-space:nowrap;font-variant-numeric:tabular-nums}.design-inspector__status{display:none;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;animation:design-status .2s var(--ease-smooth-out)}.design-inspector__bar[data-message] .design-inspector__status{display:block}.design-inspector__bar[data-message] .design-inspector__count,.design-inspector__bar:not([data-changes]) .design-inspector__tool{display:none}.design-inspector__compare { display:inline-flex; flex:none; padding:2px; border-radius:7px; background:#ffffff0a; }.design-inspector__compare[hidden],.design-inspector__bar[data-message] .design-inspector__compare { display:none; }.design-inspector__compare button { height:22px; padding:0 8px; border-radius:5px; color:#9a9a9a; font:inherit; font-size:11px; }.design-inspector__compare button:hover { color:#fff; }.design-inspector__compare button[aria-pressed="true"] { color:#fff; background:#ffffff1a; }.design-inspector__empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:0 24px 28px; color:#898680; font-size:11px; text-align:center; }.design-inspector__empty > svg { box-sizing:content-box; width:20px; height:20px; margin-bottom:8px; padding:8px; border-radius:10px; background:#ffffff0a; color:#77736f; }.design-inspector__empty strong { color:#e9e6e1; font-size:12px; font-weight:600; }.design-inspector__empty p { margin:2px 0 0; line-height:1.5; }.design-inspector__pick-hint{flex:none;margin:0 12px 10px;color:#989898;font-size:10px;line-height:1.5}.design-inspector__pending{margin:12px;padding:12px;border:1px solid #ffffff1a;border-radius:10px;display:flex;flex-wrap:wrap;gap:8px}.design-inspector__pending[hidden]{display:none}.design-inspector__pending p{flex-basis:100%;margin:0 0 4px;color:#aaa;line-height:1.5}.design-inspector__pending button{min-height:32px;padding:6px 10px;border:1px solid #ffffff20;border-radius:7px;background:#ffffff08;font:inherit;color:inherit;cursor:pointer}.design-inspector__tokens{margin-top:16px;min-height:34px;padding:0 14px;border-radius:8px;background:var(--accent,#bda6ef);color:#211b2d;font:inherit;font-size:12px;font-weight:500}.design-inspector__tokens:hover{filter:brightness(1.08)}.design-inspector__help{gap:6px;margin-top:8px;min-height:28px;padding:0 8px;border-radius:7px;color:#898680;font:inherit;font-size:11px}.design-inspector__tokens[hidden]+.design-inspector__help{margin-top:14px}.design-inspector__help:hover{background:#ffffff0a;color:#e9e6e1}.design-inspector__tokens[hidden],.design-inspector__help[hidden]{display:none}.design-inspector__token-chip{flex:none;align-self:flex-start;margin:0 12px 8px;min-height:24px;padding:0 8px;border-radius:6px;background:#bda6ef1f;color:#e6dcfb;font:inherit;font-size:11px}.design-inspector__token-chip:hover{background:#bda6ef33}.design-inspector__token-chip:focus-visible{outline:2px solid #bda6ef;outline-offset:1px}.design-inspector__token-chip[hidden]{display:none}',
    /** `selected`: an element view is showing, so the chip stands for the pending token edits. */
    update(count: number, canReview: boolean, selected = false) {
      const edits = tokens?.size ?? 0;
      // Token edits pend like element previews: "1 element and 2 token changes have pending runtime previews."
      label.textContent = `${[count && `${count} element${count > 1 ? "s" : ""}`, edits && `${edits} token change${edits > 1 ? "s" : ""}`].filter(Boolean).join(" and ")} ${count + edits > 1 ? "have" : "has"} pending runtime previews. Undo, Reset or reload to restore.`;
      review.hidden = !canReview;
      edit.hidden = !options.mode?.design?.tokens && !document.querySelector("[data-komo-design-tokens]");
      edit.textContent = edits ? `Edit tokens · ${edits} change${edits > 1 ? "s" : ""}` : "Edit tokens";
      chip.hidden = !selected || !edits;
      chip.textContent = `Token changes · ${edits}`;
    },
  };
}

/** On-demand helpers for Design mode's footer: Copy CSS, comment proposals and tool tooltips. */
/**
 * A selector that matches exactly `element`: a path of :nth-of-type steps from
 * body or the nearest unique, non-generated id. Utility classes alone match
 * dozens of elements in Tailwind apps, so they only label the last step.
 */
export function cssSelector(element: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    // React useId and Radix ids change between renders, as in anchors.ts.
    const id = node.id && !/^radix-|^:r|_r_|«r/.test(node.id) ? `#${CSS.escape(node.id)}` : "";
    if (id && document.querySelectorAll(id).length === 1) return [id, ...parts].join(" > ");
    if (node === document.body || !node.parentElement) return [node.tagName.toLowerCase(), ...parts].join(" > ");
    const classes = node === element ? [...node.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("") : "";
    const index = [...node.parentElement.children].filter((child) => child.tagName === node!.tagName).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}${classes}:nth-of-type(${index})`);
  }
  return parts.join(" > ");
}

export function cssText(element: Element, values: Map<string, string>): string {
  return `${cssSelector(element)} {\n${[...values].map(([property, value]) => `  ${property}: ${value};`).join("\n")}\n}`;
}

/**
 * One proposal for everything previewed on the element. Token-bound properties
 * are described by the token section, so they are not repeated as raw CSS.
 * `context` lines (theme, component, props) join the first section, after its
 * header and target; a section's own Component line wins over the context's.
 */
export function designProposal(
  element: Element,
  values: Map<string, string> | undefined,
  before: (property: string) => string | undefined,
  bound: Set<string> | undefined,
  sections: Array<string | undefined>,
  context: string[] = [],
): string | undefined {
  const rows = [...values ?? []].filter(([property]) => !bound?.has(property))
    .map(([property, value]) => `- ${property}: ${before(property) || "(unset)"} → ${value}`);
  const parts = [
    rows.length ? `Proposed style changes (preview only)\nTarget: ${cssSelector(element)}\n${rows.join("\n")}` : "",
    ...sections.map(section => section && !/^Target: /m.test(section) ? section.replace("\n", `\nTarget: ${cssSelector(element)}\n`) : section),
  ].filter((part): part is string => !!part);
  if (parts[0] && context.length) {
    const lines = parts[0].split("\n");
    const extra = context.filter((line) => !line.startsWith("Component: ") || !lines.some((own) => own.startsWith("Component: ")));
    lines.splice(lines[1]?.startsWith("Target: ") ? 2 : 1, 0, ...extra);
    parts[0] = lines.join("\n");
  }
  return parts.join("\n\n") || undefined;
}

/**
 * Footer controls use the toolbar's tooltip surface, like the Comments header.
 * Loaded on the bar's first hover or focus, which `first` replays.
 */
export function footerTips(bar: HTMLElement, root: ShadowRoot, signal: AbortSignal, first: Event, place?: (tip: HTMLElement, target: HTMLElement) => void) {
  if (signal.aborted) return;
  const tip = el("div", "morphing-menu__tooltip sidebar-tooltip");
  tip.setAttribute("aria-hidden", "true");
  root.append(tip);
  let timer = 0;
  const hide = () => {
    clearTimeout(timer);
    delete tip.dataset.open;
  };
  const show = (event: Event) => {
    const button = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
    if (!button || (event.type === "focusin" && !button.matches(":focus-visible"))) return hide();
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!button.isConnected) return;
      const box = button.getBoundingClientRect();
      tip.textContent = button.dataset.tip ?? "";
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.max(8 + half, Math.min(document.documentElement.clientWidth - 8 - half, box.left + box.width / 2))}px`;
      tip.style.top = `${box.top - 8 - tip.offsetHeight}px`;
      place?.(tip, button);
      tip.dataset.open = "true";
    }, tip.dataset.open ? 0 : 400);
  };
  bar.addEventListener("pointerover", show, { signal });
  bar.addEventListener("focusin", show, { signal });
  for (const type of ["pointerleave", "pointerdown", "focusout", "scroll"]) bar.addEventListener(type, hide, { signal });
  signal.addEventListener("abort", () => {
    hide();
    tip.remove();
  });
  // The pointer may have left while this chunk loaded.
  if (first.type === "focusin" || bar.matches(":hover")) show(first);
}

/** Footer feedback belongs to the lazy footer tools, including timer ownership. */
export function watchDesignStatus(status: HTMLElement, bar: HTMLElement, editing: () => boolean, signal: AbortSignal) {
  let timer = 0;
  const observer = new MutationObserver(() => {
    const text = status.textContent ?? "";
    status.title = text;
    bar.toggleAttribute("data-message", !!text);
    clearTimeout(timer);
    if (text) timer = window.setTimeout(function clear() {
      if (editing()) timer = window.setTimeout(clear, 2600);
      else status.textContent = "";
    }, 2600);
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  signal.addEventListener("abort", () => { observer.disconnect(); clearTimeout(timer); }, { once: true });
}
