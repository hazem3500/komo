export interface PaletteComponentsOptions {
  /**
   * Turn instrumentation on. Pass true only for builds that never reach customers, e.g.
   * `process.env.PREVIEW === "1"`. Off, the plugin has no hooks and the build is unchanged.
   */
  enabled?: boolean;
  /** Design-system packages (or package subpaths): every eligible component export is instrumented. */
  packages?: string[];
  /**
   * App components to instrument, relative to the Vite root: "src/cards/Card.tsx" for every
   * eligible export of that module, or "src/cards/Card.tsx#Card,CardHeader" for named ones.
   */
  components?: string[];
  /** Exports never to instrument. Default: names ending in Provider, Context or Icon. */
  exclude?(name: string, from: string): boolean;
  /** tsconfig used to read component types. Default: the nearest tsconfig.json from the root. */
  tsconfig?: string;
  /** Log how many components were instrumented. Default true. */
  report?: boolean;
}

/** Vite plugin; works with Vite 5 and later. */
export function paletteComponents(options?: PaletteComponentsOptions): {
  name: string;
  enforce?: "pre";
  [hook: string]: unknown;
};

export function defaultExclude(name: string): boolean;
