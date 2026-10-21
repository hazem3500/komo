import type { Anchor, CommentsOptions, Thread } from "./types.js";

/** Whether a comment target sits in layout shown on every page, such as an app sidebar. */
export function inPersistentRegion(
  element: Element,
  options: Pick<CommentsOptions, "persistentRegions" | "isPersistent">,
): boolean {
  return !!options.isPersistent?.(element) || !!options.persistentRegions?.some((selector) => {
    try {
      return !!element.closest(selector);
    } catch {
      return false;
    }
  });
}

/** Any other or future scope value reads as this page only. */
export const allPages = (thread: Pick<Thread, "scope">) => thread.scope === "all";

/**
 * A thread belongs on a page when it was made there, or when it shows on all
 * pages and its anchor exists there. Elsewhere an all-pages thread is simply
 * absent: it never counts as missing from the page.
 */
export function threadOnPage(
  thread: Pick<Thread, "page" | "scope" | "anchor">,
  page: string,
  resolves: (anchor: Anchor) => unknown,
): boolean {
  return thread.page === page || (allPages(thread) && !!resolves(thread.anchor));
}
