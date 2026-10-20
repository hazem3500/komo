// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  colorChannels, documentColors, formatColor, hslToRgb, hsvToRgb, matchingToken, parseColor, pickerEditor,
  recentColors, rememberColor, rgbToHsl, rgbToHsv, type Rgba,
} from "../src/color-editor.js";
import type { DesignToken } from "../src/design-system.js";
import { openTokenPicker } from "../src/token-picker.js";

vi.stubGlobal("CSS", { supports: (property: string, value: string) => {
  const style = document.createElement("span").style;
  style.setProperty(property, value);
  return !!style.getPropertyValue(property);
} });

const tokens: DesignToken[] = [
  { path: "tone.ink", label: "Ink", type: "color", value: "#336699", properties: ["color"] },
  { path: "tone.paper", label: "Paper", type: "color", value: "rgb(250 250 250)", properties: ["color"] },
  { path: "space.small", label: "Small", type: "dimension", value: "8px", properties: ["padding"] },
];
const rounded = (rgba: Rgba | undefined) => rgba?.map((part, index) => index < 3 ? Math.round(part) : Math.round(part * 1000) / 1000);

describe("color conversions", () => {
  it("parses hex, rgb, hsl and hsb in every syntax, and rejects what is not a color", () => {
    expect(parseColor("#369")).toEqual([51, 102, 153, 1]);
    expect(parseColor("336699")).toEqual([51, 102, 153, 1]);
    expect(rounded(parseColor("#33669980"))).toEqual([51, 102, 153, 0.502]);
    expect(rounded(parseColor("#3698"))).toEqual([51, 102, 153, 0.533]);
    expect(parseColor("rgb(51, 102, 153)")).toEqual([51, 102, 153, 1]);
    expect(parseColor("rgba(51,102,153,.5)")).toEqual([51, 102, 153, 0.5]);
    expect(parseColor("rgb(51 102 153 / 50%)")).toEqual([51, 102, 153, 0.5]);
    expect(parseColor("rgb(20% 40% 60%)")).toEqual([51, 102, 153, 1]);
    expect(rounded(parseColor("hsl(210 50% 40%)"))).toEqual([51, 102, 153, 1]);
    expect(rounded(parseColor("hsla(210deg, 50%, 40%, 0.25)"))).toEqual([51, 102, 153, 0.25]);
    expect(rounded(parseColor("hsb(210 66.667% 60%)"))).toEqual([51, 102, 153, 1]);
    expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
    for (const invalid of ["", "#12zz", "rgb(1, 2)", "rgb(a b c)", "var(--tone)", "currentColor", "12px"]) expect(parseColor(invalid)).toBeUndefined();
  });

  it("round-trips HSB and HSL", () => {
    for (const rgb of [[51, 102, 153], [255, 0, 0], [0, 0, 0], [255, 255, 255], [19, 18, 19], [168, 76, 157]]) {
      expect(hsvToRgb(...(rgbToHsv(...(rgb as [number, number, number])) as [number, number, number])).map(Math.round)).toEqual(rgb);
      expect(hslToRgb(...(rgbToHsl(...(rgb as [number, number, number])) as [number, number, number])).map(Math.round)).toEqual(rgb);
    }
  });

  it("writes each format's CSS and shows its channels, alpha in percent", () => {
    const color: Rgba = [43, 96, 97, 1], faded: Rgba = [43, 96, 97, 0.5];
    expect(formatColor(color, "Hex")).toBe("#2b6061");
    expect(formatColor(faded, "Hex")).toBe("#2b606180");
    expect(formatColor(faded, "RGB")).toBe("rgb(43 96 97 / 50%)");
    expect(formatColor(color, "HSL")).toBe("hsl(181 39% 27%)");
    expect(formatColor(faded, "HSB")).toBe("#2b606180");
    expect(formatColor(color, "CSS")).toBe("rgb(43 96 97)");
    const hsv = rgbToHsv(43, 96, 97);
    expect(colorChannels(color, "Hex", hsv)).toEqual(["2B6061", "100"]);
    expect(colorChannels(faded, "RGB", hsv)).toEqual(["43", "96", "97", "50"]);
    expect(colorChannels(color, "HSL", hsv)).toEqual(["181", "39", "27", "100"]);
    expect(colorChannels(color, "HSB", hsv)).toEqual(["181", "56", "38", "100"]);
    expect(colorChannels(faded, "CSS", hsv)).toEqual(["rgb(43 96 97 / 50%)"]);
    // A gray keeps the hue it was dragged to.
    expect(colorChannels([128, 128, 128, 1], "HSB", [200, 0, 0.5])[0]).toBe("200");
  });
});

