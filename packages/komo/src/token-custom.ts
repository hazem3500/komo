import { css, fontParts, typedCustom } from "./typed-custom.js";
import type { DesignToken } from "./design-system.js";
import { el } from "./dom.js";
import type { TokenPickerOptions } from "./token-picker.js";

export interface CustomHost {
  /** Transient preview; the next preview, a keep or Escape replaces it. */
  preview(value: string): void;
  /** Keeps the value: the end of a scrub, Enter, blur, a menu choice or a toggle. */
  commit(value: string): void;
  token?(token: DesignToken): void;
  /** A hovered or arrowed menu option, previewed until it is chosen or left (undefined). */
  hover?(value?: string): void;
}

/**
 * The typed Custom editor (lengths, spacing, radius, shadows, fonts), fetched only when
 * Custom opens. It applies live like the color picker: no Apply button, previews while a
 * value changes, keeps it when the gesture ends, and the popup's Escape restores the
 * value from before it opened. Colors use color-editor.ts.
 */
export function pickerEditor(options: TokenPickerOptions, host: CustomHost): HTMLElement & { live: true; refresh(value: string): void; destroy(): void } {
  const { property } = options;
  const initial = options.custom!.value;
  const box = el("div", "komo-custom");
  const body = el("div", "komo-custom__body");
  const exact = el("input");
  exact.value = initial;
  exact.setAttribute("aria-label", "CSS value");
  let dirty = false, gone = false;
  const send = (next: string, keep: boolean) => {
    if (gone) return false;
    dirty = true;
    // A typography token may leave the family out, which CSS alone would not accept as `font`.
    const valid = !!next.trim() && (CSS.supports(property, next) || property === "font" && !!fontParts(next)) && !/[{};]/.test(next);
    exact.setAttribute("aria-invalid", String(!valid));
    if (!valid) return false;
    if (exact !== (exact.getRootNode() as Document).activeElement) exact.value = next;
    if (keep) host.commit(next);
    else host.preview(next);
    return true;
  };
  box.append(el("style", "", css), body);
  const draw = typedCustom(body, property, initial, exact, send, options.custom?.field, options.tokens, value => { if (!gone) host.hover?.(value); });
  return Object.assign(box, {
    live: true as const,
    // Chrome blurs a focused field as the closed popup is removed; that blur keeps nothing.
    destroy() { gone = true; },
    refresh(next: string) {
      if (dirty) return;
      const { selectionStart: start, selectionEnd: end } = exact;
      draw(next);
      if (start !== null && end !== null) exact.setSelectionRange(start, end);
    },
  });
}
