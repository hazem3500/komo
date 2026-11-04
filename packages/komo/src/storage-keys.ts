// Palette's browser storage keys start with "palette:". Older releases wrote the
// same keys as "branch-comments:" and "komo:". Each mount copies an old key to its
// "palette:" name when that is still unset, and leaves the old key in place, so an
// older copy of the app on the same origin (or a rollback) keeps its sessions and
// settings. Only the key families Palette owns are touched.
// The session, its account and thread caches are "<endpoint>:<project>…".
const OWNED =
  /^(?:branch-comments:(?:https?:\/\/|(?:sidebar-mode|pin-size|read|channel|drawer|sidebar|frame-size|open|toolbar-dismissed|comments-hidden|emoji|colors):|(?:dismissed-tips|color-format)$)|komo:(?:(?:shell|shell-off|geometry-moved)$|setup:))/;
const rest = (key: string) => key.slice(key.indexOf(":") + 1);

/** The name a "palette:" key had before the rename, if Palette wrote it then. */
export const legacyKey = (key: string) =>
  key.startsWith("palette:")
    ? ["branch-comments:", "komo:"].map((old) => old + rest(key)).find((old) => OWNED.test(old))
    : undefined;

export function migrateStorage() {
  for (const area of ["localStorage", "sessionStorage"] as const)
    try {
      const store = globalThis[area];
      for (const key of Object.keys(store)) {
        const next = `palette:${rest(key)}`;
        if (OWNED.test(key) && store.getItem(next) === null) store.setItem(next, store.getItem(key)!);
      }
    } catch {
      /* Storage is blocked or full; the old keys are read again next time. */
    }
}

/** Removes a key under its name and its older one, so the old value can't come back at the next mount. */
export function forget(store: Storage, key: string) {
  store.removeItem(key);
  const old = legacyKey(key);
  if (old) store.removeItem(old);
}