describe("document and recent swatches", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.body.replaceChildren());

  it("ranks the page's colors by use, without duplicates, transparent colors or komo itself", () => {
    document.body.innerHTML = `<main style="color:rgb(10, 10, 10)"><p style="color:#0a0a0a">a</p><p style="color:rgb(10 10 10);background-color:#ff0000">b</p>
      <p style="background-color:rgba(0, 0, 0, 0)">c</p><p style="border:2px solid #00ff00">d</p><p style="border-top:0 solid #0000ff">e</p></main>
      <div data-branch-comments="example" style="color:#123456"></div>`;
    const colors = documentColors(document.body);
    expect(colors[0]).toBe("#0a0a0a");
    expect(colors).toContain("#ff0000");
    expect(colors).toContain("#00ff00");
    expect(colors).not.toContain("#0000ff");
    expect(colors).not.toContain("#123456");
    expect(new Set(colors).size).toBe(colors.length);
    expect(documentColors(document.body, 2)).toHaveLength(2);
  });

  it("keeps eight recent colors per project, newest first", () => {
    document.body.innerHTML = '<div data-branch-comments="alpha"></div>';
    for (let index = 0; index < 10; index++) rememberColor(`#00000${index}`);
    rememberColor("#000003");
    expect(recentColors()).toEqual(["#000003", "#000009", "#000008", "#000007", "#000006", "#000005", "#000004", "#000002"]);
    document.body.innerHTML = '<div data-branch-comments="beta"></div>';
    expect(recentColors()).toEqual([]);
  });

  it("finds the relevant token whose value is the color", () => {
    expect(matchingToken([51, 102, 153, 1], tokens, "color")?.path).toBe("tone.ink");
    expect(matchingToken([250, 250, 250, 1], tokens, "color")?.path).toBe("tone.paper");
    expect(matchingToken([51, 102, 153, 0.5], tokens, "color")).toBeUndefined();
    expect(matchingToken([51, 102, 153, 1], tokens, "background-color")).toBeUndefined();
  });
});

