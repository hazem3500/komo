import type { Thread } from "./types.js";

/** Stable membership: moving a pin opts it out until its anchor is replaced. */
export function pinStacks<T>(
  threads: Thread[],
  target: (thread: Thread) => T | null
): Map<string, Thread[]> {
  const groups = new Map<T, Thread[]>();
  for (const thread of threads) {
    if (thread.resolved || thread.anchor.unstacked) continue;
    const key = target(thread);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(thread);
    groups.set(key, group);
  }
  const membership = new Map<string, Thread[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort(byAge);
    for (const thread of group) membership.set(thread.id, group);
  }
  return membership;
}

/** Oldest first, so a stack keeps its leader when the API reorders threads. */
export const byAge = (a: Thread, b: Thread) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

export type Box = { left: number; top: number; right: number; bottom: number };

/** A resting stack draws up to three faces; a larger one collapses to its first author and "+N". */
export const stackFaces = (count: number) => (count > 3 ? 1 : count);

/** How wide a resting stack of `count` faces is, with each face overlapping the previous by 60%. */
export function stackWidth(count: number, face: number) {
  const shown = stackFaces(count);
  return Math.max(24, face * (1 + (shown - 1) * 0.4) + (count > 3 ? 26 : 0) + 4);
}

/**
 * The 24px-tall hit area of a resting pin or stack whose tip is at (x, y), in viewport pixels.
 * Anchors are measured after Frame scaling, so the same page distance collides sooner when scaled down.
 */
export function hitArea(x: number, y: number, right: boolean, width = 24): Box {
  const left = right ? x + 9 - width : x - 9;
  return { left, top: y - 18, right: left + width, bottom: y + 6 };
}

/** Indexes of boxes whose areas overlap, grouped transitively, each group in input order. */
export function collisions(boxes: (Box | null)[]): number[][] {
  const root = boxes.map((_, index) => index);
  const find = (index: number): number =>
    root[index] === index ? index : (root[index] = find(root[index]));
  boxes.forEach((a, i) => {
    for (let j = i + 1; a && j < boxes.length; j++) {
      const b = boxes[j];
      if (b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
        root[find(j)] = find(i);
    }
  });
  const groups = new Map<number, number[]>();
  boxes.forEach((_, index) => {
    const key = find(index);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()];
}

