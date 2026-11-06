// The single-copy simulated viewport's page moves (frame.shell), loaded on demand: into the shell,
// out of it, and the shell's URL following the frame's route. The keys repeat
// shell-session.ts's, so this chunk shares no module with core.

const PARAM = "palette-shell";
const KEY = "palette:shell";

/** `href` with the shell's nonce, or without it for `""`. */
export function shellUrl(href: string, nonce: string) {
  const url = new URL(href, location.href);
  // An older link's komo-shell gives way to palette-shell.
  url.searchParams.delete("komo-shell");
  if (nonce) url.searchParams.set(PARAM, nonce);
  else url.searchParams.delete(PARAM);
  return url.href;
}

/** Ends the shell: clears it, notes why when it ended early, and loads `href` as the normal page. */
export function leaveShellPage(href: string, reason = "") {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem("komo:shell");
    if (reason) sessionStorage.setItem("palette:shell-off", reason);
  } catch {
    /* The URL no longer carries the nonce, so the next page is normal anyway. */
  }
  location.replace(shellUrl(href, ""));
}

/**
 * Reloads this page as the shell. `ask` confirms first; `fallback` runs when the
 * reviewer cancels, storage is blocked, or the page didn't unload (the
 * app's own unsaved-changes guard can keep it).
 */
export function enterShell(project: string, ask: boolean, edited: boolean, fallback: (reason: string) => void) {
  try {
    const reason = sessionStorage.getItem("palette:shell-off");
    if (reason) return fallback(reason);
    if (ask && !confirm(`Reload in Frame?\n\nUnsaved app changes${edited ? " and unposted Design changes" : ""} will be lost.`))
      return fallback("Reload cancelled.");
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, project, nonce, origin: location.origin }));
    location.replace(shellUrl(location.href, nonce));
  } catch {
    return fallback("Storage blocked.");
  }
  setTimeout(fallback, 3000, "Reload cancelled.");
}

/** The shell's URL follows the frame's route, so reloading or sharing it keeps the page. */
export function syncShell(view: Window | null | undefined, nonce: string) {
  try {
    const shown = view!.location.href;
    const next = shellUrl(shown, nonce);
    if (shown.startsWith(location.origin) && next !== location.href) history.replaceState(history.state, "", next);
  } catch {
    /* The frame is between documents. */
  }
}
