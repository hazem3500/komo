import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The PALETTE_ setting `name`, or its older KOMO_ name. */
export const setting = (env, name) => env[`PALETTE_${name}`] || env[`KOMO_${name}`] || undefined;

/**
 * Where a project keeps its settings and generated client module. New projects
 * use .palette/ and palette.config.js. A project set up before the rename keeps
 * .komo/ and komo.config.js, so its imports and ignored files stay valid.
 */
export function projectLayout(root) {
  return !existsSync(join(root, ".palette")) && existsSync(join(root, ".komo"))
    ? { dir: ".komo", module: "komo.config.js" }
    : { dir: ".palette", module: "palette.config.js" };
}

export function gitValue(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
export function repository(remote) {
  const match = remote.match(
    /^(?:https?:\/\/[^/]+\/|ssh:\/\/(?:[^@/]+@)?[^/]+\/|(?:[^@/]+@)?[^:/]+:)(.+?)(?:\.git)?\/?$/
  );
  return match?.[1] || "";
}
export function branchName(env, cwd) {
  return (
    setting(env, "BRANCH") ||
    env.CF_PAGES_BRANCH ||
    env.WORKERS_CI_BRANCH ||
    env.VERCEL_GIT_COMMIT_REF ||
    env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME ||
    env.BRANCH ||
    gitValue(["symbolic-ref", "--short", "HEAD"], cwd)
  );
}
export function clientModule(config) {
  return `import { definePalette } from '@hazem3500/palette/setup';\n\nexport const initPalette = definePalette(${JSON.stringify(config, null, 2)});\n\n/** @deprecated Use initPalette. */\nexport const initKomo = initPalette;\n`;
}
