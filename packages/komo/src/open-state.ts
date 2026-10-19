import type { CommentsOptions } from "./types.js";

/** Remembers whether the sidebar was open, per `restoreOpen`. */
export function openState(
  key: string,
  mode: CommentsOptions["restoreOpen"] = "session",
) {
  let store: Storage | undefined;
  try {
    // Drop the old localStorage key so it can't reopen the sidebar.
    if (mode !== "always") localStorage.removeItem(key);
  } catch {
    /* Storage is blocked. */
  }
  try {
    store =
      mode === "always" ? localStorage : mode ? sessionStorage : undefined;
  } catch {
    /* Start closed when storage is blocked. */
  }
  return {
    get() {
      try {
        return store?.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    set(open: boolean) {
      try {
        if (open) store?.setItem(key, "1");
        else store?.removeItem(key);
      } catch {
        /* The sidebar starts closed next time. */
      }
    },
  };
}
