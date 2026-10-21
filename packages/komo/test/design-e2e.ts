import type { Page } from "playwright-core";

/**
 * Opens Design mode with D and waits until its inspector is open. The first open loads
 * Design mode, its controls and its selection keys; until the inspector shows, a page click
 * or key still belongs to the host. Wait on this, not on a fixed delay, before picking.
 */
export async function openDesign(page: Page) {
  await page.keyboard.press("d");
  await page.locator('.design-inspector[aria-hidden="false"]').waitFor();
}
