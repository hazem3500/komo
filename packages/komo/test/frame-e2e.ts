import type { Page } from "playwright-core";

/** Sets Frame's zoom, "Fit" or "100%", from the size menu; choosing closes the menu. */
export async function frameZoom(page: Page, zoom: string) {
  const trigger = page.locator(".frame-size-trigger");
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await page.getByRole("menuitemradio", { name: zoom, exact: true }).click();
}

/** The Frame trigger's full label, e.g. "Tablet 768 × 1024 · 64%" or "703 × 785 · 70%". */
export const frameLabel = (page: Page) => page.locator(".frame-size-trigger").getAttribute("aria-label");
