// `@hazem3500/palette/shell`: the entry guard for Frame's single-copy simulated viewport. It has no
// top-level side effects, so `import.meta.env.DEV && isShell(project)` drops it
// from production builds.

import { leaveShellPage } from "./shell-mode.js";
import { shellClaimed, shellNonce } from "./shell-session.js";

export interface ShellOptions {
  /** How long Palette may take to start in the shell before the normal page loads instead, in ms. Default 4000. */
  timeout?: number;
}

/**
 * True when this page load is Palette's single-copy simulated-viewport shell for `project`:
 * skip mounting the app, and start Palette with `frame: { mode: "iframe", shell: true }`.
 *
 * Only Palette makes a shell: it sets a random nonce in this tab's sessionStorage and
 * in the URL. A link with `?palette-shell=…` (or the older `?komo-shell=…`) alone, or a flag left by another project
 * or origin, returns false. If Palette doesn't start within `timeout`, the shell is
 * cleared and the normal page loads, so a shell is never left blank.
 */
export function isShell(project: string, options: ShellOptions = {}): boolean {
  const nonce = shellNonce(project);
  if (nonce)
    setTimeout(() => {
      if (!shellClaimed(nonce)) leaveShellPage(location.href, "Palette didn't start in the single-copy shell in time.");
    }, options.timeout ?? 4000);
  return !!nonce;
}
