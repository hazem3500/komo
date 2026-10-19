export type FrameMapping = { scale: number; left: number; top: number };
type SavedProperty = { value: string; priority: string };
type Entry = {
  translate: SavedProperty;
  scale: SavedProperty;
  appliedTranslate: string;
  appliedScale: string;
  style: string | null;
  animation?: Animation;
};

const saved = (node: HTMLElement, name: string): SavedProperty => ({
  value: node.style.getPropertyValue(name),
  priority: node.style.getPropertyPriority(name),
});
const restore = (node: HTMLElement, name: string, property: SavedProperty) => {
  if (property.value)
    node.style.setProperty(name, property.value, property.priority);
  else node.style.removeProperty(name);
};
const tokens = (value: string) =>
  value && value !== "none" ? (value.match(/calc\(.*?\)|[^\s(]+/g) ?? []) : [];
const scaleFrames = (scale: number) => [
  { scale: String(scale) },
  { scale: String(scale) },
];

/** Compose Frame with host portals without moving live DOM or capturing entrance scales. */
export function createFramePortals(
  surface: HTMLElement,
  host: HTMLElement,
  include: ((node: HTMLElement) => boolean) | undefined,
  onChange: () => void,
) {
  const entries = new Map<HTMLElement, Entry>();
  let mapping: FrameMapping | null = null;
  let scheduled = 0;
  let listening: AbortController | undefined;
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver((records) => {
    if (!mapping) return;
    if (
      records.some((record) => {
        const node = record.target;
        if (
          !(node instanceof HTMLElement) ||
          node === host ||
          host.contains(node) ||
          node === surface ||
          surface.contains(node)
        )
          return false;
        return (
          record.type !== "attributes" ||
          record.attributeName !== "style" ||
          entries.get(node)?.style !== node.getAttribute("style")
        );
      })
    )
      schedule();
  });
  function schedule() {
    if (scheduled || !mapping) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      apply();
      onChange();
    });
  }
  function release(node: HTMLElement, entry: Entry) {
    if (node.style.translate !== entry.appliedTranslate)
      entry.translate = saved(node, "translate");
    if (!entry.animation && node.style.scale !== entry.appliedScale)
      entry.scale = saved(node, "scale");
    entry.animation?.cancel();
    restore(node, "translate", entry.translate);
    if (!entry.animation) restore(node, "scale", entry.scale);
    resize.unobserve(node);
  }
  function apply() {
    if (!mapping) return;
    const keep = new Set<HTMLElement>();
    const visit = (node: HTMLElement, forced?: boolean) => {
      if (node === host || node.contains(surface)) return;
      const position = getComputedStyle(node).position;
      if (forced === false) return;
      if (forced !== true && position !== "fixed") {
        for (const child of node.children)
          if (child instanceof HTMLElement) visit(child);
        return;
      }
      keep.add(node);
      let entry = entries.get(node);
      if (!entry) {
        entry = {
          translate: saved(node, "translate"),
          scale: saved(node, "scale"),
          appliedTranslate: node.style.translate,
          appliedScale: node.style.scale,
          style: node.getAttribute("style"),
        };
        // An additive scale follows the host's own animation and future scale changes.
        // Sampling an entrance value into an inline override would freeze that value.
        if (typeof node.animate === "function" && !entry.scale.priority) {
          try {
            const animation = node.animate(scaleFrames(1), {
              duration: 1,
              fill: "both",
              composite: "add",
            });
            if (
              (animation.effect as KeyframeEffect | null)?.composite === "add"
            ) {
              entry.animation = animation;
              animation.pause();
              animation.currentTime = 0;
            } else animation.cancel();
          } catch {
            // Older animation engines use the reversible inline fallback.
          }
        }
        entries.set(node, entry);
        resize.observe(node);
      } else {
        if (node.style.translate !== entry.appliedTranslate)
          entry.translate = saved(node, "translate");
        if (!entry.animation && node.style.scale !== entry.appliedScale)
          entry.scale = saved(node, "scale");
      }
      restore(node, "translate", entry.translate);
      if (entry.animation)
        (entry.animation.effect as KeyframeEffect).setKeyframes(scaleFrames(1));
      else restore(node, "scale", entry.scale);
      const css = getComputedStyle(node);
      const origin = css.transformOrigin.split(" ").map(parseFloat);
      const translate = tokens(css.translate);
      const scale = mapping!.scale;
      // Pixel translations from positioning engines already use the framed
      // anchor's viewport coordinates. Keep that placement while scaling content.
      const positioned =
        forced !== true &&
        !!node.style.transform &&
        !node.style.transform.includes("%") &&
        /^(?:translate(?:3d|X|Y)?\([^%]+\)\s*)+$/i.test(node.style.transform);
      const rect = positioned ? node.getBoundingClientRect() : null;
      const offsets = [node.offsetLeft, node.offsetTop];
      const frame = [mapping!.left, mapping!.top];
      const point = rect ? [rect.left, rect.top] : null;
      const value = frame
        .map((offset, axis) => {
          const center = offsets[axis] + (origin[axis] || 0);
          const delta = point
            ? (1 - scale) * (point[axis] - center)
            : offset - (1 - scale) * center;
          return `calc(${delta}px + ${scale} * ${translate[axis] ?? "0px"})`;
        })
        .join(" ");
      node.style.setProperty("translate", value, entry.translate.priority);
      if (entry.animation)
        (entry.animation.effect as KeyframeEffect).setKeyframes(
          scaleFrames(scale),
        );
      else
        node.style.setProperty(
          "scale",
          tokens(css.scale).length
            ? tokens(css.scale)
                .map((value) => String(Number(value) * scale))
                .join(" ")
            : String(scale),
          entry.scale.priority,
        );
      entry.appliedTranslate = node.style.translate;
      entry.appliedScale = node.style.scale;
      entry.style = node.getAttribute("style");
    };
    for (const child of document.body.children)
      if (child instanceof HTMLElement) visit(child, include?.(child));
    for (const [node, entry] of entries)
      if (!keep.has(node)) {
        release(node, entry);
        entries.delete(node);
      }
  }
  function stop() {
    cancelAnimationFrame(scheduled);
    scheduled = 0;
    listening?.abort();
    listening = undefined;
    mutations.disconnect();
    resize.disconnect();
    for (const [node, entry] of entries) release(node, entry);
    entries.clear();
  }
  return {
    update(next: FrameMapping | null) {
      mapping = next;
      if (!next) return stop();
      if (!listening) {
        listening = new AbortController();
        mutations.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style", "class", "data-state"],
        });
        for (const name of [
          "animationend",
          "animationcancel",
          "transitionend",
          "transitioncancel",
        ])
          document.addEventListener(name, schedule, {
            capture: true,
            signal: listening.signal,
          });
      }
      apply();
    },
    destroy() {
      mapping = null;
      stop();
    },
  };
}