describe("the color editor", () => {
  let host: { preview: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn>; token: ReturnType<typeof vi.fn> };
  const open = (value = "rgb(51, 102, 153)") => {
    const editor = pickerEditor({ trigger: document.body, tokens, property: "color", onSelect() {}, custom: { value, onPreview: () => () => {}, onSelect() {} } }, host);
    document.body.append(editor);
    return editor;
  };
  const input = (editor: HTMLElement, name: string) => editor.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  const key = (node: Element, key: string, shiftKey = false) => node.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  const type = (field: HTMLInputElement, value: string) => { field.value = value; field.dispatchEvent(new Event("input")); };
  const format = (editor: HTMLElement, name: string) => {
    const select = editor.querySelector<HTMLSelectElement>('select[aria-label="Color format"]')!;
    select.value = name;
    select.dispatchEvent(new Event("change"));
  };

  beforeEach(() => {
    localStorage.clear();
    host = { preview: vi.fn(), commit: vi.fn(), token: vi.fn() };
  });
  afterEach(() => document.body.replaceChildren());

  it("previews typing and keeps it on Enter or blur, once", () => {
    const editor = open();
    const hex = input(editor, "Hex");
    expect(hex.value).toBe("336699");
    type(hex, "2B6061");
    expect(host.preview).toHaveBeenLastCalledWith("#2b6061");
    expect(host.commit).not.toHaveBeenCalled();
    key(hex, "Enter");
    expect(host.commit).toHaveBeenCalledExactlyOnceWith("#2b6061");
    hex.dispatchEvent(new Event("blur"));
    expect(host.commit).toHaveBeenCalledTimes(1);
    type(hex, "12zz");
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    hex.dispatchEvent(new Event("blur"));
    expect(host.commit).toHaveBeenCalledTimes(1);
    type(input(editor, "Opacity"), "50");
    input(editor, "Opacity").dispatchEvent(new Event("blur"));
    expect(host.commit).toHaveBeenLastCalledWith("#2b606180");
  });

  it("nudges channels with arrows, scrubs them by their label and takes a pasted color", () => {
    const editor = open();
    format(editor, "RGB");
    const red = input(editor, "Red");
    key(red, "ArrowUp");
    expect(host.commit).toHaveBeenLastCalledWith("rgb(52 102 153)");
    key(red, "ArrowDown", true);
    expect(host.commit).toHaveBeenLastCalledWith("rgb(42 102 153)");
    const label = red.previousElementSibling as HTMLElement;
    label.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true }));
    label.dispatchEvent(new MouseEvent("pointermove", { clientX: 110, bubbles: true }));
    expect(host.preview).toHaveBeenLastCalledWith("rgb(47 102 153)");
    const commits = host.commit.mock.calls.length;
    label.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, shiftKey: true, bubbles: true }));
    expect(host.commit).toHaveBeenCalledTimes(commits);
    label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(host.commit).toHaveBeenCalledTimes(commits + 1);
    expect(host.commit).toHaveBeenLastCalledWith("rgb(97 102 153)");
    const paste = Object.assign(new Event("paste", { cancelable: true }), { clipboardData: { getData: () => "hsl(0 100% 50% / 25%)" } });
    input(editor, "Green").dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(host.commit).toHaveBeenLastCalledWith("rgb(255 0 0 / 25%)");
    expect([...editor.querySelectorAll<HTMLInputElement>(".komo-color__channels input")].map(item => item.value)).toEqual(["255", "0", "0", "25"]);
  });

  it("switches formats without keeping anything and remembers the choice", () => {
    const editor = open();
    for (const [name, values] of [["HSL", ["210", "50", "40", "100"]], ["HSB", ["210", "67", "60", "100"]], ["CSS", ["rgb(51 102 153)"]]] as const) {
      format(editor, name);
      expect([...editor.querySelectorAll<HTMLInputElement>(".komo-color__channels input")].map(item => item.value)).toEqual(values);
    }
    expect(host.commit).not.toHaveBeenCalled();
    type(input(editor, "CSS color"), "rebeccapurple");
    key(input(editor, "CSS color"), "Enter");
    expect(host.commit).toHaveBeenLastCalledWith("rebeccapurple");
    document.body.replaceChildren();
    expect(open().querySelector<HTMLSelectElement>("select")!.value).toBe("CSS");
  });

  it("drives the area and both sliders from the keyboard with readable values", () => {
    const editor = open("#ff0000");
    const area = editor.querySelector('[aria-label="Saturation and brightness"]')!;
    const hue = editor.querySelector('[role=slider][aria-label="Hue"]')!;
    const opacity = editor.querySelector('[role=slider][aria-label="Opacity"]')!;
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 100%, brightness 100%");
    key(area, "ArrowLeft", true);
    key(area, "ArrowDown");
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 90%, brightness 99%");
    key(area, "Home");
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 0%, brightness 99%");
    key(area, "End");
    key(hue, "ArrowRight");
    expect(hue.getAttribute("aria-valuetext")).toBe("Hue 1°");
    key(hue, "End");
    expect(hue.getAttribute("aria-valuenow")).toBe("360");
    key(hue, "Home");
    key(hue, "ArrowUp", true);
    expect(hue.getAttribute("aria-valuetext")).toBe("Hue 10°");
    key(opacity, "PageDown");
    expect(opacity.getAttribute("aria-valuetext")).toBe("Opacity 90%");
    expect(host.commit).toHaveBeenLastCalledWith("#fc2a00e6");
  });

  it("offers the token a swatch or value matches", async () => {
    document.body.innerHTML = '<p style="color:#336699">Swatch</p>';
    const editor = open("#000000");
    await vi.waitFor(() => expect(editor.querySelector('[aria-label="Document color #336699"]')).not.toBeNull());
    const match = editor.querySelector<HTMLElement>(".komo-color__match")!;
    expect(match.hidden).toBe(true);
    editor.querySelector<HTMLButtonElement>('[aria-label="Document color #336699"]')!.click();
    expect(host.commit).toHaveBeenLastCalledWith("#336699");
    expect(match.hidden).toBe(false);
    expect(match.textContent).toContain("Matches Ink");
    match.querySelector<HTMLButtonElement>('[aria-label="Use token Ink"]')!.click();
    expect(host.token).toHaveBeenCalledWith(tokens[0]);
    expect(recentColors()).toEqual(["#336699"]);
  });
});

describe("the live color popup", () => {
  afterEach(() => document.body.replaceChildren());

  it("keeps values while open, finishes on close and cancels on Escape", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const custom = { value: "#336699", onPreview: vi.fn(() => () => {}), onSelect: vi.fn(), onCommit: vi.fn(), onDone: vi.fn(), onCancel: vi.fn() };
    openTokenPicker({ trigger, tokens, property: "color", onSelect: vi.fn(), custom });
    await vi.waitFor(() => expect(document.querySelector(".komo-color")).not.toBeNull());
    expect(document.querySelector(".komo-custom")).toBeNull();
    const hex = document.querySelector<HTMLInputElement>('.komo-color input[aria-label="Hex"]')!;
    hex.value = "112233";
    hex.dispatchEvent(new Event("input"));
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(custom.onCommit).toHaveBeenCalledExactlyOnceWith("#112233");
    expect(document.querySelector(".komo-tokens")).not.toBeNull();
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(custom.onCancel).toHaveBeenCalledTimes(1);
    expect(custom.onDone).not.toHaveBeenCalled();
    expect(document.querySelector(".komo-tokens")).toBeNull();

    openTokenPicker({ trigger, tokens, property: "color", onSelect: vi.fn(), custom });
    await vi.waitFor(() => expect(document.querySelector(".komo-color")).not.toBeNull());
    const typed = document.querySelector<HTMLInputElement>('.komo-color input[aria-label="Hex"]')!;
    typed.value = "445566";
    typed.dispatchEvent(new Event("input"));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(custom.onCommit).toHaveBeenLastCalledWith("#445566");
    expect(custom.onDone).toHaveBeenCalledTimes(1);
  });
});
