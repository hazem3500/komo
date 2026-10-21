import type { Page } from "playwright-core";

/**
 * Waits until Design mode's inspector is open and ready: its property controls and selection
 * keys have loaded (komo marks the panel data-ready). Until the inspector shows, a page click or
 * key still belongs to the host. Wait on this, not on a fixed delay, before picking.
 */
export async function waitForInspector(page: Page) {
  await page.locator('.design-inspector[aria-hidden="false"][data-ready]').waitFor();
}

/** Opens Design mode with D and waits for its ready inspector. */
export async function openDesign(page: Page) {
  await page.keyboard.press("d");
  await waitForInspector(page);
}
