import type { Field } from "./design-panel.js";
import type { DesignTarget } from "./design-target.js";
import { toHex } from "./design-preview.js";

type ColorValue = (field: Field, element: DesignTarget, resolved?: string) => string;

/**
 * A pick lands mid-hover or mid-transition, and themes, state previews and host
 * renders restyle the element later, so the panel's color fields read again once
 * its color transitions settle: a token-bound field shows its token's value for
 * the current theme, any other field the computed value. A field being typed in
 * keeps its text; an open popup hears `komo-field-sync` and refreshes its own value.
 * Loaded with the panel as its own chunk.
 */
export function liveColors(boxes: HTMLElement[], element: DesignTarget, valueFor: ColorValue): void {
  const live = new AbortController();
  const observer = new MutationObserver(() => schedule());
  let queued = false, waiting = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  };
  const sync = () => {
    queued = false;
    if (!boxes[0].isConnected) return live.abort();
    for (const box of boxes) {
      const control = box.querySelector<HTMLInputElement>("[data-property]")!;
      const swatch = box.querySelector<HTMLInputElement>('input[type="color"]');
      const own = box.querySelector<HTMLElement>(".design-token-binding")?.dataset.value;
      const value = valueFor({ property: control.dataset.property!, kind: "color" } as Field, element, own);
      if (value === control.value || control.matches(":focus") || control.getAttribute("aria-invalid") === "true") continue;
      control.value = value;
      if (swatch) swatch.value = toHex(value);
      box.dispatchEvent(new Event("komo-field-sync"));
    }
    // Color transitions on the element or an ancestor are awaited, a second at a time.
    const running = element.ownerDocument.getAnimations?.().filter((animation) =>
      /color|fill|stroke/.test(String((animation as CSSTransition).transitionProperty)) &&
      (animation.effect as KeyframeEffect | null)?.target?.contains(element));
    if (!running?.length || waiting) return;
    waiting = true;
    void Promise.race([Promise.allSettled(running.map((animation) => animation.finished)), new Promise((done) => setTimeout(done, 1000))])
      .then(() => { waiting = false; schedule(); });
  };
  for (const type of ["pointerover", "pointerout", "pointerup", "focusin", "focusout", "transitionend", "transitioncancel"])
    addEventListener(type, schedule, { capture: true, signal: live.signal });
  observer.observe(element.ownerDocument, { attributes: true, subtree: true });
  live.signal.addEventListener("abort", () => observer.disconnect());
  schedule();
}
