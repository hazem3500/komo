// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { isolateEscape } from "../src/dom";

it("reserves feedback Escape before document capture without preventing local handling", () => {
  const host = document.createElement("div"),
    outside = document.createElement("input");
  const root = host.attachShadow({ mode: "open" }),
    input = document.createElement("textarea");
  root.append(input);
  document.body.append(host, outside);
  const listening = new AbortController(),
    dismissHost = vi.fn(),
    local = vi.fn();
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) dismissHost();
    },
    { capture: true, signal: listening.signal },
  );
  root.addEventListener("keydown", local, { signal: listening.signal });
  isolateEscape(host, listening.signal);
  const press = (target: EventTarget, key = "Escape") => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  expect(press(input).defaultPrevented).toBe(true);
  expect(dismissHost).not.toHaveBeenCalled();
  expect(local).toHaveBeenCalledOnce();
  expect(press(input, "ArrowLeft").defaultPrevented).toBe(false);
  expect(press(outside).defaultPrevented).toBe(false);
  expect(dismissHost).toHaveBeenCalledOnce();
  listening.abort();
  expect(press(input).defaultPrevented).toBe(false);
  host.remove();
  outside.remove();
});

it("uses the feedback host's iframe window and removes the capture listener on abort", () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const frameDocument = iframe.contentDocument!,
    frameWindow = frameDocument.defaultView!;
  const host = frameDocument.createElement("div"),
    root = host.attachShadow({ mode: "open" }),
    input = frameDocument.createElement("button");
  root.append(input);
  frameDocument.body.append(host);
  const listening = new (
    frameWindow as unknown as typeof window
  ).AbortController();
  isolateEscape(host, listening.signal);
  const press = () => {
    const event = new (frameWindow as unknown as typeof window).KeyboardEvent(
      "keydown",
      { key: "Escape", bubbles: true, composed: true, cancelable: true },
    );
    input.dispatchEvent(event);
    return event;
  };
  expect(press().defaultPrevented).toBe(true);
  listening.abort();
  expect(press().defaultPrevented).toBe(false);
  iframe.remove();
});
