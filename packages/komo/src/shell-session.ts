// Single-copy Viewport: the top window becomes a shell for komo and the app runs
// once, in Frame's viewport iframe. komo marks a shell page with a random nonce,
// kept both in this tab's sessionStorage and in the URL, so a link alone can't
// make one. This is the part core reads at mount; shell-mode.ts moves pages, and
// the side-effect-free `@hazem3500/komo/shell` entry is built from both on its own.
// Nothing here runs at import.

/** The URL parameter that carries the shell's nonce. */
export const SHELL_PARAM = "komo-shell";
/** sessionStorage: the shell komo started in this tab, `{ v, project, nonce, origin }`. */
export const SHELL_KEY = "komo:shell";
/** sessionStorage: why the last shell ended early. This tab then keeps two copies, without reloading. */
export const SHELL_OFF_KEY = "komo:shell-off";

/** The page's shell nonce, when komo started a shell for `project` in this tab; else "". */
export function shellNonce(project: string): string {
  try {
    if (window.name === "komo-viewport") return "";
    const nonce = new URL(location.href).searchParams.get(SHELL_PARAM);
    const stored = JSON.parse(sessionStorage.getItem(SHELL_KEY) ?? "null");
    return nonce && stored?.v === 1 && stored.nonce === nonce && stored.project === project && stored.origin === location.origin
      ? nonce
      : "";
  } catch {
    return "";
  }
}

/** komo started in this shell, so the guard's fallback stands down. */
export function claimShell(nonce: string) {
  (window as unknown as Record<symbol, string>)[Symbol.for("komo.shell")] = nonce;
}
export const shellClaimed = (nonce: string) => (window as unknown as Record<symbol, string>)[Symbol.for("komo.shell")] === nonce;
