// Palette's browser storage keys start with "palette:". Older releases wrote
// "branch-comments:" and "komo:" keys; each one moves to its "palette:" name when
// Palette mounts, so sessions, drafts and settings survive the upgrade. A key
// already written under the new name wins.
export function migrateStorage() {
  for (const area of ["localStorage", "sessionStorage"] as const)
    try {
      const store = globalThis[area];
      for (const key of Object.keys(store)) {
        const next = key.replace(/^(?:branch-comments|komo):/, "palette:");
        if (next === key) continue;
        if (store.getItem(next) === null) store.setItem(next, store.getItem(key)!);
        store.removeItem(key);
      }
    } catch {
      /* Storage is blocked or full; the old keys stay for the next load. */
    }
}
