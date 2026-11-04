import type { CommentsOptions } from "./types.js";

export type PaletteConfig = Omit<
  CommentsOptions,
  "repo" | "branch" | "endpoint"
> & {
  /** Your Palette server. Without it, Palette logs an error and does not mount. */
  endpoint?: string;
  repo?: string;
  /** Shared feedback across deployments by default. */
  scope?: "project" | "branch";
  /** Required only for branch scope; normally injected by the setup command. */
  branch?: string;
};

/** @deprecated Use `PaletteConfig`. */
export type KomoConfig = PaletteConfig;

export function resolveConfig(config: PaletteConfig): CommentsOptions {
  const { scope = "project", ...options } = config;
  if (scope === "branch" && !config.branch?.trim())
    throw new Error(
      "Branch scope needs a build-time branch. Run palette sync before your build or set branch explicitly."
    );
  return {
    ...options,
    endpoint: options.endpoint || "",
    repo: config.repo || config.project,
    branch: scope === "branch" ? config.branch! : "shared",
  };
}
