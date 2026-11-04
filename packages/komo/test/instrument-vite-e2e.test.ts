import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, fixtureApp, serve } from "./instrument-build.js";
import { openDesign } from "./design-e2e.js";

// Build-time instrumentation in real Chrome, on Vite production builds (minified, production
// React 19 and 18): design-system components and one allowlisted app component edit their
// scalar props through their own instance state, with Undo, Redo and Reset, and nothing else
// about them changes.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let browser: Browser;
const sites: Record<number, { directory: string; server: Server; origin: string }> = {};

beforeAll(async () => {
  if (!chrome) return;
  for (const react of [19, 18] as const) {
    const { directory, app } = await fixtureApp(react);
    const out = await buildApp(app, join(directory, "preview"), true);
    sites[react] = { directory, ...(await serve(out)) };
  }
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-blink-features=EyeDropperAPI"] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  for (const site of Object.values(sites)) {
    site.server.close();
    await rm(site.directory, { recursive: true, force: true });
  }
});

async function open(react: number, before?: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sites[react]!.origin);
  await page.locator("#primary").waitFor();
  await before?.(page);
  await page.evaluate(() => window.qa.startPalette());
  await page.waitForFunction(() => !!window.qa.palette);
  await openDesign(page);
  return { page, errors };
}
const attr = (page: Page, selector: string, name: string) => page.locator(selector).getAttribute(`data-${name}`);
const count = (page: Page) => page.locator(".design-inspector__count").textContent();
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const undo = (page: Page) => page.keyboard.press("ControlOrMeta+z");
const redo = (page: Page) => page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
/** Picks the component that renders `selector`: a part inside it offers "Select component". */
async function pick(page: Page, selector: string) {
  await page.click(selector);
  const select = button(page, "Select component");
  if (await select.waitFor({ timeout: 1000 }).then(() => true, () => false)) await select.click();
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.locator(".palette-select").getByRole("option", { name: value, exact: true }).click();
  await page.locator(".palette-select").waitFor({ state: "detached" });
}

