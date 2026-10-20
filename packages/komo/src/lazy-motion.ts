import type { AnimationOptions, DOMKeyframesDefinition } from "motion";

/** The parts of Motion's playback controls komo's own surfaces use. */
export type MotionControls = { stop(): void; readonly finished: Promise<unknown> };

let motion: typeof import("./motion-animate.js") | undefined;
let loading: Promise<typeof import("./motion-animate.js")> | undefined;

/**
 * Motion only runs once a reviewer opens or moves something, so it stays out of
 * the mount bundle. The toolbar's menu shares the chunk; komo prefetches it on idle.
 */
export function loadMotion() {
  return (loading ??= import("./motion-animate.js").then(
    (module) => (motion = module),
    (reason) => {
      loading = undefined;
      throw reason;
    },
  ));
}

// The two-value keyframes komo writes ("from", "to") are CSS properties; `y` is Motion's.
function hold(target: HTMLElement, keyframes: DOMKeyframesDefinition, at: 0 | -1) {
  for (const [key, value] of Object.entries(keyframes)) {
    const frame = Array.isArray(value) ? value.at(at) : at ? value : undefined;
    if (frame === undefined || frame === null) continue;
    if (key === "y") target.style.transform = `translateY(${parseFloat(String(frame)) || 0}px)`;
    else if (key in target.style)
      (target.style as unknown as Record<string, string>)[key] = String(frame);
  }
}

/**
 * Motion's `animate` for one element. Before Motion has loaded the element holds its
 * first keyframe and the animation starts as soon as the chunk arrives; if it cannot
 * load, the element jumps to its last keyframe and `finished` resolves.
 */
export function animate(
  target: HTMLElement,
  keyframes: DOMKeyframesDefinition,
  options: AnimationOptions,
): MotionControls {
  if (motion) return motion.animate(target, keyframes, options);
  let controls: MotionControls | undefined;
  let stopped = false;
  hold(target, keyframes, 0);
  const finished = loadMotion().then(
    (module) => {
      // Stopped before it started: never settle, as callers moved on.
      if (stopped) return new Promise(() => {});
      controls = module.animate(target, keyframes, options);
      return controls.finished;
    },
    () => {
      if (stopped) return new Promise(() => {});
      hold(target, keyframes, -1);
    },
  );
  return {
    stop() {
      stopped = true;
      controls?.stop();
    },
    finished,
  };
}
