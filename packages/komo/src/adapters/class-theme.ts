// Theme axis for sites that switch themes with a class or attribute, e.g.
// `<html class="dark">` or `<html data-theme="docs">`.
//
//   import { classTheme } from "@hazem3500/komo/adapters/class-theme";
//   initKomo({ design: { themes: [classTheme({ id: "mode", options: [...], colorScheme: true })] } });
//
// A separate entry point; it never enters the core bundle.
import type { ThemeAxis } from "../design-system.js";

export interface ClassThemeOption {
  id: string;
  label?: string;
  /** Class(es) present on the target while this option is active, e.g. "dark". */
  class?: string | string[];
  /** Attributes set on the target while this option is active, e.g. { "data-theme": "dark" }. */
  attribute?: Record<string, string>;
  /** `color-scheme` to set when the axis has `colorScheme`; defaults to the option id. */
  colorScheme?: string;
}

export interface ClassThemeOptions {
  id: string;
  label?: string;
  options: ClassThemeOption[];
  /** Element carrying the classes or attributes; defaults to `<html>`. */
  target?: () => Element;
  /** Also set the target's inline `color-scheme` (e.g. for light/dark). */
  colorScheme?: boolean;
}

const classesOf = (option: ClassThemeOption) =>
  (Array.isArray(option.class) ? option.class : [option.class ?? ""]).flatMap((item) => item.split(/\s+/)).filter(Boolean);

/** A `ThemeAxis` that reads and switches classes or attributes on one element. */
export function classTheme(config: ClassThemeOptions): ThemeAxis {
  const target = config.target ?? (() => document.documentElement);
  // The page's own inline color-scheme, restored when the starting option is applied again.
  let initial: { option: string; colorScheme: string } | undefined;

  const markers = (option: ClassThemeOption) => classesOf(option).length + Object.keys(option.attribute ?? {}).length;
  const active = (element: Element, option: ClassThemeOption) =>
    classesOf(option).every((name) => element.classList.contains(name)) &&
    Object.entries(option.attribute ?? {}).every(([name, value]) => element.getAttribute(name) === value);

  function current() {
    const element = target();
    // The most specific matching option wins, so "dark high-contrast" beats "dark".
    let best: ClassThemeOption | undefined;
    for (const option of config.options)
      if (active(element, option) && (!best || markers(option) > markers(best))) best = option;
    return (best ?? config.options[0])?.id ?? "";
  }

  return {
    id: config.id,
    ...(config.label ? { label: config.label } : {}),
    options: config.options.map(({ id, label }) => ({ id, ...(label ? { label } : {}) })),
    current,
    subscribe(listener) {
      let previous = current();
      const observer = new MutationObserver(() => {
        const next = current();
        if (next !== previous) { previous = next; listener(); }
      });
      observer.observe(target(), { attributes: true });
      return () => observer.disconnect();
    },
    apply(optionId) {
      const option = config.options.find((item) => item.id === optionId);
      if (!option) return;
      const element = target();
      const style = (element as HTMLElement).style as CSSStyleDeclaration | undefined;
      initial ??= { option: current(), colorScheme: style?.colorScheme ?? "" };
      for (const other of config.options) {
        if (other === option) continue;
        element.classList.remove(...classesOf(other));
        for (const [name, value] of Object.entries(other.attribute ?? {}))
          if (element.getAttribute(name) === value && !(name in (option.attribute ?? {}))) element.removeAttribute(name);
      }
      element.classList.add(...classesOf(option));
      for (const [name, value] of Object.entries(option.attribute ?? {})) element.setAttribute(name, value);
      if (config.colorScheme && style)
        style.colorScheme = optionId === initial.option ? initial.colorScheme : option.colorScheme ?? option.id;
    },
  };
}
