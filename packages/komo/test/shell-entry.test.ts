import { build } from "esbuild";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `@hazem3500/komo/shell` must vanish from a production build behind a build-time guard.
// A host entry, bundled and minified the way an app's production build would be.
async function bundle(dev: boolean, entry = resolve("src/shell.ts")) {
  const result = await build({
    stdin: {
      contents: `
        import { isShell } from ${JSON.stringify(entry)};
        if (import.meta.env.DEV && isShell("example-project")) console.log("shell-branch");
        else console.log("app-branch");
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    define: { "import.meta.env.DEV": String(dev) },
    write: false,
  });
  return result.outputFiles[0].text;
}

describe("shell entry", () => {
  it("drops out of a minified production build behind import.meta.env.DEV", async () => {
    const production = await bundle(false);
    expect(production).toContain("app-branch");
    for (const trace of ["shell-branch", "komo", "sessionStorage", "setTimeout", "location"])
      expect(production, trace).not.toContain(trace);
    // Nothing left but the app's own branch.
    expect(production.trim()).toBe('console.log("app-branch");');
  });

  it("stays in a development build, where the guard runs", async () => {
    const development = await bundle(true);
    for (const trace of ["shell-branch", "komo-shell", "komo:shell", "sessionStorage"])
      expect(development, trace).toContain(trace);
  });

  it("has no top-level side effects, so an unused import also vanishes", async () => {
    const result = await build({
      stdin: { contents: `import ${JSON.stringify(resolve("src/shell.ts"))}; console.log("app-branch");`, resolveDir: process.cwd(), loader: "ts" },
      bundle: true,
      minify: true,
      format: "esm",
      write: false,
      // Without the package's sideEffects hint: the module itself must be pure.
      ignoreAnnotations: true,
    });
    expect(result.outputFiles[0].text.trim()).toBe('console.log("app-branch");');
  });
});
