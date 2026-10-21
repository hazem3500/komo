import { chromium, type Browser, type BrowserContext, type LaunchOptions } from "playwright-core";

// Automated runs must never open the native EyeDropper: on macOS it starts the system colour
// sampler, which takes over the pointer for the whole desktop. Every browser a test launches has
// the API switched off, every page gets a stub instead, and a native `open()` that is somehow
// still reachable throws rather than sampling the screen.
export const EYEDROPPER_STUB_HEX = "#ff0000";

/** Page script: `globalThis.__komoEyeDropper = "abort"` makes the next pick cancel. */
export const eyeDropperStub = `(() => {
  const native = globalThis.EyeDropper;
  if (native) native.prototype.open = () => { throw new Error("Native EyeDropper reached in an automated test"); };
  class EyeDropper {
    open() {
      globalThis.__komoEyeDropperCalls = (globalThis.__komoEyeDropperCalls ?? 0) + 1;
      const next = globalThis.__komoEyeDropper ?? { sRGBHex: "${EYEDROPPER_STUB_HEX}" };
      return next === "abort"
        ? Promise.reject(new DOMException("The user canceled the selection.", "AbortError"))
        : Promise.resolve(next);
    }
  }
  Object.defineProperty(globalThis, "EyeDropper", { value: EyeDropper, configurable: true, writable: true });
})();`;

const off = "--disable-blink-features=EyeDropperAPI";
const withFlag = <T extends LaunchOptions>(options?: T) => ({ ...options, args: [...(options?.args ?? []), off] }) as T;

function guardContext(context: BrowserContext) {
  return context.addInitScript(eyeDropperStub).then(() => context);
}

function guardBrowser(browser: Browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => guardContext(await newContext(...args));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.context().addInitScript(eyeDropperStub);
    return page;
  };
  return browser;
}

const launch = chromium.launch.bind(chromium);
chromium.launch = async (options) => guardBrowser(await launch(withFlag(options)));
const persistent = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (dir, options) => guardContext(await persistent(dir, withFlag(options)));

// jsdom and happy-dom files get the same stub.
if (typeof window !== "undefined") new Function(eyeDropperStub)();