describe.skipIf(!chrome).each([19, 18])("build-time instrumented components, React %s production", (react) => {
  it("edits a design-system Button through its own state: Undo, Redo, Reset, parent renders and an unset prop", async () => {
    const { page, errors } = await open(react);
    // No wrapper element: the button is still the first child of main.
    expect(await page.evaluate(() => document.querySelector("main")!.firstElementChild!.id)).toBe("primary");
    await pick(page, "#primary");
    await page.getByRole("combobox", { name: "Button variant", exact: true }).waitFor();
    expect(await page.locator(".design-react-group summary").first().textContent()).toContain("Button");

    await choose(page, "Button variant", "danger");
    await expect.poll(() => attr(page, "#primary", "variant")).toBe("danger");
    expect(await count(page)).toBe("1 change");
    // The parent renders again: the preview holds and the parent's own state moves on.
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(() => window.qa.rerender());
      await expect.poll(() => page.locator("#tick").textContent()).toBe(String(i));
    }
    expect(await attr(page, "#primary", "variant")).toBe("danger");
    // The forwarded ref still reaches the DOM button, and context still reaches the component.
    expect(await page.evaluate(() => window.qa.ref())).toContain("ui-danger");
    expect(await attr(page, "#primary", "theme")).toBe("dark");

    await undo(page);
    await expect.poll(() => attr(page, "#primary", "variant")).toBe("primary");
    await redo(page);
    await expect.poll(() => attr(page, "#primary", "variant")).toBe("danger");

    // size isn't passed: set, then reset, it is absent again, not undefined.
    expect(await attr(page, "#primary", "has-size")).toBe("false");
    await choose(page, "Button size", "lg");
    await expect.poll(() => attr(page, "#primary", "size")).toBe("lg");
    expect(await attr(page, "#primary", "has-size")).toBe("true");
    await button(page, "Reset").click();
    await expect.poll(() => attr(page, "#primary", "variant")).toBe("primary");
    expect(await attr(page, "#primary", "size")).toBe("md");
    expect(await attr(page, "#primary", "has-size")).toBe("false");
    expect(await count(page)).toBe("");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("previews a controlled input's value while the app keeps its own, and keeps a stateful component's state", async () => {
    // Design mode takes page clicks, so the Counter counts before it opens.
    const { page, errors } = await open(react, async (page) => {
      await page.click(".ui-counter");
      await page.click(".ui-counter");
    });
    await pick(page, ".ui-field span");
    const value = page.getByRole("textbox", { name: "TextField value", exact: true });
    await value.waitFor();
    await value.fill("Preview");
    await value.press("Enter");
    await expect.poll(() => page.locator(".ui-field input").inputValue()).toBe("Preview");
    // The app's state changes underneath; the preview still shows until it is undone.
    await page.evaluate(() => window.qa.setText("From the app"));
    await expect.poll(() => page.locator("#text").textContent()).toBe("From the app");
    expect(await page.locator(".ui-field input").inputValue()).toBe("Preview");
    // ⌘Z from the panel's own text field is that field's; Design mode's Undo needs focus outside it.
    await value.evaluate((input) => input.blur());
    await undo(page);
    await expect.poll(() => page.locator(".ui-field input").inputValue()).toBe("From the app");

    // Counter's own count survives a preview of its props.
    expect(await page.locator(".ui-counter").textContent()).toBe("Count 2");
    await pick(page, ".ui-counter");
    await choose(page, "Counter tone", "bold");
    await expect.poll(() => attr(page, ".ui-counter", "tone")).toBe("bold");
    expect(await page.locator(".ui-counter").textContent()).toBe("Count 2");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("covers memo, portal, multiple roots, a class component and an allowlisted app component", async () => {
    const { page, errors } = await open(react);
    await pick(page, ".ui-badge");
    await choose(page, "Badge tone", "warning");
    await expect.poll(() => attr(page, ".ui-badge", "tone")).toBe("warning");

    await pick(page, ".ui-popover");
    await choose(page, "Popover placement", "top");
    await expect.poll(() => attr(page, ".ui-popover", "placement")).toBe("top");

    await pick(page, ".ui-pair-first");
    const first = page.getByRole("textbox", { name: "Pair first", exact: true });
    await first.fill("Edited");
    await first.press("Enter");
    await expect.poll(() => page.locator(".ui-pair-first").textContent()).toBe("Edited");

    await pick(page, "#inside-panel");
    await choose(page, "Panel elevation", "2");
    await expect.poll(() => attr(page, ".ui-panel", "elevation")).toBe("2");

    await pick(page, ".project-card h3");
    await choose(page, "ProjectCard status", "at-risk");
    await expect.poll(() => attr(page, ".project-card", "status")).toBe("at-risk");
    // Objects and callbacks aren't controls.
    expect(await page.getByRole("textbox", { name: "ProjectCard owner", exact: true }).count()).toBe(0);
    expect(await page.getByRole("textbox", { name: "ProjectCard onOpen", exact: true }).count()).toBe(0);
    // Undo walks back through every instance's edits.
    for (let i = 0; i < 5; i++) await undo(page);
    await expect.poll(() => attr(page, ".project-card", "status")).toBe("on-track");
    expect(await attr(page, ".ui-badge", "tone")).toBe("success");
    expect(await attr(page, ".ui-popover", "placement")).toBe("bottom");
    expect(await page.locator(".ui-pair-first").textContent()).toBe("Left");
    expect(await attr(page, ".ui-panel", "elevation")).toBe("1");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("edits the instance inside Frame's viewport iframe, never the copy beneath it", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(sites[react]!.origin);
    await page.locator("#primary").waitFor();
    await page.evaluate(() => window.qa.startPalette(true));
    await page.waitForFunction(() => !!window.qa.palette);
    await page.keyboard.press("l");
    await page.waitForFunction(() => {
      const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
      const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-palette-viewport]");
      return !!frame?.contentDocument?.querySelector("#primary") && !root!.querySelector(".frame-stage[data-loading]");
    });
    const frame = page.frames().find((item) => item.name() === "komo-viewport")!;
    await openDesign(page);
    const point = await page.evaluate(() => {
      const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
      const frame = root.querySelector<HTMLIFrameElement>("iframe[data-palette-viewport]")!;
      const outer = frame.getBoundingClientRect(), scale = outer.width / frame.offsetWidth;
      const inner = frame.contentDocument!.querySelector("#primary")!.getBoundingClientRect();
      return { x: outer.left + (inner.left + inner.width / 2) * scale, y: outer.top + (inner.top + inner.height / 2) * scale };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    await choose(page, "Button variant", "danger");
    await expect.poll(() => frame.locator("#primary").getAttribute("data-variant")).toBe("danger");
    expect(await page.locator("main #primary").getAttribute("data-variant")).toBe("primary");
    await undo(page);
    await expect.poll(() => frame.locator("#primary").getAttribute("data-variant")).toBe("primary");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("edits next to a null and an over-long prop, keeps memo's compare, and covers default and aliased exports", async () => {
    const { page, errors } = await open(react);
    // Avatar's src is null and its caption too long for a control: editing size leaves both as they were.
    await pick(page, ".ui-avatar");
    await choose(page, "Avatar size", "lg");
    await expect.poll(() => attr(page, ".ui-avatar", "size")).toBe("lg");
    expect(await attr(page, ".ui-avatar", "src")).toBe("null");
    expect(await attr(page, ".ui-avatar", "caption-length")).toBe("600");
    expect(await attr(page, ".ui-avatar", "author")).toBe("Sam");

    // Tag's compare ignores note: parent renders still bail out, as without instrumentation.
    const renders = await page.evaluate(() => (window as any).qa.tagRenders());
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.qa.rerender());
    await expect.poll(() => page.locator("#tick").textContent()).toBe("3");
    expect(await page.evaluate(() => (window as any).qa.tagRenders())).toBe(renders);
    await pick(page, ".ui-tag");
    await choose(page, "Tag tone", "bold");
    await expect.poll(() => attr(page, ".ui-tag", "tone")).toBe("bold");

    // A default export re-exported as { Quote as default }, and an app module behind an alias.
    await pick(page, ".ui-quote");
    const author = page.getByRole("textbox", { name: "Quote author", exact: true });
    await author.fill("Kai");
    await author.press("Enter");
    await expect.poll(() => page.locator(".ui-quote").textContent()).toBe("Kai");
    await pick(page, ".summary");
    await choose(page, "Summary tone", "loud");
    await expect.poll(() => attr(page, ".summary", "tone")).toBe("loud");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("instruments a subpath export and leaves a type-compared compound part alone", async () => {
    const { page, errors } = await open(react);
    // List keeps only ListItem children: ListItem isn't wrapped, so both items still render.
    expect(await attr(page, ".ui-list", "count")).toBe("2");
    await pick(page, ".ui-chip");
    await choose(page, "Chip tone", "bright");
    await expect.poll(() => attr(page, ".ui-chip", "tone")).toBe("bright");
    await pick(page, ".ui-list");
    await choose(page, "List density", "compact");
    await expect.poll(() => attr(page, ".ui-list", "density")).toBe("compact");
    expect(await attr(page, ".ui-list", "count")).toBe("2");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("drops an unmounted instance and gives a remounted one its own props", async () => {
    const { page, errors } = await open(react);
    await pick(page, "#transient");
    await choose(page, "Button variant", "danger");
    await expect.poll(() => attr(page, "#transient", "variant")).toBe("danger");
    await page.evaluate(() => window.qa.toggleShown());
    await page.locator("#transient").waitFor({ state: "detached" });
    await page.evaluate(() => window.qa.toggleShown());
    await page.locator("#transient").waitFor();
    expect(await attr(page, "#transient", "variant")).toBe("secondary");
    // Undo after the instance left never retargets the new one.
    await undo(page);
    expect(await attr(page, "#transient", "variant")).toBe("secondary");
    expect(errors).toEqual([]);
    await page.close();
  });
});
