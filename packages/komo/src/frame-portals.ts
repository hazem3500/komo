export type FrameMapping = {
  scale: number;
  left: number;
  top: number;
  zoom?: number;
  bounds?: Pick<
    DOMRect,
    "left" | "top" | "right" | "bottom" | "width" | "height"
  >;
};
type SavedProperty = { value: string; priority: string };
type Constraints = {
  properties: Map<
    string,
    { original: SavedProperty; applied: string; maximum?: string }
  >;
  style: string | null;
};
type Entry = {
  translate: SavedProperty;
  scale: SavedProperty;
  appliedTranslate: string;
  appliedScale: string;
  style: string | null;
  animation?: Animation;
  transform: string;
  positioningFrame: FrameMapping | null;
  constraints?: Map<HTMLElement, Constraints>;
};

const saved = (node: HTMLElement, name: string): SavedProperty => ({
  value: node.style.getPropertyValue(name),
  priority: node.style.getPropertyPriority(name),
});
const restore = (node: HTMLElement, name: string, property: SavedProperty) => {
  node.style.setProperty(name, property.value, property.priority);
};
export function preserveFrameStyles(node: HTMLElement, names: string[]) {
  const attribute = node.getAttribute("style");
  const original = node.style.cssText;
  const properties = names.map((name) => [name, saved(node, name)] as const);
  return () => {
    for (const [name, property] of properties) restore(node, name, property);
    if (node.style.cssText === original) {
      if (attribute === null) node.removeAttribute("style");
      else node.setAttribute("style", attribute);
    }
  };
}
const tokens = (value: string) =>
  value && value !== "none" ? (value.match(/calc\(.*?\)|[^\s(]+/g) ?? []) : [];
const scaleFrames = (scale: number, translate = "0px 0px") => [
  { scale: String(scale), translate },
  { scale: String(scale), translate },
];
function cancelTransitions(node: HTMLElement, properties: string[]) {
  for (const animation of node.getAnimations?.() ?? [])
    if (
      "transitionProperty" in animation &&
      properties.includes(String(animation.transitionProperty))
    )
      animation.cancel();
}

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
  let entering = false;
  let positionFrame = 0;
  const reposition = () => {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      surface.ownerDocument.defaultView?.dispatchEvent(new Event("resize"));
      schedule();
    });
  };
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
          (entries.get(node)?.style !== node.getAttribute("style") &&
            ![...entries.values()].some(
              (entry) =>
                entry.constraints?.get(node)?.style ===
                node.getAttribute("style"),
            ))
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
    if (!entry.animation && node.style.translate !== entry.appliedTranslate)
      entry.translate = saved(node, "translate");
    if (!entry.animation && node.style.scale !== entry.appliedScale)
      entry.scale = saved(node, "scale");
    entry.animation?.cancel();
    if (!entry.animation) {
      restore(node, "translate", entry.translate);
      restore(node, "scale", entry.scale);
      cancelTransitions(node, ["translate", "scale"]);
    }
    for (const [target, constraints] of entry.constraints ?? [])
      releaseConstraints(target, constraints);
    resize.unobserve(node);
  }
  function releaseConstraints(
    node: HTMLElement,
    constraints: Constraints,
    keepObserved = false,
  ) {
    for (const [name, property] of constraints.properties) {
      if (node.style.getPropertyValue(name) !== property.applied)
        property.original = saved(node, name);
      restore(node, name, property.original);
    }
    if (!keepObserved) resize.unobserve(node);
  }
  function constrain(
    node: HTMLElement,
    entry: Entry,
    width: number,
    height: number,
  ) {
    entry.constraints ??= new Map();
    let constraints = entry.constraints.get(node);
    if (!constraints) {
      constraints = { properties: new Map(), style: null };
      entry.constraints.set(node, constraints);
      resize.observe(node);
    }
    const css = getComputedStyle(node);
    const inset = (axis: "Width" | "Height") =>
      css.boxSizing === "border-box"
        ? 0
        : axis === "Width"
          ? (parseFloat(css.paddingLeft) || 0) +
            (parseFloat(css.paddingRight) || 0) +
            (parseFloat(css.borderLeftWidth) || 0) +
            (parseFloat(css.borderRightWidth) || 0)
          : (parseFloat(css.paddingTop) || 0) +
            (parseFloat(css.paddingBottom) || 0) +
            (parseFloat(css.borderTopWidth) || 0) +
            (parseFloat(css.borderBottomWidth) || 0);
    const properties: Record<string, string> = {
      "min-width": "0px",
      "min-height": "0px",
      "max-width": `${Math.max(1, width - inset("Width"))}px`,
      "max-height": `${Math.max(1, height - inset("Height"))}px`,
      overflow: "auto",
    };
    for (const [name, value] of Object.entries(properties)) {
      let property = constraints.properties.get(name);
      if (!property)
        constraints.properties.set(
          name,
          (property = {
            original: saved(node, name),
            applied: "",
            maximum: name.startsWith("max-")
              ? css.getPropertyValue(name)
              : undefined,
          }),
        );
      else if (node.style.getPropertyValue(name) !== property.applied) {
        property.original = saved(node, name);
        if (name.startsWith("max-"))
          property.maximum = css.getPropertyValue(name);
      }
      const maximum = property.maximum;
      node.style.setProperty(
        name,
        maximum && maximum !== "none" ? `min(${maximum}, ${value})` : value,
        "important",
      );
      property.applied = node.style.getPropertyValue(name);
    }
    cancelTransitions(node, Object.keys(properties));
    constraints.style = node.getAttribute("style");
  }
  function apply() {
    if (!mapping) return;
    const keep = new Set<HTMLElement>();
    let animating = false;
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
          transform: node.style.transform,
          positioningFrame: entering ? null : { ...mapping! },
        };
        // Keep host transitions out of our positioning feedback loop.
        if (
          typeof node.animate === "function" &&
          !entry.scale.priority &&
          !entry.translate.priority
        ) {
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
        if (
          entry.animation &&
          (node.style.getPropertyPriority("translate") ||
            node.style.getPropertyPriority("scale"))
        ) {
          entry.animation.cancel();
          entry.animation = undefined;
          entry.translate = saved(node, "translate");
          entry.scale = saved(node, "scale");
          entry.appliedTranslate = node.style.translate;
          entry.appliedScale = node.style.scale;
        }
        if (!entry.animation && node.style.translate !== entry.appliedTranslate)
          entry.translate = saved(node, "translate");
        if (!entry.animation && node.style.scale !== entry.appliedScale)
          entry.scale = saved(node, "scale");
        if (node.style.transform !== entry.transform) {
          entry.transform = node.style.transform;
          entry.positioningFrame = { ...mapping! };
        }
      }
      if (entry.animation)
        (entry.animation.effect as KeyframeEffect).setKeyframes(scaleFrames(1));
      else {
        restore(node, "translate", entry.translate);
        restore(node, "scale", entry.scale);
        cancelTransitions(node, ["translate", "scale"]);
      }
      const dialogSelector = '[role="dialog"], [role="alertdialog"]';
      const content = node.matches(dialogSelector)
        ? null
        : node.querySelector<HTMLElement>(dialogSelector);
      // Measure the host content at its own size so a larger Frame can expand it again.
      for (const [target, constraints] of entry.constraints ?? [])
        if (target !== node) {
          releaseConstraints(target, constraints, target === content);
          entry.constraints!.delete(target);
        }
      const css = getComputedStyle(node);
      const translate = tokens(css.translate);
      const scale = mapping!.scale;
      const zoom = mapping!.zoom ?? 1;
      // Pixel translations from positioning engines already use the framed
      // anchor's viewport coordinates. Keep that placement while scaling content.
      const positioned =
        forced !== true &&
        !!node.style.transform &&
        !node.style.transform.includes("%") &&
        /^(?:translate(?:3d|X|Y)?\([^%]+\)\s*)+$/i.test(node.style.transform);
      const rect = node.getBoundingClientRect();
      const frame = [mapping!.left, mapping!.top];
      const bounds = mapping!.bounds ?? surface.getBoundingClientRect();
      const gap = positioned ? 8 / zoom : 0;
      const limits = [bounds.width - 2 * gap, bounds.height - 2 * gap];
      if (
        bounds.width &&
        bounds.height &&
        (entry.constraints?.has(node) ||
          (rect.width / zoom) * scale > limits[0] ||
          (rect.height / zoom) * scale > limits[1])
      ) {
        constrain(node, entry, limits[0] / scale, limits[1] / scale);
      }
      if (content instanceof HTMLElement && bounds.width && bounds.height) {
        const contentRect = content.getBoundingClientRect();
        if (
          entry.constraints?.has(node) ||
          (contentRect.width / zoom) * scale > limits[0] ||
          (contentRect.height / zoom) * scale > limits[1]
        ) {
          // Keep the scrollable surface inside the host modal's scroll-lock boundary.
          const room = (axis: "Width" | "Height") => {
            const sides =
              axis === "Width" ? ["left", "right"] : ["top", "bottom"];
            let inset = 0;
            for (
              let child = content;
              child !== node && child.parentElement;
              child = child.parentElement
            ) {
              const childCSS = getComputedStyle(child);
              const parentCSS = getComputedStyle(child.parentElement);
              for (const side of sides)
                inset +=
                  (parseFloat(childCSS.getPropertyValue(`margin-${side}`)) ||
                    0) +
                  (parseFloat(parentCSS.getPropertyValue(`padding-${side}`)) ||
                    0) +
                  (child.parentElement === node
                    ? 0
                    : parseFloat(
                        parentCSS.getPropertyValue(`border-${side}-width`),
                      ) || 0);
            }
            return (
              Math.min(
                limits[axis === "Width" ? 0 : 1] / scale,
                node[`client${axis}`],
              ) - inset
            );
          };
          constrain(content, entry, room("Width"), room("Height"));
        }
        if (!entry.constraints?.has(content)) resize.unobserve(content);
      }
      const measured = node.getBoundingClientRect();
      const point = positioned
        ? [measured.left / zoom, measured.top / zoom]
        : null;
      const origin = getComputedStyle(node)
        .transformOrigin.split(" ")
        .map(parseFloat);
      const offsets = [node.offsetLeft, node.offsetTop];
      const value = frame
        .map((offset, axis) => {
          const center = offsets[axis] + (origin[axis] || 0);
          let delta = offset - (1 - scale) * center;
          if (point && measured) {
            const reference = entry.positioningFrame;
            let desired =
              offset +
              (scale *
                (point[axis] -
                  (reference ? [reference.left, reference.top][axis] : 0))) /
                (reference?.scale ?? 1);
            if (bounds.width && bounds.height) {
              const minimum = [bounds.left, bounds.top][axis] + gap;
              const maximum =
                [bounds.right, bounds.bottom][axis] -
                gap -
                ([measured.width, measured.height][axis] / zoom) * scale;
              desired = Math.max(minimum, Math.min(maximum, desired));
            }
            delta = desired - scale * point[axis] - (1 - scale) * center;
          }
          return `calc(${delta}px + ${entry.animation ? scale - 1 : scale} * ${translate[axis] ?? "0px"})`;
        })
        .join(" ");
      if (entry.animation)
        (entry.animation.effect as KeyframeEffect).setKeyframes(
          scaleFrames(scale, value),
        );
      else {
        node.style.setProperty("translate", value, entry.translate.priority);
        node.style.setProperty(
          "scale",
          tokens(css.scale).length
            ? tokens(css.scale)
                .map((value) => String(Number(value) * scale))
                .join(" ")
            : String(scale),
          entry.scale.priority,
        );
        cancelTransitions(node, ["translate", "scale"]);
      }
      entry.appliedTranslate = node.style.translate;
      entry.appliedScale = node.style.scale;
      entry.style = node.getAttribute("style");
      animating ||= (node.getAnimations?.() ?? []).some(
        (animation) =>
          animation !== entry.animation &&
          animation.playState === "running" &&
          (animation.effect as KeyframeEffect | null)
            ?.getKeyframes()
            .some((keyframe) =>
              Object.keys(keyframe).some((key) =>
                /^(transform|translate|scale|left|top|width|height)$/.test(key),
              ),
            ),
      );
    };
    for (const child of document.body.children)
      if (child instanceof HTMLElement) visit(child, include?.(child));
    for (const [node, entry] of entries)
      if (!keep.has(node)) {
        release(node, entry);
        entries.delete(node);
      }
    if (animating) schedule();
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
      const previous = mapping;
      entering = !previous && !!next;
      mapping = next;
      if (!next) {
        stop();
        if (previous) reposition();
        return;
      }
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
        surface.addEventListener("scroll", reposition, {
          passive: true,
          signal: listening.signal,
        });
      }
      apply();
      entering = false;
      if (
        !previous ||
        previous.scale !== next.scale ||
        previous.left !== next.left ||
        previous.top !== next.top
      )
        reposition();
    },
    reposition,
    destroy() {
      mapping = null;
      stop();
      cancelAnimationFrame(positionFrame);
    },
  };
}
