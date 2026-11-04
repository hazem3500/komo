import { initComments } from "./index.js";
import { resolveConfig, type PaletteConfig } from "./config.js";
export type { PaletteConfig, KomoConfig } from "./config.js";

/** Bind generated public settings once; mount with optional per-site overrides. */
export function definePalette(config: PaletteConfig) {
  return (overrides: Partial<PaletteConfig> = {}) =>
    initComments(resolveConfig({ ...config, ...overrides }));
}

/** @deprecated Use `definePalette`. */
export const defineKomo = definePalette;
