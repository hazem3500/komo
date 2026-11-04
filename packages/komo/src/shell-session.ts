// Single-copy simulated viewport: the top window becomes a shell for Palette and the app runs
// once, in Frame's viewport iframe. Palette marks a shell page with a random nonce,
// kept both in this tab's sessionStorage and in the URL, so a link alone can't
// make one. This is the part core reads at mount; shell-mode.ts moves pages, and
// the side-effect-free `@hazem3500/palette/shell` entry is built from both on its own.
// Nothing here runs at import.

/** The URL parameter that carries the shell's nonce. */
export const SHELL_PARAM = "palette-shell";
/** Its name before the rename; still accepted. */
export const LEGACY_SHELL_PARAM = "komo-shell";
/** sessionStorage: the shell Palette started in this tab, `{ v, project, nonce, origin }`. */
export const SHELL_KEY = "palette:shell";
/** sessionStorage: why the last shell ended early. This tab then keeps two copies, without reloading. */
export const SHELL_OFF_KEY = "palette:shell-off";

/** The page's shell nonce, when Palette started a shell for `project` in this tab; else "". */
export function shellNonce(project: string): string {
  try {
    if (/^(palette|komo)-viewport$/.test(window.name)) return "";
    const params = new URL(location.href).searchParams;
    const nonce = params.get(SHELL_PARAM) ?? params.get(LEGACY_SHELL_PARAM);
    // The guard runs before Palette mounts and moves older keys, so it reads the old one too.
    const stored = JSON.parse(sessionStorage.getItem(SHELL_KEY) ?? sessionStorage.getItem("komo:shell") ?? "null");
    return nonce && stored?.v === 1 && stored.nonce === nonce && stored.project === project && stored.origin === location.origin
      ? nonce
      : "";
  } catch {
    return "";
  }
}

// Published under the older "komo.shell" too, so a guard from an older release stands down.
const claims = () => [Symbol.for("palette.shell"), Symbol.for("komo.shell")];
/** Palette started in this shell, so the guard's fallback stands down. */
export function claimShell(nonce: string) {
  for (const claim of claims()) (window as unknown as Record<symbol, string>)[claim] = nonce;
}
export const shellClaimed = (nonce: string) => claims().some((claim) => (window as unknown as Record<symbol, string>)[claim] === nonce);
