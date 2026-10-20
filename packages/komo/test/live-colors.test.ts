// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldControl, fields, valueFor } from "../src/design-panel.js";
import { liveColors } from "../src/live-colors.js";

describe("live color fields", () => {
  let element: HTMLElement;
  let boxes: HTMLElement[];
  const frames: FrameRequestCallback[] = [];
  const flush = async () => {
    await Promise.resolve();
    while (frames.length) frames.shift()!(0);
  };
  const field = (property: string) => boxes.find(box => box.dataset.fieldProperty === property)!;
  const text = (property: string) => field(property).querySelector<HTMLInputElement>("[data-property]")!.value;
  const swatch = (property: string) => field(property).querySelector<HTMLInputElement>('input[type="color"]')!.value;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    document.body.innerHTML = '<style>.calm{color:rgb(19, 18, 19)}.lit{color:rgb(60, 57, 59)}</style><p id="target" class="lit" style="background-color: rgb(244, 244, 244)">Text</p><div id="panel"></div>';
    element = document.querySelector("#target")!;
    const context = { element, begin() {}, apply() {}, commit() {} };
    const panel = document.querySelector("#panel")!;
    boxes = ["color", "background-color"].map(property => fieldControl(fields.find(item => item.property === property)!, context));
    panel.append(...boxes);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    frames.length = 0;
    vi.unstubAllGlobals();
  });

  it("re-reads the element after its state changes, not the value from the moment it was picked", async () => {
    expect(text("color")).toBe("#3c393b");
    liveColors(boxes, element, valueFor);
    element.className = "calm";
    await flush();
    expect([text("color"), swatch("color")]).toEqual(["#131213", "#131213"]);
    expect([text("background-color"), swatch("background-color")]).toEqual(["#f4f4f4", "#f4f4f4"]);
  });

  it("keeps the text of a field being typed in and tells an open popup when a value settles", async () => {
    liveColors(boxes, element, valueFor);
    const synced: string[] = [];
    for (const box of boxes) box.addEventListener("komo-field-sync", () => synced.push(box.dataset.fieldProperty!));
    const typing = field("background-color").querySelector<HTMLInputElement>("[data-property]")!;
    typing.focus();
    typing.value = "#ab";
    element.className = "calm";
    element.style.backgroundColor = "rgb(1, 2, 3)";
    await flush();
    expect(typing.value).toBe("#ab");
    expect(text("color")).toBe("#131213");
    expect(synced).toEqual(["color"]);
    element.setAttribute("data-state", "same");
    await flush();
    expect(synced).toEqual(["color"]);
  });

  it("shows a bound token's value for the current theme instead of the painted value", async () => {
    const binding = document.createElement("span");
    binding.className = "design-token-binding";
    binding.dataset.value = "rgb(201, 194, 255)";
    field("color").append(binding);
    liveColors(boxes, element, valueFor);
    await flush();
    expect([text("color"), swatch("color")]).toEqual(["#c9c2ff", "#c9c2ff"]);
  });

  it("stops listening once its fields leave the panel", async () => {
    liveColors(boxes, element, valueFor);
    await flush();
    for (const box of boxes) box.remove();
    element.className = "calm";
    await flush();
    const before = text("color");
    element.className = "lit";
    await Promise.resolve();
    expect(frames).toEqual([]);
    expect(text("color")).toBe(before);
  });
});
